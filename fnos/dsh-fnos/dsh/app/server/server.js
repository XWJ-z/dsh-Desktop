'use strict';
/**
 * server.js — DeepSeek Harness 飞牛网关接入服务（v0.1，对齐 Windows 版 v0.5 功能）
 *
 * 职责：
 *  1. 管理 DSH web 运行时生命周期（内聚，壳只暴露一个进程给 cmd/main）：
 *       ensure（npm install，首次联网下载）→ spawn `dsh web`（127.0.0.1:DSH_PORT）
 *       → 就绪探测 → DSH web 崩溃自动重启 → 退出时清理子进程
 *  2. 监听统一网关 Unix Socket（$TRIM_APPDEST/app.sock），把流量转发到 DSH web
 *  3. 网关前缀剥离：请求路径带 /app/dsh 前缀时剥掉再路由/转发（兼容网关两种行为）
 *  4. 壳自带路由：/about（联系我们）、/log（日志查看）、/init（初始化提示）、
 *     /api/health、/api/status、/api/log、/api/update（检查 DSH 官方更新 + 热升级）
 *  5. 日志：本地时间 + 内存环形缓冲（800 行）+ 落盘 $TRIM_PKGVAR/app.log
 *  6. 全局未捕获异常/拒绝兜底（记录后不退出，对齐 Windows 版）
 *  7. 支持 WebSocket 转发（DSH 的 HMR/实时功能）
 *
 * 环境变量（由 cmd/main 传入）：
 *  SOCKET_PATH      网关 Socket 路径（安装到飞牛后使用）；为空时监听 TCP（本地开发）
 *  PORT             本地开发端口（默认 5001）
 *  DSH_PORT         DSH web 服务端口（默认 3080）
 *  GATEWAY_PREFIX   网关公开前缀（默认 /app/dsh）
 *  DATA_DIR         DSH 用户数据目录（data-share 第一个路径；为空则用 DSH 默认 ~/.dsh）
 *  TRIM_PKGVAR      应用数据目录（日志落盘）
 *  TRIM_PKGETC      应用配置目录（config.json 读取/改写）
 */

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const SOCKET_PATH = process.env.SOCKET_PATH || '';
const PORT = Number(process.env.PORT || 5001);
const DSH_HOST = '127.0.0.1';
const DSH_PORT = Number(process.env.DSH_PORT || 3080);
const GATEWAY_PREFIX = (process.env.GATEWAY_PREFIX || '/app/dsh').replace(/\/+$/, '');
const DATA_DIR = process.env.DATA_DIR || '';
const PKGVAR = process.env.TRIM_PKGVAR || '';
const PKGETC = process.env.TRIM_PKGETC || path.join(__dirname, '..', '..', 'etc');
const SERVER_DIR = __dirname;
const MANAGER_JS = path.join(SERVER_DIR, 'dsh-manager.js');
const APP_VERSION = '0.2.5'; // 与 manifest version 同步（审查报告 v3.0 版本号管理）
// 配置读取顺序：$TRIM_PKGETC/config.json（用户可改，优先）→ 包内 app/server/config.json（默认）
const CONFIG_CANDIDATES = [
  path.join(PKGETC, 'config.json'),
  path.join(SERVER_DIR, 'config.json'),
];
function resolveConfigFile() {
  for (const p of CONFIG_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return CONFIG_CANDIDATES[0];
}

let dshChild = null;      // DSH web 子进程
let dshReady = false;     // DSH web 就绪标志
let ensuring = false;     // 是否正在安装/启动 DSH
let dshVersion = null;    // 已安装 DSH 版本（缓存）
let ensureError = null;   // 初始化失败原因（非空时初始化页显示错误，而非无限等待）
let currentStage = 'check'; // check → install → start → ready（对齐 Windows loading 阶段）
let installProgressMb = '0.0'; // 安装进度（dshenv 目录体积，MB）

// ---------------------------------------------------------------------------
// 日志：本地时间 + 环形缓冲（800 行）+ 落盘 + console（cmd/main 重定向 app.log）
// ---------------------------------------------------------------------------
const LOG_LINES = [];
const LOG_MAX = 800;
function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function log(level, msg) {
  const line = `[${now()}] [${level}] ${msg}`;
  LOG_LINES.push(line);
  if (LOG_LINES.length > LOG_MAX) LOG_LINES.shift();
  // 落盘由 cmd/main 的 stdout 重定向完成（>> $TRIM_PKGVAR/app.log），此处只输出到 stdout，
  // 避免与重定向双写同一日志文件
  console.log(line);
}
function setStage(stage) {
  currentStage = stage;
  log('info', `启动阶段：${stage}`);
}

// 全局异常兜底（对齐 Windows 版：记录后不退出，避免偶发错误拖垮壳）
process.on('uncaughtException', (err) => {
  try { log('error', `未捕获异常：${err && err.stack ? err.stack : String(err)}`); } catch { /* ignore */ }
});
process.on('unhandledRejection', (reason) => {
  try { log('error', `未处理的 Promise 拒绝：${String(reason)}`); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// DSH 运行时管理（异步安装 + 进度统计，对齐 Windows loading 窗口）
// ---------------------------------------------------------------------------
/** 统计目录体积（MB，一位小数）；失败返回 '0.0' */
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

/** DSH 运行时目录（dsh-manager.js 中定义：$TRIM_PKGVAR/dshenv 或相对回退） */
function dshenvDir() {
  return PKGVAR ? path.join(PKGVAR, 'dshenv') : path.join(__dirname, '..', '..', 'var', 'dshenv');
}

/**
 * 异步执行 dsh-manager.js ensure：
 *  已安装且版本匹配 → 秒回 bin 路径；否则 npm install（可达 10 分钟），
 *  期间每 2 秒统计体积作为下载进度（installProgressMb）。
 *  注意：npm 下载 tarball 先写 cache（$PKGVAR/npm-cache）、解压才写 dshenv，
 *  进度必须两者相加，否则下载阶段（最耗时）恒显示 0.0 MB（N1，对齐 Windows 已修项）。
 * @returns {Promise<string|null>} bin.js 路径
 */
function ensureDshBinAsync() {
  return new Promise((resolve) => {
    setStage('install');
    const stdoutLines = [];
    const child = spawn(process.execPath, [MANAGER_JS, 'ensure'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (c) => {
      for (const line of c.toString().split(/\r?\n/)) {
        const t = line.trim();
        if (t) { stdoutLines.push(t); log('dsh', t); }
      }
    });
    child.stderr.on('data', (c) => {
      for (const line of c.toString().split(/\r?\n/)) {
        if (line.trim()) log('dsh:err', line.trimEnd());
      }
    });
    // 进度统计：dshenv（解压产物）+ npm-cache（下载缓存），安装期间每 2 秒
    const NPM_CACHE = PKGVAR ? path.join(PKGVAR, 'npm-cache') : path.join(dshenvDir(), '..', 'npm-cache');
    const installTotalMB = () =>
      (parseFloat(dirSizeMB(dshenvDir())) + parseFloat(dirSizeMB(NPM_CACHE))).toFixed(1);
    installProgressMb = installTotalMB();
    const timer = setInterval(() => { installProgressMb = installTotalMB(); }, 2000);
    child.on('error', (err) => {
      clearInterval(timer);
      log('error', `DSH 安装进程错误：${err.message}`);
      resolve(null);
    });
    child.on('exit', (code) => {
      clearInterval(timer);
      installProgressMb = installTotalMB();
      if (code !== 0) {
        log('error', 'DSH 运行时安装失败（见上方日志），请检查网络后重启应用');
        resolve(null);
        return;
      }
      // dsh-manager 成功时 stdout 输出 bin.js 路径（最后一行）
      const bin = stdoutLines[stdoutLines.length - 1] || '';
      resolve(bin && fs.existsSync(bin) ? bin : null);
    });
  });
}

function spawnDshWeb(bin) {
  const args = [bin, 'web', '--host', DSH_HOST, '--port', String(DSH_PORT)];
  const env = { ...process.env };
  if (!env.DSH_TELEMETRY_DISABLED) env.DSH_TELEMETRY_DISABLED = '1';
  // HOME 指向可写的应用 home（飞牛 package 用户无真实 /home/dsh，
  // DSH 内部文件浏览/工作区默认目录依赖 HOME —— 不设会 opendir /home/dsh ENOENT）
  // v0.2.4：真变量是 TRIM_PKGHOME（/vol1/@apphome/dsh）；TRIM_APPHOME 为兼容旧版保留
  env.HOME = process.env.TRIM_PKGHOME || process.env.TRIM_APPHOME || PKGVAR || DATA_DIR || '/tmp';
  // 数据目录：data-share 存在时指定，卸载/重装后数据仍保留
  if (DATA_DIR) env.DSH_HOME = DATA_DIR;

  log('info', `启动 DSH web：node ${args.join(' ')}`);
  if (DATA_DIR) log('info', `DSH 数据目录：${DATA_DIR}`);
  log('info', 'DSH_TELEMETRY_DISABLED=1');

  let child;
  try {
    child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    log('error', `DSH web 进程启动失败：${err.message}`);
    return;
  }
  dshChild = child;

  child.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) log('dsh', line.trimEnd());
    }
  });
  child.stderr.on('data', (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) log('dsh:err', line.trimEnd());
    }
  });
  child.on('error', (err) => {
    log('error', `DSH web 进程错误：${err.message}`);
  });
  child.on('exit', (code, signal) => {
    log('warn', `DSH web 进程退出 code=${code} signal=${signal}`);
    if (dshChild === child) {
      dshChild = null;
      dshReady = false;
      if (!shuttingDown) scheduleRestart();
    }
  });
}

