'use strict';

/**
 * about.js — 关于窗口脚本（v0.5.3）
 * 经 preload：getAboutInfo() 获取版本信息、openUpdateWindow() 打开更新窗口、
 * openExternal() 打开外部链接。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

async function init() {
  if (!dsh || !dsh.getAboutInfo) return;
  const info = await dsh.getAboutInfo();
  if (!info) return;

  if (info.iconPath) {
    const logo = el('logo');
    logo.onerror = () => { logo.style.display = 'none'; };
    logo.src = 'file:///' + info.iconPath.replace(/\\/g, '/');
  }
  el('app-version').textContent = `v${info.appVersion}`;
  el('dsh-ver').textContent = info.dsh;
  el('dsh-latest').textContent = info.dshLatest;
  el('shell-latest').textContent = info.shellLatest;
  el('service-url').textContent = info.url;
  if (info.shellNewer) el('shell-newer-badge').style.display = '';
}

el('check-update-btn').addEventListener('click', () => {
  if (dsh && dsh.openUpdateWindow) dsh.openUpdateWindow();
});

el('home-btn').addEventListener('click', (e) => {
  e.preventDefault();
  if (dsh && dsh.openExternal) dsh.openExternal('https://github.com/XWJ-z/dsh-Desktop');
});

init();
