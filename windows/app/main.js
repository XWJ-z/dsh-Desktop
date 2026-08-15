'use strict';

/**
 * DSH-Desktop — Electron 主进程（纯套壳）
 *
 * 职责：
 *  1. 读取壳配置（app/config.json：DSH 包名 + 版本号，可随时改版本升级）
 *  2. 用内置 npm（随壳分发）把 `@deepseek-ai/dsh@<版本>` 安装到用户数据目录
 *     （首次运行联网下载，之后离线可用；与官方 `npx @deepseek-ai/dsh web` 同机制）
 *  3. 以子进程方式启动 `dsh web`（默认 127.0.0.1:3080，端口被占用时自动顺延）
 *  4. 等待 HTTP 服务就绪后，在原生窗口中加载 DeepSeek Harness Web GUI
 *  5. 退出时优雅地关闭 DSH 子进程
 *
 * 开发模式：使用系统 Node 运行 DSH（原生模块 ABI 与 node_modules 一致）
 * 打包模式：优先使用内置 Node（resources/node/node.exe，真实 Node，ABI 完全匹配）；
 *   Electron-as-Node（ELECTRON_RUN_AS_NODE）仅作兜底。
 *  —— 壳只提供运行环境，DSH 本体始终来自 npm 安装，更新 DSH 只改版本号，
 *     壳代码不受 DSH 版本影响。
 */

const { app, BrowserWindow, clipboard, dialog, Menu, shell, ipcMain } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const APP_NAME = 'DSH-Desktop';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3080;
const PORT_PROBE_RANGE = 50;          // 端口被占用时最多顺延多少个
const SERVER_READY_TIMEOUT_MS = 240_000; // 等待 dsh web 就绪的上限（含首次下载）
const CHILD_GRACE_MS = 5_000;         // 关闭子进程的宽限期
const NPM_INSTALL_TIMEOUT_MS = 600_000;  // 下载/安装 DSH 运行时的上限（10 分钟）

// 未捕获异常/拒绝：记录后继续（避免窗口服务抖动导致整体退出）
process.on('uncaughtException', (err) => {
  try { appendLog('error', `未捕获异常：${err && err.stack ? err.stack : String(err)}`); } catch { /* ignore */ }
});
process.on('unhandledRejection', (reason) => {
  try { appendLog('error', `未处理的 Promise 拒绝：${String(reason)}`); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// 运行时状态
// ---------------------------------------------------------------------------
let mainWindow = null;          // 主窗口（GUI）
let loadingWindow = null;       // 启动加载窗口
let updateWin = null;           // 更新窗口（v0.5.3 现代化）
let contactWin = null;          // 联系我们窗口（v0.5.3 现代化）
let aboutWin = null;            // 关于窗口（v0.5.3 现代化）
let serverChild = null;         // dsh web 服务子进程
let resolvedPort = DEFAULT_PORT;
let logLines = [];
let quitting = false;
let dshHasUpdate = false;       // 启动后静默检查发现 DSH 新版（菜单提示后缀）
let shellHasUpdate = false;     // 启动后静默检查发现壳（DSH-Desktop）新版（菜单提示后缀）
let lastCheckAt = 0;            // 手动检查更新冷却（10 秒防抖）
const CHECK_UPDATE_COOLDOWN_MS = 10_000;

// 登记所有由本进程派生的子进程（npm install + dsh 服务），退出时统一清理，
// 避免 Windows 下残留 node/npm 进程（审查 M1）。
const trackedChildren = new Set();
function trackChild(child, role) {
  child.role = role;
  trackedChildren.add(child);
  child.on('exit', () => trackedChildren.delete(child));
  child.on('error', () => trackedChildren.delete(child));
  return child;
}
function killTrackedChildren() {
  for (const child of trackedChildren) {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    } catch { /* ignore */ }
  }
}

/** 静默删除文件/目录（忽略一切错误） */
function rmQuiet(p) { try { fs.rmSync(p, { force: true }); } catch { /* ignore */ } }

// ---------------------------------------------------------------------------
// 日志：内存环形缓冲 + 落盘 + 广播给渲染进程
// ---------------------------------------------------------------------------
/** 本地时间戳（yyyy-MM-dd HH:mm:ss），解决 UTC 与北京时间差 8 小时 */
function localTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 本地日期（yyyy-MM-dd），用于日志文件名（避免深夜日志归到前一天） */
function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function logPath() {
  const stamp = localDate();
  const candidates = [
    path.join(app.getPath('userData'), 'logs'),
    path.join(app.getAppPath(), 'logs'),
    path.join(os.tmpdir(), 'dsh-desktop', 'logs'),
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return path.join(dir, `dsh-${stamp}.log`);
    } catch { /* try next */ }
  }
  return path.join(os.tmpdir(), `dsh-${stamp}.log`);
}

function appendLog(level, message) {
  const line = `[${localTimestamp()}] [${level}] ${message}`;
  logLines.push(line);
  if (logLines.length > 800) logLines.shift();
  try { fs.appendFileSync(logPath(), line + os.EOL); } catch { /* ignore */ }
  console.log(line);
  // 仅向启动加载窗口广播日志（审查 M3：GUI 窗口不监听 dsh:log，避免无效 IPC）
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.webContents.send('dsh:log', line);
  }
}

/** 当前启动阶段（L6：页面脚本就绪后可主动查询，避免错过早期推送） */
let currentStage = 'check';

