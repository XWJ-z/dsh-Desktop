'use strict';

/**
 * DSH-Desktop — 手机访问模块（v1.2.1 T7，2026-08-23 修复版）
 *
 * ⚠️ 关键修正：DSH 运行时（@deepseek-ai/dsh）**出于安全明确拒绝 `--host 0.0.0.0`**
 * （`error: --host 0.0.0.0 is intentionally not supported yet for safety...`），
 * 让 DSH 绑定 0.0.0.0 会导致它退出码 1 → 壳反复重试 → 启动超时失败。
 *
 * 因此改为：**DSH 永远绑定 127.0.0.1:<port>（不变），由壳在手机访问开启时启动一个
 * TCP 反向代理**，监听 0.0.0.0:<proxyPort>，把局域网进来的连接转发到本机
 * 127.0.0.1:<dshPort>。这样：
 *  - 不触发 DSH 的 0.0.0.0 拒绝；
 *  - 手机访问开关**不再重启 DSH**（只启/停代理，零干扰）；
 *  - 二维码指向 http://<lanIP>:<proxyPort>（走代理）。
 *
 * 职责：
 *  - getLanIps()：os.networkInterfaces() 过滤 IPv4 非 internal
 *  - isEnabled / setLanMode(on)：读写 settings.lanAccess；开=起代理+确保弹窗开，关=停代理；
 *    **关闭不收起二维码窗口**（用户指令：弹窗内关闭开关后弹窗保持打开，由用户手动关）
 *  - ensureRunning()：启动时若 lanAccess 已开则恢复代理（供 main.js 调用）
 *  - getQrData()：{ enabled, port: proxyPort, ips: [{ip,url}] }
 *  - qrFor()：qrcode.toDataURL
 *
 * 依赖注入（deps）：
 *  - os / net              Node 模块（net 用于 TCP 代理）
 *  - appendLog / getSettings / saveSettings
 *  - getResolvedPort       当前 DSH 端口（127.0.0.1）
 *  - openQrWindow          确保手机访问弹窗打开
 */

function createLanAccess(deps) {
  const { os, net, http, appendLog, getSettings, saveSettings, getResolvedPort, openQrWindow } = deps;

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

  /** crypto.randomUUID polyfill（手机经 http 局域网访问 = 非安全上下文，`crypto.randomUUID` 不存在） */
  const CRYPTO_UID_POLYFILL = '<scr' + 'ipt>(function(){try{var c=globalThis.crypto||(globalThis.crypto={});if(typeof c.randomUUID!=="function"){c.randomUUID=function(){return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(a){var b=Math.random()*16|0,d=a==="x"?b:(b&3|8);return d.toString(16)})}}}catch(e){}})();</scr' + 'ipt>';

  /** 转发普通 HTTP 请求到 127.0.0.1:<targetPort>（不改写 Host/Origin，trusted-host 已放行）；HTML 响应注入 crypto.randomUUID polyfill */
  function forwardHttp(req, res, targetPort) {
    const up = http.request({
      host: '127.0.0.1',
      port: targetPort,
      method: req.method,
      path: req.url,
      headers: req.headers,
    }, (upRes) => {
      const ct = String(upRes.headers['content-type'] || '');
      if (upRes.statusCode === 200 && /text\/html/i.test(ct)) {
        let body = '';
        upRes.setEncoding('utf8');
        upRes.on('data', (c) => { body += c; });
        upRes.on('end', () => {
          const injected = body.replace(/<head([^>]*)>/i, '<head$1>' + CRYPTO_UID_POLYFILL);
          const h = { ...upRes.headers };
          delete h['content-length']; delete h['transfer-encoding']; delete h.connection; delete h['keep-alive'];
          res.writeHead(upRes.statusCode, h);
          res.end(injected);
        });
      } else {
        const h = { ...upRes.headers };
        delete h.connection; delete h['keep-alive']; delete h['proxy-connection']; delete h['transfer-encoding'];
        res.writeHead(upRes.statusCode, h);
        upRes.pipe(res);
      }
    });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* ignore */ } });
    req.on('error', () => { try { up.destroy(); } catch { /* ignore */ } });
    req.pipe(up);
  }

  /** 转发 WebSocket / HTTP Upgrade（不改写 Host/Origin，裸管道双向——trusted-host 已放行） */
  function forwardUpgrade(req, socket, head, targetPort) {
    const upstream = net.connect(targetPort, '127.0.0.1');
    socket.on('error', () => { try { upstream.destroy(); } catch { /* ignore */ } });
    upstream.on('error', () => { try { socket.destroy(); } catch { /* ignore */ } });
    upstream.on('connect', () => {
      let headStr = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || v === null) continue;
        headStr += `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`;
      }
      headStr += '\r\n';
      upstream.write(headStr);
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket).pipe(upstream);
    });
  }

  /**
   * 启动局域网反向代理（绑定 0.0.0.0:<dshPort+offset> → 127.0.0.1:<dshPort>）。
   * HTTP 请求转发 + HTML 注入 crypto.randomUUID polyfill（手机非安全上下文）+ WebSocket 裸管道。
   * 需 DSH 以 `--trusted-host <局域网IP>` 启动（见 serverLifecycle.js），否则非 localhost 请求 403。
   */
  async function startProxy() {
    if (proxyServer) return true;
    const targetPort = getResolvedPort();
    for (let off = 1; off <= 20; off++) {
      const want = targetPort + off;
      try {
        const srv = await new Promise((resolve, reject) => {
          const s = http.createServer((req, res) => forwardHttp(req, res, targetPort));
          s.on('upgrade', (req, socket, head) => forwardUpgrade(req, socket, head, targetPort));
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
   * 开启/关闭手机访问。
   *  - 开：起代理(0.0.0.0:proxyPort)；成功则确保二维码窗口打开；不动 DSH
   *  - 关：停代理；**不关闭二维码窗口**（用户指令：在弹窗里关闭开关后弹窗保持打开，
   *    由弹窗渲染进程刷新为"未开启"态，开关复用）—— 弹窗由用户手动关闭。
   */
  async function setLanMode(enabled) {
    const s = getSettings();
    s.lanAccess = !!enabled;
    saveSettings();
    if (enabled) {
      const okProxy = await startProxy();
      if (okProxy) {
        openQrWindow();
        appendLog('info', '手机访问已开启（基于反向代理，DSH 保持 127.0.0.1 绑定）');
        return { ok: true };
      }
      appendLog('warn', '手机访问代理启动失败（端口不可用），弹窗保持打开供重试');
      return { ok: false, message: '手机访问代理启动失败（端口不可用），请稍后重试' };
    }
    stopProxy();
    appendLog('info', '手机访问已关闭');
    return { ok: true };
  }

  /** 启动时恢复（settings.lanAccess 已开则起代理；幂等）。
   *  ⚠️ 修复 2026-08-23：此前只起代理不弹二维码窗口 —— 若上一轮已开启局域网访问
   *  （settings.lanAccess=true 持久化），重启后代理静默恢复、菜单开关显示"开"，
   *  但二维码窗口不出现（用户反馈：开了开关却没有二维码）。现补 openQrWindow()。 */
  async function ensureRunning() {
    if (isEnabled()) {
      const ok = await startProxy();
      if (ok) openQrWindow();
      return !!proxyServer;
    }
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
