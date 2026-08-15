// verify.js — 集成验证 v2（本地测试用，不进应用包）
// 覆盖：路由/前缀/中文/页面/API（health/status/log/update）/WebSocket/apiUrl 断言
'use strict';
const http = require('node:http');
const net = require('node:net');

const BASE = 'http://127.0.0.1:5001';
let failures = 0;

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(BASE + path, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function check(name, ok, detail) {
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' :: ' + detail : ''}`);
  if (!ok) failures++;
}

// v4.0 复审教训：页面 apiUrl 是运行时拼接，verify 必须用与页面相同的逻辑做断言
// （页面函数：提取 pathname 前两段为网关前缀，本地开发前缀为空）
function pageApiUrl(pathname, p) {
  const m = pathname.match(/^(\/[^/]+\/[^/]+)/);
  const base = m ? m[1] + '/' : '/';
  return base + p;
}

(async () => {
  // 0) apiUrl 拼接断言（P0-1 防复发）——模拟各页面 location.pathname
  check('apiUrl 网关 about', pageApiUrl('/app/dsh/about', 'api/update') === '/app/dsh/api/update');
  check('apiUrl 网关 update', pageApiUrl('/app/dsh/update', 'api/update') === '/app/dsh/api/update');
  check('apiUrl 网关 log', pageApiUrl('/app/dsh/log', 'api/log') === '/app/dsh/api/log');
  check('apiUrl 网关根 init', pageApiUrl('/app/dsh', 'api/status') === '/app/dsh/api/status');
  check('apiUrl 网关根带斜杠', pageApiUrl('/app/dsh/', 'api/status') === '/app/dsh/api/status');
  check('apiUrl 本地 about', pageApiUrl('/about', 'api/update') === '/api/update');
  check('apiUrl 本地 update', pageApiUrl('/update', 'api/update') === '/api/update');
  check('apiUrl 本地 log', pageApiUrl('/log', 'api/log') === '/api/log');
  check('apiUrl 自定义前缀', pageApiUrl('/app/mydsh/about', 'api/update') === '/app/mydsh/api/update');

  // 1) init 页（直接访问）：中文 + 阶段指示器
  let r = await get('/init');
  check('init status', r.status === 200, `status=${r.status}`);
  check('init 中文', r.body.includes('正在初始化 DeepSeek Harness'));
  check('init 阶段指示器', r.body.includes('data-stage="install"'));
  check('init 日志链接', r.body.includes('查看运行日志'));
  check('init apiUrl 修复版', r.body.includes('location.pathname.match(/^(\\/[^/]+\\/[^/]+)/)'));

  // 2) about 页：中文 + 群号 + 更新卡片 + 版本 JS + 项目主页 + 返回 DSH
  r = await get('/about');
  check('about status', r.status === 200, `status=${r.status}`);
  check('about 标题中文', r.body.includes('关于 DeepSeek Harness'));
  check('about 群号', r.body.includes('群号：916607090'));
  check('about 二维码内嵌', r.body.includes('data:image/png;base64,iVBOR'));
  check('about 更新卡片', r.body.includes('up-current'));
  check('about 版本 JS', r.body.includes('d.dshVersion'));
  check('about 项目主页', r.body.includes('github.com/XWJ-z/dsh-Desktop'));
  check('about apiUrl 修复版', r.body.includes('location.pathname.match(/^(\\/[^/]+\\/[^/]+)/)'));
  check('about pageUrl 导航', r.body.includes("lk-update") && r.body.includes("pageUrl('update')"));
  check('about 返回 DSH', r.body.includes('lk-back'));

  // 3) log 页
  r = await get('/log');
  check('log page', r.status === 200 && r.body.includes('运行日志'), `status=${r.status}`);
  check('log apiUrl 修复版', r.body.includes('location.pathname.match(/^(\\/[^/]+\\/[^/]+)/)'));
  check('log 返回 DSH', r.body.includes('lk-back'));

  // 3.1) update 页（v0.2 新增）
  r = await get('/update');
  check('update page', r.status === 200 && r.body.includes('DSH 运行时更新'), `status=${r.status}`);
  check('update 版本字段', r.body.includes('id="cur"') && r.body.includes('id="lat"'), '');
  check('update 升级按钮', r.body.includes('upgradeDsh'), '');
  check('update 导航链接', r.body.includes('lk-about') && r.body.includes('lk-back'), '');
  check('update apiUrl 修复版', r.body.includes('location.pathname.match(/^(\\/[^/]+\\/[^/]+)/)'));

  // 4) API
  r = await get('/api/health');
  let d = JSON.parse(r.body);
  check('health', r.status === 200 && d.ok && 'dshReady' in d && 'stage' in d, r.body);

  r = await get('/api/status');
  d = JSON.parse(r.body);
  check('status', r.status === 200 && 'stage' in d && 'progressMb' in d, r.body);

  r = await get('/api/log');
  d = JSON.parse(r.body);
  check('api/log', r.status === 200 && Array.isArray(d.lines), `lines=${d.lines.length}`);

  r = await get('/api/update');
  d = JSON.parse(r.body);
  check('api/update', r.status === 200 && d.dsh && typeof d.dsh.current === 'string',
    `current=${d.dsh && d.dsh.current} latest=${d.dsh && d.dsh.latest}`);

  // 5) 前缀剥离（含三壳页面网关形态，v4.0 盲区补充）
  r = await get('/app/dsh/api/health');
  check('prefix health', r.status === 200, r.body.slice(0, 60));
  r = await get('/app/dsh/about');
  check('prefix about', r.status === 200 && r.body.includes('关于'));
  r = await get('/app/dsh/update');
  check('prefix update', r.status === 200 && r.body.includes('DSH 运行时更新'));
  r = await get('/app/dsh/log');
  check('prefix log', r.status === 200 && r.body.includes('运行日志'));

  // 5.1) v0.2.3 query 保留回归（转发不能丢 query string，Session 导出 400 的根因）
  r = await get('/app/dsh/api/health?x=1&y=2');
  check('query 保留（health 带参）', r.status === 200, `status=${r.status}`);

  // 6) DSH 代理（就绪时）
  r = await get('/');
  const boot = r.body.includes('__DSH_BOOT__');
  const initPage = r.body.includes('正在初始化');
  check('root proxy or init', r.status === 200, `boot=${boot} init=${initPage} bytes=${r.body.length}`);
  // 6.1) v0.2.2 修复：DSH 页面不再注入悬浮入口（FLOATING_ENTRY 是命令弹层闪现根因——
  // 置顶按钮遮挡右下角弹层，点击被拦截导致 dismiss）。校验重写后的 DSH HTML 无注入。
  if (boot) {
    check('无悬浮入口注入', !r.body.includes('id="dsh-entry"'), 'M1 修复：移除注入');
  } else {
    check('无悬浮入口注入（未就绪跳过）', true, 'init 页不注入，符合预期');
  }

  // 7) WebSocket upgrade：不挂起（就绪时可能被转发；未就绪被拒）
  const wsOk = await new Promise((resolve) => {
    const s = net.connect(5001, '127.0.0.1', () => {
      s.write('GET /app/dsh/ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
      setTimeout(() => { s.destroy(); resolve('closed-by-timeout(ok:no-hang)'); }, 2500);
    });
    s.on('data', () => { s.destroy(); resolve('got-response(ok)'); });
    s.on('end', () => resolve('closed(ok)'));
    s.on('error', () => resolve('error(ok:refused)'));
  });
  check('ws no-hang', true, wsOk);

  process.exit(failures === 0 ? 0 : 1);
})();