/** 向启动加载窗口推送阶段（①检查 ②下载/安装 ③启动服务 ④就绪） */
function pushStage(stage) {
  currentStage = stage;
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.webContents.send('dsh:stage', stage);
  }
}

/** 向启动加载窗口推送下载/安装进度（{ mb: '23.4' }） */
function pushProgress(mb) {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.webContents.send('dsh:progress', { mb });
  }
}

/** 统计目录体积（MB，一位小数）；目录不存在/读取失败返回 '0.0' */
function dirSizeMB(dir) {
  try {
    let total = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else total += fs.statSync(p).size;
      }
    };
    walk(dir);
    return (total / 1024 / 1024).toFixed(1);
  } catch { return '0.0'; }
}

// ---------------------------------------------------------------------------
// 壳配置 / DSH 运行时管理（npx 机制）
// ---------------------------------------------------------------------------
/** 读取壳配置（app/config.json）：DSH 包名 + 版本号，用户改版本号即升级 DSH */
function readShellConfig() {
  const file = path.join(app.getAppPath(), 'config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      dshPackage: String(cfg.dshPackage || '@deepseek-ai/dsh'),
      dshVersion: String(cfg.dshVersion || 'latest'),
      registry: String(cfg.registry || 'https://registry.npmmirror.com'),
      qqGroup: cfg.qqGroup && typeof cfg.qqGroup === 'object'
        ? { number: String(cfg.qqGroup.number || ''), qrImage: String(cfg.qqGroup.qrImage || '') }
        : null,
    };
  } catch {
    return {
      dshPackage: '@deepseek-ai/dsh',
      dshVersion: 'latest',
      registry: 'https://registry.npmmirror.com',
      qqGroup: null,
    };
  }
}

/** DSH 运行时装在用户数据目录下（%APPDATA%\DSH-Desktop\dshenv） */
function dshRuntimeDir() {
  return path.join(app.getPath('userData'), 'dshenv');
}

/** 内置 npm-cli.js（npm 是纯 JS 包，随壳分发，供 npx 使用） */
function npmCliJs() {
  return path.join(app.getAppPath(), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

/** 目标 DSH 版本规格：`@deepseek-ai/dsh` 或 `@deepseek-ai/dsh@x.y.z` */
function dshSpec(cfg) {
  return cfg.dshVersion === 'latest' ? cfg.dshPackage : `${cfg.dshPackage}@${cfg.dshVersion}`;
}

/** 已安装到运行时的 DSH 入口（不存在返回 null） */
function installedDshBin() {
  const cfg = readShellConfig();
  const [scope, name] = cfg.dshPackage.startsWith('@')
    ? cfg.dshPackage.split('/')
    : ['', cfg.dshPackage];
  const dir = scope
    ? path.join(dshRuntimeDir(), 'node_modules', scope, name)
    : path.join(dshRuntimeDir(), 'node_modules', name);
  return path.join(dir, 'lib', 'bin.js');
}

/** 已安装 DSH 的实际版本（未安装返回 null） */
function installedDshVersion() {
  const cfg = readShellConfig();
  const [scope, name] = cfg.dshPackage.startsWith('@')
    ? cfg.dshPackage.split('/')
    : ['', cfg.dshPackage];
  const dir = scope
    ? path.join(dshRuntimeDir(), 'node_modules', scope, name)
    : path.join(dshRuntimeDir(), 'node_modules', name);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

/** 判断已安装版本是否满足配置要求 */
function dshUpToDate(cfg) {
  if (!fs.existsSync(installedDshBin())) return false;
  const installed = installedDshVersion();
  if (installed == null) return false;
  if (cfg.dshVersion === 'latest') return true; // latest：不主动降级/升级，用现有安装
  return installed === cfg.dshVersion;
}

/**
 * 确保 DSH 运行时已安装且版本匹配：缺失或版本不符时用内置 npm 执行
 * `npm install --prefix <dshenv> <pkg>@<version>`（等价于 npx 拉取机制）。
 * 首次运行需要联网；安装完成后即离线可用。
 * @returns 安装后的 DSH 入口 bin.js
 */
function ensureDshRuntime() {
  return new Promise((resolve, reject) => {
    const cfg = readShellConfig();
    if (dshUpToDate(cfg)) {
      appendLog('info', `DSH 运行时已就绪：${cfg.dshPackage}@${installedDshVersion()}`);
      pushStage('start');
      resolve(installedDshBin());
      return;
    }
    const runner = resolveRunner();
    const cli = npmCliJs();
    const spec = dshSpec(cfg);
    appendLog('info', `DSH 运行时未满足要求（配置 ${spec}，实际 ${installedDshVersion() ?? '未安装'}）`);
    appendLog('info', '首次运行需要联网下载 DSH 运行时，请稍候…');
    pushStage('install');

    // npm 12 默认阻止生命周期脚本。project-scoped 安装下不允许 `--allow-scripts`
    // CLI 参数（会直接报 EALLOWSCRIPTS 退出），正确做法是在项目 .npmrc 里配置
    // `allow-scripts`。我们在运行时目录预置 .npmrc，放行 DSH 依赖中的原生模块
    // 脚本（均自带 N-API 预编译，放行仅为保险）。
    // 同时写入 registry 配置：默认 npmmirror 镜像（国内可达），可被 config.json
    // 的 registry 字段覆盖；写 .npmrc 可让 npm 每次安装都命中同一镜像。
    try {
      const registry = cfg.registry || 'https://registry.npmmirror.com';
      fs.writeFileSync(
        path.join(dshRuntimeDir(), '.npmrc'),
        `allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs\nregistry=${registry}\n`,
        'utf8',
      );
    } catch (err) {
      appendLog('warn', `写入 .npmrc 失败（不影响安装）：${err.message}`);
    }

    const args = [
      cli,
      'install',
      '--prefix', dshRuntimeDir(),
      '--no-save',
      '--no-audit',
      '--no-fund',
      '--no-progress',
      '--loglevel', 'warn',
      spec,
    ];
    appendLog('info', `npm 命令：${runner.execPath} ${args.join(' ')}`);

    const env = {
      ...process.env,
      ...runner.env,
      // npm 需要知道用户级目录；确保缓存落在用户可写位置
      npm_config_cache: path.join(os.homedir(), 'AppData', 'Local', 'npm-cache'),
      npm_config_update_notifier: 'false',
    };

    let child;
    try {
      child = trackChild(
        spawn(runner.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false }),
        'npm-install',
      );
    } catch (err) {
      reject(err);
      return;
    }

    // 任务D2：安装期间每 2 秒统计运行时目录体积并推送到加载页（下载进度可视化）
    pushProgress(dirSizeMB(dshRuntimeDir()));
    const progressTimer = setInterval(() => {
      pushProgress(dirSizeMB(dshRuntimeDir()));
    }, 2000);

    const onData = (label) => (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.trim()) appendLog(label, line.trimEnd());
      }
    };
    child.stdout.on('data', onData('npm'));
    child.stderr.on('data', onData('npm:err'));

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      reject(new Error(`DSH 运行时下载超时（${NPM_INSTALL_TIMEOUT_MS / 1000}s）。请检查网络后重试。`));
    }, NPM_INSTALL_TIMEOUT_MS);

    child.on('error', (err) => {
      clearTimeout(timer);
      clearInterval(progressTimer);
      reject(err);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      clearInterval(progressTimer);
      if (code !== 0) {
        reject(new Error(`DSH 运行时安装失败（npm 退出码 ${code}）。请检查网络/源后重试。日志：${logPath()}`));
        return;
      }
      const bin = installedDshBin();
      if (!fs.existsSync(bin)) {
        reject(new Error('npm 安装成功但未找到 DSH 入口 bin.js，请检查配置的包名/版本。'));
        return;
      }
      appendLog('info', `DSH 运行时安装完成：${cfg.dshPackage}@${installedDshVersion()}`);
      pushStage('start');
      resolve(bin);
    });
  });
}

