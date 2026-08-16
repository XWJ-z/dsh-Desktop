'use strict';
// v0.8.25 CDP 仿真验证：宠物图标 V2 注入 + 表情 class/动画兼容 + 位置记忆不回归
// 用法: node cdp-v0825-test.js <remotePort> <webBase>
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

  await sleep(12000);
  const targets = await getTargets();
  const main = targets.find((t) => t.url.startsWith(WEB));
  if (!main) { console.log('FAIL no main target'); process.exit(1); }
  const ws = main.webSocketDebuggerUrl;

  // ── T1: 宠物注入且可见（64px） ──
  const rectR = await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    if (!p) return null;
    const b = p.getBoundingClientRect();
    const svg = p.querySelector('svg');
    return { left: Math.round(b.left), top: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height),
      visible: b.width > 0 && b.height > 0 && b.right > 0 && b.bottom > 0 && b.left < window.innerWidth && b.top < window.innerHeight,
      hasSvg: !!svg, mode: p.dataset.mode };
  })()`);
  const rect = rectR && rectR.result ? rectR.result.value : null;
  log('T1 宠物注入且可见', !!(rect && rect.visible && rect.hasSvg), rect ? JSON.stringify(rect) : 'none');
  log('T1 宠物 64x64', !!(rect && rect.w === 64 && rect.h === 64), rect ? 'w=' + rect.w + ' h=' + rect.h : '');

  // ── T2: SVG V2 特征（新身体/尾巴/肚皮渐变/大眼） ──
  const svgR = await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    if (!p) return null;
    const svg = p.querySelector('svg');
    const html = svg.outerHTML;
    return {
      v2body: html.includes('M60 14 C 90 14 104 34 104 60'),
      v2tail: html.includes('M98 78 C 106 72 112 68 118 68'),
      bellyGrad: html.includes('id="dsh-whale-belly"'),
      grad: html.includes('id="dsh-whale-grad"'),
      bigEye: html.includes('rx="10" ry="11.5"'),
      blush: html.includes('fill="#ff9db8" opacity="0.95"'),
      spout: html.includes('fill="#9db8ff"'),
    };
  })()`);
  const svg = svgR && svgR.result ? svgR.result.value : null;
  log('T2 SVG 为 V2 新身体', !!(svg && svg.v2body));
  log('T2 分叉尾鳍 V2', !!(svg && svg.v2tail));
  log('T2 肚皮渐变+品牌渐变 id', !!(svg && svg.bellyGrad && svg.grad));
  log('T2 大眼/腮红/水珠元素', !!(svg && svg.bigEye && svg.blush && svg.spout));

  // ── T3: 表情 class 保留（injectPet 动画依赖） ──
  const clsR = await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    if (!p) return null;
    return {
      tail: !!p.querySelector('.tail'),
      eyeL: !!p.querySelector('.eye.eye-l'),
      eyeR: !!p.querySelector('.eye.eye-r'),
      mouth: !!p.querySelector('.mouth'),
    };
  })()`);
  const cls = clsR && clsR.result ? clsR.result.value : null;
  log('T3 表情 class 全部保留', !!(cls && cls.tail && cls.eyeL && cls.eyeR && cls.mouth),
    cls ? JSON.stringify(cls) : 'none');

  // ── T4: hover 表情动画生效（眼睛上移 + 尾巴翘起，注入脚本 transform 应用到 SVG 元素） ──
  await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    p.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  const hoverR = await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    const eye = p.querySelector('.eye-l');
    const tail = p.querySelector('.tail');
    return { eyeT: eye ? eye.style.transform : null, tailT: tail ? tail.style.transform : null, hoverCls: p.classList.contains('hover') };
  })()`);
  const hover = hoverR && hoverR.result ? hoverR.result.value : null;
  log('T4 hover 表情 class 生效', !!(hover && hover.hoverCls));
  log('T4 眼睛上移+尾巴翘起 transform', !!(hover && hover.eyeT && hover.eyeT.includes('translateY(-3px)') && hover.tailT && hover.tailT.includes('rotate(-14deg)')),
    hover ? 'eye=' + hover.eyeT + ' tail=' + hover.tailT : '');

  // ── T5: happy 表情（单击 → 弯眼笑 scaleY(.4)） ──
  await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    p.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    p.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  const happyR = await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    const eye = p.querySelector('.eye-l');
    return { eyeT: eye ? eye.style.transform : null, happyCls: p.classList.contains('happy') };
  })()`);
  const happy = happyR && happyR.result ? happyR.result.value : null;
  log('T5 happy 表情生效（眼睛弯成 scaleY）', !!(happy && happy.happyCls && happy.eyeT && happy.eyeT.includes('scaleY')),
    happy ? 'eye=' + happy.eyeT : '');

  // ── T6: 位置记忆不回归（保存位置 → 页面重载模拟"关闭重开" → 出现在原位） ──
  await evalIn(ws, `(() => {
    if (window.dshDesktop && window.dshDesktop.saveWebOpenBtnPos) {
      window.dshDesktop.saveWebOpenBtnPos({ x: 320, y: 260 });
    }
    location.reload();
    return true;
  })()`);
  await sleep(9000);
  const rect2R = await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    if (!p) return null;
    const b = p.getBoundingClientRect();
    return { left: Math.round(b.left), top: Math.round(b.top), visible: b.width > 0 && b.height > 0 };
  })()`);
  const rect2 = rect2R && rect2R.result ? rect2R.result.value : null;
  log('T6 重建后宠物可见', !!(rect2 && rect2.visible), rect2 ? JSON.stringify(rect2) : 'none');
  log('T6 出现在保存位置(320,260)', !!(rect2 && rect2.left === 320 && rect2.top === 260),
    rect2 ? 'left=' + rect2.left + ' top=' + rect2.top : '');

  // ── T7: 工具箱形态不回归（菜单「隐藏宠物」→ switchMode 前端切换为 toolbox.svg） ──
  await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    const it = p ? p.querySelector('.pet-item[data-action="hide"]') : null;
    if (it) it.click();
    return !!it;
  })()`);
  await sleep(1500);
  const tbR = await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    if (!p) return null;
    const svg = p.querySelector('svg');
    return { mode: p.dataset.mode, hasToolboxGrad: svg ? svg.outerHTML.includes('id="tb-g"') : false,
      noEyes: !p.querySelector('.eye') };
  })()`);
  const tb = tbR && tbR.result ? tbR.result.value : null;
  log('T7 工具箱形态切换（tb-g 渐变）', !!(tb && tb.mode === 'toolbox' && tb.hasToolboxGrad && tb.noEyes),
    tb ? JSON.stringify(tb) : 'none');

  console.log(ok ? 'ALL PASS' : 'HAS FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
