'use strict';

/** S2（代码审查 2026-09-07）：手机访问鉴权用的一次性 PIN 通过 crypto 生成（本地，不落盘） */
const crypto = require('crypto');

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
  const { os, net, http, appendLog, getSettings, saveSettings, getResolvedPort, getWebAuthToken, openQrWindow } = deps;

  let proxyServer = null; // 局域网 TCP 反向代理
  let proxyPort = 0;      // 代理监听端口（QR 用）
  // S2（代码审查 2026-09-07）：手机访问鉴权 —— 一次性 6 位 PIN + 会话 cookie。
  // 开启/恢复代理时生成 PIN，二维码 URL 携带 PIN；同网用户仅扫码（带 PIN）才能用，
  // 首次验证通过下发会话 cookie，后续请求凭 cookie 放行（无需每请求带 PIN）。
  let proxyPin = null;        // 当前一次性 PIN（6 位数字）
  let proxySession = null;    // 会话 cookie value（首次 PIN 验证通过时下发）
  let pinFail = 0;            // 连续鉴权失败计数
  const MAX_PIN_FAIL = 5;

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

  /** 采集二维码窗口数据（URL = http://<lanIP>:<proxyPort>，v1.2.14 起追加 DSH 鉴权 token；
   *  S2 起再追加一次性 PIN —— 手机扫码即完成鉴权，未带 PIN 的裸地址访问会被拒绝） */
  function getQrData() {
    const p = effectiveProxyPort();
    const token = getWebAuthToken();
    const qs = [];
    if (token) qs.push(`token=${encodeURIComponent(token)}`);
    if (proxyPin) qs.push(`pin=${encodeURIComponent(proxyPin)}`);
    const path = qs.length ? `/?${qs.join('&')}` : '';
    return {
      enabled: isEnabled(),
      port: p,
      ips: getLanIps().map((ip) => ({ ip, url: `http://${ip}:${p}${path}` })),
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

  /** S2：收取本次一次性 PIN（仅登录用的 6 位数字，不落盘） */
  function issuePin() {
    proxyPin = String(Math.floor(100000 + Math.random() * 900000));
    proxySession = crypto.randomBytes(16).toString('hex');
    pinFail = 0;
    return proxyPin;
  }

  /** 从请求 URL 查询参数取 pin；解析失败返回 '' */
  function pinFromUrl(reqUrl) {
    try {
      return new URL(String(reqUrl || ''), 'http://localhost').searchParams.get('pin') || '';
    } catch {
      return '';
    }
  }

  /** 从转发用 URL 里去掉 pin 参数（避免把鉴权 pin 透传给 DSH） */
  function stripPin(reqUrl) {
    try {
      const u = new URL(String(reqUrl || ''), 'http://localhost');
      if (u.searchParams.has('pin')) {
        u.searchParams.delete('pin');
        return u.pathname + u.search + u.hash;
      }
    } catch { /* ignore */ }
    return reqUrl;
  }

  /** S2：鉴权。已带有效会话 cookie → ok；URL 带正确一次性 PIN → 下发会话 cookie；否则拒绝。
   *  @returns {{ ok: boolean, setCookie?: string }} setCookie 仅在首次 PIN 验证通过时返回（需并入响应头） */
  function authorize(req) {
    if (proxySession && req.headers.cookie && req.headers.cookie.includes(`dsh_proxy_session=${proxySession}`)) {
      return { ok: true };
    }
    const pin = pinFromUrl(req.url);
    if (proxyPin && pin && pin === proxyPin) {
      pinFail = 0;
      return { ok: true, setCookie: `dsh_proxy_session=${proxySession}; Max-Age=28800; Path=/; HttpOnly; SameSite=Lax` };
    }
    pinFail++;
    if (pinFail >= MAX_PIN_FAIL) {
      appendLog('warn', `手机访问鉴权失败 ${MAX_PIN_FAIL} 次，已停止局域网代理（安全兜底，请重新开启手机访问）`);
      stopProxy();
    } else {
      appendLog('warn', `手机访问鉴权失败（无有效 PIN 或会话 cookie），第 ${pinFail}/${MAX_PIN_FAIL} 次`);
    }
    return { ok: false };
  }

  /** 鉴权失败：返回 403 引导页 */
  function denyAuth(res) {
    try {
      res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:sans-serif;text-align:center;padding-top:60px"><h3>访问受限</h3><p>请用手机扫描 DSH 桌面端「手机访问」窗口里的二维码（需携带验证码）。</p></body></html>');
    } catch { /* ignore */ }
  }

  /** M11：剥离客户端透传的鉴权头（Authorization / Proxy-Authorization），防企业 SSO token
   *  被透传到 DSH 并记入其日志；Cookie 保留（DSH 鉴权用），改为代理自己维护。 */
  function cleanHeaders(headers) {
    const h = { ...headers };
    delete h.authorization;
    delete h['proxy-authorization'];
    return h;
  }

  /** 转发普通 HTTP 请求到 127.0.0.1:<targetPort>（不改写 Host/Origin，trusted-host 已放行）；HTML 响应注入 crypto.randomUUID polyfill */
  function forwardHttp(req, res, targetPort) {
    // S2：局域网暴露鉴权 —— 未授权一律 403（二维码已含一次性 PIN），保护同网用户。
    const auth = authorize(req);
    if (!auth.ok) { denyAuth(res); return; }
    // 转发路径去掉 pin（不透传给 DSH）
    const forwardPath = stripPin(req.url);

    // v1.2.14（手机访问同步鉴权）：DSH 0.1.2-rc.1+ 首页需带 token 换取会话 cookie。
    // 手机直接访问裸地址（http://<ip>:<port>/，旧二维码/手动输入）且还没种 cookie 时，
    // 先 302 引导到带 token 的地址；已经带 dsh-auth cookie 的则按原样转发（避免循环）。
    const token = getWebAuthToken();
    if (token && req.method === 'GET' && !req.headers.cookie) {
      try {
        const u = new URL(forwardPath, 'http://localhost');
        if (u.pathname === '/' && !u.searchParams.has('token')) {
          if (auth.setCookie) res.setHeader('Set-Cookie', auth.setCookie);
          res.writeHead(302, { location: `/?token=${encodeURIComponent(token)}` });
          res.end();
          return;
        }
      } catch { /* ignore —— URL 解析失败仍按原样转发 */ }
    }
    const up = http.request({
      host: '127.0.0.1',
      port: targetPort,
      method: req.method,
      path: forwardPath,
      // v2.0.6 修复手机访问空白：DSH 对带 Accept-Encoding:gzip 的请求会返回压缩 HTML，
      // 而下方 HTML 注入分支把 gzip 字节当 utf8 读出、注入后再带 content-encoding:gzip 发出，
      // 浏览器解压失败 → net::ERR_CONTENT_DECODING_FAILED → 手机空白。
      // 强制请求上游不压缩（identity），确保 HTML 注入拿到的是未压缩明文（局域网可接受体积）。
      headers: cleanHeaders({ ...req.headers, 'accept-encoding': 'identity' }),
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
          delete h['content-encoding']; // 上游已强制 identity 不压缩，防残留头导致浏览器解压失败
          if (auth.setCookie) h['set-cookie'] = h['set-cookie'] ? [].concat(h['set-cookie'], auth.setCookie) : auth.setCookie;
          res.writeHead(upRes.statusCode, h);
          res.end(injected);
        });
      } else {
        const h = { ...upRes.headers };
        delete h.connection; delete h['keep-alive']; delete h['proxy-connection']; delete h['transfer-encoding'];
        if (auth.setCookie) h['set-cookie'] = h['set-cookie'] ? [].concat(h['set-cookie'], auth.setCookie) : auth.setCookie;
        res.writeHead(upRes.statusCode, h);
        upRes.pipe(res);
      }
    });
    up.on('error', () => { try { res.writeHead(502); res.end(); } catch { /* ignore */ } });
    req.on('error', () => { try { up.destroy(); } catch { /* ignore */ } });
    req.pipe(up);
  }

  /** 转发 WebSocket / HTTP Upgrade（不改写 Host/Origin，裸管道双向——trusted-host 已放行）。
   *  S2：升级请求同样要鉴权（手机侧首次扫码后已种下会话 cookie）；
   *  S3：转发前消毒 req.url（拒绝 CRLF 注入 / 非 / 开头），并剥离 Authorization 头（M11）。 */
  function forwardUpgrade(req, socket, head, targetPort) {
    // S2：无有效会话 cookie 的 Upgrade 一律拒绝（首个 WS 握手已带此前种下的 cookie）
    if (proxySession && (!req.headers.cookie || !req.headers.cookie.includes(`dsh_proxy_session=${proxySession}`))) {
      appendLog('warn', '拒绝未授权的 WebSocket 升级（手机访问鉴权失败）');
      socket.destroy();
      return;
    }
    // S3：URL 消毒 —— 拒绝含 CRLF 或非 / 开头的 URL（req.url 由客户端控制，Node http server 不消毒）
    const url = String(req.url || '');
    if (!url.startsWith('/') || /[\r\n]/.test(url)) {
      appendLog('warn', `拒绝非法 Upgrade 请求（URL 含 CRLF 或非 / 开头）：${url.slice(0, 120)}`);
      socket.destroy();
      return;
    }
    const upstream = net.connect(targetPort, '127.0.0.1');
    socket.on('error', () => { try { upstream.destroy(); } catch { /* ignore */ } });
    upstream.on('error', () => { try { socket.destroy(); } catch { /* ignore */ } });
    upstream.on('connect', () => {
      let headStr = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined || v === null) continue;
        // M11：剥离客户端透传的鉴权头
        if (k === 'authorization' || k === 'proxy-authorization') continue;
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
        // S2：启动反向代理即生成一次性 PIN（二维码携带；未授权访问被拒）
        issuePin();
        appendLog('info', `局域网代理已启动：0.0.0.0:${want} → 127.0.0.1:${targetPort}（手机扫码用 http://<电脑IP>:${want}/?pin=******，一次性 PIN 已生成）`);
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

  /** 停止局域网反向代理（同时清空一次性 PIN / 会话，旧 PIN 立即失效） */
  function stopProxy() {
    if (proxyServer) {
      try { proxyServer.close(); } catch { /* ignore */ }
      proxyServer = null;
      proxyPort = 0;
      proxyPin = null;
      proxySession = null;
      pinFail = 0;
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