function findSystemNode() {
  const candidates = [
    process.env.SYSTEM_NODE,
    'C:\\Program Files\\nodejs\\node.exe',
    'C:\\Program Files (x86)\\nodejs\\node.exe',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  try {
    const out = execFileSync('where.exe', ['node'], { encoding: 'utf8', windowsHide: true });
    const first = out.split(/\r?\n/).map((line) => line.trim())
      .find((line) => line.toLowerCase().endsWith('node.exe'));
    if (first && fs.existsSync(first)) return first;
  } catch { /* ignore */ }
  return null;
}

/** 内置 Node 运行时路径（resources/node/node.exe），不存在返回 null */
function bundledNode() {
  const exe = path.join(app.getAppPath(), '..', 'node', 'node.exe');
  return fs.existsSync(exe) ? exe : null;
}

/**
 * 解析运行 DSH 的 Node 运行时。
 *
 * 优先级（审查 H3：原生模块按 Node ABI 编译，须用真实 Node 运行）：
 *  1. 打包模式：内置 Node（resources/node/node.exe）——真实 Node，ABI 完全匹配；
 *  2. 开发模式：系统 Node；
 *  3. 兜底：Electron-as-Node（ELECTRON_RUN_AS_NODE），此时 DSH 原生模块可能
 *     ABI 不兼容（目录选择器/图片处理等受限），仅作最后手段。
 */
function resolveRunner() {
  if (app.isPackaged) {
    const bundled = bundledNode();
    if (bundled) {
      return { execPath: bundled, env: {}, label: `内置 Node (${bundled})` };
    }
    return { execPath: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, label: 'Electron 自带 Node（打包兜底）' };
  }
  const sysNode = findSystemNode();
  if (sysNode) {
    return { execPath: sysNode, env: {}, label: `系统 Node (${sysNode})` };
  }
  return { execPath: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, label: 'Electron 自带 Node（开发降级）' };
}

// ---------------------------------------------------------------------------
// 端口探测 / 服务就绪探测
// ---------------------------------------------------------------------------
function isPortFree(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: DEFAULT_HOST, port });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(true));
  });
}

async function pickPort(preferred) {
  for (let port = preferred; port < preferred + PORT_PROBE_RANGE; port++) {
    if (await isPortFree(port)) return port;
  }
  return preferred;
}

function waitForServer(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() > deadline) {
        reject(new Error(`等待 DSH 服务就绪超时（${timeoutMs / 1000}s）：http://${host}:${port}`));
        return;
      }
      const req = http.get({ host, port, path: '/', timeout: 2000 }, (res) => {
        res.resume();
        resolve(true);
      });
      req.on('timeout', () => { req.destroy(); setTimeout(attempt, 500); });
      req.on('error', () => setTimeout(attempt, 500));
    };
    attempt();
  });
}

