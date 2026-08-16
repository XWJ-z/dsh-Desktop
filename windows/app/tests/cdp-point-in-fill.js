'use strict';
/** 用 isPointInFill 检测 body path 填充区域 + 检查绘制顺序 */
const { spawn } = require('child_process');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9337;
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
const withTimeout = (p, ms, tag) => Promise.race([p, sleep(ms).then(() => { throw new Error('timeout: ' + tag); })]);

async function main() {
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=C:\\Users\\xwj\\AppData\\Local\\Temp\\dsh-edge-layout5', URL,
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
    const paths = Array.from(document.querySelectorAll('svg path'));
    const body = paths[1]; // tail 是第一个，body 第二个
    const pts = [[41,33],[51,48],[41,60],[20,52],[60,70],[90,60],[110,56],[60,30],[70,40],[80,50],[95,55]];
    const out = { bodyD: (body.getAttribute('d') || '').slice(0, 80), results: [] };
    for (const [x, y] of pts) {
      const p = body.createSVGPoint ? { x, y } : null;
      let inFill = false;
      try { inFill = body.isPointInFill(new DOMPoint(x, y)); } catch (e) { inFill = 'ERR'; }
      out.results.push({ x, y, inFill });
    }
    // 绘制顺序（后画的在上层）
    out.order = Array.from(document.querySelectorAll('svg path,svg circle,svg g')).map((el, i) => (el.tagName) + (el.getAttribute('class') ? '.' + el.getAttribute('class') : ''));
    return JSON.stringify(out);
  })()`;
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(res.result.result.value);
  ws.close();
  edge.kill();
  process.exit(0);
}
main().catch((e) => { console.error('ERR', e); process.exit(1); });
