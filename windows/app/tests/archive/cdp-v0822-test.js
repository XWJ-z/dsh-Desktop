'use strict';
// v0.8.22 CDP 仿真验证：
//  T1: 宠物注入后被页面清除 → watchdog 自动重新注入（持续守护，替代 v0.8.19 的 6 次重试）
//  T2: 回归 —— 启动不自动打开 DSH 设置面板 + 宠物正常出现
// 用法: node cdp-v0822-test.js <remotePort> <webBase>
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
  let ok = true;
  const log = (n, pass, extra) => { console.log((pass ? 'PASS' : 'FAIL'), n, extra || ''); if (!pass) ok = false; };

  // 等 12s（启动加载 + 宠物首轮注入）
  await sleep(12000);
  const targets = await getTargets();
  const main = targets.find((t) => t.url.startsWith(WEB));
  if (!main) { console.log('FAIL no main target'); process.exit(1); }
  const ws = main.webSocketDebuggerUrl;

  // T2 回归: 面板未自动打开 + 宠物出现
  const t1 = await evalIn(ws, `(() => document.querySelectorAll('[class*="themeCube"]').length)()`);
  log('回归 启动后 DSH 面板未自动打开(themeCube=0)', t1 && t1.result && t1.result.value === 0, 'themeCube=' + (t1 && t1.result && t1.result.value));
  const pet0 = await evalIn(ws, `(() => !!document.getElementById('dsh-pet'))()`);
  log('回归 宠物已注入', !!(pet0 && pet0.result && pet0.result.value));

  // T1: 模拟 SPA 清除宠物（老大实机场景：注入成功后被重渲染清掉）
  await evalIn(ws, `(() => { const p = document.getElementById('dsh-pet'); if (p) p.remove(); return true; })()`);
  const gone = await evalIn(ws, `(() => !document.getElementById('dsh-pet'))()`);
  log('T1 模拟清除后宠物不存在', !!(gone && gone.result && gone.result.value));

  // 等 watchdog（3s 周期）→ 宠物应自动重新注入
  await sleep(4000);
  const pet1 = await evalIn(ws, `(() => !!document.getElementById('dsh-pet'))()`);
  log('T1 watchdog 4s 内自动重注入', !!(pet1 && pet1.result && pet1.result.value));

  // 再清一次：确认持续守护（不是一次性）
  await evalIn(ws, `(() => { const p = document.getElementById('dsh-pet'); if (p) p.remove(); return true; })()`);
  await sleep(4000);
  const pet2 = await evalIn(ws, `(() => !!document.getElementById('dsh-pet'))()`);
  log('T1 再次清除后仍自动重注入(持续守护)', !!(pet2 && pet2.result && pet2.result.value));

  // T2: 设置菜单分组静态复验（仅统计设置菜单块内分隔符：设置 → 帮助 之间）
  const fs = require('fs');
  const path = require('path');
  const menu = fs.readFileSync(path.join(__dirname, '..', 'modules', 'menu.js'), 'utf8');
  const setStart = menu.indexOf("label: '设置',");
  const setEnd = menu.indexOf("label: '帮助',");
  const setBlock = setStart !== -1 && setEnd !== -1 ? menu.slice(setStart, setEnd) : '';
  log('T2 外观…动态显示当前值', menu.includes("'（浅色）'") && menu.includes("'（深色）'") && menu.includes("'（跟随系统）'"));
  const seps = (setBlock.match(/\{ type: 'separator' \}/g) || []).length;
  log('T2 设置菜单分隔符为 2（分组协调）', seps === 2, 'separators=' + seps);

  console.log(ok ? 'ALL PASS' : 'HAS FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