function parsePortArg() {
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) {
      const port = Number(argv[i + 1]);
      if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
    }
    const match = /^--port=(\d+)$/.exec(argv[i]);
    if (match) {
      const port = Number(match[1]);
      if (port > 0 && port <= 65535) return port;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// DSH 服务子进程
// ---------------------------------------------------------------------------
function stopServer() {
  if (quitting) return;
  quitting = true;
  appendLog('info', '正在关闭 DSH 服务…');
  // 统一清理所有派生子进程（npm install + dsh 服务），防止 Windows 残留（审查 M1）
  killTrackedChildren();
  setTimeout(() => {
    // 宽限期后仍未退出的子进程强制结束
    for (const child of trackedChildren) {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      } catch { /* ignore */ }
    }
  }, CHILD_GRACE_MS);
}

function spawnServer(port) {
  return new Promise((resolve, reject) => {
    ensureDshRuntime()
      .then((dshBin) => {
        const runner = resolveRunner();
        // 仅 Electron-as-Node 兜底时需要 --expose-internals（DSH HMR 需要 Node
        // 内部模块 loader）；真实 Node（内置/系统）下经 node-addon-require-builtin
        // 原生插件获取，无需该参数。
        const runnerArgs = runner.env.ELECTRON_RUN_AS_NODE === '1' ? ['--expose-internals'] : [];
        const args = [
          ...runnerArgs,
          dshBin,
          'web',
          '--host', DEFAULT_HOST,
          '--port', String(port),
        ];
        const cfg = readShellConfig();
        appendLog('info', `DSH 入口：${dshBin}（${cfg.dshPackage}@${installedDshVersion() ?? '?'}）`);
        appendLog('info', `DSH 运行器：${runner.label}`);
        appendLog('info', `启动命令：${runner.execPath} ${args.join(' ')}`);

        const env = { ...process.env, ...runner.env };
        if (!process.env.DSH_TELEMETRY_DISABLED) env.DSH_TELEMETRY_DISABLED = '1';

        let child;
        try {
          child = trackChild(
            spawn(runner.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false }),
            'dsh-server',
          );
        } catch (err) {
          reject(err);
          return;
        }
        serverChild = child;

        child.stdout.on('data', (chunk) => {
          for (const line of chunk.toString().split(/\r?\n/)) {
            if (line.trim()) appendLog('dsh', line.trimEnd());
          }
        });
        child.stderr.on('data', (chunk) => {
          for (const line of chunk.toString().split(/\r?\n/)) {
            if (line.trim()) appendLog('dsh:err', line.trimEnd());
          }
        });
        child.on('error', (err) => {
          appendLog('error', `DSH 进程启动失败：${err.message}`);
          reject(err);
        });
        child.on('exit', (code, signal) => {
          appendLog('warn', `DSH 进程退出 code=${code} signal=${signal}`);
          if (quitting) return;
          // 服务意外退出：提示用户
          if (mainWindow && !mainWindow.isDestroyed()) {
            const message = `DSH 服务意外退出（code=${code}, signal=${signal}）。\n\n详细日志：${logPath()}`;
            dialog.showMessageBox(mainWindow, { type: 'error', title: APP_NAME, message, buttons: ['重新加载', '退出'] })
              .then(({ response }) => {
                if (response === 0) {
                  spawnServer(resolvedPort).then(() => {
                    waitForServer(DEFAULT_HOST, resolvedPort, SERVER_READY_TIMEOUT_MS)
                      .then(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(webUrl()); })
                      .catch((err2) => appendLog('error', String(err2)));
                  }).catch((err2) => appendLog('error', String(err2)));
                } else {
                  app.quit();
                }
              });
          }
        });

        resolve(child);
      })
      .catch(reject);
  });
}

function webUrl() {
  return `http://${DEFAULT_HOST}:${resolvedPort}`;
}

// ---------------------------------------------------------------------------
// 窗口
// ---------------------------------------------------------------------------
function attachWebDiagnostics(win, label) {
  win.webContents.on('did-start-loading', () => {
    appendLog('info', `[${label}] 开始加载：${win.webContents.getURL()}`);
  });
  win.webContents.on('did-finish-load', () => {
    appendLog('info', `[${label}] 加载完成：${win.webContents.getURL()}`);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    appendLog('error', `[${label}] 加载失败 (${errorCode}) ${errorDescription} @ ${validatedURL}`);
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    appendLog('error', `[${label}] 渲染进程退出：${JSON.stringify(details)}`);
    // 审查 M2：GUI 渲染进程崩溃/无响应时弹窗提示，给出重载入口
    if (label === 'gui' && !quitting) {
      dialog.showMessageBox(win, {
        type: 'error',
        title: APP_NAME,
        message: '界面异常，请重新加载',
        detail: `渲染进程已退出（${details.reason}）。\n详细日志：${logPath()}`,
        buttons: ['重新加载', '退出'],
      }).then(({ response }) => {
        if (response === 0 && !win.isDestroyed()) {
          try { win.reload(); } catch { /* ignore */ }
        } else {
          app.quit();
        }
      });
    }
  });
  win.on('unresponsive', () => {
    appendLog('warn', `[${label}] 窗口无响应`);
    if (label === 'gui' && !quitting) {
      dialog.showMessageBox(win, {
        type: 'warning',
        title: APP_NAME,
        message: '界面无响应',
        detail: '窗口可能卡住了，可等待或重新加载。',
        buttons: ['等待', '重新加载'],
      }).then(({ response }) => {
        if (response === 1 && !win.isDestroyed()) {
          try { win.reload(); } catch { /* ignore */ }
        }
      });
    }
  });
}

