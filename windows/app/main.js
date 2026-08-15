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

const { app, BrowserWindow, clipboard, dialog, Menu, screen, shell, ipcMain, Tray } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tar = require('tar'); // v0.7.0：数据备份/恢复（package.json dependencies 已显式声明，随包分发）

const APP_NAME = 'DSH-Desktop';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3080;
const PORT_PROBE_RANGE = 50;          // 端口被占用时最多顺延多少个
const SERVER_READY_TIMEOUT_MS = 240_000; // 等待 dsh web 就绪的上限（含首次下载）
const CHILD_GRACE_MS = 5_000;         // 关闭子进程的宽限期
const NPM_INSTALL_TIMEOUT_MS = 600_000;  // 下载/安装 DSH 运行时的上限（10 分钟）

// 未捕获异常/拒绝：记录后继续（避免窗口服务抖动导致整体退出）；
// ENOENT 等致命错误（P2-8）额外弹窗提示，避免静默不稳定态
process.on('uncaughtException', (err) => {
  try { appendLog('error', `未捕获异常：${err && err.stack ? err.stack : String(err)}`); } catch { /* ignore */ }
  const code = err && err.code;
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
    try {
      dialog.showErrorBox(APP_NAME,
        `发生系统级错误（${code}）：${err && err.message ? err.message : String(err)}\n\n请检查文件/网络权限后重试。`);
    } catch { /* ignore */ }
  }
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
// v0.6.0（T-025）：系统托盘
let tray = null;                // 托盘图标
let isQuitting = false;         // 真正退出标志（区分"关窗隐藏"与"退出"）
let trayExitConfirmed = false;  // 本会话首次托盘「退出」弹确认；取消后重置

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

const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024; // P2-6：单日日志超 5MB 轮转
let logFilePath = null;                       // 当前日志文件（含轮转后缀），缓存避免重复探测

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
      // P2-6：若当前文件超限，轮转到 dsh-YYYY-MM-DD-N.log（N 递增）
      const base = path.join(dir, `dsh-${stamp}.log`);
      if (!logFilePath || path.dirname(logFilePath) !== dir || !fs.existsSync(logFilePath)) {
        if (!fs.existsSync(base) || fs.statSync(base).size < MAX_LOG_FILE_BYTES) {
          logFilePath = base;
        } else {
          let n = 1;
          while (fs.existsSync(path.join(dir, `dsh-${stamp}-${n}.log`))) n++;
          logFilePath = path.join(dir, `dsh-${stamp}-${n}.log`);
        }
      }
      return logFilePath;
    } catch { /* try next */ }
  }
  return path.join(os.tmpdir(), `dsh-${stamp}.log`);
}

