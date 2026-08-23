'use strict';

/**
 * DSH-Desktop — 局域网扫码访问模块（v1.2.1 T7，2026-08-23 修复版）
 *
 * ⚠️ 关键修正：DSH 运行时（@deepseek-ai/dsh）**出于安全明确拒绝 `--host 0.0.0.0`**
 * （`error: --host 0.0.0.0 is intentionally not supported yet for safety...`），
 * 让 DSH 绑定 0.0.0.0 会导致它退出码 1 → 壳反复重试 → 启动超时失败。
 *
 * 因此改为：**DSH 永远绑定 127.0.0.1:<port>（不变），由壳在局域网开启时启动一个
 * TCP 反向代理**，监听 0.0.0.0:<proxyPort>，把局域网进来的连接转发到本机
 * 127.0.0.1:<dshPort>。这样：
 *  - 不触发 DSH 的 0.0.0.0 拒绝；
 *  - 局域网开关**不再重启 DSH**（只启/停代理，零干扰）；
 *  - 二维码指向 http://<lanIP>:<proxyPort>（走代理）。
 *
 * 职责：
 *  - getLanIps()：os.networkInterfaces() 过滤 IPv4 非 internal
 *  - isEnabled / setLanMode(on)：读写 settings.lanAccess；开=起代理+弹二维码，关=停代理+关窗口
 *  - ensureRunning()：启动时若 lanAccess 已开则恢复代理（供 main.js 调用）
 *  - getQrData()：{ enabled, port: proxyPort, ips: [{ip,url}] }
 *  - qrFor()：qrcode.toDataURL
 *
 * 依赖注入（deps）：
 *  - os / net              Node 模块（net 用于 TCP 代理）
 *  - appendLog / getSettings / saveSettings
 *  - getResolvedPort       当前 DSH 端口（127.0.0.1）
 *  - openQrWindow / closeQrWindow
 */

function createLanAccess(deps) {
  const { os, net, appendLog, getSettings, saveSettings, getResolvedPort, openQrWindow, closeQrWindow } = deps;

  let proxyServer = null; // 局域网 TCP 反向代理
  let proxyPort = 0;      // 代理监听端口（QR 用）

  /** 局域网 IPv4 地址（过滤 internal / 非 IPv4；多网卡返回全部） */
  function getLanIps() {
    const out = [];
    try {
      const itf = os.networkInterfaces();
      for (const key of Object.keys(itf)) {
        for (const a of (itf[key] || [])) {
          if (a.family === 'IPv4' && !a.internal) out.push(a.address);
        }
      }
    } catch { /* ignore */ }
    return out;
  }

  function isEnabled() {
    return !!getSettings().lanAccess;
  }

  /** 代理监听端口（未启动时给 dshPort+1 作为展示占位） */
  function effectiveProxyPort() {
    return proxyPort > 0 ? proxyPort : (getResolvedPort() + 1);
  }

  /** 采集二维码窗口数据（URL = http://<lanIP>:<proxyPort>） */
  function getQrData() {
    const p = effectiveProxyPort();
    return {
      enabled: isEnabled(),
      port: p,
      ips: getLanIps().map((ip) => ({ ip, url: `http://${ip}:${p}` })),
    };
  }

  /** 二维码生成（qrcode.toDataURL；失败返回 ''） */
  function qrFor(text) {
    return new Promise((resolve) => {
      try {
        const QRCode = require('qrcode');
        QRCode.toDataURL(String(text || ''), { width: 240, margin: 1 })
          .then((url) => resolve(url))
          .catch(() => resolve(''));
      } catch {
        resolve('');
      }
    });
  }

  /** 处理代理连接：把 socket 管道到 127.0.0.1:<targetPort> */
  function handleProxy(socket, targetPort) {
    const upstream = net.connect(targetPort, '127.0.0.1');
    socket.on('error', () => { try { upstream.destroy(); } catch { /* ignore */ } });
    upstream.on('error', () => { try { socket.destroy(); } catch { /* ignore */ } });
    socket.pipe(upstream).pipe(socket);
  }

  /** 启动局域网反向代理（绑定 0.0.0.0:<dshPort+offset> → 127.0.0.1:<dshPort>） */
  async function startProxy() {
    if (proxyServer) return true;
    const targetPort = getResolvedPort();
    for (let off = 1; off <= 20; off++) {
      const want = targetPort + off;
      try {
        const srv = await new Promise((resolve, reject) => {
          const s = net.createServer((socket) => handleProxy(socket, targetPort));
          s.on('error', (err) => {
            if (err && err.code === 'EADDRINUSE') reject(err);
            else { appendLog('warn', `局域网代理错误：${err.message}`); }
          });
          s.listen(want, '0.0.0.0', () => resolve(s));
        });
        proxyServer = srv;
        proxyPort = want;
        appendLog('info', `局域网代理已启动：0.0.0.0:${want} → 127.0.0.1:${targetPort}（手机扫码用 http://<电脑IP>:${want}）`);
        return true;
      } catch (err) {
        if (err && err.code === 'EADDRINUSE') continue; // 端口占用，试下一个
        appendLog('warn', `局域网代理启动失败（端口 ${want}）：${err && err.message}`);
        return false;
      }
    }
    appendLog('error', '局域网代理启动失败：未找到可用端口');
    return false;
  }

  /** 停止局域网反向代理 */
  function stopProxy() {
    if (proxyServer) {
      try { proxyServer.close(); } catch { /* ignore */ }
      proxyServer = null;
      proxyPort = 0;
      appendLog('info', '局域网代理已停止');
    }
  }

  /**
   * 开启/关闭局域网访问。
   *  - 开：起代理(0.0.0.0:proxyPort) + 弹二维码窗口；不动 DSH
   *  - 关：停代理 + 关二维码窗口；不动 DSH
   */
  async function setLanMode(enabled) {
    const s = getSettings();
    s.lanAccess = !!enabled;
    saveSettings();
    if (enabled) {
      const okProxy = await startProxy();
      if (okProxy) {
        openQrWindow();
        appendLog('info', '局域网访问已开启（基于反向代理，DSH 保持 127.0.0.1 绑定）');
        return { ok: true };
      }
      closeQrWindow();
      return { ok: false, message: '局域网代理启动失败（端口不可用），请稍后重试' };
    }
    stopProxy();
    closeQrWindow();
    appendLog('info', '局域网访问已关闭');
    return { ok: true };
  }

  /** 启动时恢复（settings.lanAccess 已开则起代理；幂等） */
  async function ensureRunning() {
    if (isEnabled()) await startProxy();
    return !!proxyServer;
  }

  return {
    getLanIps,
    isEnabled,
    getQrData,
    qrFor,
    setLanMode,
    ensureRunning,
    stopProxy,
  };
}

module.exports = { createLanAccess };