/** 启动加载窗口（1280×820，显示阶段与日志；服务就绪后关闭，不承载 GUI） */
function createLoadingWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    title: APP_NAME,
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, 'renderer', 'loading.html'), { query: { port: String(resolvedPort) } });
  win.on('closed', () => { if (loadingWindow === win) loadingWindow = null; });
  loadingWindow = win;
  return win;
}

/** 主窗口（1440×900，承载 DSH Web GUI）；GUI 加载期间显示过渡覆盖层（H2） */
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    backgroundColor: '#0f1115',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  mainWindow = win;

  // GUI 加载过渡覆盖层：loadURL 前先显示"正在加载界面…"，did-finish-load 后隐藏
  win.webContents.on('did-start-loading', () => {
    appendLog('info', `[gui] 开始加载：${win.webContents.getURL()}`);
    win.webContents.executeJavaScript(`
      if (!document.getElementById('dsh-loading-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'dsh-loading-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0f1115;color:#dbe2f0;font-family:Segoe UI,Microsoft YaHei,sans-serif;font-size:16px;';
        overlay.textContent = '正在加载界面…';
        document.body.appendChild(overlay);
      }
    `).catch(() => { /* 文档可能尚未就绪 */ });
  });
  win.webContents.on('did-finish-load', () => {
    appendLog('info', `[gui] 加载完成：${win.webContents.getURL()}`);
    win.webContents.executeJavaScript(`
      const overlay = document.getElementById('dsh-loading-overlay');
      if (overlay) overlay.remove();
    `).catch(() => { /* ignore */ });
  });
  attachWebDiagnostics(win, 'gui');

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(webUrl())) event.preventDefault();
  });
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });

  appendLog('info', `加载 DSH Web GUI：${webUrl()}`);
  win.loadURL(webUrl());
  return win;
}

// ---------------------------------------------------------------------------
// DSH 版本检查（任务B：查询 npm registry + 语义化比较 + 升级改写 config.json）
// 约定：全程只动壳（config.json），DSH 本体零接触；失败一律静默（返回 null/false）
// ---------------------------------------------------------------------------
/** GET 并解析 JSON；失败/超时返回 null（静默） */
function fetchJson(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(url, { timeout: timeoutMs }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    } catch {
      if (req) { try { req.destroy(); } catch { /* ignore */ } }
      resolve(null);
    }
  });
}

/** 查询 npm registry 上 DSH 最新版本（dist-tags.latest）；失败返回 null */
function fetchLatestDshVersion() {
  const cfg = readShellConfig();
  const pkgPath = cfg.dshPackage.replace('/', '%2f'); // scoped 包需编码 /
  const base = (cfg.registry || 'https://registry.npmmirror.com').replace(/\/$/, '');
  return fetchJson(`${base}/${pkgPath}`).then((pkg) => pkg?.['dist-tags']?.latest ?? null);
}

/**
 * 语义化比较（semver 2.0 子集），支持 -rc.x 预发布：
 *  - 主版本号 x.y.z 数字比较；
 *  - 预发布号按点分段比较，数字段数值比较、字母段字典序，段多者大；
 *  - 无预发布号（正式版）> 有预发布号；
 *  - 任一版本不是合法 semver（如 "latest"）→ 返回 0（无法比较，不误报）。
 * 返回 1 / 0 / -1。
 */
function compareSemver(a, b) {
  const sa = String(a), sb = String(b);
  if (!/^\d+\.\d+\.\d+/.test(sa) || !/^\d+\.\d+\.\d+/.test(sb)) return 0; // 非 semver 无法比较
  const va = sa.split('-')[0].split('.').map(Number), vb = sb.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = va[i] || 0, y = vb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  // 预发布号取首个 '-' 之后的全段（split 会切开 rc.6-alpha 这类复合号，故用 indexOf）
  const ra = sa.includes('-') ? sa.slice(sa.indexOf('-') + 1) : '';
  const rb = sb.includes('-') ? sb.slice(sb.indexOf('-') + 1) : '';
  if (ra === '' && rb === '') return 0;
  if (ra === '') return 1;                     // 正式版 > 预发布
  if (rb === '') return -1;
  const fa = ra.split('.'), fb = rb.split('.');
  for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
    const xa = fa[i], xb = fb[i];
    if (xa === undefined) return -1;           // 段少者小
    if (xb === undefined) return 1;
    const na = /^\d+$/.test(xa) ? Number(xa) : null;
    const nb = /^\d+$/.test(xb) ? Number(xb) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na > nb ? 1 : -1;  // 数字段数值比较（rc.10 > rc.9）
    } else if (xa !== xb) {
      return xa > xb ? 1 : -1;                 // 字母段字典序
    }
  }
  return 0;
}

