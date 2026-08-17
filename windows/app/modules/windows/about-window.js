'use strict';

/**
 * DSH-Desktop — 更新窗口 / 联系我们 / 关于窗口模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：
 *  - openUpdateWindow：检查更新窗口（壳+DSH 一个窗口）
 *  - openContactWindow：联系我们窗口（QQ 群二维码）
 *  - openAboutWindow：关于窗口
 *  （secureWebPreferences 已抽到 modules/security.js，v0.8.30 R1）
 *
 * 依赖注入（deps）：
 *  - BrowserWindow / app / path / nativeTheme
 *  - getMainWindow
 *  - getUpdateWin/setUpdateWin / getContactWin/setContactWin / getAboutWin/setAboutWin
 *  - secureWebPreferences   安全基线（modules/security.js 注入）
 */

function createDialogWindowsModule(deps) {
  const {
    BrowserWindow, app, path, nativeTheme,
    getUpdateWin, setUpdateWin,
    getContactWin, setContactWin,
    getAboutWin, setAboutWin,
    secureWebPreferences,
  } = deps;

  /** 现代化更新窗口（深色卡片风；壳+DSH 一个窗口） */
  function openUpdateWindow() {
    if (getUpdateWin() && !getUpdateWin().isDestroyed()) { getUpdateWin().focus(); return; }
    const win = new BrowserWindow({
      width: 560, height: 640, resizable: false, minimizable: false,
      parent: deps.getMainWindow(), modal: true, title: '检查更新',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f4', // v0.9.9：跟随外观
      webPreferences: secureWebPreferences(),
    });
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'update.html'));
    win.on('closed', () => { setUpdateWin(null); });
    setUpdateWin(win);
  }

  /** 联系我们窗口（QQ群二维码+群号+复制） */
  function openContactWindow() {
    if (getContactWin() && !getContactWin().isDestroyed()) { getContactWin().focus(); return; }
    const win = new BrowserWindow({
      width: 400, height: 560, resizable: false, minimizable: false,
      parent: deps.getMainWindow(), modal: true, title: '联系我们',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f4', // v0.9.9：跟随外观
      webPreferences: secureWebPreferences(),
    });
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'contact.html'));
    win.on('closed', () => { setContactWin(null); });
    setContactWin(win);
  }

  /** 关于窗口（现代化：版本信息卡片 + 链接按钮） */
  function openAboutWindow() {
    if (getAboutWin() && !getAboutWin().isDestroyed()) { getAboutWin().focus(); return; }
    const win = new BrowserWindow({
      width: 420, height: 560, resizable: false, minimizable: false,
      parent: deps.getMainWindow(), modal: true, title: '关于 DSH-Desktop',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f4', // v0.9.9：跟随外观
      webPreferences: secureWebPreferences(),
    });
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'about.html'));
    win.on('closed', () => { setAboutWin(null); });
    setAboutWin(win);
  }

  return { openUpdateWindow, openContactWindow, openAboutWindow };
}

module.exports = { createDialogWindowsModule };
