'use strict';

/**
 * updater-fetchjson-net-test.js — v1.1.3 修复验证：updater.fetchJson 改用 Electron net
 *
 * 背景：真机 Node https.get 访问 api.github.com / raw.githubusercontent TLS 验证失败
 * （"unable to verify the first certificate"），三源只剩 jsDelivr → sourcesAgree=false
 * → 防投毒拒绝自动下载（用户反馈：下载更新失败）。
 * 修复：fetchJson 改用 Electron net.request（Chromium 网络栈 + 系统 CA），与 help-doc 同款。
 *
 * 本测试用 mock net 验证：
 *  1. fetchJson 调 net.request（而非 https.get）
 *  2. 成功解析 JSON（含跨 chunk 拼接）
 *  3. 非 2xx 返回 null
 *  4. 响应体超 maxBytes 放弃
 *  5. 请求 error → null
 */

// ── mock Electron net：记录请求 + 手动触发 response/error 事件 ──
let lastReq = null;
const mockNet = {
  request(url) {
    const req = {
      url,
      headers: {},
      _events: {},
      setHeader(k, v) { this.headers[k] = v; },
      end() {},
      abort() { this._aborted = true; },
      on(ev, fn) { (this._events[ev] || (this._events[ev] = [])).push(fn); return this; },
      _emit(ev, arg) { (this._events[ev] || []).forEach((fn) => fn(arg)); },
    };
    lastReq = req;
    return req;
  },
};

// ── 构造 updater（注入 mock net + 最小 deps）──
const { createUpdater } = require('../modules/updater');
const updaterApi = createUpdater({
  app: { getPath: () => '', getVersion: () => '1.1.3' },
  shell: {},
  https: {},
  net: mockNet,
  crypto: require('node:crypto'),
  fs: require('node:fs'),
  path: require('node:path'),
  rmQuiet: () => {},
  appendLog: () => {},
  readShellConfig: () => ({ dshPackage: '@deepseek-ai/dsh', dshVersion: 'latest', registry: 'https://registry.npmmirror.com' }),
  installedDshVersion: () => null,
  updateDshVersion: () => true,
  shellUpdateUrls: [],
});

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } }

function emitResponse(req, code, body) {
  const res = {
    statusCode: code,
    _events: {},
    setEncoding() {},
    on(ev, fn) { (this._events[ev] || (this._events[ev] = [])).push(fn); return this; },
    _emit(ev, arg) { (this._events[ev] || []).forEach((fn) => fn(arg)); },
  };
  req._emit('response', res);
  // 分两个 chunk 发，验证跨 chunk 拼接
  const b = Buffer.from(body, 'utf8');
  const mid = Math.max(1, Math.floor(b.length / 2));
  res._emit('data', b.slice(0, mid));
  res._emit('data', b.slice(mid));
  res._emit('end');
  return res;
}

(async () => {
  // 1) 成功解析 JSON（跨 chunk）
  const p1 = updaterApi.fetchJson('https://cdn.jsdelivr.net/gh/XWJ-z/dsh-Desktop@main/version.json');
  await new Promise((r) => setImmediate(r));
  ok(!!lastReq, 'fetchJson 调用了 net.request');
  ok(lastReq.url.includes('cdn.jsdelivr.net'), '请求 URL 正确');
  ok(lastReq.headers['User-Agent'] === 'DSH-Desktop', '默认 User-Agent 已设置');
  emitResponse(lastReq, 200, '{"version":"1.1.3","hash":"abc"}');
  const r1 = await p1;
  ok(r1 && r1.version === '1.1.3', '200 + JSON（跨 chunk）→ 解析成功');

  // 2) 非 2xx → null
  const p2 = updaterApi.fetchJson('https://example.com/x');
  await new Promise((r) => setImmediate(r));
  emitResponse(lastReq, 404, 'not found');
  const r2 = await p2;
  ok(r2 === null, '404 → null');

  // 3) 响应体超 maxBytes → null（maxBytes 传极小值）
  const p3 = updaterApi.fetchJson('https://example.com/big', 8000, {}, 10);
  await new Promise((r) => setImmediate(r));
  emitResponse(lastReq, 200, '{"data":"' + 'x'.repeat(100) + '"}');
  const r3 = await p3;
  ok(r3 === null, '响应体超 maxBytes → null');

  // 4) 请求 error → null
  const p4 = updaterApi.fetchJson('https://example.com/err');
  await new Promise((r) => setImmediate(r));
  lastReq._emit('error', new Error('boom'));
  const r4 = await p4;
  ok(r4 === null, '请求 error → null');

  console.log(pass && !fail ? 'ALL PASS' : 'HAS FAIL');
  process.exit(fail ? 1 : 0);
})();
