'use strict';
/** CDP 诊断：elementFromPoint 检查鲸鱼 SVG 各元素 z-order 和 rect */
const { spawn } = require('child_process');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9338;
const URL = 'file:///D:/00xm/x-app/dsh-Desktop/windows/app/tests/preview-pet.html';

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, tag) => Promise.race([p, sleep(ms).then(() => { throw new Error('timeout ' + tag); })]);

async function main() {
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=C:\\Users\\xwj\\AppData\\Local\\Temp\\dsh-edge-layout6', URL,
  ], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json`); break; } catch { }
  }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('preview-pet'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); }), 8000, 'ws');
  let id = 0;
  const send = (method, params) => withTimeout(new Promise((resolve, reject) => {
    const mid = ++id;
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === mid) { ws.removeEventListener('message', handler); resolve(msg); }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  }), 8000, 'send');
  await send('Runtime.enable');
  await sleep(800);

  const expr = `(() => {
    const svg = document.querySelector('svg');
    const out = { svgRect: (() => { const r = svg.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(), elems: [], hit: [] };
    svg.querySelectorAll('path,ellipse,circle,g').forEach((el, i) => {
      const b = el.getBoundingClientRect();
      out.elems.push({ i, tag: el.tagName, cls: el.getAttribute('class') || '', x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) });
    });
    // 关键点 elementFromPoint（屏坐标）
    const pts = { 'eye(611,446)': [474, 281], 'body(340,340)': [378, 244], 'cheek(557,496)': [455, 299], 'mouth(600,482)': [470, 294] };
    for (const [k, [x, y]] of Object.entries(pts)) {
      const el = document.elementFromPoint(x, y);
      out.hit.push({ pt: k, tag: el ? el.tagName : null, cls: el ? el.getAttribute('class') || '' : null, fill: el ? el.getAttribute('fill') || '' : '' });
    }
    return JSON.stringify(out);
  })()`;
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(res.result.result.value);
  ws.close();
  edge.kill();
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
