'use strict';

/**
 * DSH-Desktop — 局域网扫码访问模块（v1.2.1 T7）
 *
 * 职责：
 *  - getLanIps()：os.networkInterfaces() 过滤 IPv4 非 internal（多网卡全部返回）
 *  - isEnabled / setLanMode(on)：读写 settings.lanAccess；
 *    开启 → 重启 DSH 服务绑定 0.0.0.0 + 弹二维码窗口；关闭 → 回 127.0.0.1
 *  - getQrData()：{ enabled, port, ips: [{ ip, url }] }（二维码窗口展示）
 *  - 二维码生成：require('qrcode').toDataURL(url)（轻量，无网络依赖）
 *  - 首次开启提示防火墙放行（前端引导文案）+ 安全提示「仅限信任 WiFi」
 *
 * 依赖注入（deps）：
 *  - os                     Node 模块
 *  - appendLog
 *  - getSettings / saveSettings
 *  - getResolvedPort        当前端口
 *  - restartServer          重启 DSH 服务（main.js 注入；读取 getServerHost 决定绑定）
 *  - openQrWindow / closeQrWindow
 */

function createLanAccess(deps) {
  const { os, appendLog, getSettings, saveSettings, getResolvedPort, restartServer, openQrWindow, closeQrWindow } = deps;

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

  /** 是否开启局域网访问 */
  function isEnabled() {
    return !!getSettings().lanAccess;
  }

  /** 采集二维码窗口数据（ip + URL 列表；URL = http://<ip>:<port>） */
  function getQrData() {
    const port = getResolvedPort();
    return {
      enabled: isEnabled(),
      port,
      ips: getLanIps().map((ip) => ({ ip, url: `http://${ip}:${port}` })),
    };
  }

  /**
   * 二维码生成（qrcode.toDataURL，返回 data URL 字符串）。
   * @param {string} text
   * @returns {Promise<string>} data URL；失败返回 ''
   */
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

  /**
   * 开启/关闭局域网访问。
   *  - 开启：settings.lanAccess=true → 重启 DSH 服务（0.0.0.0）→ 弹二维码窗口（首次附防火墙引导）
   *  - 关闭：settings.lanAccess=false → 重启 DSH 服务（127.0.0.1）→ 关二维码窗口
   * @param {boolean} enabled
   * @returns {Promise<{ok: boolean, message?: string}>}
   */
  async function setLanMode(enabled) {
    const s = getSettings();
    s.lanAccess = !!enabled;
    saveSettings();
    appendLog('info', `局域网访问已${enabled ? '开启（绑定 0.0.0.0）' : '关闭（绑定 127.0.0.1）'}，重启 DSH 服务…`);
    try {
      await restartServer();
      if (enabled) {
        openQrWindow();
      } else {
        closeQrWindow();
      }
      return { ok: true };
    } catch (err) {
      appendLog('error', `切换局域网访问失败：${err.message}`);
      return { ok: false, message: err.message };
    }
  }

  return {
    getLanIps,
    isEnabled,
    getQrData,
    qrFor,
    setLanMode,
  };
}

module.exports = { createLanAccess };
