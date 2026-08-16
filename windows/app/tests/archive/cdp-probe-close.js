'use strict';
// 探测 DSH 设置面板的关闭方式：ESC / 遮罩点击 / 关闭按钮 / toggle
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

(async () => {
  const targets = await getTargets();
  const main = targets.find((t) => t.url.startsWith(WEB));
  if (!main) { console.log('NO MAIN'); process.exit(1); }
  const ws = main.webSocketDebuggerUrl;

  // 1. 打开设置面板
  await evalIn(ws, `(() => {
    const b = Array.from(document.querySelectorAll('button,[role="button"]'))
      .find((x) => (x.textContent || '').trim() === '设置');
    if (b) b.click();
    return true;
  })()`);
  await sleep(800);
  let r = await evalIn(ws, `(() => {
    const cube = document.querySelectorAll('[class*="themeCube"]');
    // 找面板容器：themeCube 的祖先
    let el = cube[0];
    const chain = [];
    while (el && chain.length < 6) { el = el.parentElement; if (el) chain.push(el.tagName + '.' + (el.className || '').toString().slice(0, 60)); }
    return { cubeCount: cube.length, ancestors: chain };
  })()`);
  console.log('打开后面板:', JSON.stringify(r && r.result && r.result.value));

  // 2. 探测 ESC
  await evalIn(ws, `(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
  await sleep(600);
  r = await evalIn(ws, `(() => document.querySelectorAll('[class*="themeCube"]').length)()`);
  console.log('ESC 后 themeCube:', r && r.result && r.result.value);

  // 3. 重新打开（若被关）再探测面板结构里的关闭按钮/遮罩
  if ((r && r.result && r.result.value) === 0) {
    await evalIn(ws, `(() => {
      const b = Array.from(document.querySelectorAll('button,[role="button"]'))
        .find((x) => (x.textContent || '').trim() === '设置');
      if (b) b.click();
      return true;
    })()`);
    await sleep(800);
  }
  r = await evalIn(ws, `(() => {
    // 面板内所有按钮文本 + 面板附近可点击元素
    const cube = document.querySelectorAll('[class*="themeCube"]');
    if (!cube.length) return { open: false };
    let el = cube[0];
    for (let i = 0; i < 5 && el; i++) el = el.parentElement;
    const btns = el ? Array.from(el.querySelectorAll('button')).map((b) => (b.textContent || '').trim().slice(0, 20)) : [];
    const rects = cube[0].getBoundingClientRect();
    return { open: true, panelBtns: btns.slice(0, 30), cubeRect: { x: rects.x, y: rects.y } };
  })()`);
  console.log('面板结构:', JSON.stringify(r && r.result && r.result.value));

  // 4. 遮罩点击测试（点页面右上角空白）
  await evalIn(ws, `(() => {
    const el = document.elementFromPoint(5, 5);
    if (el) { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); el.click && el.click(); }
    return true;
  })()`);
  await sleep(600);
  r = await evalIn(ws, `(() => document.querySelectorAll('[class*="themeCube"]').length)()`);
  console.log('点空白后 themeCube:', r && r.result && r.result.value);

  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
