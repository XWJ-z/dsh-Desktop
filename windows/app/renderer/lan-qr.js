'use strict';

/**
 * lan-qr.js — 局域网扫码窗口脚本（v1.2.1 T7）
 *
 * 显示当前局域网访问的二维码 + URL（多网卡全部列出）；首次开启显示防火墙引导，
 * 安全提示「仅限信任 WiFi」常驻。
 */
(async function () {
  const box = document.getElementById('qr-box');
  try {
    const data = await window.dshDesktop.getLanQrData();
    if (!data.ips || data.ips.length === 0) {
      box.innerHTML = '<div class="empty">未检测到局域网地址（请确认已连接 WiFi/网线，且已开启局域网访问）</div>';
      return;
    }
    box.innerHTML = '';
    data.ips.forEach((item) => {
      const div = document.createElement('div');
      div.className = 'qrcode';
      div.innerHTML =
        (item.qr ? '<img src="' + item.qr + '" alt="二维码" />' : '<div class="empty">二维码生成失败</div>') +
        '<div class="url">' + escapeHtml(item.url) + '</div>';
      box.appendChild(div);
    });
    // 首次开启（无历史位）展示防火墙引导
    const fw = document.getElementById('firewall');
    if (fw && !localStorage.getItem('lan-firewall-shown')) {
      fw.hidden = false;
      localStorage.setItem('lan-firewall-shown', '1');
    }
  } catch (e) {
    box.innerHTML = '<div class="empty">读取局域网信息失败：' + escapeHtml((e && e.message) || String(e)) + '</div>';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
