'use strict';
// v0.8.23 CDP 仿真验证：
//  T1: 页面内自愈 —— ①SPA 清除宠物节点 → 页面内 MutationObserver 即时重建
//      （<3s，不等主进程 watchdog）②残留不可见节点（display:none/移出视口）→ 重建
//  T2: 弹窗外观统一 —— progress.html 深色主题（静态复验）
// 用法: node cdp-v0823-test.js <remotePort> <webBase>
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

async function petVisible(ws) {
  const r = await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    if (!p) return false;
    const b = p.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && b.right > 0 && b.bottom > 0 &&
      b.left < window.innerWidth && b.top < window.innerHeight;
  })()`);
  return !!(r && r.result && r.result.value);
}

(async () => {
  let ok = true;
  const log = (n, pass, extra) => { console.log((pass ? 'PASS' : 'FAIL'), n, extra || ''); if (!pass) ok = false; };

  await sleep(12000);
  const targets = await getTargets();
  const main = targets.find((t) => t.url.startsWith(WEB));
  if (!main) { console.log('FAIL no main target'); process.exit(1); }
  const ws = main.webSocketDebuggerUrl;

  log('启动后宠物存在', await petVisible(ws));

  // T1①: 模拟 SPA 清除节点 → 页面内自愈即时重建（等 2.5s，远小于主进程 3s watchdog）
  await evalIn(ws, `(() => { const p = document.getElementById('dsh-pet'); if (p) p.remove(); return true; })()`);
  await sleep(2500);
  log('T1① 节点被清除后 2.5s 内自愈重建', await petVisible(ws));

  // T1②a: display:none 隐藏 → 残留不可见节点 → 重建
  await evalIn(ws, `(() => { const p = document.getElementById('dsh-pet'); if (p) p.style.display = 'none'; return true; })()`);
  await sleep(2500);
  log('T1②a display:none 后 2.5s 内重建', await petVisible(ws));

  // T1②b: 移出视口 → 重建
  await evalIn(ws, `(() => { const p = document.getElementById('dsh-pet'); if (p) { p.style.left = '-999px'; p.style.top = '-999px'; } return true; })()`);
  await sleep(2500);
  log('T1②b 移出视口后 2.5s 内重建', await petVisible(ws));

  // T1 回归: 恢复默认布局仍可用（reset 清 self-heal 状态 + 重新注入）
  // （此处不触发菜单，跳过；静态已查 reset 清 __dshPetSelfHeal）

  // T2: 弹窗外观统一静态复验
  const fs = require('fs');
  const path = require('path');
  const prog = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'progress.html'), 'utf8');
  log('T2 progress.html 深色主题（shared.css + token）', prog.includes('shared.css') && prog.includes('var(--brand)'));
  const misc = fs.readFileSync(path.join(__dirname, '..', 'modules', 'windows', 'misc-windows.js'), 'utf8');
  log('T2 备份进度窗口背景统一 #0f1115', misc.includes("backgroundColor: '#0f1115'"));

  console.log(ok ? 'ALL PASS' : 'HAS FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
