'use strict';

/**
 * DSH-Desktop — 角色选择窗口模块（v1.0.3，用户反馈 3）
 *
 * 背景：v0.9.15 起双击 DSH 输入框重选角色，原实现用 dialog.showMessageBox 的
 * 按钮列表 —— Windows 原生按钮**横排**，角色名称过长时选项被拉得很长不美观。
 * 本模块改为自定义窗口**竖排列表**：每个角色一行（v1.2.8 起仅角色名，
 * 不再显示灰色定位摘要），样式跟随深浅色，窗口高度随角色数量自适应；
 * 弹出后再双击输入框 → 置顶显示（v1.2.8，见 focusRolePicker）。
 *
 * 依赖注入（deps）：
 *  - BrowserWindow / app / path / nativeTheme / ipcMain
 *  - secureWebPreferences   安全基线（modules/security.js）
 *
 * IPC 协议：
 *  - renderer → main：`role-picker:select`（send，参数 = 角色在列表中的 index）
 *  - 每个窗口实例用 ipcMain.once 监听（窗口关闭时移除监听并 resolve null）
 */

function createRolePicker(deps) {
  const { BrowserWindow, app, path, nativeTheme, ipcMain, secureWebPreferences } = deps;

  /** 当前已打开的角色选择窗口（v1.2.8：再次双击置顶，不再重复新建） */
  let activeWin = null;

  /**
   * 把已打开的角色选择窗口置顶/聚焦到前台；未打开返回 false。
   * v1.2.8（用户反馈：弹出后再双击要顶置显示）。
   */
  function focusRolePicker() {
    if (!activeWin || activeWin.isDestroyed()) return false;
    try {
      if (activeWin.isMinimized()) activeWin.restore();
      activeWin.show();
      activeWin.focus();
      return true;
    } catch {
      /* ignore */ return false;
    }
  }

  /**
   * 弹窗竖排选择角色；返回选中的角色对象（含 index/name/desc/value）或 null（取消）。
   * v1.2.8：已打开时再次调用 → 置顶现有窗口并返回 null（不新建、不重复注入）。
   * @param {Array} roles 角色列表 [{ name, desc?, value? }]
   * @returns {Promise<{index:number,name:string,desc:string,value:string}|null>}
   */
  function openRolePicker(roles) {
    return new Promise((resolve) => {
      // v1.2.8（用户反馈）：已打开 → 置顶显示并复用
      if (activeWin && !activeWin.isDestroyed()) {
        focusRolePicker();
        resolve(null);
        return;
      }
      const list = (Array.isArray(roles) ? roles : [])
        .map((r, index) => ({
          index,
          name: String((r && r.name) || '').trim() || '（未命名角色）',
          desc: String((r && r.desc != null ? r.desc : (r && r.value)) || '').split('\n')[0].trim(),
          value: String((r && r.value) || ''),
        }))
        .filter((r) => r.name !== '（未命名角色）' || true); // 保留全部（空名也可选，主流程过滤）
      if (list.length === 0) { resolve(null); return; }

      let settled = false;
      const done = (result) => { if (!settled) { settled = true; resolve(result); } };

      const win = new BrowserWindow({
        // 高度随角色数量自适应（每行约 60px + 头尾留白），最多 560
        width: 460,
        height: Math.max(220, Math.min(560, 130 + list.length * 62)),
        resizable: false, minimizable: false, maximizable: false,
        parent: null, modal: false, title: '选择角色',
        autoHideMenuBar: true,
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#eef0f4',
        webPreferences: secureWebPreferences(),
      });
      activeWin = win; // v1.2.8：记录当前窗口，便于再次双击置顶
      // 选中后由 renderer 通知主进程；用 once 只收本窗口这一次选择
      const onSelect = (_e, index) => {
        const chosen = list.find((r) => r.index === Number(index)) || null;
        done(chosen);
        if (win && !win.isDestroyed()) win.close();
      };
      ipcMain.on('role-picker:select', onSelect);
      win.on('closed', () => {
        ipcMain.removeListener('role-picker:select', onSelect);
        if (activeWin === win) activeWin = null;
        done(null); // 窗口关闭（取消）→ null
      });
      win.loadFile(path.join(app.getAppPath(), 'renderer', 'role-picker.html'));
      win.webContents.once('did-finish-load', () => {
        win.webContents.executeJavaScript(
          `window.__rolePickerInit && window.__rolePickerInit(${JSON.stringify(list)})`
        ).catch(() => { /* ignore */ });
      });
    });
  }

  return { openRolePicker, focusRolePicker };
}

module.exports = { createRolePicker };
