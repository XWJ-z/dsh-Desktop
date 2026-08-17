'use strict';

/**
 * DSH-Desktop — 主窗口模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：
 *  - attachWebDiagnostics：窗口加载/失败/崩溃/无响应的日志与恢复弹窗
 *  - isValidBounds：窗口记忆 bounds 有效性校验（防分辨率变化跑出屏幕）
 *  - createMainWindow：主窗口（1440×900 承载 DSH GUI，还原窗口状态记忆，宠物注入）
 *
 * 依赖注入（deps）：
 *  - BrowserWindow / app / dialog / shell / screen / path
 *  - appendLog / logPath                      日志模块
 *  - getSettings / saveSettings               设置（winBounds/winMaximized/minimizeToTray/closeChoice）
 *  - injectPet                                宠物模块
 *  - openCloseChoiceWindow                    misc-windows 模块（关闭行为询问）
 *  - getWebUrl / getIsQuitting / setMainWindow
 */

function createMainWindowModule(deps) {
  const {
    BrowserWindow, app, dialog, shell, screen, path,
    appendLog, logPath, appName,
    getSettings, saveSettings,
    injectPet, openCloseChoiceWindow,
    injectDropHandler, // v0.9（T3）：拖拽文件入工作区监听
    getWebUrl, getIsQuitting, setQuitting, getMainWindow, setMainWindow,
  } = deps;

  function attachWebDiagnostics(win, label) {
    win.webContents.on('did-start-loading', () => {
      appendLog('info', `[${label}] 开始加载：${win.webContents.getURL()}`);
    });
    win.webContents.on('did-finish-load', () => {
      appendLog('info', `[${label}] 加载完成：${win.webContents.getURL()}`);
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      appendLog('error', `[${label}] 加载失败 (${errorCode}) ${errorDescription} @ ${validatedURL}`);
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      appendLog('error', `[${label}] 渲染进程退出：${JSON.stringify(details)}`);
      // 审查 M2：GUI 渲染进程崩溃/无响应时弹窗提示，给出重载入口
      if (label === 'gui' && !getIsQuitting()) {
        dialog.showMessageBox(win, {
          type: 'error',
          title: appName,
          message: '界面异常，请重新加载',
          detail: `渲染进程已退出（${details.reason}）。\n详细日志：${logPath()}`,
          buttons: ['重新加载', '退出'],
        }).then(({ response }) => {
          if (response === 0 && !win.isDestroyed()) {
            try { win.reload(); } catch { /* ignore */ }
          } else {
            app.quit();
          }
        });
      }
    });
    win.on('unresponsive', () => {
      appendLog('warn', `[${label}] 窗口无响应`);
      if (label === 'gui' && !getIsQuitting()) {
        dialog.showMessageBox(win, {
          type: 'warning',
          title: appName,
          message: '界面无响应',
          detail: '窗口可能卡住了，可等待或重新加载。',
          buttons: ['等待', '重新加载'],
        }).then(({ response }) => {
          if (response === 1 && !win.isDestroyed()) {
            try { win.reload(); } catch { /* ignore */ }
          }
        });
      }
    });
  }

  /**
   * T5（v0.6.6）：窗口 bounds 有效性校验 —— 记忆的位置/大小须在任一屏幕可见区域内，
   * 防止分辨率变化/拔显示器导致窗口跑到屏幕外。
   */
  function isValidBounds(b) {
    if (!b || typeof b.x !== 'number' || typeof b.y !== 'number' ||
        typeof b.width !== 'number' || typeof b.height !== 'number') return false;
    if (b.width < 400 || b.height < 300) return false; // 过小丢弃
    return screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x < a.x + a.width && b.x + b.width > a.x &&
             b.y < a.y + a.height && b.y + b.height > a.y;
    });
  }

  /** 主窗口（1440×900，承载 DSH Web GUI）；GUI 加载期间显示过渡覆盖层（H2）；还原窗口状态记忆（T5） */
  function createMainWindow() {
    // T5（v0.6.6）：窗口状态记忆 —— 还原上次位置/大小/最大化
    const settings = getSettings();
    const b = settings.winBounds;
    const bounds = b && isValidBounds(b) ? b : { width: 1440, height: 900 };
    const win = new BrowserWindow({
      ...bounds,
      minWidth: 900,
      minHeight: 600,
      title: appName,
      icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
      backgroundColor: '#0f1115',
      show: false,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // v0.7.10（老大反馈）：托盘隐藏期间不禁用渲染节流 —— 隐藏时 WebContents
        // 被冻结，托盘恢复需重新绘制导致黑屏等待；关闭节流后恢复即时显示
        backgroundThrottling: false,
      },
    });
    win.once('ready-to-show', () => {
      if (settings.winMaximized && win.isMaximizable()) win.maximize();
      win.show();
    });
    setMainWindow(win);

    // GUI 加载过渡覆盖层：DSH 页面加载期间显示"正在加载界面…"，did-finish-load 后移除。
    // v0.7.10（老大反馈）：原 did-start-loading 注入时文档可能未就绪（executeJavaScript
    // 失败被吞 → 无提示黑屏）；改在 dom-ready（body 就绪）注入，成功率高。
    win.webContents.on('dom-ready', () => {
      win.webContents.executeJavaScript(`
        if (!document.getElementById('dsh-loading-overlay')) {
          const overlay = document.createElement('div');
          overlay.id = 'dsh-loading-overlay';
          overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:#0f1115;color:#dbe2f0;font-family:Segoe UI,Microsoft YaHei,sans-serif;font-size:16px;';
          overlay.textContent = '正在加载界面…';
          document.body.appendChild(overlay);
        }
      `).catch(() => { /* ignore */ });
    });
    win.webContents.on('did-finish-load', () => {
      appendLog('info', `[gui] 加载完成：${win.webContents.getURL()}`);
      // v0.8.19（老大反馈）：DSH 是 SPA，did-finish-load 时 React 可能尚未挂载，
      // 立即注入会被随后的 SPA 渲染清除（重开软件宠物/工具箱不出现）。
      // → 延迟 1s 首次注入。
      // v0.8.22：主进程 watchdog 每 3s 检查一次（兜底）。
      // v0.8.23（老大反馈：仍要点恢复默认布局才出现）：主注入改**页面内自愈**
      // （pet.js MutationObserver，SPA 清除/隐藏宠物立即重建）；watchdog 升级为
      // **可见性检查**（存在但不可见 = 残留节点，触发重注入），并保留为兜底。
      let petGuardTimer = null;
      const guardPet = () => {
        if (win.isDestroyed()) { if (petGuardTimer) { clearInterval(petGuardTimer); petGuardTimer = null; } return; }
        win.webContents.executeJavaScript(`
          (() => {
            const p = document.getElementById('dsh-pet');
            if (!p) return false;
            const r = p.getBoundingClientRect();
            return r.width > 0 && r.height > 0 &&
              r.right > -10 && r.bottom > -10 &&
              r.left < window.innerWidth + 10 && r.top < window.innerHeight + 10;
          })()
        `)
          .then((visible) => {
            if (win.isDestroyed()) return;
            if (!visible) {
              appendLog('warn', '[gui] 宠物/工具箱缺失或不可见，重新注入');
              injectPet(win);
            }
          })
          .catch(() => { /* ignore */ });
      };
      setTimeout(() => {
        if (win.isDestroyed()) return;
        injectPet(win);
        // v0.9（T3）：拖拽监听注入（window 级，SPA 重渲染不影响；幂等）
        if (injectDropHandler) injectDropHandler(win);
        if (petGuardTimer) clearInterval(petGuardTimer);
        petGuardTimer = setInterval(guardPet, 3000);
      }, 1000);
      win.on('closed', () => { if (petGuardTimer) { clearInterval(petGuardTimer); petGuardTimer = null; } });
    });
    attachWebDiagnostics(win, 'gui');

    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith(getWebUrl())) event.preventDefault();
    });
    // v0.6.1（T-027）：点 X 关闭行为 —— 退出 / 关闭到托盘（询问或按记忆执行）
    win.on('close', (event) => {
      // T5（v0.6.6）：保存窗口状态（真正退出/关闭时记忆；隐藏到托盘不覆盖 bounds）
      if (!win.isDestroyed() && !win.isMaximized()) {
        settings.winBounds = win.getBounds();
      }
      settings.winMaximized = !!(win.isMaximized());
      saveSettings();
      if (getIsQuitting()) return;                       // 真正退出（托盘退出/菜单退出/系统关机）不拦截
      if (!settings.minimizeToTray) return;              // 未启用托盘常驻：关闭即退出（window-all-closed 处理）
      if (settings.rememberCloseChoice) {
        if (settings.closeChoice === 'quit') { setQuitting(true); return; } // 记忆=退出：放行
        if (settings.closeChoice === 'tray') { event.preventDefault(); win.hide(); return; } // 记忆=托盘
      }
      // 未记住选择：弹窗询问
      event.preventDefault();
      openCloseChoiceWindow(win);
    });
    win.on('closed', () => { if (getMainWindow() === win) setMainWindow(null); });

    appendLog('info', `加载 DSH Web GUI：${getWebUrl()}`);
    win.loadURL(getWebUrl());
    return win;
  }

  return { attachWebDiagnostics, isValidBounds, createMainWindow };
}

module.exports = { createMainWindowModule };
