'use strict';

/**
 * windows/tests/smoke.js — DSH-Desktop 最小集成冒烟测试（v0.7.10，29 改进意见 5）
 *
 * 流程：起壳（spawn Electron）→ 等 DSH 就绪（GET / 200）→ 健康校验
 *       （/api/health 存在则校验；DSH web 本体无此端点时降级以 / 200 为准）
 *       → 退出壳（taskkill 进程树）→ 断言无残留（端口释放 + 主进程消失）。
 *
 * 用法（在 windows/app 下执行）：
 *   npm run smoke                          # 默认端口 3080，就绪超时 240s
 *   node ../tests/smoke.js --port 4000 --timeout 600000
 *
 * 前置条件：本机已成功启动过 DSH-Desktop（DSH 运行时已装好，避免首装 600s）；
 *           测试前请先退出正在运行的 DSH-Desktop 实例（单实例锁）。
 *
 * 退出码：0 = 全部通过；非 0 = 有失败项。
 */

const { spawn, execSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

// tests/ 位于 windows/ 下：ROOT = windows/，APP_DIR = windows/app
const ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const ELECTRON_EXE = path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const HOST = '127.0.0.1';

// ── 参数解析 ──────────────────────────────────────────────────────────────
function parseArgs() {
  const argv = process.argv.slice(2);
  const out = { port: 3080, timeoutMs: 240_000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) out.port = Number(argv[i + 1]);
    if (argv[i] === '--timeout' && argv[i + 1]) out.timeoutMs = Number(argv[i + 1]);
  }
  return out;
}
const { port, timeoutMs } = parseArgs();
const BASE = `http://${HOST}:${port}`;

// ── 工具 ──────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(url, timeout = 5000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; if (body.length > 2 * 1024 * 1024) req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', () => resolve({ status: 0, body: '' }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '' }); });
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

function portInUse(p) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host: HOST, port: p });
    s.setTimeout(1500);
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('timeout', () => { s.destroy(); resolve(false); });
    s.once('error', () => resolve(false));
  });
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function killTree(pid) {
  try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', windowsHide: true }); } catch { /* ignore */ }
}

// ── 测试流程 ──────────────────────────────────────────────────────────────
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForReady(deadline) {
  let lastStatus = 0;
  while (Date.now() < deadline) {
    const r = await httpGet(`${BASE}/`);
    if (r.status === 200) return true;
    lastStatus = r.status;
    await sleep(1000);
  }
  console.log(`   [waitForReady] 超时，最后状态码 ${lastStatus}`);
  return false;
}

async function main() {
  // 0. 前置检查
  if (!fs.existsSync(ELECTRON_EXE)) {
    console.error(`[smoke] 未找到 Electron 可执行文件：${ELECTRON_EXE}\n请先在 windows/app 执行 npm install。`);
    process.exit(2);
  }
  if (await portInUse(port)) {
    console.error(`[smoke] 端口 ${port} 已被占用 —— 请先退出正在运行的 DSH-Desktop 实例再测。`);
    process.exit(2);
  }

  // 1. 起壳
  console.log(`[smoke] 启动 DSH-Desktop（端口 ${port}，就绪超时 ${timeoutMs / 1000}s）…`);
  const child = spawn(ELECTRON_EXE, ['.', '--port', String(port)], {
    cwd: APP_DIR,
    env: { ...process.env, DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let childOut = '';
  child.stdout.on('data', (d) => { childOut += d; });
  child.stderr.on('data', (d) => { childOut += d; });
  child.on('error', (err) => {
    console.error(`[smoke] 启动失败：${err.message}`);
    process.exit(2);
  });

  // 2. 等 DSH 就绪（GET / 200，与 main.js waitForServer 同判据）
  const deadline = Date.now() + timeoutMs;
  const ready = await waitForReady(deadline);
  check('DSH 服务就绪（GET / → 200）', ready, ready ? `${BASE}/` : '超时');

  // 3. 健康校验：/api/health 存在则校验；DSH web 本体无此端点（飞牛壳才有）时降级
  if (ready) {
    const health = await httpGet(`${BASE}/api/health`);
    if (health.status === 200) {
      let ok = true;
      try { const j = JSON.parse(health.body); ok = j && j.dshReady !== false; } catch { /* 非 JSON 也接受 */ }
      check('健康校验（/api/health → 200）', ok, `status=${health.status}`);
    } else {
      check('健康校验（/api/health 降级）', true,
        `status=${health.status}（DSH web 本体无此端点属正常，以 GET / 200 为准）`);
    }
  }

  // 4. 退出壳（进程树）
  if (child.pid) {
    console.log(`[smoke] 退出壳（taskkill 进程树 PID=${child.pid}）…`);
    killTree(child.pid);
  }

  // 5. 断言无残留：端口释放 + 主进程消失（最多等 15s）
  let portFreed = false;
  const freeDeadline = Date.now() + 15_000;
  while (Date.now() < freeDeadline) {
    if (!(await portInUse(port))) { portFreed = true; break; }
    await sleep(1000);
  }
  check('退出后端口释放（无残留服务）', portFreed, portFreed ? `端口 ${port} 已释放` : `端口 ${port} 仍被占用`);

  let procGone = true;
  if (child.pid) {
    await sleep(1000);
    procGone = !pidAlive(child.pid);
  }
  check('退出后主进程消失', procGone, procGone ? `PID=${child.pid}` : `PID=${child.pid} 仍存活`);

  // 6. 汇总
  const failed = results.filter((r) => !r.ok);
  console.log('\n========================================');
  console.log(`smoke 结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  FAIL  ${f.name}`);
    if (childOut) console.log('\n--- 壳输出（末 30 行）---\n' + childOut.split(/\r?\n/).slice(-30).join('\n'));
    process.exit(1);
  }
  console.log('全部通过 ✅');
  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke] 异常：', err);
  process.exit(1);
});
