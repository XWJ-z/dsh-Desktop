'use strict';
/** Edge headless CDP 截图 + 像素采样验证宠物 SVG 渲染 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9336;
const URL = 'file:///D:/00xm/x-app/dsh-Desktop/windows/app/tests/preview-pet.html';
const OUT = 'D:\\00xm\\x-app\\dsh-Desktop\\windows\\app\\tests\\preview-pet-cdp.png';

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
    '--user-data-dir=C:\\Users\\xwj\\AppData\\Local\\Temp\\dsh-edge-layout4', URL,
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try { targets = await getJson(`http://127.0.0.1:${PORT}/json`); break; } catch { }
  }
  const page = targets.find((t) => t.type === 'page' && t.url.includes('preview-pet'));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws error')); }), 8000, 'ws open');

  let id = 0;
  const send = (method, params) => withTimeout(new Promise((resolve, reject) => {
    const mid = ++id;
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === mid) { ws.removeEventListener('message', handler); resolve(msg); }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  }), 8000, 'send ' + method);

  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(1000);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('saved ' + OUT);
  ws.close();
  edge.kill();
  process.exit(0);
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
