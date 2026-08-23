'use strict';

/**
 * test-v121-lan-proxy.js — v1.2.1 T7 局域网反向代理功能测试（真实 TCP 转发）
 *
 * 覆盖：startProxy 起 0.0.0.0:<proxyPort> → 转发到 127.0.0.1:<dshPort>；
 *       连接代理能收到后端响应；setLanMode 开关启/停代理；ensureRunning 幂等；
 *       DSH 无需重启（测试后端端口不变）。
 *
 * 用法：node tests/test-v121-lan-proxy.js
 */

const net = require('node:net');
const os = require('node:os');
const { createLanAccess } = require('../modules/lan-access');

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.error(`  ✗ ${name}`); } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let dshPort = null;

/** 起一个测试"DSH"后端（127.0.0.1:<dshPort>，回显 hello） */
function startBackend() {
  return new Promise((resolve) => {
    const srv = net.createServer((socket) => {
      socket.on('data', () => socket.write('world'));
    });
    srv.listen(0, '127.0.0.1', () => { dshPort = srv.address().port; resolve(srv); });
  });
}

/** 通过代理端口发请求，收到首段数据即返回（后端回显后连接保持打开） */
function probe(proxyPort, send, tries = 30) {
  return new Promise((resolve, reject) => {
    const tryOnce = (left) => {
      const s = net.connect(proxyPort, '127.0.0.1');
      let buf = '';
      const done = () => { s.destroy(); resolve(buf); };
      s.setTimeout(2500, done);
      s.on('connect', () => s.write(send));
      s.on('data', (c) => { buf += c; clearTimeout(s._t); done(); });
      s.on('error', () => { s.destroy(); if (left > 0) setTimeout(() => tryOnce(left - 1), 150); else resolve(''); });
    };
    tryOnce(tries);
  });
}

async function run() {
  const backend = await startBackend();
  ok(dshPort > 0, `测试后端启动于 127.0.0.1:${dshPort}`);

  const state = { lanAccess: false };
  const calls = { save: 0, openQr: 0, closeQr: 0 };
  const lan = createLanAccess({
    os, net,
    appendLog: () => {},
    getSettings: () => state,
    saveSettings: () => { calls.save++; },
    getResolvedPort: () => dshPort,
    openQrWindow: () => { calls.openQr++; },
    closeQrWindow: () => { calls.closeQr++; },
  });

  // 开启前：qr 显示代理占位端口（dshPort+1）
  ok(lan.getQrData().port === dshPort + 1, '未开启时 QR 端口 = dshPort+1（占位）');
  ok(lan.getQrData().enabled === false, '未开启时 enabled=false');

  // 开启局域网访问
  const r = await lan.setLanMode(true);
  ok(r && r.ok, '开启局域网访问成功');
  ok(state.lanAccess === true && calls.save >= 1, 'settings.lanAccess=true + 已保存');
  ok(calls.openQr >= 1, '开启时弹二维码窗口');
  const proxyPort = lan.getQrData().port;
  ok(proxyPort > dshPort, `代理端口 > dshPort（${proxyPort} > ${dshPort}）`);

  // 通过代理请求，应转发到后端并回显
  const got = await probe(proxyPort, 'ping');
  ok(got === 'world', `代理转发并回显（收到「${got}」）`);

  // 未开启后端绑定 0.0.0.0；后端仍在 127.0.0.1
  ok(lan.isEnabled() === true, 'isEnabled()=true');

  // 关闭局域网访问 → 停代理 + 关窗口
  await lan.setLanMode(false);
  ok(state.lanAccess === false && calls.closeQr >= 1, '关闭时停代理 + 关窗口');
  ok(lan.getQrData().port === dshPort + 1, '关闭后 QR 端口回占位');
  // 关闭后再 probe 代理端口：应连不上（代理已停）
  const afterClose = await probe(proxyPort, 'ping', 5);
  ok(afterClose === '', '关闭后代理端口已释放（连不上）');

  // ensureRunning 幂等
  await lan.setLanMode(true);
  const ep1 = lan.getQrData().port;
  await lan.ensureRunning();
  const ep2 = lan.getQrData().port;
  ok(ep1 === ep2, 'ensureRunning 幂等（复用同一代理端口）');
  const got2 = await probe(ep1, 'ping');
  ok(got2 === 'world', 'ensureRunning 后代理仍可用');

  // v1.2.1 修复：重启后（settings.lanAccess=true 持久化）ensureRunning 也应再弹二维码窗口
  // （VM 实测：开关显示"开"但没有二维码窗口）
  const openQrAfterRestore = calls.openQr;
  await lan.ensureRunning();
  ok(calls.openQr > openQrAfterRestore, '重启后 ensureRunning 会重新弹出二维码窗口');

  lan.stopProxy();
  backend.close();
  console.log(`\n${passed} 通过, ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error('执行抛错：', err); process.exit(1); });
