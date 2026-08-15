'use strict';

/**
 * contact.js — 联系我们窗口脚本（v0.5.3）
 * 经 preload：getContactInfo() 获取群号+二维码路径、copyText() 复制群号。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

async function init() {
  if (!dsh || !dsh.getContactInfo) {
    el('group-num').textContent = '暂不可用';
    return;
  }
  const info = await dsh.getContactInfo();
  // 品牌鲸鱼 logo（主进程 assets/icon.png）
  if (info && info.iconPath) {
    const logo = el('logo');
    logo.onerror = () => { logo.style.display = 'none'; };
    logo.src = 'file:///' + info.iconPath.replace(/\\/g, '/');
  }
  if (!info || !info.number) {
    el('group-num').textContent = '未配置 QQ 群';
    el('qr-placeholder').textContent = '请在 config.json 配置 qqGroup';
    return;
  }
  el('group-num').textContent = info.number;

  if (info.qrPath) {
    const img = el('qr');
    img.onload = () => { el('qr-placeholder').style.display = 'none'; img.style.display = ''; };
    img.onerror = () => { el('qr-placeholder').textContent = '二维码加载失败'; };
    img.src = 'file:///' + info.qrPath.replace(/\\/g, '/');
  } else {
    el('qr-placeholder').textContent = '未找到二维码图片';
  }
}

el('copy-btn').addEventListener('click', async () => {
  const num = el('group-num').textContent;
  if (!num || num === '-' || num === '未配置 QQ 群') return;
  if (dsh && dsh.copyText) {
    await dsh.copyText(num);
  } else {
    try { navigator.clipboard.writeText(num); } catch { /* ignore */ }
  }
  const c = el('copied');
  c.textContent = '✓ 群号已复制';
  setTimeout(() => { c.textContent = ''; }, 1500);
});

init();
