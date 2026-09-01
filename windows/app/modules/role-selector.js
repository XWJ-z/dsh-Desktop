'use strict';

/**
 * DSH-Desktop — 角色选择模块（v0.9.15 用户指令）
 *
 * v0.9.15（用户：全局记忆加提示「双击对话框选择角色，默认角色 1」+ 新建对话不再提示）：
 *  - **移除新对话弹窗**：不再轮询 DSH 会话切换、不再在新建对话时弹角色选择
 *    （用户：新建对话就不提示了）—— 角色切换改由**双击 DSH 输入框**随时触发；
 *  - **双击重选**：DSH 主页面双击聊天输入框 → 主进程弹角色选择 →
 *    注入「本次对话角色为 xxxx，角色定义文件为 xxxx」（选错角色不用重开新对话）；
 *  - 未配置任何角色 → 不弹窗（方案 3）。
 *
 * 依赖注入（deps）：
 *  - dialog / appName          Electron 对话框
 *  - appendLog                 日志模块
 *  - getMainWindow             主窗口 getter
 *  - getRoles                  读取已配置角色 [{ name, value }]（global-memory data）
 *  - roleFilePath              角色文件路径（global-memory roleFile）
 *  - injectText                注入函数（promptInject.injectTextIntoInput）
 *  - openRolePicker            v1.0.3：角色选择竖排窗口（modules/role-picker.js，
 *                              晚绑定 —— role-picker 模块组装晚于本模块）
 */

function createRoleSelector(deps) {
  const {
    dialog, appName, appendLog,
    getMainWindow, getRoles, roleFilePath, injectText,
    openRolePicker, // v1.0.3（用户反馈 3）：竖排列表选择
    focusRolePicker, // v1.2.8：弹出后再双击 → 置顶已有选择窗口
  } = deps;

  // v1.2.8（用户反馈）：多次双击输入框会连开多个角色选择窗口 —— 加互斥锁：
  // 同一时间只允许一次「弹窗选角色」，已打开时再次触发改为置顶显示（不再新建窗口）。
  let pickerBusy = false;

  /** 当前是否有已配置角色（角色名非空） */
  function configuredRoles() {
    const roles = getRoles() || [];
    return roles.filter((r) => String(r.name || '').trim() !== '');
  }

  /** 弹窗选择角色；返回选中的 { name, value } 或 null（取消/无角色） */
  async function pickRole(roles) {
    // v1.0.3（用户反馈 3）：原生 MessageBox 按钮横排，角色名过长不美观 →
    // 改自定义竖排列表窗口（名称 + 定位摘要），取消/关闭返回 null
    if (openRolePicker) {
      const chosen = await openRolePicker(roles);
      if (!chosen) return null;
      return roles[chosen.index] || null;
    }
    // 兜底（未注入竖排窗口时退回原生弹窗，兼容旧依赖）
    const owner = getMainWindow();
    if (!owner || owner.isDestroyed()) return null;
    const buttons = roles.map((r) => r.name);
    const { response } = await dialog.showMessageBox(owner, {
      type: 'question',
      title: appName,
      message: '本次对话使用哪个角色？',
      detail: roles.map((r) => `${r.name}：${String(r.desc != null ? r.desc : (r.value || '')).split('（')[0]}`).join('\n'),
      buttons: [...buttons, '不选择'],
      defaultId: 0, cancelId: buttons.length, noLink: true,
    });
    if (response == null || response >= buttons.length) return null;
    return roles[response];
  }

  /**
   * 弹窗选角色 + 注入（双击 DSH 输入框触发；v0.9.13 用户反馈：选错角色不用重开新对话）。
   * @returns {{ ok: boolean, name?: string, reason?: string }}
   */
  async function pickAndInject() {
    if (pickerBusy) {
      if (focusRolePicker) focusRolePicker(); // v1.2.8：已有选择窗口 → 置顶显示
      return { ok: false, reason: 'busy' };
    }
    const roles = configuredRoles();
    if (roles.length === 0) return { ok: false, reason: 'no-roles' }; // 未配置角色不弹
    pickerBusy = true;
    try {
      const chosen = await pickRole(roles);
      if (!chosen) return { ok: false, reason: 'cancelled' };
      const name = String(chosen.name).trim();
      const filePath = roleFilePath ? roleFilePath(name) : null;
      const text = `本次对话角色为 ${name}${filePath ? `，角色定义文件为 ${filePath}` : ''}`;
      const mw = getMainWindow();
      if (mw && !mw.isDestroyed()) {
        injectText(mw, text, { celebrate: false }).catch(() => { /* ignore */ });
        appendLog('info', `已选择角色：${name}（${filePath || '无文件'}）`);
      }
      return { ok: true, name };
    } finally {
      pickerBusy = false;
    }
  }

  /**
   * 注入「双击输入框重选角色」监听（v0.9.13 用户反馈；v0.9.15 起为唯一入口）：
   * DSH 主页面双击聊天输入框 → 通知主进程弹角色选择（选错角色不用重开新对话）。
   * 幂等：同一页面生命周期只注入一次。
   */
  function injectDblclick(win) {
    if (!win || win.isDestroyed()) return;
    win.webContents.executeJavaScript(`
      (() => {
        if (window.__dshRoleDblclick) return;
        window.__dshRoleDblclick = true;
        document.addEventListener('dblclick', (e) => {
          const t = e.target;
          const isInput = t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable);
          if (!isInput) return;
          if (window.dshDesktop && window.dshDesktop.chooseRole) window.dshDesktop.chooseRole();
        });
      })()
    `).catch(() => { /* ignore */ });
  }

  return { configuredRoles, pickAndInject, injectDblclick };
}

module.exports = { createRoleSelector };