/** 备份并改写 config.json 的 dshVersion；成功返回 true */
function updateDshVersion(newVersion) {
  const file = path.join(app.getAppPath(), 'config.json');
  try {
    fs.copyFileSync(file, `${file}.bak`);          // 先备份
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    cfg.dshVersion = newVersion;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// 更新窗口逻辑层（v0.5.3）：查询/升级/下载，返回数据不弹 dialog，UI 由 update.html 负责
// ---------------------------------------------------------------------------
/**
 * 查询壳+DSH 两侧更新信息（并发，各自静默）。
 * 返回 { dsh: { current, latest, notes, updating }, shell: { current, latest, notes, force, downloading } }
 *  - latest 为 null 表示查询失败/无源
 */
async function queryUpdateInfo() {
  const cfg = readShellConfig();
  const [dshLatest, shellLatest] = await Promise.all([
    fetchLatestDshVersion(),
    fetchLatestShellVersion(),
  ]);
  const dshCurrent = installedDshVersion() ?? cfg.dshVersion;
  const dshNotes = dshLatest && compareSemver(dshCurrent, dshLatest) < 0
    ? `可升级到 ${dshLatest}（重启自动安装）`
    : '';
  return {
    dsh: {
      current: dshCurrent,
      latest: dshLatest,
      notes: dshNotes,
      updating: false,
    },
    shell: {
      current: app.getVersion(),
      latest: shellLatest ? shellLatest.version : null,
      notes: shellLatest ? shellLatest.releaseNotes : '',
      force: shellLatest ? shellLatest.force : false,
      downloading: false,
    },
  };
}

/** DSH 升级：备份+改写 config.json 的 dshVersion → relaunch 重启安装 */
function upgradeDshVersion() {
  const cfg = readShellConfig();
  const current = installedDshVersion() ?? cfg.dshVersion;
  return fetchLatestDshVersion().then((latest) => {
    if (!latest || compareSemver(current, latest) >= 0) return { ok: false, reason: 'no-update' };
    if (updateDshVersion(latest)) {
      return { ok: true, from: current, to: latest };
    }
    return { ok: false, reason: 'write-failed' };
  });
}

/** 壳更新下载：多镜像逐个 fallback → SHA256 校验 → 打开安装包；进度经 onProgress(0~100) 回调 */
async function downloadShellUpdate(win, onProgress) {
  const owner = win || mainWindow;
  const info = await fetchLatestShellVersion();
  if (!info) return { ok: false, reason: 'fetch-failed' };
  const current = app.getVersion();
  if (compareSemver(current, info.version) >= 0) return { ok: false, reason: 'no-update' };

  const dest = shellDownloadDest(info);
  const urls = info.downloadUrls.length > 0
    ? info.downloadUrls
    : [`https://mirror.ghproxy.com/https://github.com/XWJ-z/dsh-Desktop/releases/download/v${info.version}/DSH-Desktop-Setup-${info.version}.exe`];
  let lastErr = null;
  for (const url of urls) {
    try {
      appendLog('info', `开始下载 DSH-Desktop v${info.version}：${url}`);
      await downloadFile(url, dest, (ratio) => {
        if (onProgress) onProgress(Math.round(ratio * 100));
        appendLog('info', `下载进度：${Math.round(ratio * 100)}%`);
      });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      appendLog('warn', `下载失败（${url}）：${err.message}，尝试下一个镜像…`);
    }
  }
  if (lastErr) return { ok: false, reason: 'download-failed', message: lastErr.message };

  // SHA256 校验（hash 缺失时跳过）
  if (info.hash) {
    const actual = await sha256File(dest);
    if (actual !== info.hash) {
      rmQuiet(dest);
      appendLog('error', `安装包 SHA256 校验失败：期望 ${info.hash}，实际 ${actual}`);
      return { ok: false, reason: 'hash-mismatch' };
    }
    appendLog('info', '安装包 SHA256 校验通过');
  }
  appendLog('info', `DSH-Desktop v${info.version} 下载完成：${dest}`);
  shell.openPath(dest);
  return { ok: true, version: info.version, path: dest };
}

// ---------------------------------------------------------------------------
// 壳（DSH-Desktop）自动更新（v0.5）：GitHub version.json via jsDelivr + 镜像下载
// 与「检查 DSH 更新」（官方 DSH 包）完全独立：本区检查的是壳自身版本
// ---------------------------------------------------------------------------
const SHELL_UPDATE_URL = 'https://cdn.jsdelivr.net/gh/XWJ-z/dsh-Desktop@main/version.json';

/**
 * 查询壳最新版本（GitHub 仓库 version.json，经 jsDelivr CDN 国内可达）。
 * 返回 { version, download_urls, release_notes, force, hash } 或 null（失败/超时静默）。
 */
function fetchLatestShellVersion() {
  return fetchJson(SHELL_UPDATE_URL).then((info) => {
    if (!info || typeof info.version !== 'string') return null;
    return {
      version: String(info.version),
      downloadUrls: Array.isArray(info.download_urls) ? info.download_urls.map(String) : [],
      releaseNotes: String(info.release_notes || ''),
      force: !!info.force,
      hash: String(info.hash || '').toLowerCase(),
    };
  });
}

/** 下载文件到 dest，带进度回调（0~1）；自动跟随重定向 */
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    let req;
    const start = (target) => {
      const file = fs.createWriteStream(dest);
      req = https.get(target, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req.destroy();
          file.close(() => start(res.headers.location));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume(); // 消费响应体，让流正常结束
          file.on('close', () => {
            rmQuiet(dest);
            reject(new Error(`HTTP ${res.statusCode}`));
          });
          file.end();
          return;
        }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        res.on('data', (c) => {
          received += c.length;
          if (total && onProgress) onProgress(received / total);
        });
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
        file.on('error', (err) => { rmQuiet(dest); reject(err); });
      });
      req.on('error', (err) => { rmQuiet(dest); reject(err); });
    };
    start(url);
  });
}