function appendLog(level, message) {
  const line = `[${localTimestamp()}] [${level}] ${message}`;
  logLines.push(line);
  if (logLines.length > 800) logLines.shift();
  try {
    // P2-6：写前检查当前文件是否超限，超限则强制下次轮转（重置缓存）
    if (logFilePath && fs.existsSync(logFilePath) &&
        fs.statSync(logFilePath).size >= MAX_LOG_FILE_BYTES) {
      logFilePath = null;
    }
    fs.appendFileSync(logPath(), line + os.EOL);
  } catch { /* ignore */ }
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

/** 已安装 DSH 包目录：<dshenv>/node_modules/<scope>/<name>（P2-3 抽取公共函数） */
function dshPkgDir() {
  const cfg = readShellConfig();
  const [scope, name] = cfg.dshPackage.startsWith('@')
    ? cfg.dshPackage.split('/')
    : ['', cfg.dshPackage];
  return scope
    ? path.join(dshRuntimeDir(), 'node_modules', scope, name)
    : path.join(dshRuntimeDir(), 'node_modules', name);
}

/** 已安装到运行时的 DSH 入口（不存在返回 null） */
function installedDshBin() {
  return path.join(dshPkgDir(), 'lib', 'bin.js');
}

/** 已安装 DSH 的实际版本（未安装返回 null） */
function installedDshVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dshPkgDir(), 'package.json'), 'utf8'));
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
    const registry = cfg.registry || 'https://registry.npmmirror.com';
    try {
      // v0.7.3（T-034）：目录可能尚不存在（npm --prefix 安装时才创建），先建再写，
      // 否则首次运行 .npmrc 写失败 → allow-scripts 不生效 → 原生模块脚本被 npm 12 拦截
      fs.mkdirSync(dshRuntimeDir(), { recursive: true });
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
      // v0.7.4（T-035）：registry 直接走 CLI 参数，不依赖 .npmrc 写入成败 ——
      // .npmrc 写失败（如权限）时若回落官方源 registry.npmjs.org，国内网络
      // 下载会卡死（600s 超时），CLI 参数保证始终命中配置/默认镜像
      '--registry', registry,
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
      // v0.7.3（T-034）：内置 Node 目录加入 PATH —— 无系统 Node 的机器上，
      // koffi 等依赖的 install 脚本（cmd /c node ./cnoke.cjs）才能找到 node 命令
      PATH: `${path.dirname(runner.execPath)}${path.delimiter}${process.env.PATH || ''}`,
      // npm 需要知道用户级目录；确保缓存落在用户可写位置
      npm_config_cache: path.join(os.homedir(), 'AppData', 'Local', 'npm-cache'),
      npm_config_update_notifier: 'false',
    };

    let child;
    try {
      child = trackChild(
        spawn(runner.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
        'npm-install',
      );
    } catch (err) {
      reject(err);
      return;
    }

    // 任务D2：安装期间每 2 秒统计"dshenv + npm 缓存"总量并推送到加载页
    // （下载进度可视化：npm 先写缓存、解压才写 dshenv，仅统计 dshenv 会恒为 0）
    const npmCacheDir = process.env.npm_config_cache || path.join(os.homedir(), 'AppData', 'Local', 'npm-cache');
    const installTotalMB = () =>
      (parseFloat(dirSizeMB(dshRuntimeDir())) + parseFloat(dirSizeMB(npmCacheDir))).toFixed(1);
    pushProgress(installTotalMB());
    const progressTimer = setInterval(() => {
      pushProgress(installTotalMB());
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
            spawn(runner.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
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

/**
 * T5（v0.6.6）：窗口 bounds 有效性校验 —— 记忆的位置/大小须在任一屏幕可见区域内，
 * 防止分辨率变化/拔显示器导致窗口跑到屏幕外。
 */
function isValidBounds(b) {
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number' ||
      typeof b.width !== 'number' || typeof b.height !== 'number') return false;
  if (b.width < 400 || b.height < 300) return false; // 过小丢弃
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width && b.x + b.width > a.x &&
           b.y < a.y + a.height && b.y + b.height > a.y;
  });
}

/** 主窗口（1440×900，承载 DSH Web GUI）；GUI 加载期间显示过渡覆盖层（H2）；还原窗口状态记忆（T5） */
function createMainWindow() {
  // T5（v0.6.6）：窗口状态记忆 —— 还原上次位置/大小/最大化
  const b = settings.winBounds;
  const bounds = b && isValidBounds(b) ? b : { width: 1440, height: 900 };
  const win = new BrowserWindow({
    ...bounds,
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
  win.once('ready-to-show', () => {
    if (settings.winMaximized && win.isMaximizable()) win.maximize();
    win.show();
  });
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
    // v0.7.1（T-032）：右上角「网页打开」醒目按钮（原菜单栏顶层项改悬浮按钮）。
    // 注入固定定位按钮，点击走 preload 暴露的 openExternal（IPC → 系统浏览器）。
    win.webContents.executeJavaScript(`
      (() => {
        const overlay = document.getElementById('dsh-loading-overlay');
        if (overlay) overlay.remove();
        if (document.getElementById('dsh-web-open-btn')) return;
        const url = '${webUrl()}';
        const btn = document.createElement('button');
        btn.id = 'dsh-web-open-btn';
        btn.type = 'button';
        btn.title = '在系统浏览器中打开 DSH 网页界面';
        btn.innerHTML = '<span style="font-size:13px;line-height:1;">🌐</span><span>网页打开</span>';
        btn.style.cssText = 'position:fixed;top:14px;right:18px;z-index:2147483646;display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border:none;border-radius:20px;cursor:pointer;background:linear-gradient(135deg,#4d6bfe,#7c5cff);color:#fff;font:600 13px/1 "Segoe UI","Microsoft YaHei",sans-serif;box-shadow:0 3px 12px rgba(77,107,254,.5);user-select:none;';
        btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.12)'; });
        btn.addEventListener('mouseleave', () => { btn.style.filter = ''; });
        btn.addEventListener('click', () => {
          if (window.dshDesktop && window.dshDesktop.openExternal) {
            window.dshDesktop.openExternal(url);
          } else {
            window.open(url, '_blank');
          }
        });
        document.body.appendChild(btn);
      })();
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
  // v0.6.1（T-027）：点 X 关闭行为 —— 退出 / 关闭到托盘（询问或按记忆执行）
  win.on('close', (event) => {
    // T5（v0.6.6）：保存窗口状态（真正退出/关闭时记忆；隐藏到托盘不覆盖 bounds）
    if (!win.isDestroyed() && !win.isMaximized()) {
      settings.winBounds = win.getBounds();
    }
    settings.winMaximized = !!(win.isMaximized());
    saveSettings();
    if (isQuitting) return;                       // 真正退出（托盘退出/菜单退出/系统关机）不拦截
    if (!settings.minimizeToTray) return;         // 未启用托盘常驻：关闭即退出（window-all-closed 处理）
    if (settings.rememberCloseChoice) {
      if (settings.closeChoice === 'quit') { isQuitting = true; return; }        // 记忆=退出：放行
      if (settings.closeChoice === 'tray') { event.preventDefault(); win.hide(); return; } // 记忆=托盘
    }
    // 未记住选择：弹窗询问
    event.preventDefault();
    openCloseChoiceWindow(win);
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
/** GET 并解析 JSON；失败/超时返回 null（静默）。响应体超 maxBytes（默认 5MB）放弃。 */
function fetchJson(url, timeoutMs = 8000, headers = {}, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(url, { timeout: timeoutMs, headers }, (res) => {
        let body = '';
        let aborted = false;
        res.on('data', (c) => {
          if (aborted) return;
          body += c;
          if (body.length > maxBytes) { // P2-4：防超大响应体耗尽内存
            aborted = true;
            req.destroy();
            resolve(null);
          }
        });
        res.on('end', () => {
          if (!aborted) { try { resolve(JSON.parse(body)); } catch { resolve(null); } }
        });
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
  // P1-3：Accept 精简头只拉 dist-tags+版本摘要（几十 KB），避免全量元数据（5-20MB）
  return fetchJson(`${base}/${pkgPath}`, 8000, { Accept: 'application/vnd.npm.install-v1+json' })
    .then((pkg) => pkg?.['dist-tags']?.latest ?? null);
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

/**
 * v0.6.2（T-028）：最新版本展示值 —— 获取到的 latest ≤ 当前版本时显示当前版本。
 * 场景：CDN/镜像缓存旧版（latest < current）或本地版本比源新时，避免「最新版本」
 * 一栏显示比当前更小的版本号（显得"降级"）；latest 为 null 原样返回（显示未知）。
 */
function effectiveLatest(current, latest) {
  if (latest == null) return null;
  return compareSemver(String(current), String(latest)) >= 0 ? String(current) : String(latest);
}

// ---------------------------------------------------------------------------
// 更新窗口逻辑层（v0.5.3）：查询/升级/下载，返回数据不弹 dialog，UI 由 update.html 负责
// ---------------------------------------------------------------------------
/**
 * 查询壳+DSH 两侧更新信息（并发，各自静默）。
 * 返回 { dsh: { current, latest, notes, updatable, updating }, shell: { current, latest, notes, updatable, force, downloading } }
 *  - latest 为 null 表示查询失败/无源
 *  - updatable 用语义化比较（避免字符串比较：最新<当前（如 CDN 缓存旧版）时误提示更新）
 */
async function queryUpdateInfo() {
  const cfg = readShellConfig();
  const [dshLatest, shellLatest] = await Promise.all([
    fetchLatestDshVersion(),
    fetchLatestShellVersion(),
  ]);
  const dshCurrent = installedDshVersion() ?? cfg.dshVersion;
  const dshUpdatable = !!dshLatest && compareSemver(dshCurrent, dshLatest) < 0;
  const dshNotes = dshUpdatable ? `可升级到 ${dshLatest}（重启自动安装）` : '';
  const shellUpdatable = !!shellLatest && compareSemver(app.getVersion(), shellLatest.version) < 0;
  return {
    dsh: {
      current: dshCurrent,
      // T-028：latest ≤ current 时显示 current（防 CDN 缓存旧版导致"降级"显示）
      latest: effectiveLatest(dshCurrent, dshLatest),
      notes: dshNotes,
      updatable: dshUpdatable,
      updating: false,
    },
    shell: {
      current: app.getVersion(),
      latest: shellLatest ? effectiveLatest(app.getVersion(), shellLatest.version) : null,
      notes: shellLatest ? shellLatest.releaseNotes : '',
      updatable: shellUpdatable,
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
      // 延迟 relaunch，给渲染端"已更新配置"提示留出展示时间（审查 v12 P0：恢复重启逻辑）
      setTimeout(() => { app.relaunch(); app.exit(0); }, 1500);
      return { ok: true, from: current, to: latest };
    }
    // P1-4：附带 config 路径，便于提示用户手动处理（如安装目录为受保护路径 EACCES）
    return { ok: false, reason: 'write-failed', configPath: path.join(app.getAppPath(), 'config.json') };
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
    : [`https://ghfast.top/https://github.com/XWJ-z/dsh-Desktop/releases/download/v${info.version}/DSH-Desktop-Setup-${info.version}.exe`];
  let lastErr = null;
  let lastUrl = null;
  for (const url of urls) {
    try {
      // v0.7.2（T-033）：换镜像 = 换数据源，.part 内容不兼容，删除避免混合续传
      if (lastUrl && url !== lastUrl) rmQuiet(`${dest}.part`);
      lastUrl = url;
      appendLog('info', `开始下载 DSH-Desktop v${info.version}：${url}${fs.existsSync(`${dest}.part`) ? '（续传）' : ''}`);
      await downloadFile(url, dest, (ratio) => {
        // 有总量 → 0~100；无总量（chunked）→ 负值 = 已下载字节数
        if (onProgress) onProgress(ratio > 0 ? Math.round(ratio * 100) : -ratio);
        if (ratio > 0) appendLog('info', `下载进度：${Math.round(ratio * 100)}%`);
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
// 诊断 / 数据备份 / 数据恢复（v0.7.0）
// ---------------------------------------------------------------------------
/** T1（v0.7.0）：生成诊断报告 —— 环境信息 + 最近日志 + 配置（脱敏），复制到剪贴板并落盘 */
function generateDiagnostics() {
  try {
    const cfg = readShellConfig();
    const lines = [];
    lines.push('DSH-Desktop 诊断报告');
    lines.push('====================');
    lines.push(`生成时间：${localTimestamp()}`);
    lines.push(`应用版本：${app.getVersion()}`);
    lines.push(`DSH 包：${cfg.dshPackage}@${installedDshVersion() ?? cfg.dshVersion}`);
    lines.push(`运行器：${resolveRunner().label}`);
    lines.push(`监听端口：${resolvedPort}`);
    lines.push(`启动阶段：${currentStage}`);
    lines.push(`数据目录：${app.getPath('userData')}`);
    lines.push(`日志文件：${logPath()}`);
    lines.push(`系统：${os.platform()} ${os.release()} (${os.arch()})`);
    lines.push(`内存：${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB 总量`);
    lines.push('');
    lines.push('--- 配置（脱敏）---');
    // T4：防御性脱敏 —— 键名含 pass/token/secret/key/apiKey 的值打码
    const mask = (obj) => JSON.stringify(obj, (k, v) =>
      /pass|token|secret|api[_-]?key/i.test(k) && typeof v === 'string' && v ? '***' : v, 2);
    lines.push(mask(cfg));
    lines.push('');
    lines.push('--- 最近日志（末 200 行）---');
    lines.push(logLines.slice(-200).join('\n'));
    const text = lines.join('\n');

    // 落盘
    const dir = path.join(app.getPath('userData'), 'diagnostics');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `dsh-diagnostics-${localTimestamp().replace(/[: ]/g, '-')}.txt`);
    fs.writeFileSync(file, text, 'utf8');

    // 复制到剪贴板
    clipboard.writeText(text);

    dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
      type: 'info', title: APP_NAME,
      message: '诊断报告已生成',
      detail: `已复制到剪贴板，可直接粘贴发送。\n已保存：${file}`,
      buttons: ['打开所在目录', '关闭'],
      defaultId: 1, cancelId: 1, noLink: true,
    }).then(({ response }) => {
      if (response === 0) shell.openPath(dir);
    }).catch(() => { /* ignore */ });

    appendLog('info', `诊断报告已生成：${file}`);
  } catch (err) {
    appendLog('error', `生成诊断报告失败：${err.message}`);
    dialog.showErrorBox(APP_NAME, `生成诊断报告失败：${err.message}`);
  }
}

/** T2（v0.7.0）：备份 DSH 用户数据 + 设置 → 用户选路径的 tar.gz */
async function backupUserData() {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const { canceled, filePath } = await dialog.showSaveDialog(owner, {
    title: '备份 DSH 数据',
    defaultPath: path.join(app.getPath('documents'), `dsh-backup-${localDate()}.tar.gz`),
    filters: [{ name: '备份包', extensions: ['tar.gz'] }],
  });
  if (canceled || !filePath) return;

  const dshHome = path.join(os.homedir(), '.dsh');
  const settings = settingsFile();
  const hasDsh = fs.existsSync(dshHome);
  const hasSettings = fs.existsSync(settings);

  if (!hasDsh && !hasSettings) {
    dialog.showMessageBox(owner, {
      type: 'warning', title: APP_NAME,
      message: '没有可备份的数据',
      detail: '未找到 DSH 用户数据（~/.dsh）和设置文件。首次使用后再备份。',
      buttons: ['确定'], noLink: true,
    });
    return;
  }

  appendLog('info', `开始备份：~/.dsh=${hasDsh} settings=${hasSettings} → ${filePath}`);
  dialog.showMessageBox(owner, {
    type: 'info', title: APP_NAME,
    message: '正在备份…',
    detail: '数据量小（秒级）；大工作区需稍候。备份完成后自动提示。',
    buttons: ['确定'], noLink: true,
  });

  // 暂存目录：把 .dsh / settings.json / manifest.json 统一归位到 tar 根，
  // 保证包内只有相对路径（portable，解包到任意机器路径一致）
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-backup-'));
  try {
    const entries = [];
    if (hasDsh) {
      fs.cpSync(dshHome, path.join(staging, '.dsh'), { recursive: true });
      entries.push('.dsh');
    }
    if (hasSettings) {
      fs.copyFileSync(settings, path.join(staging, 'settings.json'));
      entries.push('settings.json');
    }
    // manifest 记录（恢复时校验格式用）
    const manifest = {
      format: 'dsh-backup-v1',
      appVersion: app.getVersion(),
      dshPackage: readShellConfig().dshPackage,
      dshVersion: installedDshVersion() ?? readShellConfig().dshVersion,
      backupTime: localTimestamp(),
      entries,
    };
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

    await tar.create(
      { gzip: true, file: filePath, cwd: staging, portable: true },
      ['manifest.json', ...entries],
    );

    appendLog('info', `备份完成：${filePath}`);
    dialog.showMessageBox(owner, {
      type: 'info', title: APP_NAME,
      message: '备份完成',
      detail: `${filePath}\n\n包含：${entries.join('、')}`,
      buttons: ['打开所在目录', '关闭'],
      defaultId: 1, cancelId: 1, noLink: true,
    }).then(({ response }) => {
      if (response === 0) shell.openPath(path.dirname(filePath));
    }).catch(() => { /* ignore */ });
  } catch (err) {
    appendLog('error', `备份失败：${err.message}`);
    dialog.showErrorBox(APP_NAME, `备份失败：${err.message}`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** T3（v0.7.0）：从备份包恢复 DSH 数据（固定路径映射，不信任包内路径） */
async function restoreUserData() {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

  // v0.7.1（T-032）：恢复前服务占用检查 —— DSH 服务在跑时 ~/.dsh 被占用，
  // 重命名会 EPERM 且可能半恢复（settings 换了、数据没换），提示先退出再恢复
  if (serverChild && serverChild.exitCode === null) {
    dialog.showMessageBox(owner, {
      type: 'warning', title: APP_NAME,
      message: '恢复数据前请先退出 DSH 服务',
      detail: 'DSH 服务正在运行，数据文件（~/.dsh）可能被占用，直接恢复会导致失败或数据不一致。\n\n请先通过托盘菜单「退出」关闭应用（或重启电脑）后，再运行「恢复数据…」。',
      buttons: ['知道了'], noLink: true,
    });
    return;
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(owner, {
    title: '选择 DSH 备份包',
    properties: ['openFile'],
    filters: [{ name: '备份包', extensions: ['tar.gz', 'tgz'] }],
  });
  if (canceled || !filePaths || !filePaths[0]) return;
  const backupFile = filePaths[0];

  // 确认
  const { response: confirmRes } = await dialog.showMessageBox(owner, {
    type: 'warning', title: APP_NAME,
    message: '恢复数据将覆盖本机现有 DSH 数据',
    detail: '现有数据会被重命名为 .bak 保留（不删除）。确定继续？',
    buttons: ['确定恢复', '取消'], defaultId: 1, cancelId: 1, noLink: true,
  });
  if (confirmRes !== 0) return;

  // 先解压到临时目录校验（不直接解到目标，防恶意包写任意路径）
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-restore-'));
  try {
    await tar.extract({ file: backupFile, cwd: tmp, portable: true });

    // T4：校验 manifest（格式/版本），不存在则拒绝（防随意 tar 包）
    const manifestPath = path.join(tmp, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      dialog.showErrorBox(APP_NAME, '无效的备份包：缺少 manifest.json');
      return;
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      dialog.showErrorBox(APP_NAME, '无效的备份包：manifest.json 解析失败');
      return;
    }
    if (manifest.format !== 'dsh-backup-v1') {
      dialog.showErrorBox(APP_NAME, '无效的备份包：格式不识别');
      return;
    }
    const entries = Array.isArray(manifest.entries) ? manifest.entries : [];

    // 固定路径映射（T4：不信任包内路径，只按约定落位）
    const dshHome = path.join(os.homedir(), '.dsh');
    const settings = settingsFile();
    const stamp = Date.now();
    const moveOld = (target) => {
      if (fs.existsSync(target)) fs.renameSync(target, `${target}.bak-${stamp}`);
    };

    if (entries.includes('.dsh') && fs.existsSync(path.join(tmp, '.dsh'))) {
      moveOld(dshHome);
      fs.renameSync(path.join(tmp, '.dsh'), dshHome);
    }
    if (entries.includes('settings.json') && fs.existsSync(path.join(tmp, 'settings.json'))) {
      moveOld(settings);
      fs.mkdirSync(path.dirname(settings), { recursive: true });
      fs.renameSync(path.join(tmp, 'settings.json'), settings);
    }

    appendLog('info', `数据恢复完成（来源：${backupFile}）`);

    // 版本差异提示
    const curDsh = installedDshVersion() ?? '未知';
    const bakDsh = manifest.dshVersion ?? '未知';
    const diff = curDsh !== bakDsh
      ? `\n\n注意：备份时的 DSH 版本为 ${bakDsh}，当前为 ${curDsh}。如需一致，请到「检查更新」窗口升级 DSH。`
      : '';

    dialog.showMessageBox(owner, {
      type: 'info', title: APP_NAME,
      message: '数据恢复完成',
      detail: `工作区/会话数据已还原。${diff}\n\n建议重启应用使设置生效。`,
      buttons: ['立即重启', '稍后'],
      defaultId: 1, cancelId: 1, noLink: true,
    }).then(({ response }) => {
      if (response === 0) { isQuitting = true; app.relaunch(); app.exit(0); }
    }).catch(() => { /* ignore */ });
  } catch (err) {
    appendLog('error', `恢复失败：${err.message}`);
    // T4：DSH 服务运行中占用 ~/.dsh 时重命名/写回会 EPERM —— 给出操作指引
    let detail = `恢复失败：${err.message}`;
    if (/EPERM|EACCES/.test(err.message)) {
      detail += '\n\n数据文件可能正被 DSH 服务占用。请先通过托盘「退出」关闭应用（或重启电脑）后重试。';
    }
    dialog.showErrorBox(APP_NAME, detail);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 壳（DSH-Desktop）自动更新（v0.5）：GitHub version.json 三源并发 + 镜像下载
// 与「检查 DSH 更新」（官方 DSH 包）完全独立：本区检查的是壳自身版本
// v0.5.9：三源并发（jsDelivr @main 快但会卡缓存 / api.github.com 国内最稳、
// 永远最新 / raw.githubusercontent 兜底），取可达源中版本号最高者，
// 规避 jsDelivr @main 解析缓存卡死导致漏报更新。
// ---------------------------------------------------------------------------
const SHELL_UPDATE_URLS = [
  {
    name: 'jsDelivr',
    url: 'https://cdn.jsdelivr.net/gh/XWJ-z/dsh-Desktop@main/version.json',
  },
  {
    // api.github.com：Accept raw+json 直接返回文件原文，无 CDN 缓存，永远最新
    name: 'GitHub API',
    url: 'https://api.github.com/repos/XWJ-z/dsh-Desktop/contents/version.json?ref=main',
    headers: { 'User-Agent': 'DSH-Desktop', Accept: 'application/vnd.github.raw+json' },
  },
  {
    name: 'raw.githubusercontent',
    url: 'https://raw.githubusercontent.com/XWJ-z/dsh-Desktop/main/version.json',
  },
];

/**
 * 查询壳最新版本（三源并发：并发请求全部更新源，取版本号最高者）。
 * 返回 { version, download_urls, release_notes, force, hash } 或 null（全部失败/超时静默）。
 */
function fetchLatestShellVersion() {
  const parse = (info) => {
    if (!info || typeof info.version !== 'string') return null;
    return {
      version: String(info.version),
      downloadUrls: Array.isArray(info.download_urls) ? info.download_urls.map(String) : [],
      releaseNotes: String(info.release_notes || ''),
      force: !!info.force,
      hash: String(info.hash || '').toLowerCase(),
    };
  };
  return Promise.all(SHELL_UPDATE_URLS.map((s) => fetchJson(s.url, 8000, s.headers || {}).then(parse)))
    .then((results) => {
      const valid = results.filter(Boolean);
      if (valid.length === 0) return null;
      valid.sort((a, b) => (compareSemver(a.version, b.version) < 0 ? 1 : -1));
      const best = valid[0];
      const detail = SHELL_UPDATE_URLS.map((s, i) => `${s.name}=${results[i] ? results[i].version : '×'}`).join(', ');
      appendLog('info', `版本检查：${valid.length}/3 源可达（${detail}），取最高 v${best.version}`);
      return best;
    });
}

/** 下载文件到 dest，带进度回调（0~1）；自动跟随重定向（≤5 次），总超时 10 分钟 */
/**
 * 下载文件到 dest，带进度回调（0~1）；自动跟随重定向（≤5 次）。
 * v0.7.2（T-033）：断点续传 —— 下载写入 <dest>.part，中断/网络错误保留 .part，
 * 同 URL 自动重试（≤3 次）时发 Range 续传（206 追加）；服务器忽略 Range（200）
 * 则从头覆盖；416（.part 无效）删 .part 重来。完成后原子 rename 为 dest。
 * 进度：有总大小 → 0~1（含续传起点）；无（chunked）→ 负值 = 累计字节数。
 */
function downloadFile(url, dest, onProgress) {
  const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000; // P2-1：单次尝试总超时 10 分钟
  const MAX_REDIRECTS = 5;                    // P2-1：重定向上限
  const MAX_ATTEMPTS = 3;                     // v0.7.2：同 URL 自动重试（含续传）次数
  const part = `${dest}.part`;
  return new Promise((resolve, reject) => {
    let req;
    let file = null;
    let redirects = 0;
    let attempts = 0;
    let retried416 = false;
    let resumeFrom = 0; // 本次请求的续传起点（.part 已有字节数）
    const resumeSize = () => {
      try { return fs.statSync(part).size; } catch { return 0; }
    };
    const start = (target) => {
      let done = false;
      resumeFrom = resumeSize();
      const timer = setTimeout(() => {         // P2-1：超时中止（保留 .part 供续传）
        try { req.destroy(); } catch { /* ignore */ }
        if (file) { try { file.destroy(); } catch { /* ignore */ } }
        onFail(new Error('下载超时'));
      }, DOWNLOAD_TIMEOUT_MS);
      const cleanupTimer = () => clearTimeout(timer);
      const onFail = (err) => {                // 网络错误/超时：保留 .part，同 URL 自动重试续传
        if (done) return;
        done = true;
        cleanupTimer();
        if (attempts < MAX_ATTEMPTS) {
          attempts++;
          setTimeout(() => start(target), 500);
          return;
        }
        reject(err);
      };
      // v0.6.7（T-031）：写入失败走业务兜底（删 .part 重来），不冒泡成系统级错误
      const openStream = (flags) => {
        file = fs.createWriteStream(part, { flags });
        file.on('error', (err) => { if (!done) { done = true; cleanupTimer(); rmQuiet(part); reject(err); } });
        return file;
      };
      const headers = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : undefined;
      req = https.get(target, { headers }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          req.destroy();
          if (++redirects > MAX_REDIRECTS) {
            cleanupTimer();
            rmQuiet(part);
            reject(new Error('重定向次数过多'));
            return;
          }
          start(res.headers.location); // 续传起点不变，.part 不变
          return;
        }
        if (res.statusCode === 416) {
          // .part 已完整或与源不一致：删掉从头重来一次
          res.resume();
          cleanupTimer();
          rmQuiet(part);
          if (retried416) { reject(new Error('HTTP 416')); return; }
          retried416 = true;
          start(target);
          return;
        }
        if (res.statusCode !== 200 && res.statusCode !== 206) {
          res.resume(); // 消费响应体，让流正常结束
          cleanupTimer();
          rmQuiet(part); // 其他错误码（404 等）：.part 无意义，删掉
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        // 200 = 服务器忽略 Range（或首次下载），从头覆盖；206 = 续传追加
        if (res.statusCode === 200) resumeFrom = 0;
        const stream = openStream(resumeFrom > 0 ? 'a' : 'w');
        // v0.7.2（T-033）：响应流中途断开（网络中断/服务端掐断）→ 保留 .part 走续传重试。
        // 不监听的话 pipe 写失败会走 file 'error' 删 .part（续传失效），或永远 pending。
        res.on('error', (err) => onFail(err));
        res.on('close', () => { if (!done && !res.complete) onFail(new Error('连接中断')); });
        // 总大小：206 时 content-length 是剩余字节，完整大小在 Content-Range 里
        let total = Number(res.headers['content-length']) || 0;
        if (res.statusCode === 206 && res.headers['content-range']) {
          const m = /\/\s*(\d+)\s*$/.exec(res.headers['content-range']);
          if (m) total = Number(m[1]);
        }
        let received = 0;
        res.on('data', (c) => {
          received += c.length;
          if (onProgress) {
            const base = resumeFrom;
            onProgress(total ? (base + received) / total : -(base + received));
          }
        });
        res.pipe(stream);
        stream.on('finish', () => {
          if (done) return;
          done = true;
          cleanupTimer();
          stream.close(() => {
            try {
              fs.renameSync(part, dest); // 原子落位
              resolve(dest);
            } catch (err) {
              rmQuiet(part);
              reject(err);
            }
          });
        });
      });
      req.on('error', (err) => onFail(err)); // 保留 .part 供续传
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

/** 下载安装包到用户数据目录 updates/ 下，返回本地路径；先清理该目录旧版本安装包（P2-2） */
function shellDownloadDest(info) {
  const dir = path.join(app.getPath('userData'), 'updates');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  try {
    for (const old of fs.readdirSync(dir)) {
      if (/^DSH-Desktop-Setup-.*\.exe$/.test(old) && old !== `DSH-Desktop-Setup-${info.version}.exe`) {
        rmQuiet(path.join(dir, old));
      }
    }
  } catch { /* ignore */ }
  const file = path.join(dir, `DSH-Desktop-Setup-${info.version}.exe`);
  // v0.7.2（T-033）：只清正式文件（需重新下载完整版）；.part 保留作为断点续传基础
  rmQuiet(file);
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

/** 关闭行为询问弹窗（v0.6.1 T-027）：退出 / 关闭到托盘 + 记住我的选择 */
let closeChoiceWin = null;
function openCloseChoiceWindow(parentWin) {
  if (closeChoiceWin && !closeChoiceWin.isDestroyed()) { closeChoiceWin.focus(); return; }
  closeChoiceWin = new BrowserWindow({
    width: 400, height: 190, resizable: false, minimizable: false, maximizable: false,
    parent: parentWin, modal: true, title: '关闭 DSH-Desktop',
    backgroundColor: '#0f1115',
    webPreferences: secureWebPreferences(),
  });
  closeChoiceWin.loadFile(path.join(__dirname, 'renderer', 'close-choice.html'));
  closeChoiceWin.on('closed', () => { closeChoiceWin = null; });
}

// ---------------------------------------------------------------------------
// 用户设置（v0.6.1 T-027）：持久化到 userData/settings.json
//  - autostart        开机自启（设置菜单 / 托盘菜单勾选）
//  - minimizeToTray   最小化到托盘总开关（关闭窗口行为：关闭即退出 / 托盘常驻）
//  - closeChoice      记住的关闭选择：'quit' | 'tray' | null（null = 每次询问）
//  - rememberCloseChoice 是否记住关闭选择
// ---------------------------------------------------------------------------
let settings = {
  autostart: false,
  minimizeToTray: true,
  closeChoice: null,
  rememberCloseChoice: false,
  checkUpdateOnStart: true,   // v0.6.5（T-030）：启动时检查更新并弹窗询问（默认开启）
  winBounds: null,            // T5（v0.6.6）：主窗口位置/大小 {x,y,width,height}
  winMaximized: false,        // T5：最大化状态
};

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const disk = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...settings, ...disk };
  } catch { /* 首次运行/损坏：用默认值 */ }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    appendLog('error', `保存设置失败：${err.message}`);
  }
}

/** 开机自启（设置菜单与托盘菜单统一入口；开发模式 setLoginItemSettings 无效属正常） */
function setAutostart(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    settings.autostart = !!enabled;
    saveSettings();
    appendLog('info', `开机自启已${enabled ? '开启' : '关闭'}`);
  } catch (err) {
    appendLog('error', `设置开机自启失败：${err.message}`);
  }
  refreshMenus();
}

/** 最小化到托盘总开关 */
function setMinimizeToTray(enabled) {
  settings.minimizeToTray = !!enabled;
  saveSettings();
  appendLog('info', `最小化到托盘已${enabled ? '开启' : '关闭'}（关闭窗口${enabled ? '将询问/驻留托盘' : '将直接退出'}）`);
  refreshMenus();
}

/** 记住关闭选择（action: 'quit' | 'tray'） */
function setCloseChoice(action, remember) {
  settings.closeChoice = action;
  settings.rememberCloseChoice = !!remember;
  saveSettings();
  refreshMenus();
}

/** 清除记忆：关闭窗口时恢复询问 */
function clearCloseChoice() {
  settings.closeChoice = null;
  settings.rememberCloseChoice = false;
  saveSettings();
  appendLog('info', '已清除关闭行为记忆，关闭窗口时将再次询问');
  refreshMenus();
}

/** 启动时检查更新开关 */
function setCheckUpdateOnStart(enabled) {
  settings.checkUpdateOnStart = !!enabled;
  saveSettings();
  appendLog('info', `启动时检查更新已${enabled ? '开启' : '关闭'}`);
  refreshMenus();
}

/** 重建托盘菜单 + 应用菜单（设置变化后同步显示状态） */
function refreshMenus() {
  if (tray) updateTrayMenu();
  Menu.setApplicationMenu(buildMenu());
}

// ---------------------------------------------------------------------------
// 系统托盘（v0.6.0 T-025）：关闭窗口 ≠ 退出，托盘常驻；仅托盘「退出」真正退出
// ---------------------------------------------------------------------------
function createTray() {
  if (tray) return;
  // T1（v0.6.6）：托盘用多尺寸 ICO（16-256 内置，v0.5.5 产物），高 DPI 清晰；PNG 兜底
  const candidates = [
    path.join(app.getAppPath(), 'assets', 'icon.ico'),
    path.join(app.getAppPath(), 'assets', 'icon.png'),
  ];
  const iconPath = candidates.find((p) => fs.existsSync(p));
  if (!iconPath) {
    appendLog('warn', '托盘图标缺失（icon.ico/icon.png 均不存在），托盘不创建');
    return;
  }
  tray = new Tray(iconPath);
  tray.setToolTip('DSH-Desktop');
  updateTrayMenu();
  // 单击/双击恢复主窗口（Windows 下已设右键菜单，左键单击仍触发 click）
  tray.on('click', () => showMainWindow());
  tray.on('double-click', () => showMainWindow());
  appendLog('info', '系统托盘已就绪（关闭窗口 = 最小化到托盘，托盘菜单可退出）');
}

function updateTrayMenu() {
  if (!tray) return;
  const ctx = Menu.buildFromTemplate([
    { label: '打开主界面', click: () => showMainWindow() },
    { label: '远程连接（即将推出）', enabled: false }, // 占位（v0.6.0 暂未实现）
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: settings.autostart,
      click: (item) => setAutostart(item.checked),
    },
    { type: 'separator' },
    { label: '检查更新…', click: () => openUpdateWindow() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        // 首次托盘退出弹确认；确认过（或取消过）后按状态处理
        if (!trayExitConfirmed) {
          trayExitConfirmed = true;
          // T3（v0.6.6）：带 owner 弹窗 —— 托盘场景主窗口常隐藏，无 owner 可能不置顶
          dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
            type: 'question',
            title: APP_NAME,
            message: '确定退出？',
            detail: 'DSH 服务将停止。如需后台运行，请直接关闭窗口（最小化到托盘）。',
            buttons: ['退出', '取消'],
            defaultId: 1,
            cancelId: 1,
          }).then(({ response }) => {
            if (response === 0) {
              isQuitting = true;
              app.quit();
            } else {
              trayExitConfirmed = false; // 取消：下次再退出时重新确认
            }
          }).catch(() => { isQuitting = true; app.quit(); });
        } else {
          isQuitting = true;
          app.quit();
        }
      },
    },
  ]);
  tray.setContextMenu(ctx);
}

/** 恢复主窗口：存在则显示/还原/聚焦；已被关闭（托盘模式）则按需重建 */
function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (serverChild) {
    createMainWindow();
  } else {
    appendLog('warn', '主窗口恢复请求被忽略：DSH 服务未就绪');
  }
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
        // v0.7.0（T2/T3）：数据备份 / 恢复（打包 ~/.dsh + 设置；恢复校验 manifest 后固定路径还原）
        { label: '备份数据…', click: () => backupUserData() },
        { label: '恢复数据…', click: () => restoreUserData() },
        { type: 'separator' },
        // v0.6.0（T-025）：最小化到托盘（窗口隐藏，DSH 服务继续运行）
        { label: '最小化到托盘', click: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide(); } },
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
    // v0.6.1（T-027）：设置菜单
    {
      label: '设置',
      submenu: [
        {
          label: '开机自启',
          type: 'checkbox',
          checked: settings.autostart,
          click: (item) => setAutostart(item.checked),
        },
        {
          label: '最小化到托盘',
          type: 'checkbox',
          checked: settings.minimizeToTray,
          click: (item) => setMinimizeToTray(item.checked),
        },
        {
          // v0.6.5（T-030）：启动时检查更新（默认开启）
          label: '启动时检查更新',
          type: 'checkbox',
          checked: settings.checkUpdateOnStart,
          click: (item) => setCheckUpdateOnStart(item.checked),
        },
        { type: 'separator' },
        {
          // 清除「记住我的选择」，关闭窗口时恢复询问
          label: '关闭时总是询问',
          enabled: settings.rememberCloseChoice,
          click: () => clearCloseChoice(),
        },
      ],
    },
    // v0.6.4（T-029）：「帮助」菜单（原「关于我们」）—— 更新检查移入，符合 Windows 帮助区惯例
    {
      label: '帮助',
      submenu: [
        {
          label: `检查更新${shellHasUpdate || dshHasUpdate ? '（有新版本）' : ''}`,
          click: () => { openUpdateWindow(); },
        },
        { type: 'separator' },
        // v0.7.0（T1）：一键诊断报告 —— 环境信息 + 最近日志 + 配置（脱敏）→ 剪贴板 + 落盘
        { label: '生成诊断报告', click: () => generateDiagnostics() },
        { type: 'separator' },
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
          label: 'DSH-Desktop 项目主页',
          click: () => { shell.openExternal('https://github.com/XWJ-z/dsh-Desktop'); },
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

/**
 * 启动时检查更新（v0.6.5 T-030）：并发检查 DSH + 壳。
 *  - 有新版 → 置标志 + 日志 + 重建菜单（「检查更新（有新版本）」提示）
 *  - 壳有新版且设置「启动时检查更新」开启 → 弹窗询问「立即更新 / 稍后」
 *    （立即更新 = 自动下载 + SHA256 校验 + 打开安装包）
 */
async function checkUpdatesOnStart() {
  const cfg = readShellConfig();
  const [dshLatest, shellInfo] = await Promise.all([
    fetchLatestDshVersion(),
    fetchLatestShellVersion(),
  ]);

  // DSH 侧：保持静默提示（升级入口在更新窗口，一键升级改 config 重启）
  if (dshLatest) {
    const dshCurrent = installedDshVersion() ?? cfg.dshVersion;
    if (compareSemver(dshCurrent, dshLatest) < 0) {
      dshHasUpdate = true;
      appendLog('info', `DSH 有新版本：${dshCurrent} → ${dshLatest}（更新窗口可一键升级）`);
    }
  }

  // 壳侧：有新版本 → 按设置弹窗询问（force=true 重大漏洞时无视开关强制弹窗）
  if (shellInfo && compareSemver(app.getVersion(), shellInfo.version) < 0) {
    shellHasUpdate = true;
    appendLog('info', `DSH-Desktop 有新版本：${app.getVersion()} → ${shellInfo.version}`);
    if (settings.checkUpdateOnStart || shellInfo.force) promptShellUpdate(shellInfo);
  }

  if (dshHasUpdate || shellHasUpdate) Menu.setApplicationMenu(buildMenu());
}

/** 壳更新弹窗询问：立即更新（下载+校验+打开安装包）或稍后 */
function promptShellUpdate(info) {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  dialog.showMessageBox(owner, {
    type: 'info',
    title: APP_NAME,
    message: `发现新版本 v${info.version}（当前 v${app.getVersion()}）`,
    detail: '是否立即下载更新？下载完成后自动打开安装包。',
    buttons: ['立即更新', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }).then(({ response }) => {
    if (response !== 0) return;
    appendLog('info', '用户确认更新，开始下载…');
    downloadShellUpdate(mainWindow, (percent) => {
      if (updateWin && !updateWin.isDestroyed()) {
        updateWin.webContents.send('update:progress', { percent });
      }
    }).then((r) => {
      if (r && !r.ok) {
        appendLog('error', `自动更新失败：${r.reason}${r.message ? ' ' + r.message : ''}`);
        let reasonText = {
          'fetch-failed': '无法连接更新源，请检查网络',
          'no-update': '当前已是最新版本',
          'download-failed': '所有下载源均失败，请稍后重试',
          'hash-mismatch': '下载的安装包校验不通过（已删除），请重新下载',
        }[r.reason] || '未知错误';
        // v0.6.7（T-031）：写入被拒（EPERM/EACCES）时给出可操作提示
        if (r.reason === 'download-failed' && r.message) {
          if (/EPERM|EACCES/.test(r.message)) {
            reasonText = '安装包写入被拒绝（可能被其他程序或安全软件占用/拦截）。请关闭可能占用文件的程序后重试，或到 GitHub Releases 手动下载安装包。';
          } else {
            reasonText += `（${r.message}）`;
          }
        }
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: APP_NAME,
          message: '更新下载失败',
          detail: reasonText,
          buttons: ['打开更新窗口', '关闭'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        }).then(({ response: resp }) => {
          if (resp === 0) openUpdateWindow();
        }).catch(() => { /* ignore */ });
      }
    });
  }).catch(() => { /* ignore */ });
}

// ---------------------------------------------------------------------------
// 应用生命周期
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // P2-5：优先聚焦顶层 modal 窗口（更新/联系我们/关于），避免被主窗口遮挡
    const modal = [updateWin, contactWin, aboutWin].find((w) => w && !w.isDestroyed());
    const target = modal || mainWindow;
    if (target) {
      if (target.isMinimized()) target.restore();
      target.focus();
    }
  });

  app.whenReady().then(async () => {
    // v0.6.1（T-027）：加载设置；开机自启以注册表实际状态为准（用户可能在系统设置里改过）
    loadSettings();
    try { settings.autostart = app.getLoginItemSettings().openAtLogin; } catch { /* ignore */ }
    saveSettings();

    Menu.setApplicationMenu(buildMenu());
    createTray(); // v0.6.0（T-025）：启动即创建托盘图标
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
        // T-028：latest ≤ current 时显示 current（防缓存旧版导致"降级"显示）
        dshLatest: dshLatest ? effectiveLatest(installedDshVersion() ?? cfg.dshVersion, dshLatest) : '未知',
        shellLatest: shellLatest ? effectiveLatest(app.getVersion(), shellLatest.version) : '未知',
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
    // v0.6.1（T-027）：关闭行为询问弹窗的选择（{ action: 'quit'|'tray', remember: bool }）
    ipcMain.handle('close:choose', (_e, choice) => {
      const action = choice && choice.action;
      const remember = !!(choice && choice.remember);
      if (closeChoiceWin && !closeChoiceWin.isDestroyed()) closeChoiceWin.close();
      closeChoiceWin = null;
      if (action === 'quit') {
        if (remember) setCloseChoice('quit', true);
        appendLog('info', '用户选择退出（关闭窗口）');
        isQuitting = true;
        app.quit();
      } else if (action === 'tray') {
        if (remember) setCloseChoice('tray', true);
        appendLog('info', '用户选择关闭到托盘');
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      }
      return true;
    });

    resolvedPort = parsePortArg() ?? await pickPort(DEFAULT_PORT);
    appendLog('info', `${APP_NAME} v${app.getVersion()} 启动，目标端口 ${resolvedPort}`);
    appendLog('info', `用户数据目录：${app.getPath('userData')}`);
    appendLog('info', `DSH 运行器策略：${resolveRunner().label}`);

    // T4（v0.6.6）：自启静默启动 —— 开机自启时不弹窗口，后台运行 + 托盘常驻
    const silentStart = settings.autostart && settings.minimizeToTray;
    appendLog('info', `启动模式：${silentStart ? '静默（自启，托盘常驻）' : '正常（显示窗口）'}`);

    if (!silentStart) {
      createLoadingWindow();
      attachWebDiagnostics(loadingWindow, 'loading');
    }
    pushStage('check');

    try {
      await spawnServer(resolvedPort);
      await waitForServer(DEFAULT_HOST, resolvedPort, SERVER_READY_TIMEOUT_MS);
      appendLog('info', `DSH 服务就绪：${webUrl()}`);
      pushStage('ready');

      // 审查 H2：服务就绪后关闭 loading 窗口，新建 1440×900 主窗口承载 GUI
      if (!silentStart) {
        if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
        loadingWindow = null;
        createMainWindow();
      } else {
        appendLog('info', '静默启动：主窗口不创建（托盘常驻），可从托盘打开主界面');
      }

      // 任务B-B4 / G1 / v0.6.5（T-030）：启动时检查更新（DSH + 壳）——
      // 壳有新版且设置「启动时检查更新」开启（或 force 强制）时弹窗询问「立即更新 / 稍后」
      checkUpdatesOnStart();
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

  // v0.6.0（T-025）：before-quit 统一标记"真正退出"（托盘退出/菜单退出/系统关机均走这里）
  app.on('before-quit', () => { isQuitting = true; stopServer(); });
  app.on('will-quit', (event) => {
    appendLog('info', '应用退出中…');
    // 审查 v12 P1-2：SIGTERM 宽限期定时器可能随主进程退出被终止，导致残留子进程
    // 未被强制清理；这里在真正退出前同步兜底 SIGKILL 一次（幂等，安全）。
    for (const child of trackedChildren) {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      } catch { /* ignore */ }
    }
  });
  app.on('quit', (_event, exitCode) => { appendLog('info', `应用已退出，code=${exitCode}`); });
  // v0.6.0（T-025）/ v0.6.1（T-027）：关闭窗口 ≠ 退出 —— 启用托盘常驻时所有窗口关闭后
  // 托盘驻留、DSH 服务继续运行；未启用托盘常驻或"真正退出"（isQuitting）时随关窗退出。
  app.on('window-all-closed', () => {
    if (isQuitting || !settings.minimizeToTray) { app.quit(); return; }
    appendLog('info', '主窗口已关闭（最小化到托盘），DSH 服务继续运行，可从托盘恢复');
  });
  app.on('activate', () => {
    // Windows-only 应用；若服务已就绪且无窗口，重建主窗口（审查 L4）
    if (BrowserWindow.getAllWindows().length === 0 && serverChild) createMainWindow();
  });
}
