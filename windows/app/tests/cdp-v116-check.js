'use strict';
/** cdp-v116-check.js — v1.1.6 CDP 仿真：验证 ① 我的提示词持久化(save→重启→仍在) ② 备份含 custom-prompts.json */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_ROOT = 'D:/00xm/x-app/dsh-Desktop/windows/app';
const PACKED_EXE = path.join(APP_ROOT, 'dist', 'DSH-Desktop-win32-x64', 'DSH-Desktop.exe');
const SIM_ROOT = path.join(os.tmpdir(), 'dsh-sim-v116');
const SIM_PORT = 3116;
const SIM_DEBUG_PORT = 9260;

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) { passed++; console.log('  x ' + name); } else { failed++; console.error('  FAIL ' + name); } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function httpGet(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try { const res = await fetch(url, { signal: controller.signal }); return { status: res.status, body: await res.text() }; }
  finally { clearTimeout(t); }
}

function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1; const pending = new Map();
  const ready = new Promise((res, rej) => { ws.addEventListener('open', () => res()); ws.addEventListener('error', () => rej(new Error('ws fail'))); });
  ws.addEventListener('message', (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error('CDP: ' + JSON.stringify(m.error))) : resolve(m.result); } });
  return {
    ws,
    async send(method, params = {}) {
      await ready; const id = nextId++;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
    },
    async eval(expression) {
      const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      return r && r.result ? r.result.value : undefined;
    },
    close() { try { ws.close(); } catch {} },
  };
}

async function waitTarget(port, pred, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await httpGet(`http://127.0.0.1:${port}/json`, 2000); const ts = JSON.parse(r.body); const t = ts.find(pred); if (t) return t; } catch {}
    await sleep(500);
  }
  return null;
}

let child;
function killSim() {
  try { if (child && child.pid) require('node:child_process').execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch {}
}

async function waitReady(cdp, retries = 60) {
  for (let i = 0; i < retries; i++) {
    try { const v = await cdp.eval('!!window && !!document.body'); if (v) return true; } catch {}
    await sleep(1000);
  }
  return false;
}

async function main() {
  if (!fs.existsSync(PACKED_EXE)) throw new Error('打包产物不存在：' + PACKED_EXE);

  fs.rmSync(SIM_ROOT, { recursive: true, force: true });
  const userData = path.join(SIM_ROOT, 'userdata');
  const dshHome = path.join(SIM_ROOT, 'dshhome');
  fs.mkdirSync(path.join(userData, 'dshenv'), { recursive: true });
  fs.mkdirSync(path.join(dshHome, 'storages'), { recursive: true });
  const src = path.join(os.tmpdir(), 'dsh-sim-v095', 'userdata', 'dshenv');
  if (fs.existsSync(path.join(src, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
    fs.cpSync(src, path.join(userData, 'dshenv'), { recursive: true });
    console.log('[0] dshenv 复用 v095 仿真');
  } else { throw new Error('dshenv 源缺失'); }
  fs.writeFileSync(path.join(dshHome, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n', 'utf8');
  // 预置合法 credentials（version 必须是字符串，否则 dsh-credentials-local 启动失败）
  fs.writeFileSync(path.join(dshHome, '.credentials.yaml'), 'version: "2026-08-22.1"\n', 'utf8');
  fs.writeFileSync(path.join(dshHome, 'storages', 'workspace.json'), JSON.stringify({ unit: { name: 'workspace', version: 2 }, global: { initialized: true, workspaceIds: ['sim-ws'] }, tables: { workspaces: { 'sim-ws': { path: path.join(SIM_ROOT, 'workspace'), title: 'v116-sim', sessionIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } } }, null, 2), 'utf8');

  console.log('[1] 启动 dist 包 --port=' + SIM_PORT + ' --remote-debugging-port=' + SIM_DEBUG_PORT);
  child = spawn(PACKED_EXE, [`--user-data-dir=${userData}`, `--port=${SIM_PORT}`, `--remote-debugging-port=${SIM_DEBUG_PORT}`], { env: { ...process.env, DSH_HOME: dshHome, USERPROFILE: SIM_ROOT, HOME: SIM_ROOT }, stdio: 'ignore', detached: true, windowsHide: true });
  child.unref();

  const target = await waitTarget(SIM_DEBUG_PORT, (t) => t.type === 'page' && new RegExp(`^http://127\\.0\\.0\\.1:${SIM_PORT}`).test(t.url));
  ok(!!target, 'DSH 主页面 target 就绪');
  if (!target) { killSim(); process.exit(1); }
  const cdp = cdpConnect(target.webSocketDebuggerUrl);
  ok(await waitReady(cdp), 'DSH 页面渲染就绪');

  // ① 通过 IPC 保存我的提示词
  console.log('[2] 写入我的提示词 -> custom-prompts.json');
  const saveRes = await cdp.eval(`(async () => {
    try {
      if (window.dshDesktop && window.dshDesktop.saveCustomPrompt) {
        const r = await window.dshDesktop.saveCustomPrompt({ name: 'CDP仿真提示词', cat: '我的', content: '测试内容', hint: '' });
        return { ok: true, r };
      }
      return { ok: false, reason: 'no api' };
    } catch (e) { return { ok: false, reason: String(e) }; }
  })()`);
  console.log('  save result:', JSON.stringify(saveRes));
  ok(saveRes && saveRes.ok !== false, '通过 IPC 保存我的提示词');

  // ② 检查 custom-prompts.json 落盘
  const file = path.join(userData, 'custom-prompts.json');
  let written = false;
  try { written = fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).items.length > 0; } catch {}
  ok(written, 'custom-prompts.json 已落盘且含条目');

  // ③ 重启验证持久化
  console.log('[3] 重启验证持久化');
  killSim();
  await sleep(1500);
  child = spawn(PACKED_EXE, [`--user-data-dir=${userData}`, `--port=${SIM_PORT}`, `--remote-debugging-port=${SIM_DEBUG_PORT}`], { env: { ...process.env, DSH_HOME: dshHome, USERPROFILE: SIM_ROOT, HOME: SIM_ROOT }, stdio: 'ignore', detached: true, windowsHide: true });
  child.unref();
  const target2 = await waitTarget(SIM_DEBUG_PORT, (t) => t.type === 'page' && new RegExp(`^http://127\\.0\\.0\\.1:${SIM_PORT}`).test(t.url));
  ok(!!target2, '重启后 DSH 主页面就绪');
  if (!target2) { killSim(); process.exit(1); }
  const cdp2 = cdpConnect(target2.webSocketDebuggerUrl);
  await waitReady(cdp2);
  const afterRestart = await cdp2.eval(`(async () => {
    if (window.dshDesktop && window.dshDesktop.getCustomPrompts) { return await window.dshDesktop.getCustomPrompts(); }
    return { ok: false, reason: 'no custom-list' };
  })()`);
  console.log('  afterRestart:', JSON.stringify(afterRestart));
  ok(!!afterRestart && JSON.stringify(afterRestart).includes('CDP仿真提示词'), '重启后我的提示词仍在');

  // ④ 源码断言：backup.js 含 custom-prompts 备份/恢复
  const backupSrc = fs.readFileSync('D:/00xm/x-app/dsh-Desktop/windows/app/modules/backup.js', 'utf8');
  ok(backupSrc.includes('custom-prompts.json'), 'backup.js 备份含 custom-prompts.json');
  ok(backupSrc.includes('恢复我的提示词'), 'backup.js 恢复含 custom-prompts.json');

  killSim();
  console.log(`\nRESULT: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); killSim(); process.exit(1); });
