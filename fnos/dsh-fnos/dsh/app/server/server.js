'use strict';
/**
 * server.js — DeepSeek Harness 飞牛网关接入服务
 *
 * 职责：
 *  1. 监听统一网关 Unix Socket（$TRIM_APPDEST/app.sock），转发到 DSH web（127.0.0.1:3080）
 *  2. 提供 /about（联系我们页）与 /api/health（健康检查）
 *  3. 支持 WebSocket 转发（DSH 的 HMR/实时功能）
 *
 * 环境变量（由 cmd/main 传入）：
 *  SOCKET_PATH  网关 Socket 路径（安装到飞牛后使用）；为空时监听 TCP（本地开发）
 *  PORT         本地开发端口（默认 5001）
 *  DSH_PORT     DSH web 服务端口（默认 3080）
 */

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const SOCKET_PATH = process.env.SOCKET_PATH || '';
const PORT = Number(process.env.PORT || 5001);
const DSH_HOST = '127.0.0.1';
const DSH_PORT = Number(process.env.DSH_PORT || 3080);
const SERVER_DIR = __dirname;

// 联系我们页（读取同目录 about.html + qq-group.png）
function serveAbout(req, res) {
  const url = req.url.split('?')[0];
  if (url === '/about' || url === '/about/') {
    const html = path.join(SERVER_DIR, 'about.html');
    if (fs.existsSync(html)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(html).pipe(res);
      return true;
    }
  }
  if (url === '/about/qq-group.png') {
    const img = path.join(SERVER_DIR, 'qq-group.png');
    if (fs.existsSync(img)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      fs.createReadStream(img).pipe(res);
      return true;
    }
  }
  return false;
}

// 健康检查
function serveHealth(req, res) {
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, name: 'DeepSeek Harness', time: Date.now() }));
    return true;
  }
  return false;
}

// HTTP 代理：转发到 DSH web
function proxyHttp(req, res) {
  const proxy = http.request({
    host: DSH_HOST, port: DSH_PORT, method: req.method, path: req.url, headers: req.headers,
  }, (pRes) => {
    res.writeHead(pRes.statusCode, pRes.headers);
    pRes.pipe(res);
  });
  req.pipe(proxy);
  proxy.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('DeepSeek Harness 服务尚未就绪，请稍后重试（首次启动需下载 DSH 运行时）。');
  });
}

const server = http.createServer((req, res) => {
  if (serveAbout(req, res)) return;
  if (serveHealth(req, res)) return;
  proxyHttp(req, res);
});

// WebSocket 转发（TCP 隧道）
server.on('upgrade', (req, socket, head) => {
  const proxy = net.connect(DSH_PORT, DSH_HOST, () => {
    proxy.write(head);
    proxy.write([
      `${req.method} ${req.url} HTTP/${req.httpVersion}`,
      ...Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`),
      '',
      '',
    ].join('\r\n'));
  });
  socket.pipe(proxy).pipe(socket);
  proxy.on('error', () => socket.destroy());
});

function listen() {
  if (SOCKET_PATH) {
    fs.rmSync(SOCKET_PATH, { force: true });
    server.listen(SOCKET_PATH, () => {
      console.log(`[dsh] gateway socket 就绪：${SOCKET_PATH}`);
    });
  } else {
    server.listen(PORT, () => {
      console.log(`[dsh] 本地开发模式：http://127.0.0.1:${PORT}`);
    });
  }
}

listen();
