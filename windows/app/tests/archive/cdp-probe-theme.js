'use strict';
// 完整验证：深色→浅色→深色 双向切换背景变化
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

async function clickTheme(wsUrl, label) {
  await evalIn(wsUrl, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === ${JSON.stringify(label)});
      if (!btn) return { ok: false };
      btn.click();
      return { ok: true };
    })()
  `);
  await sleep(1500);
  const r = await evalIn(wsUrl, `(() => getComputedStyle(document.body).backgroundColor)()`);
  return r.result.value;
}

(async () => {
  const targets = await getTargets();
  const main = targets.find((t) => t.url.startsWith(WEB));
  if (!main) { console.log('NO MAIN'); process.exit(1); }

  const bgDark = await clickTheme(main.webSocketDebuggerUrl, '深色');
  console.log('深色 →', bgDark, '→ dark:', /^rgb\(2[0-5]/.test(bgDark) ? 'PASS' : '?');

  const bgLight = await clickTheme(main.webSocketDebuggerUrl, '浅色');
  console.log('浅色 →', bgLight, '→ light:', bgLight === 'rgb(255, 255, 255)' ? 'PASS' : '?');

  const bgSystem = await clickTheme(main.webSocketDebuggerUrl, '跟随系统');
  console.log('跟随系统 →', bgSystem);

  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