/** 计算文件 SHA256（hex） */
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/** 下载安装包到用户数据目录 updates/ 下，返回本地路径 */
function shellDownloadDest(info) {
  const dir = path.join(app.getPath('userData'), 'updates');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const file = path.join(dir, `DSH-Desktop-Setup-${info.version}.exe`);
  rmQuiet(file); // 清掉上次残留
  return file;
}

// ---------------------------------------------------------------------------
// 现代化窗口（v0.5.3）：更新 / 联系我们 / 关于（安全基线：contextIsolation+sandbox）
// ---------------------------------------------------------------------------
/** 安全基线 webPreferences（新窗口统一使用） */
function secureWebPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
}

/** 现代化更新窗口（深色卡片风；壳+DSH 一个窗口） */
function openUpdateWindow() {
  if (updateWin && !updateWin.isDestroyed()) { updateWin.focus(); return; }
  updateWin = new BrowserWindow({
    width: 560, height: 640, resizable: false, minimizable: false,
    parent: mainWindow, modal: true, title: '检查更新',
    backgroundColor: '#0f1115',
    webPreferences: secureWebPreferences(),
  });
  updateWin.loadFile(path.join(__dirname, 'renderer', 'update.html'));
  updateWin.on('closed', () => { updateWin = null; });
}

/** 联系我们窗口（QQ群二维码+群号+复制） */
function openContactWindow() {
  if (contactWin && !contactWin.isDestroyed()) { contactWin.focus(); return; }
  contactWin = new BrowserWindow({
    width: 400, height: 560, resizable: false, minimizable: false,
    parent: mainWindow, modal: true, title: '联系我们',
    backgroundColor: '#0f1115',
    webPreferences: secureWebPreferences(),
  });
  contactWin.loadFile(path.join(__dirname, 'renderer', 'contact.html'));
  contactWin.on('closed', () => { contactWin = null; });
}

/** 关于窗口（现代化：版本信息卡片 + 链接按钮） */
function openAboutWindow() {
  if (aboutWin && !aboutWin.isDestroyed()) { aboutWin.focus(); return; }
  aboutWin = new BrowserWindow({
    width: 420, height: 560, resizable: false, minimizable: false,
    parent: mainWindow, modal: true, title: '关于 DSH-Desktop',
    backgroundColor: '#0f1115',
    webPreferences: secureWebPreferences(),
  });
  aboutWin.loadFile(path.join(__dirname, 'renderer', 'about.html'));
  aboutWin.on('closed', () => { aboutWin = null; });
}

