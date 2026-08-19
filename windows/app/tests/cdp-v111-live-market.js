'use strict';
/**
 * cdp-v111-live-market.js — 插件市场真实拉取验证（无预置缓存，走真实网络）
 * 覆盖：插件市场窗口在无缓存时拉取官方 README → 解析出真实插件列表（应 > 100 个）
 * 用法：node tests/cdp-v111-live-market.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const APP_ROOT = path.join(__dirname, '..');
const PACKED_EXE = path.join(APP_ROOT, 'dist', 'DSH-Desktop-win32-x64', 'DSH-Desktop.exe');
const WIN_TEMP = path.join(os.homedir(), 'AppData', 'Local', 'Temp');
const SIM_ROOT = path.join(os.tmpdir(), 'dsh-sim-v111-live');
const SIM_PORT = 3105;
const SIM_DEBUG_PORT = 9245;

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function httpGet(url, timeoutMs = 5000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try { const res = await fetch(url, { signal: c.signal }); return { status: res.status, body: await res.text() }; }
  finally { clearTimeout(t); }
}

function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', () => rej(new Error('ws fail')));
  });
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error('CDP: ' + JSON.stringify(m.error))); else resolve(m.result);
    }
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = nextId++;
      return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
    },
    close() { try { ws.close(); } catch { /* ignore */ } },
  };
}

async function waitTarget(debugPort, predicate, timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await httpGet(`http://127.0.0.1:${debugPort}/json`);
      if (r.status === 200) {
        const hit = JSON.parse(r.body).find(predicate);
        if (hit) return hit;
      }
    } catch { /* ignore */ }
    await sleep(800);
  }
  return null;
}

function killSim() {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-Process | Where-Object { $_.Path -like '*dsh-sim-v111-live*' -or $_.Path -like '*dsh-Desktop-win32-x64*' } | Stop-Process -Force"],
      { stdio: 'ignore', timeout: 15_000 });
    console.log('[x] 仿真进程已清理');
  } catch (err) { console.warn('[x] 清理警告：' + err.message); }
}

async function main() {
  if (!fs.existsSync(PACKED_EXE)) throw new Error('打包产物不存在');
  fs.rmSync(SIM_ROOT, { recursive: true, force: true });
  const userData = path.join(SIM_ROOT, 'userdata');
  const dshHome = path.join(SIM_ROOT, 'dshhome');
  fs.mkdirSync(path.join(userData, 'dshenv'), { recursive: true });
  fs.mkdirSync(path.join(dshHome, 'storages'), { recursive: true });
  fs.mkdirSync(path.join(SIM_ROOT, 'workspace'), { recursive: true });
  const candidates = [
    path.join(WIN_TEMP, 'dsh-sim8', 'dshenv'),
    path.join(WIN_TEMP, 'dsh-sim-v097', 'userdata', 'dshenv'),
    path.join(WIN_TEMP, 'dsh-sim-v095', 'userdata', 'dshenv'),
  ];
  let src = null;
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) { src = c; break; }
  }
  if (!src) throw new Error('dshenv 源缺失');
  fs.cpSync(src, path.join(userData, 'dshenv'), { recursive: true });
  console.log('[0] dshenv 复用 ' + src);
  fs.writeFileSync(path.join(dshHome, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-19.1\n', 'utf8');
  fs.writeFileSync(path.join(dshHome, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 }, global: { initialized: true, workspaceIds: ['sim-ws'] },
    tables: { workspaces: { 'sim-ws': { path: path.join(SIM_ROOT, 'workspace'), title: 'v111-live', sessionIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } },
  }, null, 2), 'utf8');

  console.log('[1] 启动打包应用（--port=' + SIM_PORT + ' --remote-debugging-port=' + SIM_DEBUG_PORT + '）');
  const child = spawn(PACKED_EXE,
    [`--user-data-dir=${userData}`, `--port=${SIM_PORT}`, `--remote-debugging-port=${SIM_DEBUG_PORT}`],
    { env: { ...process.env, DSH_HOME: dshHome, USERPROFILE: SIM_ROOT, HOME: SIM_ROOT }, stdio: 'ignore', detached: true, windowsHide: true });
  child.unref();

  const mainTarget = await waitTarget(SIM_DEBUG_PORT, (t) => t.type === 'page' && new RegExp(`^http://127\\.0\\.0\\.1:${SIM_PORT}`).test(t.url));
  ok(!!mainTarget, 'DSH 主页面 target 就绪');
  if (!mainTarget) { killSim(); process.exit(1); }
  const cdp = cdpConnect(mainTarget.webSocketDebuggerUrl);

  try {
    let ready = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 30_000) {
      const r = await cdp.send('Runtime.evaluate', { expression: '!!window.dshDesktop', returnByValue: true }).catch(() => null);
      if (r && r.result && r.result.value === true) { ready = true; break; }
      await sleep(500);
    }
    ok(ready, 'preload 注入完成');
    if (!ready) throw new Error('注入超时');

    // 打开插件市场（无缓存 → 真实拉取 README）
    await cdp.send('Runtime.evaluate', { expression: 'window.dshDesktop.openPluginMarket()', returnByValue: true, awaitPromise: true });
    const mkt = await waitTarget(SIM_DEBUG_PORT, (t) => /plugin-market\.html/.test(t.url), 15_000);
    ok(!!mkt, '插件市场窗口已打开');
    if (!mkt) throw new Error('插件市场窗口未打开');
    const mktCdp = cdpConnect(mkt.webSocketDebuggerUrl);
    try {
      let mv = null;
      const t1 = Date.now();
      // 真实拉取可能耗时（三源并发 + 解析），最多等 60s
      while (Date.now() - t1 < 60_000) {
        const r = await mktCdp.send('Runtime.evaluate', {
          expression: `(() => ({
            n: document.querySelectorAll('.plugin-card').length,
            empty: !!document.querySelector('.empty-state'),
            loading: !!document.querySelector('.loading'),
            firstName: (document.querySelector('.plugin-name') || {}).textContent || '',
            firstDesc: (document.querySelector('.plugin-description') || {}).textContent || '',
          }))()`,
          returnByValue: true,
        });
        mv = r.result && r.result.value;
        // 等渲染完成：>100 张卡片（renderPlugins 同步 append，避免渲染中途误判）或空态
        if (mv && mv.n > 100) break;
        if (mv && mv.empty) break;
        await sleep(1000);
      }
      ok(!!mv && mv.n > 100, `真实拉取解析出插件（>100 个，实际 ${mv && mv.n}）`);
      ok(!!mv && !mv.empty, '无「暂无插件」空态');
      console.log(`  首个插件：${mv && mv.firstName}`);
      // v1.1.1：中文描述 —— 远程 plugin-desc-zh.json 未 push 时回退包内置，卡片应显示中文
      ok(
        !!mv && /[\u4e00-\u9fff]/.test(mv.firstDesc || ''),
        `插件卡片显示中文描述（内置回退生效，实际「${mv && mv.firstDesc}」）`,
      );
      // 缓存已落盘
      const cacheFile = path.join(userData, 'plugin-market-cache.json');
      ok(fs.existsSync(cacheFile), '插件市场缓存已落盘（userData/plugin-market-cache.json）');
    } finally {
      mktCdp.close();
    }
  } catch (err) {
    console.error('  ✗ 异常：' + err.message);
    failed++;
  } finally {
    cdp.close();
  }

  killSim();
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
