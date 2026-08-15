// verify-m1-fix.js — M1 根因修复回归验证（自包含，不依赖外部 bundle）
// 覆盖：① RPC 通道字面量 "/api" 前缀化 ② CHANNEL_PATTERN 放宽 ③ assertTarget 多段通过
// 片段为真实 DSH 0.1.0-rc.6 bundle（dsh-api-gateway / dsh-client-connection）的关键代码。
'use strict';
let fails = 0;
const check = (n, ok, d) => { console.log(`${ok ? '[PASS]' : '[FAIL]'} ${n}${d ? ' :: ' + d : ''}`); if (!ok) fails++; };

const GATEWAY_PREFIX = '/app/dsh';

// 与 server.js rewriteBody JS 分支完全一致的规则
function rewriteJs(text) {
  return text
    .replace(/"\/api\//g, `"${GATEWAY_PREFIX}/api/`)
    .replace(/`\/api\//g, `\`${GATEWAY_PREFIX}/api/`)
    .replace(/API_PATH\s*=\s*"\/api"/g, `API_PATH = "${GATEWAY_PREFIX}/api"`)
    .replace(/"\/api"/g, `"${GATEWAY_PREFIX}/api"`)
    .replace('CHANNEL_PATTERN = /^\\/[A-Za-z0-9._~-]+$/', 'CHANNEL_PATTERN = /^\\/[A-Za-z0-9._~/-]+$/')
    .replace(/"\/plugins\//g, `"${GATEWAY_PREFIX}/plugins/`);
}

// 真实 bundle 关键片段（DSH 0.1.0-rc.6）
const apiGatewaySnippet = `
const result = await connection.rpc.call("/api", endpoint, { args }, signal);
if (!mountActive(token)) return withdrawn(endpoint);`;

const connectionSnippet = `
const CHANNEL_PATTERN = /^\\/[A-Za-z0-9._~-]+$/;
function assertTarget(channel, endpoint) {
  const segments = endpoint.split("/");
  if (!CHANNEL_PATTERN.test(channel) || segments.some((s) => s === "" || s === "." || s === ".." || !ENDPOINT_SEGMENT_PATTERN.test(s))) throw new Error('invalid target');
}`;

// --- 步骤1：api-gateway channel 前缀化 ---
const gwAfter = rewriteJs(apiGatewaySnippet);
check('api-gateway rpc.call 前缀化', gwAfter.includes('rpc.call("/app/dsh/api"'), '');
check('api-gateway 无残留裸 /api', !gwAfter.includes('rpc.call("/api"'), '');

// --- 步骤2：CHANNEL_PATTERN 放宽 ---
const connAfter = rewriteJs(connectionSnippet);
check('CHANNEL_PATTERN 放宽（含 /）', connAfter.includes('CHANNEL_PATTERN = /^\\/[A-Za-z0-9._~/-]+$/'), '');

// --- 步骤3：模拟 assertTarget + URL 拼接（重写后的代码） ---
const CHANNEL_PATTERN = /^\/[A-Za-z0-9._~/-]+$/;
const ENDPOINT_SEGMENT_PATTERN = /^[A-Za-z0-9_$.-]+$/;
function assertTarget(channel, endpoint) {
  const segments = endpoint.split('/');
  if (!CHANNEL_PATTERN.test(channel) || segments.some((s) => s === '' || s === '.' || s === '..' || !ENDPOINT_SEGMENT_PATTERN.test(s))) {
    throw new Error(`invalid RPC target ${channel}/${endpoint}`);
  }
}
const channel = '/app/dsh/api';
const endpoint = 'commands/list';
try {
  assertTarget(channel, endpoint);
  check('assertTarget 通过（多段 channel）', true, '');
} catch (e) {
  check('assertTarget 通过（多段 channel）', false, e.message);
}
const url = new URL(`${channel}/${endpoint}`, 'https://192.168.2.166:64999').pathname;
check('URL 带前缀', url === '/app/dsh/api/commands/list', url);
let rejected = false;
try { assertTarget('/app/dsh/api', '..%2Fetc'); } catch { rejected = true; }
check('恶意 endpoint 仍被拒', rejected, '');

console.log(`\n===== ${fails === 0 ? 'M1 修复回归全部通过' : fails + ' 项失败'} =====`);
process.exit(fails === 0 ? 0 : 1);