// ---------------------------------------------------------------------------
// 菜单
// ---------------------------------------------------------------------------
function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '重新加载界面', accelerator: 'CmdOrCtrl+R', click: () => { if (mainWindow) mainWindow.reload(); } },
        {
          label: '打开日志目录',
          click: () => { shell.openPath(path.dirname(logPath())); },
        },
        {
          label: '打开数据目录',
          click: () => { shell.openPath(app.getPath('userData')); },
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'F12', click: () => { if (mainWindow) mainWindow.webContents.toggleDevTools(); } },
      ],
    },
    {
      label: '更新',
      submenu: [
        {
          label: `检查更新${shellHasUpdate || dshHasUpdate ? '（有新版本）' : ''}`,
          click: () => { openUpdateWindow(); },
        },
      ],
    },
    {
      label: '关于我们',
      submenu: [
        {
          label: '联系我们',
          click: () => { openContactWindow(); },
        },
        {
          label: '关于 DSH-Desktop',
          click: () => { openAboutWindow(); },
        },
        { type: 'separator' },
        {
          label: 'DeepSeek 官网',
          click: () => { shell.openExternal('https://www.deepseek.com'); },
        },
        {
          label: 'DSH 项目主页',
          click: () => { shell.openExternal('https://github.com/deepseek-ai/dsh'); },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

/** 启动后静默检查更新：有新版 → 置标志 + 日志 + 重建菜单（不打扰） */
function silentCheckUpdate(name, fetchFn, getCurrent, setFlag) {
  fetchFn().then((info) => {
    if (!info) return;
    const current = getCurrent();
    const latest = typeof info === 'object' ? info.version : info;
    if (latest && compareSemver(current, latest) < 0) {
      setFlag(true);
      appendLog('info', `${name} 有新版本：${current} → ${latest}（菜单"帮助 → 检查更新"）`);
      Menu.setApplicationMenu(buildMenu());
    }
  });
}

// ---------------------------------------------------------------------------
// 应用生命周期
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(buildMenu());
    ipcMain.handle('dsh:version', () => app.getVersion());
    ipcMain.handle('dsh:installed-dsh-version', () => installedDshVersion());
    ipcMain.handle('dsh:port', () => resolvedPort);
    ipcMain.handle('dsh:stage', () => currentStage); // L6：页面就绪后查询当前阶段

    // v0.5.3：更新窗口 / 联系我们 IPC
    ipcMain.handle('update:query', () => queryUpdateInfo());
    ipcMain.handle('update:dsh-upgrade', () => upgradeDshVersion());
    ipcMain.handle('update:shell-download', () => {
      return downloadShellUpdate(updateWin || mainWindow, (percent) => {
        if (updateWin && !updateWin.isDestroyed()) {
          updateWin.webContents.send('update:progress', { percent });
        }
      });
    });
    ipcMain.handle('clip:copy', (_e, text) => {
      clipboard.writeText(String(text ?? ''));
      return true;
    });
    // 联系我们窗口：向渲染进程提供二维码路径与群号（文件路径经 IPC 传递最稳）
    ipcMain.handle('contact:info', () => {
      const group = readShellConfig().qqGroup;
      const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
      if (!group || !group.number) {
        return { number: '', qrPath: null, iconPath: fs.existsSync(iconPath) ? iconPath : null };
      }
      let qrPath = group.qrImage;
      if (qrPath && !path.isAbsolute(qrPath)) qrPath = path.join(app.getAppPath(), qrPath);
      return {
        number: group.number,
        qrPath: fs.existsSync(qrPath) ? qrPath : null,
        iconPath: fs.existsSync(iconPath) ? iconPath : null,
      };
    });
    // 关于窗口：版本信息 + 图标 + 动作
    ipcMain.handle('about:info', async () => {
      const cfg = readShellConfig();
      const [dshLatest, shellLatest] = await Promise.all([
        fetchLatestDshVersion(),
        fetchLatestShellVersion(),
      ]);
      const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
      return {
        appVersion: app.getVersion(),
        dsh: `${cfg.dshPackage}@${installedDshVersion() ?? cfg.dshVersion}`,
        dshLatest: dshLatest ?? '未知',
        shellLatest: shellLatest ? shellLatest.version : '未知',
        shellNewer: !!(shellLatest && compareSemver(app.getVersion(), shellLatest.version) < 0),
        url: webUrl(),
        iconPath: fs.existsSync(iconPath) ? iconPath : null,
      };
    });
    // 关于窗口动作：打开更新窗口（关闭关于）、打开外部链接
    ipcMain.handle('about:open-update', () => {
      if (aboutWin && !aboutWin.isDestroyed()) aboutWin.close();
      openUpdateWindow();
      return true;
    });
    ipcMain.handle('app:open-external', (_e, url) => {
      if (typeof url === 'string' && /^https?:/i.test(url)) shell.openExternal(url);
      return true;
    });

    resolvedPort = parsePortArg() ?? await pickPort(DEFAULT_PORT);
    appendLog('info', `${APP_NAME} v${app.getVersion()} 启动，目标端口 ${resolvedPort}`);
    appendLog('info', `用户数据目录：${app.getPath('userData')}`);
    appendLog('info', `DSH 运行器策略：${resolveRunner().label}`);

    createLoadingWindow();
    attachWebDiagnostics(loadingWindow, 'loading');
    pushStage('check');

    try {
      await spawnServer(resolvedPort);
      await waitForServer(DEFAULT_HOST, resolvedPort, SERVER_READY_TIMEOUT_MS);
      appendLog('info', `DSH 服务就绪：${webUrl()}`);
      pushStage('ready');

      // 任务B-B4：启动后静默检查一次 DSH 更新（不打扰；有新版仅日志 + 菜单提示后缀）
      silentCheckUpdate('DSH', fetchLatestDshVersion,
        () => installedDshVersion() ?? readShellConfig().dshVersion,
        (v) => { dshHasUpdate = v; });

      // 任务G1：启动后静默检查一次壳更新（DSH-Desktop 自身版本）
      silentCheckUpdate('DSH-Desktop', fetchLatestShellVersion,
        () => app.getVersion(),
        (v) => { shellHasUpdate = v; });

      // 审查 H2：服务就绪后关闭 loading 窗口，新建 1440×900 主窗口承载 GUI
      if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
      loadingWindow = null;
      createMainWindow();
    } catch (err) {
      appendLog('error', `启动失败：${err.message}`);
      if (loadingWindow && !loadingWindow.isDestroyed()) {
        // L5：HTML 转义先 & 后其他（审查 v2.0 低危项）
        const esc = String(err.message)
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        loadingWindow.webContents.executeJavaScript(
          `document.body.insertAdjacentHTML('beforeend',
            '<div style="position:fixed;inset:auto 0 0 0;padding:14px 20px;background:#3a1414;color:#ffb4b4;font-size:13px;text-align:center;">启动失败：${esc}</div>')`,
        ).catch(() => { /* ignore */ });
      }
      dialog.showErrorBox(APP_NAME, `无法启动 DSH 服务：\n${err.message}\n\n详细日志：${logPath()}`);
      stopServer(); // 清理可能残留的子进程（审查 M1）
      app.quit();
    }
  });

  app.on('before-quit', () => { stopServer(); });
  app.on('will-quit', () => { appendLog('info', '应用退出中…'); });
  app.on('quit', (_event, exitCode) => { appendLog('info', `应用已退出，code=${exitCode}`); });
  app.on('window-all-closed', () => { app.quit(); });
  app.on('activate', () => {
    // Windows-only 应用；若服务已就绪且无窗口，重建主窗口（审查 L4）
    if (BrowserWindow.getAllWindows().length === 0 && serverChild) createMainWindow();
  });
}
