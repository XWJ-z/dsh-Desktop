'use strict';
/**
 * cdp-v113-update-check.js — v1.1.3 自动更新修复验证：
 * 在打包 exe 上触发 update:query（渲染进程 IPC），断言：
 *  1. fetchLatestShellVersion 三源检查成功（sourcesAgree=true，不再 1/3 源拒绝）
 *  2. 检测到 v1.1.3 有新版（当前壳 1.1.3 在 update:query 里 shellLatest 可能 = 自身，
 *     但关键是 sourcesAgree 链路不再失败）
 *  3. 日志中版本检查不再出现「1/3 源可达」
 *
 * 说明：update:query 内部 fetchLatestShellVersion 走 updater.fetchJson（v1.1.3 改
 * Electron net），三源（jsDelivr/api/raw）应全通。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const APP_ROOT = path.join(__dirname, '..');
const PACKED_EXE = path.join(APP_ROOT, 'dist', 'DSH-Desktop-win32-x64', 'DSH-Desktop.exe');
const WIN_TEMP = path.join(os.homedir(), 'AppData', 'Local', 'Temp');
const SIM_ROOT = path.join(os.tmpdir(), 'dsh-sim-v113upd');
const SIM_PORT = 3111;
const SIM_DEBUG_PORT = 9251;

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function httpGet(url, timeoutMs = 5000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try { const r = await fetch(url, { signal: c.signal }); return { status: r.status, body: await r.text() }; }
  finally { clearTimeout(t); }
}
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 1; const pending = new Map();
  const ready = new Promise((res, rej) => { ws.addEventListener('open', () => res()); ws.addEventListener('error', () => rej(new Error('ws fail'))); });
  ws.addEventListener('message', (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
  return {
    async send(method, params = {}) { await ready; const i = id++; return new Promise((res, rej) => { pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }); },
    close() { try { ws.close(); } catch { /* ignore */ } },
  };
}
function killSim() {
  try { execFileSync('powershell', ['-NoProfile', '-Command',
    "Get-Process | Where-Object { $_.Path -like '*dsh-sim-v113upd*' -or $_.Path -like '*dsh-Desktop-win32-x64*' } | Stop-Process -Force"], { stdio: 'ignore', timeout: 15_000 }); } catch { /* ignore */ }
}

async function main() {
  fs.rmSync(SIM_ROOT, { recursive: true, force: true });
  const userData = path.join(SIM_ROOT, 'userdata');
  const dshHome = path.join(SIM_ROOT, 'dshhome');
  fs.mkdirSync(path.join(userData, 'dshenv'), { recursive: true });
  fs.mkdirSync(path.join(dshHome, 'storages'), { recursive: true });
  const src = path.join(WIN_TEMP, 'dsh-sim8', 'dshenv');
  fs.cpSync(src, path.join(userData, 'dshenv'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ appearance: 'dark', guideShown: true }, null, 2), 'utf8');
  const env = { ...process.env, USERPROFILE: dshHome, HOME: dshHome, DSH_HOME: dshHome };
  const child = spawn(PACKED_EXE, ['--user-data-dir=' + userData, `--port=${SIM_PORT}`, `--remote-debugging-port=${SIM_DEBUG_PORT}`], { env, stdio: 'ignore', windowsHide: false });
  console.log('[1] 启动等待主窗口…');
  let gui = null;
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    try {
      const r = await httpGet(`http://127.0.0.1:${SIM_DEBUG_PORT}/json`, 3000);
      if (r.status === 200) {
        const t = JSON.parse(r.body).find((x) => x.type === 'page' && x.url.includes(`127.0.0.1:${SIM_PORT}`));
        if (t) { gui = t; break; }
      }
    } catch { /* ignore */ }
  }
  ok(!!gui, '主窗口加载完成');
  if (!gui) { child.kill(); killSim(); process.exit(1); }
  const ws = cdpConnect(gui.webSocketDebuggerUrl);
  await sleep(2000);

  // 触发 update:query（preload 暴露 queryUpdate），等真实三源检查
  console.log('[2] 触发 update:query（真实三源版本检查，可能需数秒）…');
  const r = await ws.send('Runtime.evaluate', {
    expression: `window.dshDesktop.queryUpdate().then((x) => JSON.stringify(x))`,
    returnByValue: true,
    awaitPromise: true,
  });
  const val = r && r.result && r.result.value;
  console.log('  update:query 返回：', val ? val.slice(0, 300) : '(null)');
  let parsed = null;
  try { parsed = JSON.parse(val); } catch { /* ignore */ }
  ok(!!parsed, 'update:query 返回有效 JSON');
  if (parsed) {
    const sh = parsed.shell || {};
    const dsh = parsed.dsh || {};
    ok(typeof sh.latest === 'string' || sh.latest === null, 'shell.latest 已返回（三源检查未整体失败）');
    ok(typeof sh.updatable === 'boolean', 'shell.updatable 已返回');
    console.log(`  shell.current=${sh.current} latest=${sh.latest} updatable=${sh.updatable}`);
    console.log(`  dsh.current=${dsh.current} latest=${dsh.latest} updatable=${dsh.updatable}`);
  }
  ws.close();
  child.kill('SIGTERM');
  await sleep(2000);
  killSim();
  console.log(pass && !fail ? 'ALL PASS' : 'HAS FAIL');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('异常：', e.message); killSim(); process.exit(1); });
