'use strict';

/**
 * test-v112-external-links.js — v1.1.2 问题1修复单测
 *
 * 验证 external-links.js 的 allowLoopback 参数：
 *  - setWindowOpenHandler（页面自动触发）传 allowLoopback=false →
 *    指向 127.0.0.1/localhost 的链接一律拒绝（不再自动弹系统浏览器）
 *  - app:open-external（宠物「网页打开」显式用户操作）默认 allowLoopback=true →
 *    本地回环仍放行（功能不受影响）
 *  - 外部白名单（github/deepseek/qq/raw/cdn）行为不变
 */

const { isAllowedExternalUrl } = require('../modules/external-links');

let pass = 0;
let fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

// ── v1.1.2 核心：页面自动触发（allowLoopback=false）──
ok(!isAllowedExternalUrl('http://127.0.0.1:3080', false), '页面触发 127.0.0.1 → 拒绝（防自动弹浏览器）');
ok(!isAllowedExternalUrl('http://localhost:3080', false), '页面触发 localhost → 拒绝');
ok(!isAllowedExternalUrl('http://127.0.0.1:3080/', false), '页面触发 127.0.0.1 带斜杠 → 拒绝');
ok(!isAllowedExternalUrl('http://localhost:3080/abc', false), '页面触发 localhost 子路径 → 拒绝');

// ── 显式用户操作（默认 allowLoopback=true）──
ok(isAllowedExternalUrl('http://127.0.0.1:3080'), '显式操作 127.0.0.1 → 放行（宠物「网页打开」）');
ok(isAllowedExternalUrl('http://localhost:3080'), '显式操作 localhost → 放行');
ok(isAllowedExternalUrl('http://127.0.0.1:3080/'), '显式操作 127.0.0.1 带斜杠 → 放行');

// ── 外部白名单行为不变 ──
ok(isAllowedExternalUrl('https://github.com/XWJ-z/dsh-Desktop', false), 'github.com 放行（页面触发）');
ok(isAllowedExternalUrl('https://www.deepseek.com/', false), 'www.deepseek.com 放行');
ok(isAllowedExternalUrl('https://qm.qq.com/q/916607090', false), 'qq.com 放行');
ok(isAllowedExternalUrl('https://cdn.jsdelivr.net/gh/XWJ-z/dsh-Desktop@main/help.html', false), 'jsDelivr help.html 放行');
ok(!isAllowedExternalUrl('https://cdn.jsdelivr.net/gh/XWJ-z/dsh-Desktop@main/other.json', false), 'jsDelivr 非 help.html 拒绝');
ok(isAllowedExternalUrl('https://raw.githubusercontent.com/XWJ-z/dsh-Desktop/main/help.html', false), 'raw help.html 放行');
ok(!isAllowedExternalUrl('https://evil.example.com/', false), '陌生域名拒绝');
ok(!isAllowedExternalUrl('javascript:alert(1)', false), 'javascript: 协议拒绝');
ok(!isAllowedExternalUrl('', false), '空串拒绝');
ok(!isAllowedExternalUrl('https://github.com.evil.com/', false), '伪装子域拒绝');

console.log(pass && !fail ? 'ALL PASS' : 'HAS FAIL');
process.exit(fail ? 1 : 0);
