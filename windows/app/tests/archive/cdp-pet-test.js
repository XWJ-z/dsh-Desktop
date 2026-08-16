'use strict';
// v0.8.19 CDP 验证：
// ①宠物/工具箱自动出现（延迟重试注入）+ 位置
// ②外观同步到 DSH 页面（背景色变化）
const http = require('http');
const PORT = 9230;
const WEB = 'http://127.0.0.1:3187';

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/json`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function evalIn(wsUrl, expression) {
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

(async () => {
  const targets = await getTargets();
  const main = targets.find((t) => t.url.startsWith(WEB));
  if (!main) { console.log('NO MAIN'); process.exit(1); }

  // ① 宠物状态与位置
  const pet = await evalIn(main.webSocketDebuggerUrl, `
    (() => {
      const p = document.getElementById('dsh-pet');
      if (!p) return { petExists: false };
      const r = p.getBoundingClientRect();
      return {
        petExists: true,
        mode: p.dataset.mode,
        centerX: Math.round(r.left + r.width / 2),
        winCenterX: Math.round(window.innerWidth / 2),
        bottomGap: Math.round(window.innerHeight - r.bottom),
      };
    })()
  `);
  const v = pet.result.value;
  console.log('① pet:', JSON.stringify(v),
    '→ exists:', v.petExists,
    '| bottom-centered:', v.petExists && Math.abs(v.centerX - v.winCenterX) <= 3 && v.bottomGap >= 20 && v.bottomGap <= 30 ? 'PASS' : 'FAIL');

  // ② 外观同步：模拟壳调用（点 DSH 设置→浅色），验证背景变化
  const bg1 = await evalIn(main.webSocketDebuggerUrl, `(() => getComputedStyle(document.body).backgroundColor)()`);
  console.log('② bg before:', bg1.result.value);
  await evalIn(main.webSocketDebuggerUrl, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === '浅色');
      if (!btn) return { ok: false };
      btn.click();
      return { ok: true };
    })()
  `);
  await sleep(1500);
  const bg2 = await evalIn(main.webSocketDebuggerUrl, `(() => getComputedStyle(document.body).backgroundColor)()`);
  console.log('   bg after click 浅色:', bg2.result.value,
    '→ changed:', bg1.result.value !== bg2.result.value ? 'PASS' : 'FAIL');

  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
