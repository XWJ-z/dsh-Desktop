// ws-stress.js — 模拟 WebSocket 客户端连上即断（压力测试壳进程健壮性）
'use strict';
const net = require('node:net');
const http = require('node:http');

const PORT = 5001;

function wsAbort(i) {
  return new Promise((resolve) => {
    const s = net.connect(PORT, '127.0.0.1', () => {
      s.write(
        'GET /app/dsh/ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
      );
      // 立即断开（模拟客户端异常掉线）
      setTimeout(() => s.destroy(), Math.floor(Math.random() * 50));
    });
    s.on('error', () => resolve());
    s.on('close', () => resolve());
    setTimeout(() => { s.destroy(); resolve(); }, 1500);
  });
}

function health() {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/health', timeout: 2000 }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve(b));
    }).on('error', () => resolve('CONN_FAILED'));
  });
}

(async () => {
  // 30 次连上即断
  for (let i = 0; i < 30; i++) await wsAbort(i);
  console.log('30 ws aborts done');
  // 再打正常请求
  for (let i = 0; i < 5; i++) {
    const h = await health();
    console.log(`health[${i}]: ${h}`);
    if (h === 'CONN_FAILED') { console.log('FAIL: shell died'); process.exit(1); }
  }
  console.log('PASS: shell alive after ws abuse');
  process.exit(0);
})();
