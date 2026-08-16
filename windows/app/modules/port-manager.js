'use strict';

/**
 * DSH-Desktop — 端口 / 服务就绪探测模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：
 *  - isPortFree / pickPort：端口探测与顺延（被占用时 +50 范围内找空位）
 *  - waitForServer：HTTP 轮询等待 DSH 服务就绪
 *  - parsePortArg：解析 --port 命令行参数
 *
 * 依赖注入（deps）：
 *  - net / http        Node 模块
 *  - defaultHost       默认监听地址（127.0.0.1）
 *  - portProbeRange    端口顺延上限（50）
 */

function createPortManager(deps) {
  const { net, http, defaultHost, portProbeRange } = deps;

  function isPortFree(port) {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: defaultHost, port });
      socket.setTimeout(1500);
      socket.once('connect', () => { socket.destroy(); resolve(false); });
      socket.once('timeout', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(true));
    });
  }

  async function pickPort(preferred) {
    for (let port = preferred; port < preferred + portProbeRange; port++) {
      if (await isPortFree(port)) return port;
    }
    return preferred;
  }

  function waitForServer(host, port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (Date.now() > deadline) {
          reject(new Error(`等待 DSH 服务就绪超时（${timeoutMs / 1000}s）：http://${host}:${port}`));
          return;
        }
        const req = http.get({ host, port, path: '/', timeout: 2000 }, (res) => {
          res.resume();
          resolve(true);
        });
        req.on('timeout', () => { req.destroy(); setTimeout(attempt, 500); });
        req.on('error', () => setTimeout(attempt, 500));
      };
      attempt();
    });
  }

  function parsePortArg() {
    const argv = process.argv;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--port' && argv[i + 1]) {
        const port = Number(argv[i + 1]);
        if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
      }
      const match = /^--port=(\d+)$/.exec(argv[i]);
      if (match) {
        const port = Number(match[1]);
        if (port > 0 && port <= 65535) return port;
      }
    }
    return null;
  }

  return { isPortFree, pickPort, waitForServer, parsePortArg };
}

module.exports = { createPortManager };
