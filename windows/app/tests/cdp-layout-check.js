'use strict';
/** Edge headless CDP 布局检查（带日志） */
const { spawn } = require('child_process');
const http = require('http');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;
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
    '--user-data-dir=C:\\Users\\xwj\\AppData\\Local\\Temp\\dsh-edge-layout3', URL,
  ], { stdio: 'ignore' });
  console.log('edge spawned');

  let targets = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json`); console.log('json ok, targets=' + targets.length); break; } catch { }
  }
  if (!targets) { console.error('no CDP target'); edge.kill(); process.exit(1); }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('preview-pet'));
  if (!page) { console.error('page target not found: ' + JSON.stringify(targets.map((t) => t.type + ':' + t.url))); edge.kill(); process.exit(1); }
  console.log('ws url: ' + page.webSocketDebuggerUrl);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error: ' + (e.message || 'unknown'))); }), 8000, 'ws open');
  console.log('ws opened');

  let id = 0;
  const send = (method, params) => withTimeout(new Promise((resolve, reject) => {
    const mid = ++id;
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === mid) { ws.removeEventListener('message', handler); resolve(msg); }
      else if (msg.method === 'Runtime.exceptionThrown') { console.log('exc: ' + JSON.stringify(msg.params).slice(0, 300)); }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  }), 8000, 'send ' + method);

  await send('Runtime.enable');
  await sleep(800);
  console.log('evaluating...');
  const expr = `(() => {
    const svg = document.querySelector('svg');
    const out = { viewport: { w: window.innerWidth, h: window.innerHeight } };
    if (svg) {
      const r = svg.getBoundingClientRect();
      out.svg = { x: r.x, y: r.y, w: r.width, h: r.height };
      out.elems = Array.from(svg.querySelectorAll('path,circle,ellipse')).map((el) => {
        const b = el.getBoundingClientRect();
        return { tag: el.tagName, cls: el.getAttribute('class') || '', x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      });
    } else out.svg = null;
    return JSON.stringify(out);
  })()`;
  const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log('RESULT:');
  console.log(res.result && res.result.result ? res.result.result.value : JSON.stringify(res).slice(0, 500));
  ws.close();
  edge.kill();
  process.exit(0);
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
