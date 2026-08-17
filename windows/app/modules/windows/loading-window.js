'use strict';

/**
 * DSH-Desktop — 启动加载窗口模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：createLoadingWindow —— 启动加载窗口（1280×820，显示阶段与日志；
 * 服务就绪后关闭，不承载 GUI）。
 *
 * 依赖注入（deps）：
 *  - BrowserWindow / app / path / nativeTheme
 *  - appName
 *  - getResolvedPort / getLoadingWindow / setLoadingWindow
 */

function createLoadingWindowModule(deps) {
  const {
    BrowserWindow, app, path, nativeTheme, appName,
    getResolvedPort, getLoadingWindow, setLoadingWindow,
  } = deps;

  /** 启动加载窗口（1280×820，显示阶段与日志；服务就绪后关闭，不承载 GUI） */
  function createLoadingWindow() {
    const win = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 860,
      minHeight: 560,
      title: appName,
      icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f4', // v0.9.9：跟随外观
      show: false,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.once('ready-to-show', () => win.show());
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'loading.html'), { query: { port: String(getResolvedPort()) } });
    win.on('closed', () => { if (getLoadingWindow() === win) setLoadingWindow(null); });
    setLoadingWindow(win);
    return win;
  }

  return { createLoadingWindow };
}

module.exports = { createLoadingWindowModule };