function waitForDshWeb(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const probe = () => {
      const req = http.get({ host: DSH_HOST, port: DSH_PORT, path: '/', timeout: 1500 }, (res) => {
        res.resume();
        dshReady = true;
        log('info', `DSH web 就绪：http://${DSH_HOST}:${DSH_PORT}`);
        resolve(true);
      });
      req.on('timeout', () => { req.destroy(); retry(); });
      req.on('error', () => retry());
      function retry() {
        if (Date.now() > deadline) {
          log('warn', `等待 DSH web 就绪超时（${timeoutMs / 1000}s）`);
          resolve(false);
          return;
        }
        setTimeout(probe, 500);
      }
    };
    probe();
  });
}

// L6（v0.2.1）：版本查询缓存 —— spawnSync 每次起一个 node 进程（10s 超时），
// 频繁访问更新页有开销；缓存 60s；useCache=false 强制实时查询（升级等关键路径）
let cachedDshVersion = null;
let cachedDshVersionAt = 0;
function getDshVersion(useCache = true) {
  const now = Date.now();
  if (useCache && cachedDshVersion && now - cachedDshVersionAt < 60_000) return cachedDshVersion;
  const r = spawnSync(process.execPath, [MANAGER_JS, 'version'], { encoding: 'utf8', timeout: 10_000 });
  const v = String(r.stdout || '').trim();
  const ver = v && v !== 'none' ? v : null;
  if (useCache) { cachedDshVersion = ver; cachedDshVersionAt = now; }
  return ver;
}

