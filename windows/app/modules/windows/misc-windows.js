'use strict';

/**
 * DSH-Desktop — 杂项窗口模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：
 *  - openChangelogWindow：更新日志窗口（本地 CHANGELOG.json）
 *  - openNoticeWindow / hasNewNotices：公告窗口 + 未读判断（T0.6）
 *  - openPromptLibWindow：提示词库面板（modal:false，可连续注入）
 *  - openGlobalMemoryWindow：全局记忆面板（v0.9.12：基础设定图形化编辑，非裸文件）
 *  - openCloseChoiceWindow：关闭行为询问（Windows 原生对话框）
 *  - openBackupProgress / updateBackupProgress / closeBackupProgress：备份进度
 *  （secureWebPreferences 已抽到 modules/security.js，v0.8.30 R1）
 *
 * 依赖注入（deps）：
 *  - BrowserWindow / app / dialog / path / nativeTheme
 *  - appendLog / appName
 *  - getSettings / setCloseChoice / clearCloseChoice
 *  - getMainWindow / getIsQuitting / setQuitting
 *  - getChangelogWin/setChangelogWin / getNoticeWin/setNoticeWin
 *  - getPromptLibWin/setPromptLibWin
 *  - getGlobalMemoryWin/setGlobalMemoryWin（v0.9.12 全局记忆窗口）
 *  - secureWebPreferences   安全基线（modules/security.js 注入）
 */

