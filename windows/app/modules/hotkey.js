'use strict';

/**
 * DSH-Desktop — 全局快捷键模块（v0.8.1 T4 新增，T5 独立成模块）
 *
 * 全局快捷键（呼出/隐藏主窗口）注册与配置。默认 Ctrl+Alt+D；
 * null/空串 = 禁用。拍板行为：未开托盘常驻时只呼出不隐藏。
 *
 * 依赖注入说明（deps 字段）：
 *   - globalShortcut / Menu   Electron 模块
 *   - appendLog          日志函数
 *   - getSettings        当前设置对象（getter；hotkey 字段）
 *   - saveSettings       设置落盘（setHotkey 调用）
 *   - getMainWindow      主窗口（getter；可见性判断）
 *   - showMainWindow     显示/重建主窗口（含服务就绪等待）
 *   - getBuildMenu       构建应用菜单的函数（setHotkey 后刷新 radio 状态）
 */

function createHotkey(deps) {
  const {
    globalShortcut, Menu,
    appendLog,
    getSettings, saveSettings, getMainWindow, showMainWindow, getBuildMenu,
  } = deps;

  /** 注册全局快捷键（呼出/隐藏主窗口）；null 或空串 = 禁用 */
  function registerHotkey(accelerator) {
    try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
    if (!accelerator) return false;
    try {
      const ok = globalShortcut.register(accelerator, () => toggleMainWindowByHotkey());
      if (ok) appendLog('info', `全局快捷键已注册：${accelerator}`);
      else appendLog('warn', `全局快捷键 ${accelerator} 注册失败（可能被其他应用占用）`);
      return ok;
    } catch (err) {
      appendLog('error', `注册全局快捷键失败：${err.message}`);
      return false;
    }
  }

  /**
   * 快捷键行为 —— 呼出/隐藏主窗口。
   * 拍板：未开托盘常驻时只呼出不隐藏（避免误退）；开托盘常驻时可见→隐藏、不可见→呼出。
   */
  function toggleMainWindowByHotkey() {
    const win = getMainWindow();
    if (win && !win.isDestroyed() && win.isVisible() && getSettings().minimizeToTray) {
      win.hide();               // 可见 + 托盘常驻 → 隐藏
    } else {
      showMainWindow();         // 不可见/未建 → 显示/重建（含服务就绪等待）
    }
  }

  /** 设置快捷键（设置菜单调用）—— 重新注册 + 落盘 + 刷新菜单 radio 状态 */
  function setHotkey(accelerator) {
    getSettings().hotkey = accelerator || null;
    saveSettings();
    registerHotkey(getSettings().hotkey);
    Menu.setApplicationMenu(getBuildMenu());
  }

  /** 退出清理：释放全部全局快捷键（防残留占用） */
  function unregisterAll() {
    try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  }

  return { registerHotkey, toggleMainWindowByHotkey, setHotkey, unregisterAll };
}

module.exports = { createHotkey };