/** 初始化 DSH：安装（如需）→ 启动 web → 等就绪。幂等。 */
async function ensureAndStart() {
  if (ensuring) return;
  ensuring = true;
  const startedAt = Date.now();
  try {
    if (dshReady && dshChild) return;
    ensureError = null;
    const bin = await ensureDshBinAsync();
    if (!bin) {
      ensureError = 'DSH 运行时安装失败（可能网络不通或源不可达），请查看运行日志后点击重试。';
      log('error', ensureError);
      return;
    }
    if (dshChild) return; // 安装期间 web 已在跑
    setStage('start');
    spawnDshWeb(bin);
    const ok = await waitForDshWeb(90_000);
    if (ok) {
      restartAttempt = 0; // 就绪后重置退避计数
      dshVersion = getDshVersion(false); // 强制实时查询（升级重装后版本可能变化，不用缓存）
      setStage('ready');
      log('info', `DSH 版本：${dshVersion ?? 'unknown'}（初始化总耗时 ${Math.round((Date.now() - startedAt) / 1000)}s）`);
    } else {
      ensureError = 'DSH 服务启动超时，请查看运行日志后点击重试。';
      log('error', ensureError);
    }
  } catch (err) {
    // 防御：任何初始化异常都必须可见，不能让页面无限"检查中"
    ensureError = `初始化异常：${err && err.message ? err.message : String(err)}`;
    log('error', ensureError);
  } finally {
    ensuring = false;
  }
}

// 自动重启（指数退避：1s → 2s → 4s … 上限 30s），DSH web 意外退出后拉起；
// 连续失败超过上限（如端口被残留进程占用）则停止并给出明确错误，避免无限重启
const RESTART_MAX = 5;
let restartTimer = null;
let restartAttempt = 0;
function scheduleRestart() {
  if (shuttingDown || restartTimer) return;
  if (restartAttempt >= RESTART_MAX) {
    ensureError = `DSH web 连续启动失败（已尝试 ${RESTART_MAX} 次），可能端口 ${DSH_PORT} 被占用或运行时异常，请检查日志后点击重试。`;
    log('error', ensureError);
    return;
  }
  const delay = Math.min(1000 * 2 ** restartAttempt, 30_000);
  restartAttempt++;
  log('warn', `${delay / 1000}s 后自动重启 DSH web…（第 ${restartAttempt}/${RESTART_MAX} 次）`);
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    if (shuttingDown || dshChild) return;
    await ensureAndStart();
  }, delay);
}

