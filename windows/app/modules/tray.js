'use strict';

/**
 * DSH-Desktop — 系统托盘模块（v0.8.1 T5 从 main.js 抽出，纯搬移不改变行为）
 *
 * 托盘图标/菜单自包含；tray 与 trayExitConfirmed 状态收敛在本模块内部。
 * main.js 仅经 refreshMenus 调用 updateTrayMenu（isTrayCreated 判断是否已建）。
 *
 * 依赖注入说明（deps 字段）：
 *   - app / dialog / Menu / Tray / fs / path   Electron 与 Node 模块
 *   - appendLog          日志函数
 *   - APP_NAME           应用名（弹窗标题）
 *   - getSettings        当前设置对象（getter）
 *   - setAutostart       设置开机自启（托盘菜单勾选）
 *   - showMainWindow     恢复主窗口（托盘点击/双击）
 *   - openUpdateWindow   打开更新窗口（托盘菜单）
 *   - readShellConfig    读取壳配置（DSH 版本显示）
 *   - installedDshVersion 已安装 DSH 版本（未安装返回 null）
 *   - getMainWindow      主窗口（getter；弹窗 owner）
 *   - getIsQuitting / setIsQuitting   真正退出标志（getter/setter）
 */

function createTrayModule(deps) {
  const {
    app, dialog, Menu, Tray, fs, path,
    appendLog, APP_NAME,
    getSettings, setAutostart, showMainWindow, openUpdateWindow,
    readShellConfig, installedDshVersion,
    getMainWindow, getIsQuitting, setIsQuitting,
  } = deps;

  let tray = null;                // 托盘图标
  let trayExitConfirmed = false;  // 本会话首次托盘「退出」弹确认；取消后重置

  function createTray() {
    if (tray) return;
    // T1（v0.6.6）：托盘用多尺寸 ICO（16-256 内置，v0.5.5 产物），高 DPI 清晰；PNG 兜底
    const candidates = [
      path.join(app.getAppPath(), 'assets', 'icon.ico'),
      path.join(app.getAppPath(), 'assets', 'icon.png'),
    ];
    const iconPath = candidates.find((p) => fs.existsSync(p));
    if (!iconPath) {
      appendLog('warn', '托盘图标缺失（icon.ico/icon.png 均不存在），托盘不创建');
      return;
    }
    tray = new Tray(iconPath);
    tray.setToolTip('DSH-Desktop');
    updateTrayMenu();
    // 单击/双击恢复主窗口（Windows 下已设右键菜单，左键单击仍触发 click）
    tray.on('click', () => showMainWindow());
    tray.on('double-click', () => showMainWindow());
    appendLog('info', '系统托盘已就绪（关闭窗口 = 最小化到托盘，托盘菜单可退出）');
  }

  function updateTrayMenu() {
    if (!tray) return;
    // v0.7.10（29 建议 C）：托盘菜单显示 DSH 运行时版本（只读，用户一眼看到版本）
    const dshVer = installedDshVersion() ?? readShellConfig().dshVersion;
    const ctx = Menu.buildFromTemplate([
      { label: '打开主界面', click: () => showMainWindow() },
      { label: '远程连接（即将推出）', enabled: false }, // 占位（v0.6.0 暂未实现）
      { type: 'separator' },
      {
        label: `DSH ${dshVer}`,
        enabled: false,
      },
      {
        label: '开机自启',
        type: 'checkbox',
        checked: getSettings().autostart,
        click: (item) => setAutostart(item.checked),
      },
      { type: 'separator' },
      { label: '检查更新…', click: () => openUpdateWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          // 首次托盘退出弹确认；确认过（或取消过）后按状态处理
          if (!trayExitConfirmed) {
            trayExitConfirmed = true;
            // T3（v0.6.6）：带 owner 弹窗 —— 托盘场景主窗口常隐藏，无 owner 可能不置顶
            const owner = getMainWindow();
            dialog.showMessageBox(owner && !owner.isDestroyed() ? owner : undefined, {
              type: 'question',
              title: APP_NAME,
              message: '确定退出？',
              detail: 'DSH 服务将停止。如需后台运行，请直接关闭窗口（最小化到托盘）。',
              buttons: ['退出', '取消'],
              defaultId: 1,
              cancelId: 1,
            }).then(({ response }) => {
              if (response === 0) {
                setIsQuitting(true);
                app.quit();
              } else {
                trayExitConfirmed = false; // 取消：下次再退出时重新确认
              }
            }).catch(() => { setIsQuitting(true); app.quit(); });
          } else {
            setIsQuitting(true);
            app.quit();
          }
        },
      },
    ]);
    tray.setContextMenu(ctx);
  }

  /** 托盘是否已创建（main.js refreshMenus 据此决定是否刷新托盘菜单） */
  function isTrayCreated() {
    return !!tray;
  }

  return { createTray, updateTrayMenu, isTrayCreated };
}

module.exports = { createTrayModule };
