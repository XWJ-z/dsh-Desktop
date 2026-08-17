'use strict';

/**
 * DSH-Desktop — 菜单模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：
 *  - buildMenu：应用菜单（文件/视图/设置/帮助/公告，Windows 惯例）
 *    v0.8.17：公告独立成一级菜单；v0.8.21：公告移到帮助菜单右边
 *  - refreshMenus：重建托盘菜单 + 应用菜单（设置变化后同步显示状态）
 *
 * 依赖注入（deps）：
 *  - Menu / shell / app / logPath / appendLog
 *  - getSettings                           设置读取（autostart/minimizeToTray/hotkey/...）
 *  - setAutostart / setMinimizeToTray / setCheckUpdateOnStart / clearCloseChoice / saveSettings
 *  - setHotkey                             hotkey 模块
 *  - backupUserData / restoreUserData      backup 模块
 *  - openUpdateWindow / openNoticeWindow / openChangelogWindow / openContactWindow / openAboutWindow
 *  - generateDiagnostics                   diagnostics 模块
 *  - resetWebOpenBtnLayout / injectPet     pet 模块
 *  - hasNewNotices                         misc-windows 模块
 *  - getMainWindow / getShellHasUpdate / getDshHasUpdate / getShellNotices
 *  - getMarquee                           notice 模块（v0.9.5 T3：菜单栏公告条）
 *  - isTrayCreated / updateTrayMenu        tray 模块
 */

