'use strict';
// 临时验证：DSH 页面注入的 pet SVG body path 是否为完整版（老大 deepseek-pet.svg）
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
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) { clearTimeout(timer); resolve(msg.result); ws.close(); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error')); };
  });
}

(async () => {
  await new Promise((r) => setTimeout(r, 3000));
  const targets = await getTargets();
  const main = targets.find((t) => t.url.startsWith(WEB));
  if (!main) { console.log('FAIL no main target'); process.exit(1); }
  // 恢复宠物形态（避免上一次运行 T7 残留 petHidden=true → 注入的是工具箱）
  await evalIn(main.webSocketDebuggerUrl, `(() => {
    if (window.dshDesktop && window.dshDesktop.setPetHidden) window.dshDesktop.setPetHidden(false);
    location.reload();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 9000));
  const r = await evalIn(main.webSocketDebuggerUrl, `(() => {
    const p = document.getElementById('dsh-pet');
    const s = p ? p.querySelector('svg') : null;
    if (!s) return { ok: false, reason: 'no svg' };
    const m = s.outerHTML.match(/d="(M[^"]+)"/);
    const path = m ? m[1] : '';
    return {
      ok: true,
      pathLen: path.length,
      complete: path.endsWith('653.7452393,431.0113831z'),
      startsRight: path.startsWith('M989.5616455,63.0478363'),
      hasEye: s.outerHTML.includes('class="eye eye-r"'),
      hasMouth: s.outerHTML.includes('class="mouth"'),
    };
  })()`);
  const v = r && r.result && r.result.value;
  console.log('page svg:', JSON.stringify(v));
  const pass = v && v.ok && v.pathLen === 4668 && v.complete && v.startsRight && v.hasEye && v.hasMouth;
  console.log(pass ? 'ALL PASS' : 'HAS FAIL');
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