function createMiscWindowsModule(deps) {
  const {
    BrowserWindow, app, dialog, path, nativeTheme,
    appendLog, appName,
    getSettings, setCloseChoice,
    getMainWindow, setQuitting,
    getChangelogWin, setChangelogWin,
    getNoticeWin, setNoticeWin,
    getPromptLibWin, setPromptLibWin,
    getGlobalMemoryWin, setGlobalMemoryWin, // v0.9.12
    secureWebPreferences,
  } = deps;

  /** 更新日志窗口（v0.8.1 T3）：本地内置 CHANGELOG.json 渲染各版本，离线可用 */
  function openChangelogWindow() {
    if (getChangelogWin() && !getChangelogWin().isDestroyed()) { getChangelogWin().focus(); return; }
    const win = new BrowserWindow({
      width: 520, height: 560, resizable: false, minimizable: false,
      parent: getMainWindow(), modal: true, title: '更新日志',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f4', // v0.9.9：跟随外观
      webPreferences: secureWebPreferences(),
    });
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'changelog.html'));
    win.on('closed', () => { setChangelogWin(null); });
    setChangelogWin(win);
  }

  /** 公告窗口（v0.8.11 T0.6）：远程 version.json notices 字段 + 本地已读标记；仿更新日志窗口 */
  function openNoticeWindow() {
    if (getNoticeWin() && !getNoticeWin().isDestroyed()) { getNoticeWin().focus(); return; }
    const win = new BrowserWindow({
      width: 520, height: 560, resizable: false, minimizable: false,
      parent: getMainWindow(), modal: true, title: '公告',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f4', // v0.9.9：跟随外观
      webPreferences: secureWebPreferences(),
    });
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'notice.html'));
    win.on('closed', () => { setNoticeWin(null); });
    setNoticeWin(win);
  }

  /** v0.8.11（T0.6）：是否有未读公告（settings.readNotices 记录已读 id） */
  function hasNewNotices(notices) {
    const read = new Set(getSettings().readNotices || []);
    return notices.some((n) => n.id && !read.has(n.id));
  }

  /** 提示词库窗口（v0.8.3 T4 → v0.8.7）：左侧分类 + 右侧提示词卡片，点击直接注入 DSH 输入框（失败降级复制） */
  function openPromptLibWindow() {
    if (getPromptLibWin() && !getPromptLibWin().isDestroyed()) { getPromptLibWin().focus(); return; }
    const win = new BrowserWindow({
      width: 720, height: 560, resizable: true, minimizable: false, // v0.8.7：内容更多，窗口加大
      parent: getMainWindow(), modal: false, title: '提示词库', // modal:false —— 面板随时可点主窗口连续注入
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f4', // v0.9.9：跟随外观
      webPreferences: secureWebPreferences(),
    });
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'promptlib.html'));
    win.on('closed', () => { setPromptLibWin(null); });
    setPromptLibWin(win);
  }

  /** v0.9.12：全局记忆窗口 —— 基础设定图形化编辑（~/.dsh/AGENTS.md，DSH 自动读取）。
   *  modal:false 便于对照主窗口；表单区块级写回，不破坏用户其他记忆内容。 */
  function openGlobalMemoryWindow() {
    if (getGlobalMemoryWin() && !getGlobalMemoryWin().isDestroyed()) { getGlobalMemoryWin().focus(); return; }
    const win = new BrowserWindow({
      width: 560, height: 640, resizable: true, minimizable: false,
      parent: getMainWindow(), modal: false, title: '全局记忆',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f4', // v0.9.9：跟随外观
      webPreferences: secureWebPreferences(),
    });
    win.loadFile(path.join(app.getAppPath(), 'renderer', 'global-memory.html'));
    win.on('closed', () => { setGlobalMemoryWin(null); });
    setGlobalMemoryWin(win);
  }

  /** 关闭行为询问弹窗（v0.6.1 T-027 → v0.7.10 改原生）：退出 / 关闭到托盘 + 记住我的选择。
   *  老大要求：和恢复数据弹窗一样用 Windows 原生对话框，不做深色美化。 */
  function openCloseChoiceWindow(parentWin) {
    dialog.showMessageBox(parentWin, {
      type: 'question',
      title: appName,
      message: '关闭 DSH-Desktop？',
      detail: '关闭到托盘 —— 窗口隐藏，DSH 服务继续后台运行\n退出 —— 停止 DSH 服务并退出应用',
      buttons: ['关闭到托盘', '退出'],
      defaultId: 0, cancelId: 1, noLink: true,
      checkboxLabel: '记住我的选择，下次不再询问',
      checkboxChecked: false,
    }).then(({ response, checkboxChecked }) => {
      if (response === 0) {
        // 关闭到托盘
        if (checkboxChecked) setCloseChoice('tray', true);
        appendLog('info', '用户选择关闭到托盘');
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      } else {
        // 退出
        if (checkboxChecked) setCloseChoice('quit', true);
        appendLog('info', '用户选择退出（关闭窗口）');
        setQuitting(true);
        app.quit();
      }
    }).catch(() => { /* ignore */ });
  }

  // ── 备份进度窗口（v0.7.10 老大反馈：极简原生风格；v0.8.23 老大要求弹窗统一外观，
  //    接入 shared.css 深色主题 + backgroundColor 与其他弹窗一致）──
  let backupProgressWin = null;

  /** 打开备份进度窗口（幂等：已存在则复用） */
  function openBackupProgress() {
    if (backupProgressWin && !backupProgressWin.isDestroyed()) { backupProgressWin.show(); return; }
    backupProgressWin = new BrowserWindow({
      width: 360, height: 110, resizable: false, minimizable: false, maximizable: false,
      parent: getMainWindow(), modal: false, title: '备份数据',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f4', // v0.9.9：跟随外观
      webPreferences: secureWebPreferences(),
    });
    backupProgressWin.loadFile(path.join(app.getAppPath(), 'renderer', 'progress.html'));
    backupProgressWin.on('closed', () => { backupProgressWin = null; });
  }

  /**
   * 更新备份进度。
   * @param {number} percent 0~100（100 = 完成）
   * @param {string} text 状态文字
   */
  function updateBackupProgress(percent, text) {
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    if (backupProgressWin && !backupProgressWin.isDestroyed()) {
      backupProgressWin.webContents.executeJavaScript(`
        const bar = document.getElementById('bar');
        if (bar) bar.value = ${pct};
        const t = document.getElementById('text');
        if (t) t.textContent = ${JSON.stringify(String(text || ''))};
      `).catch(() => { /* ignore */ });
    }
    // 主窗口任务栏进度（完成/关闭时 -1 清除）
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.setProgressBar(pct >= 100 ? -1 : pct / 100); } catch { /* ignore */ }
    }
  }

  /** 关闭备份进度窗口（清除任务栏进度） */
  function closeBackupProgress() {
    if (backupProgressWin && !backupProgressWin.isDestroyed()) backupProgressWin.close();
    backupProgressWin = null;
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.setProgressBar(-1); } catch { /* ignore */ }
    }
  }

  return {
    openChangelogWindow,
    openNoticeWindow,
    hasNewNotices,
    openPromptLibWindow,
    openGlobalMemoryWindow, // v0.9.12
    openCloseChoiceWindow,
    openBackupProgress,
    updateBackupProgress,
    closeBackupProgress,
  };
}

module.exports = { createMiscWindowsModule };