// ---------------------------------------------------------------------------
// 网关前缀剥离：fnOS 网关可能保留 /app/dsh 前缀，剥掉后得到应用内部路径
// ---------------------------------------------------------------------------
function stripPrefix(url) {
  if (!GATEWAY_PREFIX || !url.startsWith(GATEWAY_PREFIX)) return url;
  let rest = url.slice(GATEWAY_PREFIX.length);
  if (!rest.startsWith('/')) rest = '/' + rest;
  return rest;
}

// ---------------------------------------------------------------------------
// 更新检查（对齐 Windows 版任务B：npm registry dist-tags.latest + 语义化比较）
// ---------------------------------------------------------------------------
/**
 * GET 并解析 JSON；失败/超时/超限返回 null（静默）
 * N2（v0.2.1）：支持自定义请求头（如 npm 精简元数据 Accept）与响应大小上限
 * （npm 完整元数据 5-20MB，未设上限可能拖垮壳进程）
 */
function fetchJson(url, timeoutMs = 8000, headers = {}, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve) => {
    let req;
    try {
      req = https.get(url, { timeout: timeoutMs, headers }, (res) => {
        let body = '';
        let bytes = 0;
        res.on('data', (c) => {
          bytes += c.length;
          if (bytes > maxBytes) { try { req.destroy(); } catch { /* ignore */ } resolve(null); return; }
          body += c;
        });
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

function readConfig() {
  try {
    const raw = fs.readFileSync(resolveConfigFile(), 'utf8');
    const cfg = JSON.parse(raw.replace(/^\uFEFF/, '')); // 剥离 BOM（防 Windows 记事本等编辑污染）
    return {
      dshPackage: String(cfg.dshPackage || '@deepseek-ai/dsh'),
      dshVersion: String(cfg.dshVersion || 'latest'),
      registry: String(cfg.registry || 'https://registry.npmmirror.com'),
    };
  } catch {
    return { dshPackage: '@deepseek-ai/dsh', dshVersion: 'latest', registry: 'https://registry.npmmirror.com' };
  }
}

/** 查询 npm registry 上 DSH 最新版本（dist-tags.latest）；失败返回 null */
async function fetchLatestDshVersion() {
  const cfg = readConfig();
  const pkgPath = cfg.dshPackage.replace('/', '%2f'); // scoped 包需编码 /
  const base = (cfg.registry || 'https://registry.npmmirror.com').replace(/\/$/, '');
  // Accept 精简头：只取 dist-tags 等核心字段，避免下载完整元数据（5-20MB）（N2，对齐 Windows v13）
  const pkg = await fetchJson(`${base}/${pkgPath}`, 8000, { Accept: 'application/vnd.npm.install-v1+json' });
  return pkg?.['dist-tags']?.latest ?? null;
}

/** 语义化比较（semver 2.0 子集，支持 -rc.x 预发布），移植自 Windows 版 main.js */
function compareSemver(a, b) {
  const sa = String(a), sb = String(b);
  if (!/^\d+\.\d+\.\d+/.test(sa) || !/^\d+\.\d+\.\d+/.test(sb)) return 0;
  const va = sa.split('-')[0].split('.').map(Number), vb = sb.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = va[i] || 0, y = vb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  const ra = sa.includes('-') ? sa.slice(sa.indexOf('-') + 1) : '';
  const rb = sb.includes('-') ? sb.slice(sb.indexOf('-') + 1) : '';
  if (ra === '' && rb === '') return 0;
  if (ra === '') return 1;
  if (rb === '') return -1;
  const fa = ra.split('.'), fb = rb.split('.');
  for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
    const xa = fa[i], xb = fb[i];
    if (xa === undefined) return -1;
    if (xb === undefined) return 1;
    const na = /^\d+$/.test(xa) ? Number(xa) : null;
    const nb = /^\d+$/.test(xb) ? Number(xb) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na > nb ? 1 : -1;
    } else if (xa !== xb) {
      return xa > xb ? 1 : -1;
    }
  }
  return 0;
}

/** 查询更新信息：{ dsh: { current, latest, notes } }（latest=null 表示查询失败） */
async function queryUpdateInfo() {
  const cfg = readConfig();
  const latest = await fetchLatestDshVersion();
  const current = getDshVersion() ?? cfg.dshVersion;
  const notes = latest && compareSemver(current, latest) < 0
    ? `可升级到 ${latest}（升级后自动重装 DSH 运行时）`
    : '';
  return { dsh: { current, latest, notes } };
}

// N5（v0.2.1）：升级防抖 —— 连点/并发时只执行一次（ensuring 只防 ensure 重入，防不住 config 改写竞争）
let upgradingDsh = false;

/** DSH 热升级：改写 config.json dshVersion → 重启 DSH web（自动重装） */
async function upgradeDsh() {
  if (upgradingDsh) return { ok: false, reason: 'busy' };
  upgradingDsh = true;
  try {
    const cfg = readConfig();
    const current = getDshVersion() ?? cfg.dshVersion; // 实时读已安装版本（对齐 Windows installedDshVersion）
    const latest = await fetchLatestDshVersion();
    if (!latest) return { ok: false, reason: 'fetch-failed' };
    if (compareSemver(current, latest) >= 0) return { ok: false, reason: 'no-update' };
    // 备份 + 改写 config.json（优先写 $TRIM_PKGETC，用户可改）
    const cfgFile = resolveConfigFile();
    try {
      fs.copyFileSync(cfgFile, `${cfgFile}.bak`);
      const conf = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      conf.dshVersion = latest;
      fs.writeFileSync(cfgFile, JSON.stringify(conf, null, 2), 'utf8');
    } catch (err) {
      log('error', `改写 config.json 失败：${err.message}`);
      return { ok: false, reason: 'write-failed' };
    }
    log('info', `DSH 升级：${current} → ${latest}（config.json 已改写，开始重装运行时）`);
    // 停止旧 DSH web → 等旧进程真正退出（释放 3080 端口）→ 重新 ensure（版本不符自动重装）→ 重启
    // M3（v0.2.1）：kill 后必须等 exit，否则重装秒回（npm 缓存命中）时旧进程未释放端口 → EADDRINUSE
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    if (dshChild && dshChild.exitCode === null) {
      await new Promise((resolve) => {
        const c = dshChild;
        const t = setTimeout(() => resolve(), 5000); // 5s 兜底（异常进程强制继续）
        c.once('exit', () => { clearTimeout(t); resolve(); });
        try { c.kill('SIGTERM'); } catch { clearTimeout(t); resolve(); }
      });
    }
    dshChild = null;
    dshReady = false;
    dshVersion = null;
    cachedDshVersion = null; cachedDshVersionAt = 0; // 清版本缓存（升级后强制重查）
    await ensureAndStart();
    return { ok: true, from: current, to: latest };
  } finally {
    upgradingDsh = false;
  }
}

// ---------------------------------------------------------------------------
// 页面与 API 路由
// ---------------------------------------------------------------------------
function serveFile(res, file, contentType) {
  if (fs.existsSync(file)) {
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(file).pipe(res);
    return true;
  }
  return false;
}

function sendJson(res, obj, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

/**
 * 管理员校验（N4，v0.2.1）：
 *  经飞牛统一网关的请求带 X-Trim-* 可信头（登录态由网关校验，勿信客户端传入），
 *  仅管理员（X-Trim-Isadmin: true）可执行重启/升级等敏感操作；
 *  无 X-Trim 头的请求（本地开发/壳内部直连）不拦截——端口仅监听 127.0.0.1 + 网关 socket。
 */
function isAdmin(req) {
  const hasGatewayCtx = Object.keys(req.headers).some((h) => h.toLowerCase().startsWith('x-trim-'));
  if (!hasGatewayCtx) return true;
  return String(req.headers['x-trim-isadmin'] || '').toLowerCase() === 'true';
}

/** 初始化提示页（DSH 首次安装/未就绪时展示） */
function serveInit(res) {
  const html = path.join(SERVER_DIR, 'init.html');
  if (serveFile(res, html, 'text/html; charset=utf-8')) return true;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html><meta charset="utf-8"><body style="background:#0f1115;color:#dbe2f0;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">正在初始化 DeepSeek Harness…</body>');
  return true;
}

function handleApi(req, res, url) {
  // /api/health
  if (url === '/api/health') {
    sendJson(res, {
      ok: true, name: 'DeepSeek Harness', appVersion: APP_VERSION,
      dshReady, dshVersion, stage: currentStage, time: Date.now(),
    });
    return true;
  }
  // /api/status（初始化页轮询）
  if (url === '/api/status') {
    sendJson(res, {
      stage: currentStage, progressMb: installProgressMb,
      dshReady, dshVersion, error: ensureError,
    });
    return true;
  }
  // /api/restart（初始化失败后重试：重置错误并重新 ensure；仅管理员，N4）
  if (url === '/api/restart' && req.method === 'POST') {
    if (!isAdmin(req)) return sendJson(res, { ok: false, reason: 'forbidden' }, 403);
    ensureError = null;
    ensureAndStart();
    sendJson(res, { ok: true });
    return true;
  }
  // /api/log（最近日志，环形缓冲）
  if (url === '/api/log') {
    sendJson(res, { lines: LOG_LINES.slice(-500) });
    return true;
  }
  // /api/update（检查 DSH 官方更新）
  if (url === '/api/update') {
    queryUpdateInfo().then((info) => sendJson(res, { ok: true, ...info }));
    return true;
  }
  // /api/update/upgrade（一键升级 DSH；仅管理员，N4）
  if (url === '/api/update/upgrade') {
    if (!isAdmin(req)) return sendJson(res, { ok: false, reason: 'forbidden' }, 403);
    upgradeDsh().then((r) => sendJson(res, r));
    return true;
  }
  return false;
}

function handlePage(req, res, url) {
  if (url === '/about' || url === '/about/') {
    return serveFile(res, path.join(SERVER_DIR, 'about.html'), 'text/html; charset=utf-8');
  }
  if (url === '/log' || url === '/log/') {
    return serveFile(res, path.join(SERVER_DIR, 'log.html'), 'text/html; charset=utf-8');
  }
  if (url === '/update' || url === '/update/') {
    return serveFile(res, path.join(SERVER_DIR, 'update.html'), 'text/html; charset=utf-8');
  }
  if (url === '/init' || url === '/init/') {
    return serveInit(res);
  }
  return false;
}

/**
 * 网关模式重写：DSH 前端是预编译产物，资源与 API 全是根绝对路径（/assets、/api）。
 * 飞牛统一网关只转发 /app/dsh/*，必须由壳把引用改写成带前缀的路径。
 * 仅网关模式（GATEWAY_PREFIX 非空）启用。
 *
 * v0.2.2 修复（M1 命令弹层闪现根因）：移除悬浮入口注入（FLOATING_ENTRY）。
 *  根因：悬浮按钮 fixed right:18px bottom:18px + z-index:2147483647 置顶，恰好盖在
 *  DSH 命令弹层（composer 上方的弹出卡片，位于右下角区域）之上 —— 用户点击弹层项时
 *  pointerdown 落在悬浮按钮上（不在弹层卡片内）→ 弹层 document 监听判定"外部点击"
 *  → 立即 dismiss（闪现）。Windows 版无此注入所以正常；type=url 不改变悬浮按钮所以无效。
 *  悬浮入口（四菜单 Web 化）按 v2 清单规划回到 v0.3 实现；about/update/log 页面保留
 *  （可直接访问 /app/dsh/about、/app/dsh/update、/app/dsh/log）。
 */

function rewriteBody(contentType, body) {
  if (!GATEWAY_PREFIX) return body;
  let text = body;
  const isHtml = /text\/html/.test(contentType);
  if (isHtml) {
    // v0.2.3：移除 PWA manifest link —— 浏览器对 /app/dsh/manifest.webmanifest 解析报
    // "Manifest: Line: 1, column: 1, Syntax error"（桌面 Web 应用不依赖 PWA manifest，
    // 移除后浏览器不再请求/解析，彻底消除该错误）
    text = text.replace(/<link[^>]*\brel=["']manifest["'][^>]*>/gi, '');
    // 静态资源引用前缀化
    text = text
      .replace(/(src|href)="\/assets\//g, `$1="${GATEWAY_PREFIX}/assets/`)
      .replace(/(src|href)="\/manifest\.webmanifest"/g, `$1="${GATEWAY_PREFIX}/manifest.webmanifest"`)
      .replace(/(src|href)="\/favicon\.svg"/g, `$1="${GATEWAY_PREFIX}/favicon.svg"`);
  }
  if (isHtml || /javascript/.test(contentType)) {
    // JS（含 HTML 内联脚本与 __DSH_BOOT__ 注入）精确前缀化：
    //  - "/api/xxx 与 `/api/xxx：DSH 前端 API/WebSocket URL（改为网关前缀）
    //  - API_PATH = "/api" 常量（只用于拼 MUX/HOST events 路径）
    //  - "/api" 无尾斜杠字面量：RPC 通道（dsh-api-gateway 的 connection.rpc.call("/api", endpoint)
    //    → 拼接 /api/commands/list 等）。必须与接收方比较（channel !== "/api"）同步替换，
    //    否则命令数据请求打到根路径 /api/* → 网关 404 → 命令弹层加载失败闪现（M1 真正根因）
    //  - /plugins/ 客户端 bundle 路径（__DSH_BOOT__ 的 url 与 bundle 内互引）
    //  不动 `channel !== "/api"` 之外的比较逻辑（顺序：带斜杠规则先执行，无斜杠规则只
    //  命中精确 "/api"，两侧同步替换后比较仍成立）
    //
    //  M1 第二步（v0.2.2）：channel 前缀化后，connection 的 assertTarget 校验
    //  CHANNEL_PATTERN=/^\/[A-Za-z0-9._~-]+$/（单段）会拒绝 "/app/dsh/api"（多段）。
    //  同步放宽为允许 / 分段：/^\/[A-Za-z0-9._~/-]+$/（channel 值来自 api-gateway
    //  硬编码，非用户输入，无注入风险；endpoint 仍有严格分段校验）
    text = text
      .replace(/"\/api\//g, `"${GATEWAY_PREFIX}/api/`)
      .replace(/`\/api\//g, `\`${GATEWAY_PREFIX}/api/`)
      .replace(/API_PATH\s*=\s*"\/api"/g, `API_PATH = "${GATEWAY_PREFIX}/api"`)
      .replace(/"\/api"/g, `"${GATEWAY_PREFIX}/api"`)
      .replace(/"\/manifest\.webmanifest"/g, `"${GATEWAY_PREFIX}/manifest.webmanifest"`)
      .replace('CHANNEL_PATTERN = /^\\/[A-Za-z0-9._~-]+$/', 'CHANNEL_PATTERN = /^\\/[A-Za-z0-9._~/-]+$/')
      .replace(/"\/plugins\//g, `"${GATEWAY_PREFIX}/plugins/`);
    // 防静默失败：DSH 版本升级后 CHANNEL_PATTERN 文本可能变化 → 替换不命中 → RPC 校验失败复发。
    // 仅在含 CHANNEL_PATTERN 的 bundle 上检测（其他 bundle 不触发）。
    if (!text.includes('CHANNEL_PATTERN = /^\\/[A-Za-z0-9._~/-]+$/') && text.includes('CHANNEL_PATTERN = /^\\/')) {
      log('warn', 'rewriteBody: CHANNEL_PATTERN 放宽未命中（DSH 版本可能变化），命令 RPC 校验可能失败');
    }
  }
  return text;
}

/**
 * 转发到 DSH web 的请求头改写（网关模式）：
 *  DSH 的 /api 浏览器信任栅栏要求 Host 为 loopback/trusted，且 Origin 的 host 必须等于 Host。
 *  网关把浏览器 Host（NAS 域名/IP）透传 → 必须覆写 Host 为 loopback，并删除 Origin，
 *  否则 Origin(NAS) ≠ Host(127.0.0.1) 会被 403 拒绝。
 */
function upstreamHeaders(headers) {
  const h = { ...headers };
  if (GATEWAY_PREFIX) {
    h.host = `${DSH_HOST}:${DSH_PORT}`;
    delete h.origin;
    delete h['content-length']; // 长度由转发流决定
  }
  return h;
}

/** 代理到 DSH web（路径已剥前缀）；HTML/JS 响应在网关模式做路径重写 */
function proxyHttp(req, res, targetPath) {
  req.on('error', () => {}); // 客户端中途断开时吞掉，避免拖垮壳进程
  const headers = upstreamHeaders(req.headers);
  // v0.2.3：DSH web 不支持 HEAD（/api/session.export 的 HEAD 探测返回 400，导出下载中断）。
  // 把 HEAD 转 GET 转发（下游返回完整响应），丢弃 body 只回响应头，保持 HEAD 语义。
  const isHead = req.method === 'HEAD';
  const proxy = http.request({
    host: DSH_HOST, port: DSH_PORT, method: isHead ? 'GET' : req.method, path: targetPath, headers,
  }, (pRes) => {
    if (isHead) {
      // HEAD 语义：读掉 body 不转发，只回响应头
      pRes.resume();
      res.writeHead(pRes.statusCode, pRes.headers);
      res.end();
      return;
    }
    const contentType = String(pRes.headers['content-type'] || '');
    const rewritable = GATEWAY_PREFIX
      && req.method === 'GET'
      && !pRes.headers['content-encoding'] // 压缩响应不重写（避免破坏）
      && (/text\/html/.test(contentType) || /javascript/.test(contentType));
    if (rewritable) {
      // 缓冲响应体 → 重写 → 返回（需重算 Content-Length）
      const chunks = [];
      pRes.on('data', (c) => chunks.push(c));
      pRes.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const out = Buffer.from(rewriteBody(contentType, body), 'utf8');
        const h = { ...pRes.headers };
        delete h['content-length'];
        delete h['transfer-encoding']; // 已缓冲整体，改回定长
        h['content-length'] = String(out.length);
        res.writeHead(pRes.statusCode, h);
        res.end(out);
      });
      pRes.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
    } else {
      res.writeHead(pRes.statusCode, pRes.headers);
      pRes.pipe(res);
    }
  });
  req.pipe(proxy);
  proxy.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('DeepSeek Harness 服务尚未就绪，请稍后重试。');
  });
}

const server = http.createServer((req, res) => {
  const url = stripPrefix(req.url).split('?')[0]; // 路由匹配用（去 query）
  if (url.startsWith('/api/') && handleApi(req, res, url)) return;
  if (handlePage(req, res, url)) return;
  if (!dshReady || !dshChild) {
    serveInit(res);
    return;
  }
  // v0.2.3 修复：转发必须保留 query string（如 /api/session.export?sessionId=xxx），
  // 否则 DSH web 收到无参数路径 → 400（Session 导出失败的根因）
  proxyHttp(req, res, stripPrefix(req.url));
});

// WebSocket 转发（TCP 隧道，路径剥前缀 + Host/Origin 改写）
server.on('upgrade', (req, socket, head) => {
  const targetPath = stripPrefix(req.url);
  if (!dshReady || !dshChild) {
    socket.destroy();
    return;
  }
  // 客户端/上游任意一端断开都可能触发 error（ECONNRESET 等），必须吞掉，
  // 否则 unhandled 'error' 会拖垮整个壳进程
  socket.on('error', () => {});
  const headers = upstreamHeaders(req.headers);
  const proxy = net.connect(DSH_PORT, DSH_HOST, () => {
    // v0.2.2：head（upgrade 请求头之后的尾随字节）必须写在请求头之后
    // （HTTP 协议顺序：请求行 → 头 → 空行 → head）；旧写法 head 在前，
    // WS 握手 head 为空未触发问题，但 head 非空时会导致上游解析错乱
    proxy.write([
      `${req.method} ${targetPath} HTTP/${req.httpVersion}`,
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      '',
      '',
    ].join('\r\n'));
    proxy.write(head);
  });
  proxy.on('error', () => socket.destroy());
  socket.pipe(proxy).pipe(socket);
});

// ---------------------------------------------------------------------------
// 退出清理：DSH web 子进程随壳退出（避免残留进程）
// ---------------------------------------------------------------------------
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', `收到 ${signal}，正在关闭…`);
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (dshChild && dshChild.exitCode === null && dshChild.signalCode === null) {
    try { dshChild.kill('SIGTERM'); } catch { /* ignore */ }
    // 宽限期后强杀
    setTimeout(() => {
      try { if (dshChild.exitCode === null) dshChild.kill('SIGKILL'); } catch { /* ignore */ }
    }, 3000);
  }
  setTimeout(() => process.exit(0), 4000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('exit', () => {
  if (dshChild && dshChild.exitCode === null && dshChild.signalCode === null) {
    try { dshChild.kill('SIGKILL'); } catch { /* ignore */ }
  }
});

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------
function startEnsure() {
  setStage('check');
  ensureAndStart(); // 异步初始化 DSH（首次联网下载），期间 /app/dsh 显示初始化页
}

function listen() {
  server.on('error', (err) => {
    log('error', `监听失败：${err.message}`);
  });
  if (SOCKET_PATH) {
    fs.rmSync(SOCKET_PATH, { force: true });
    server.listen(SOCKET_PATH, () => {
      log('info', `网关 Socket 就绪：${SOCKET_PATH}`);
      log('info', `网关前缀：${GATEWAY_PREFIX}，转发目标：http://${DSH_HOST}:${DSH_PORT}`);
      startEnsure();
    });
  } else {
    server.listen(PORT, () => {
      log('info', `本地开发模式：http://127.0.0.1:${PORT}（前缀 ${GATEWAY_PREFIX}）`);
      startEnsure();
    });
  }
  // 兜底：listen 回调异常/未触发时，3 秒后仍保证初始化流程执行
  setTimeout(() => {
    if (!dshReady && !ensuring && !ensureError) startEnsure();
  }, 3000);
}

listen();