function createMenu(deps) {
  const {
    Menu, shell, app, path,
    logPath,
    getSettings,
    setAutostart, setMinimizeToTray, setCheckUpdateOnStart, clearCloseChoice, saveSettings,
    setHotkey,
    backupUserData, restoreUserData,
    openUpdateWindow, openNoticeWindow, openChangelogWindow, openContactWindow, openAboutWindow,
    generateDiagnostics,
    // v0.8.16：injectPet 已移除（设置菜单「显示桌面宠物」删除，形态切换走宠物/工具箱菜单）
    resetWebOpenBtnLayout,
    openAppearanceDialog, // v0.8.18：设置菜单「外观…」（浅色/深色/跟随系统）
    hasNewNotices,
    getMainWindow, getShellHasUpdate, getDshHasUpdate, getShellNotices,
    getMarquee, // v0.9.5（T3）：公告条文案
    isTrayCreated, updateTrayMenu,
  } = deps;

  /** v0.9.5（T3.3）：公告条截断 —— 超 40 字符 → 前 37 + '…'（菜单栏宽度有限） */
  function truncateMarquee(s) {
    const t = String(s || '');
    return t.length > 40 ? `${t.slice(0, 37)}…` : t;
  }

  function buildMenu() {
    const settings = getSettings();
    const template = [
      {
        label: '文件',
        submenu: [
          // v0.8.17（老大指令）：「重新加载界面」移入视图菜单（视图类操作归视图）
          {
            label: '打开日志目录',
            click: () => { shell.openPath(path.dirname(logPath())); },
          },
          {
            label: '打开数据目录',
            click: () => { shell.openPath(app.getPath('userData')); },
          },
          { type: 'separator' },
          // v0.7.0（T2/T3）：数据备份 / 恢复（打包 ~/.dsh + 设置；恢复校验 manifest 后固定路径还原）
          { label: '备份数据…', click: () => backupUserData() },
          { label: '恢复数据…', click: () => restoreUserData() },
          { type: 'separator' },
          // v0.8.16（老大指令）：删除文件菜单「最小化到托盘」—— 与设置菜单「最小化到托盘」
          // 开关重复，功能入口统一在设置菜单
          { role: 'quit', label: '退出' },
        ],
      },
      {
        label: '视图',
        submenu: [
          // v0.8.17（老大指令）：重新加载界面从文件菜单移入（视图类操作）
          { label: '重新加载界面', accelerator: 'CmdOrCtrl+R', click: () => { const mw = getMainWindow(); if (mw) mw.reload(); } },
          { role: 'resetZoom', label: '实际大小' },
          { role: 'zoomIn', label: '放大' },
          { role: 'zoomOut', label: '缩小' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: '全屏' },
          // v0.7.7（T-038）/ v0.8.17：布局/显示控制归位视图菜单（Windows 惯例），
          // 恢复默认布局 = 宠物/工具箱回底部居中
          { label: '恢复默认布局', click: () => resetWebOpenBtnLayout() },
          { type: 'separator' },
          { label: '开发者工具', accelerator: 'F12', click: () => { const mw = getMainWindow(); if (mw) mw.webContents.toggleDevTools(); } },
        ],
      },
      // v0.6.1（T-027）：设置菜单
      // v0.8.22（老大反馈：不协调）：重新分组 —— 开关项一组 / 外观+快捷键一组 /
      // 清除记忆一组，分隔符由 4 个减到 2 个；「外观…」动态显示当前值。
      {
        label: '设置',
        submenu: [
          // ── 开关项 ──
          {
            label: '开机自启',
            type: 'checkbox',
            checked: settings.autostart,
            click: (item) => setAutostart(item.checked),
          },
          {
            label: '最小化到托盘',
            type: 'checkbox',
            checked: settings.minimizeToTray,
            click: (item) => setMinimizeToTray(item.checked),
          },
          {
            // v0.6.5（T-030）：启动时检查更新（默认开启）
            label: '启动时检查更新',
            type: 'checkbox',
            checked: settings.checkUpdateOnStart,
            click: (item) => setCheckUpdateOnStart(item.checked),
          },
          { type: 'separator' },
          // ── 外观 / 快捷键 ──
          // v0.8.18（老大指令）：外观 —— 弹窗选浅色/深色/跟随系统（nativeTheme.themeSource，
          // DSH 页面经 prefers-color-scheme 自动同步）；v0.8.21：仅用户主动选择时同步 DSH
          {
            label: '外观…' + (settings.appearance === 'light' ? '（浅色）'
              : settings.appearance === 'dark' ? '（深色）' : '（跟随系统）'),
            click: () => openAppearanceDialog(),
          },
          // v0.8.1（T4）：快捷键子菜单 —— 呼出/隐藏主窗口（全局生效，默认 Ctrl+Alt+D）
          // 注意：radio 项必须连续（中间不能有 separator）—— Electron 按「同一父菜单下
          // 连续 radio 项」分组，separator 会打断分组导致「禁用」独立成组而永远显示选中。
          {
            label: '快捷键（呼出/隐藏主窗口）',
            submenu: [
              { label: 'Ctrl+Alt+D', type: 'radio', checked: settings.hotkey === 'Ctrl+Alt+D',
                click: () => setHotkey('Ctrl+Alt+D') },
              { label: 'Ctrl+Shift+D', type: 'radio', checked: settings.hotkey === 'Ctrl+Shift+D',
                click: () => setHotkey('Ctrl+Shift+D') },
              { label: 'Alt+Space', type: 'radio', checked: settings.hotkey === 'Alt+Space',
                click: () => setHotkey('Alt+Space') },
              { label: '禁用快捷键', type: 'radio', checked: !settings.hotkey,
                click: () => setHotkey(null) },
            ],
          },
          { type: 'separator' },
          // ── 清除记忆（重置"记住我的选择"）──
          {
            // 清除「记住我的选择」，关闭窗口时恢复询问
            label: '关闭时总是询问',
            enabled: settings.rememberCloseChoice,
            click: () => clearCloseChoice(),
          },
          {
            // v0.8.7（P0-3）：清除「提示词注入」的记忆选择，注入已有内容时恢复询问
            label: '提示词注入总是询问',
            enabled: !!settings.promptInjectChoice,
            click: () => {
              settings.promptInjectChoice = null;
              saveSettings();
              refreshMenus();
            },
          },
        ],
      },
      // v0.8.21（老大指令）：公告菜单移到帮助菜单右边（原在设置与帮助之间）
      // v0.6.4（T-029）：「帮助」菜单（原「关于我们」）—— 更新检查移入，符合 Windows 帮助区惯例
      {
        label: '帮助',
        submenu: [
          {
            label: `检查更新${getShellHasUpdate() || getDshHasUpdate() ? '（有新版本）' : ''}`,
            click: () => { openUpdateWindow(); },
          },
          { type: 'separator' },
          // v0.8.1（T3）：内置更新日志 —— 帮助菜单查看各版本更新内容（离线可用）
          { label: '更新日志…', click: () => openChangelogWindow() },
          { type: 'separator' },
          // v0.7.0（T1）：一键诊断报告 —— 环境信息 + 最近日志 + 配置（脱敏）→ 剪贴板 + 落盘
          { label: '生成诊断报告', click: () => generateDiagnostics() },
          { type: 'separator' },
          {
            label: '联系我们',
            click: () => { openContactWindow(); },
          },
          {
            label: '关于 DSH-Desktop',
            click: () => { openAboutWindow(); },
          },
          { type: 'separator' },
          {
            label: 'DeepSeek 官网',
            click: () => { shell.openExternal('https://www.deepseek.com'); },
          },
          {
            label: 'DSH-Desktop 项目主页',
            click: () => { shell.openExternal('https://github.com/XWJ-z/dsh-Desktop'); },
          },
        ],
      },
      // v0.8.17（老大指令）：公告独立成一级菜单（不再挂在帮助菜单下）
      {
        label: `公告${Array.isArray(getShellNotices()) && hasNewNotices(getShellNotices()) ? '（新）' : ''}`,
        submenu: [
          {
            // v0.8.11（T0.6）：公告 —— 远程拉取 + 本地已读；有新公告时菜单标「（新）」
            label: '查看公告',
            click: () => openNoticeWindow(),
          },
        ],
      },
      // v0.9.5（T3.3，老大确认：公告条最右端，公告菜单之后）：
      // 菜单栏常驻纯文字公告条（禁用态不可点），数据源 notice.json（独立下发，改内容不须发版）
      {
        label: '📢 ' + truncateMarquee(getMarquee()),
        enabled: false, // 纯文字展示，不可点
      },
    ];
    return Menu.buildFromTemplate(template);
  }

  /** 重建托盘菜单 + 应用菜单（设置变化后同步显示状态） */
  function refreshMenus() {
    if (isTrayCreated()) updateTrayMenu();
    Menu.setApplicationMenu(buildMenu());
  }

  return { buildMenu, refreshMenus };
}

module.exports = { createMenu };
