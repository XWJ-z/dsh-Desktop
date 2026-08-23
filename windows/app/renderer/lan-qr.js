'use strict';

/**
 * lan-qr.js — 手机访问弹窗脚本（v1.2.1 T7）
 *
 * 弹窗内一个药丸开关控制手机访问的开启/关闭：
 *  - 开：显示二维码 + URL（多网卡全部列出）+ 首次防火墙引导；安全提示常驻。
 *  - 关：仅显示关闭说明，不显示二维码。
 * 开关切换经 setLanAccess(IPC) 起/停代理 + 弹/关二维码窗口（本窗口自身保持打开）。
 */
(async function () {
  const box = document.getElementById('qr-box');
  const sw = document.getElementById('lan-switch');
  const stateEl = document.getElementById('switch-state');
  const fw = document.getElementById('firewall');

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderOn(data) {
    box.innerHTML = '';
    if (!data.ips || data.ips.length === 0) {
      box.innerHTML = '<div class="empty">未检测到局域网地址（请确认已连接 WiFi/网线，且已开启手机访问）</div>';
    } else {
      data.ips.forEach((item) => {
        const div = document.createElement('div');
        div.className = 'qrcode';
        div.innerHTML =
          (item.qr ? '<img src="' + item.qr + '" alt="二维码" />' : '<div class="empty">二维码生成失败</div>') +
          '<div class="url">' + escapeHtml(item.url) + '</div>';
        box.appendChild(div);
      });
    }
    // 首次开启（无历史位）展示防火墙引导
    if (fw && !localStorage.getItem('lan-firewall-shown')) {
      fw.hidden = false;
      localStorage.setItem('lan-firewall-shown', '1');
    }
  }

  function renderOff() {
    box.innerHTML = '<div class="empty">手机访问未开启 —— 打开上方开关后，手机即可扫码使用。</div>';
    if (fw) fw.hidden = true;
  }

  async function refresh() {
    let data;
    try {
      data = await window.dshDesktop.getLanQrData();
    } catch (e) {
      box.innerHTML = '<div class="empty">读取手机访问信息失败：' + escapeHtml((e && e.message) || String(e)) + '</div>';
      return;
    }
    const on = !!data.enabled;
    sw.checked = on;
    if (stateEl) stateEl.textContent = on ? '已开启' : '未开启';
    if (on) renderOn(data);
    else renderOff();
  }

  // 药丸开关 → 开启/关闭手机访问
  sw.addEventListener('change', async () => {
    const target = sw.checked;
    try {
      const r = await window.dshDesktop.setLanAccess(target);
      if (r && r.ok) {
        await refresh();
      } else {
        // 失败：回滚开关
        sw.checked = !target;
        if (stateEl) stateEl.textContent = target ? '未开启' : '已开启';
        box.innerHTML = '<div class="empty">' + escapeHtml((r && r.message) || '手机访问切换失败，请重试') + '</div>';
      }
    } catch (e) {
      sw.checked = !target;
      box.innerHTML = '<div class="empty">手机访问切换失败：' + escapeHtml((e && e.message) || String(e)) + '</div>';
    }
  });

  // v1.2.7：二维码 30s 自动刷新 + 手动刷新（局域网 IP/代理端口变化时自动更新）
  const refreshBtn = document.getElementById('lan-refresh');
  if (refreshBtn) refreshBtn.addEventListener('click', () => refresh());
  setInterval(() => { if (sw.checked) refresh(); }, 30000);

  await refresh();
})();
