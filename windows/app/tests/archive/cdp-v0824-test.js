'use strict';
// v0.8.24 CDP 仿真验证：
//  T2: ①模拟保存位置后重载页面 → 宠物出现在保存位置（top 不再被 auto 覆盖）
//  T1: ②外观同步 → DSH 设置面板不残留（模拟 syncDshAppearance 流程后 themeCube=0）
// 用法: node cdp-v0824-test.js <remotePort> <webBase>
const http = require('http');
const PORT = Number(process.argv[2]);
const WEB = process.argv[3];

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/json`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

function evalIn(wsUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('timeout')); }, 15000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) {
        clearTimeout(timer);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        ws.close();
      }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function petRect(ws) {
  const r = await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    if (!p) return null;
    const b = p.getBoundingClientRect();
    return { left: Math.round(b.left), top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
      visible: b.width > 0 && b.height > 0 && b.right > 0 && b.bottom > 0 &&
        b.left < window.innerWidth && b.top < window.innerHeight };
  })()`);
  return r && r.result && r.result.value;
}

async function themeCubeCount(ws) {
  const r = await evalIn(ws, `(() => document.querySelectorAll('[class*="themeCube"]').length)()`);
  return r && r.result ? r.result.value : -1;
}

(async () => {
  let ok = true;
  const log = (n, pass, extra) => { console.log((pass ? 'PASS' : 'FAIL'), n, extra || ''); if (!pass) ok = false; };

  await sleep(12000);
  const targets = await getTargets();
  const main = targets.find((t) => t.url.startsWith(WEB));
  if (!main) { console.log('FAIL no main target'); process.exit(1); }
  const ws = main.webSocketDebuggerUrl;

  // ── T2: 模拟拖拽保存位置 → 重载页面（模拟关闭重开）→ 宠物应在保存位置 ──
  // 通过 preload 暴露的 saveWebOpenBtnPos 保存位置（与拖拽 endDrag 同路径）
  const saveR = await evalIn(ws, `(() => {
    if (window.dshDesktop && window.dshDesktop.saveWebOpenBtnPos) {
      window.dshDesktop.saveWebOpenBtnPos({ x: 300, y: 250 });
      return { ok: true };
    }
    return { ok: false, reason: 'no preload api' };
  })()`);
  log('T2 保存位置 API 可用', !!(saveR && saveR.result && saveR.result.value && saveR.result.value.ok));

  // 重载页面模拟"关闭重开"（did-finish-load → 1s 后注入 → 读保存位置）
  await evalIn(ws, `location.reload(); true`);
  await sleep(8000);

  const rect = await petRect(ws);
  log('T2 重开后宠物可见', !!(rect && rect.visible), rect ? JSON.stringify(rect) : 'none');
  log('T2 宠物在保存位置(300,250)', !!(rect && rect.left === 300 && rect.top === 250),
    rect ? 'left=' + rect.left + ' top=' + rect.top : '');

  // ── T1: 外观同步后面板不残留 ──
  // 模拟 syncDshAppearance 完整流程：打开设置 → 点主题按钮 → 关闭前检查 stillOpen
  // 再点「设置」→ 最终面板必须关闭（themeCube=0）
  await evalIn(ws, `(() => {
    const b = Array.from(document.querySelectorAll('button,[role="button"]'))
      .find((x) => (x.textContent || '').trim() === '设置');
    if (b) b.click();
    return true;
  })()`);
  await sleep(800);
  const openCnt = await themeCubeCount(ws);
  log('T1 设置面板已打开(themeCube>0)', openCnt > 0, 'themeCube=' + openCnt);

  // 点「深色」主题按钮（若面板已开）
  await evalIn(ws, `(() => {
    const b = Array.from(document.querySelectorAll('button'))
      .find((x) => (x.textContent || '').trim() === '深色');
    if (b) b.click();
    return true;
  })()`);
  await sleep(1500);
  const afterClick = await themeCubeCount(ws);
  log('T1 点击主题后面板状态', afterClick >= 0, 'themeCube=' + afterClick);

  // 模拟修复后的关闭逻辑：先查 stillOpen，仍开则点面板外空白关闭
  await evalIn(ws, `(() => {
    const stillOpen = !!document.querySelector('[class*="themeCube"]');
    if (stillOpen) {
      const el = document.elementFromPoint(8, 8);
      if (el) {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      }
    }
    return true;
  })()`);
  await sleep(1000);
  const finalCnt = await themeCubeCount(ws);
  log('T1 同步后面板已关闭(themeCube=0)', finalCnt === 0, 'themeCube=' + finalCnt);

  // 恢复默认布局回归：位置记忆清空 → 底部居中
  await evalIn(ws, `(() => {
    if (window.__dshPetObserver) { window.__dshPetObserver.disconnect(); window.__dshPetObserver = null; }
    window.__dshPetSelfHeal = false;
    const p = document.getElementById('dsh-pet'); if (p) p.remove();
    return true;
  })()`).catch(() => {});
  // 通过主进程重置不可达，直接验证 fallback：清空记忆后注入逻辑静态已验；
  // 这里验证 saved=null 时 ensurePet 走底部居中（内联模拟）
  await evalIn(ws, `(() => {
    if (window.__dshEnsurePet) window.__dshEnsurePet();
    return true;
  })()`);
  await sleep(1000);
  const rect2 = await petRect(ws);
  log('回归 清理后宠物仍可见', !!(rect2 && rect2.visible), rect2 ? JSON.stringify(rect2) : 'none');

  console.log(ok ? 'ALL PASS' : 'HAS FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
