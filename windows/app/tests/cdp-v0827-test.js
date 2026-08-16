'use strict';
// v0.8.27 CDP 仿真验证：宠物图标基于 Twemoji 专业设计 + 品牌蓝着色 + 表情兼容
// 用法: node cdp-v0827-test.js <remotePort> <webBase>
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

  // 恢复宠物形态（上一次运行 T7 可能残留 petHidden=true → 重新注入为宠物）
  await evalIn(ws, `(() => {
    if (window.dshDesktop && window.dshDesktop.setPetHidden) window.dshDesktop.setPetHidden(false);
    location.reload();
    return true;
  })()`);
  await sleep(9000);

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

  // ── T2: SVG DeepSeek logo 鲸鱼特征（老大手绘 + 表情 class） ──
  const svgR = await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    if (!p) return null;
    const svg = p.querySelector('svg');
    const html = svg.outerHTML;
    return {
      dsBody: html.includes('M989.5616455,63.0478363'),
      bodyG: html.includes('id="bodyG"'),
      eyeR: html.includes('class="eye eye-r"'),
      mouth: html.includes('class="mouth"'),
      viewBox: html.includes('viewBox="0 0 680 680"'),
      noTwemoji: !html.includes('M36 7.001c'),
    };
  })()`);
  const svg = svgR && svgR.result ? svgR.result.value : null;
  log('T2 DeepSeek logo 鲸鱼 body path', !!(svg && svg.dsBody));
  log('T2 bodyG 渐变 + viewBox 680', !!(svg && svg.bodyG && svg.viewBox));
  log('T2 表情 class(eye-r + mouth)', !!(svg && svg.eyeR && svg.mouth));
  log('T2 无旧版 Twemoji body path', !!(svg && svg.noTwemoji));

  // ── T3: 表情 class 保留（DeepSeek logo 无独立 .tail——尾巴连体，eye.r + mouth 保留） ──
  const clsR = await evalIn(ws, `(() => {
    const p = document.getElementById('dsh-pet');
    if (!p) return null;
    return {
      eyeR: !!p.querySelector('.eye.eye-r'),
      mouth: !!p.querySelector('.mouth'),
    };
  })()`);
  const cls = clsR && clsR.result ? clsR.result.value : null;
  log('T3 表情 class 保留(单眼+嘴)', !!(cls && cls.eyeR && cls.mouth),
    cls ? JSON.stringify(cls) : 'none');

  // ── T4: hover 表情动画生效（眼睛上移 + 尾巴翘起，注入脚本 transform 应用到 SVG 元素） ──
  // ── T4: hover 表情动画生效（idle wink 8s 定时器可能打断 hover → 轮询重试） ──
  let hover = null;
  for (let i = 0; i < 6; i++) {
    await evalIn(ws, `(() => {
      const p = document.getElementById('dsh-pet');
      p.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      return true;
    })()`);
    await sleep(700);
    const hoverR = await evalIn(ws, `(() => {
      const p = document.getElementById('dsh-pet');
      const eye = p.querySelector('.eye-r');
      const tail = p.querySelector('.tail');
      return { eyeT: eye ? eye.style.transform : null, tailT: tail ? tail.style.transform : null, hoverCls: p.classList.contains('hover') };
    })()`);
    hover = hoverR && hoverR.result ? hoverR.result.value : null;
    if (hover && hover.hoverCls) break;
  }
  log('T4 hover 表情 class 生效', !!(hover && hover.hoverCls));
  log('T4 hover 眼睛有 transform', !!(hover && hover.eyeT && hover.eyeT.length > 0),
    hover ? 'eye=' + hover.eyeT + ' tail=' + hover.tailT : '');

  // ── T5: happy 表情（单击 → 弯眼笑 scaleY；同样轮询容错） ──
  let happy = null;
  for (let i = 0; i < 6; i++) {
    await evalIn(ws, `(() => {
      const p = document.getElementById('dsh-pet');
      p.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      p.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    })()`);
    await sleep(700);
    const happyR = await evalIn(ws, `(() => {
      const p = document.getElementById('dsh-pet');
      const eye = p.querySelector('.eye-r');
      return { eyeT: eye ? eye.style.transform : null, happyCls: p.classList.contains('happy') };
    })()`);
    happy = happyR && happyR.result ? happyR.result.value : null;
    if (happy && happy.happyCls) break;
  }
  log('T5 happy 表情 class 生效', !!(happy && happy.happyCls),
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
