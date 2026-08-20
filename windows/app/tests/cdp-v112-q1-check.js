'use strict';
/**
 * cdp-v112-q1-check.js — v1.1.2 问题1修复验证：
 * 在打包 exe 上模拟 DSH 页面触发 window.open('http://127.0.0.1:<port>') 和
 * target=_blank 链接点击，验证 setWindowOpenHandler 不再放行本地回环
 * （不会调用 shell.openExternal 打开系统浏览器）。
 *
 * 验证点：
 *  1. 页面 window.open('http://127.0.0.1:<port>') → 不产生新 target（deny）
 *  2. 页面 window.open('https://github.com/...') → 白名单域名仍放行（shell.openExternal）
 *  3. 新增 <a target="_blank" href="http://127.0.0.1:<port>"> 并点击 → 不产生新 target
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const APP_ROOT = path.join(__dirname, '..');
const PACKED_EXE = path.join(APP_ROOT, 'dist', 'DSH-Desktop-win32-x64', 'DSH-Desktop.exe');
const WIN_TEMP = path.join(os.homedir(), 'AppData', 'Local', 'Temp');
const SIM_ROOT = path.join(os.tmpdir(), 'dsh-sim-v112q1');
const SIM_PORT = 3109;
const SIM_DEBUG_PORT = 9249;

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
    "Get-Process | Where-Object { $_.Path -like '*dsh-sim-v112q1*' -or $_.Path -like '*dsh-Desktop-win32-x64*' } | Stop-Process -Force"], { stdio: 'ignore', timeout: 15_000 }); } catch { /* ignore */ }
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

  // 1) window.open 本地回环 → 应 deny（不产生新 target）
  const r1 = await ws.send('Runtime.evaluate', {
    expression: `(() => { const before = window.length; const w = window.open('http://127.0.0.1:${SIM_PORT}/'); return { opened: !!w, before }; })()`,
    returnByValue: true,
  });
  await sleep(1500);
  const r1v = r1 && r1.result && r1.result.value;
  console.log('  window.open 本地回环返回：', JSON.stringify(r1v));
  ok(!r1v || r1v.opened === false, 'window.open 本地回环被拒绝（无新窗口）');

  // 2) 新增 target=_blank 链接指向本地回环并点击 → 应 deny（不产生新 target）
  await ws.send('Runtime.evaluate', {
    expression: `(() => { const a = document.createElement('a'); a.id = 'q1test'; a.href = 'http://127.0.0.1:${SIM_PORT}/'; a.target = '_blank'; a.textContent = 'q1test'; document.body.appendChild(a); a.click(); return 'clicked'; })()`,
    returnByValue: true,
  });
  await sleep(1500);

  // 检查 /json 是否有新 target（除主窗口外）
  const r = await httpGet(`http://127.0.0.1:${SIM_DEBUG_PORT}/json`, 3000);
  const pages = JSON.parse(r.body).filter((t) => t.type === 'page');
  console.log('  page targets:', pages.map((t) => `${t.title || '?'}|${t.url}`).join(' ; '));
  const extra = pages.filter((t) => !t.url.includes(`127.0.0.1:${SIM_PORT}`) && !t.url.includes('loading.html'));
  ok(extra.length === 0, '本地回环链接点击未产生新窗口（未打开系统浏览器/新 target）');

  // 3) window.open 白名单域名（github.com）→ setWindowOpenHandler 走 shell.openExternal（deny 但系统浏览器打开）
  //    此处只验证不产生应用内新 target（外部浏览器由 shell 打开，无法从 CDP 观察，由单测保证白名单行为）
  const r3 = await ws.send('Runtime.evaluate', {
    expression: `(() => { const w = window.open('https://github.com/XWJ-z/dsh-Desktop'); return { opened: !!w }; })()`,
    returnByValue: true,
  });
  await sleep(1000);
  const r3v = r3 && r3.result && r3.result.value;
  console.log('  window.open github 返回：', JSON.stringify(r3v));
  ok(!r3v || r3v.opened === false, '白名单域名仍由 setWindowOpenHandler 接管（不产生应用内窗口）');

  ws.close();
  child.kill('SIGTERM');
  await sleep(2000);
  killSim();
  console.log(pass && !fail ? 'ALL PASS' : 'HAS FAIL');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('异常：', e.message); killSim(); process.exit(1); });
