'use strict';
// v0.8.21 CDP 仿真验证：
//  T1: 启动后不自动打开 DSH 设置面板（themeCube 不存在）
//  T2: DSH 面板点「深色/浅色」→ 壳 settings.json appearance 反向同步
//  T3: 菜单顺序静态已查（check-v0821.js），此处复验公告/帮助源码顺序
// 用法: node cdp-v0821-test.js <remotePort> <webBase> <userData>
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]);
const WEB = process.argv[3];
const USERDATA = process.argv[4];

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

function readAppearance() {
  const f = path.join(USERDATA, 'settings.json');
  if (!fs.existsSync(f)) return '<no-settings-file>';
  try { return JSON.parse(fs.readFileSync(f, 'utf8')).appearance; } catch (e) { return '<read-error:' + e.message + '>'; }
}

async function clickText(wsUrl, label) {
  const r = await evalIn(wsUrl, `
    (() => {
      const btn = Array.from(document.querySelectorAll('button,[role="button"]'))
        .find((b) => (b.textContent || '').trim() === ${JSON.stringify(label)});
      if (!btn) return { ok: false };
      btn.click();
      return { ok: true };
    })()
  `);
  return !!(r && r.result && r.result.value && r.result.value.ok);
}

(async () => {
  let ok = true;
  const log = (n, pass, extra) => { console.log((pass ? 'PASS' : 'FAIL'), n, extra || ''); if (!pass) ok = false; };

  // 等 12s（启动加载 + 宠物注入），此时面板绝不应自动打开
  await sleep(12000);
  const targets = await getTargets();
  const main = targets.find((t) => t.url.startsWith(WEB));
  if (!main) { console.log('FAIL no main target'); process.exit(1); }
  const ws = main.webSocketDebuggerUrl;

  // T1: themeCube 不存在 = DSH 设置面板未被自动打开
  const t1 = await evalIn(ws, `(() => document.querySelectorAll('[class*="themeCube"]').length)()`);
  log('T1 启动 12s 后面板未自动打开(themeCube=0)', t1 && t1.result && t1.result.value === 0, 'themeCube=' + (t1 && t1.result && t1.result.value));
  // T1 补充：宠物在（回归）
  const pet = await evalIn(ws, `(() => !!document.getElementById('dsh-pet'))()`);
  log('T1 宠物存在(回归)', !!(pet && pet.result && pet.result.value));
  const appr0 = readAppearance();
  log('T1 壳外观设置未被改动', appr0 === 'system' || appr0 === 'light' || appr0 === 'dark', 'appearance=' + appr0);

  // T2a: 打开 DSH 设置面板 → 点「深色」
  const opened = await clickText(ws, '设置');
  await sleep(800);
  const cubes = await evalIn(ws, `(() => document.querySelectorAll('[class*="themeCube"]').length)()`);
  log('T2 面板已打开(themeCube>0)', opened && cubes && cubes.result && cubes.result.value > 0, 'themeCube=' + (cubes && cubes.result && cubes.result.value));
  const clickedDark = await clickText(ws, '深色');
  await sleep(3500); // watch 轮询 2.5s
  const a1 = readAppearance();
  const bg1 = await evalIn(ws, `(() => getComputedStyle(document.body).backgroundColor)()`);
  log('T2 DSH 点深色→壳反向同步 dark', clickedDark && a1 === 'dark', 'appearance=' + a1 + ' bg=' + (bg1 && bg1.result && bg1.result.value));

  // T2b: 点「浅色」
  await clickText(ws, '浅色');
  await sleep(3500);
  const a2 = readAppearance();
  const bg2 = await evalIn(ws, `(() => getComputedStyle(document.body).backgroundColor)()`);
  log('T2 DSH 点浅色→壳反向同步 light', a2 === 'light', 'appearance=' + a2 + ' bg=' + (bg2 && bg2.result && bg2.result.value));

  // T2c: 恢复「跟随系统」
  await clickText(ws, '跟随系统');
  await sleep(3500);
  const a3 = readAppearance();
  log('T2 DSH 点跟随系统→壳反向同步 system', a3 === 'system', 'appearance=' + a3);

  // T3: 源码顺序复验（帮助在公告左边 = 公告在帮助右边）
  const menu = fs.readFileSync(path.join(__dirname, '..', 'modules', 'menu.js'), 'utf8');
  const hi = menu.indexOf("label: '帮助',");
  const ni = menu.indexOf('label: `公告');
  log('T3 公告菜单在帮助菜单右边', hi !== -1 && ni !== -1 && hi < ni, 'help@' + hi + ' notice@' + ni);

  console.log(ok ? 'ALL PASS' : 'HAS FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
