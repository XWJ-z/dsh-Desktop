'use strict';

/**
 * DSH-Desktop — 角色选择模块（v0.9.13 老大方案）
 *
 * 新对话时引导用户选择 DSH 角色：
 *  - AGENTS.md「DSH 角色」区块记录 角色名 → 定位（文件：~/.dsh/roles/<角色名>.md）；
 *  - 轮询 DSH 页面 localStorage `dsh.sessions.current`（会话 id），检测到**会话切换**
 *    （= 新对话/切到另一个会话）→ 若已配置角色 → 弹窗让用户选择角色；
 *  - 未配置任何角色 → 不弹窗（老大方案 3）；
 *  - 选定角色 → 向输入框注入「本次对话角色为 xxxx，角色定义文件为 xxxx」，
 *    DSH 据此读取角色文件内容扮演（老大方案 4）；详细记忆在角色文件里，AGENTS.md 不膨胀。
 *
 * 依赖注入（deps）：
 *  - dialog / appName          Electron 对话框
 *  - appendLog                 日志模块
 *  - getMainWindow             主窗口 getter
 *  - getRoles                  读取已配置角色 [{ name, value }]（global-memory data）
 *  - injectText                注入函数（promptInject.injectTextIntoInput）
 *  - currentSessionIdFromPage  读 DSH 当前会话 id（workspace 模块）
 *  - pollMs                    轮询间隔（默认 2500ms）
 */

function createRoleSelector(deps) {
  const {
    dialog, appName, appendLog,
    getMainWindow, getRoles, injectText, currentSessionIdFromPage,
    pollMs = 2500,
  } = deps;

  let timer = null;
  let lastSessionId = null;

  /** 当前是否有已配置角色（角色名非空） */
  function configuredRoles() {
    const roles = getRoles() || [];
    return roles.filter((r) => String(r.name || '').trim() !== '');
  }

  /** 弹窗选择角色；返回选中的 { name, value } 或 null（取消/无角色） */
  async function pickRole(roles) {
    const owner = getMainWindow();
    if (!owner || owner.isDestroyed()) return null;
    const buttons = roles.map((r) => r.name);
    const { response } = await dialog.showMessageBox(owner, {
      type: 'question',
      title: appName,
      message: '本次对话使用哪个角色？',
      detail: roles.map((r) => `${r.name}：${String(r.value || '').split('（')[0]}`).join('\n'),
      buttons: [...buttons, '不选择'],
      defaultId: 0, cancelId: buttons.length, noLink: true,
    });
    if (response == null || response >= buttons.length) return null;
    return roles[response];
  }

  /** 会话切换处理：弹窗选角色 → 注入提示词 */
  async function onSessionChanged() {
    const roles = configuredRoles();
    if (roles.length === 0) return; // 未配置角色：不弹窗（老大方案 3）
    await pickAndInject();
  }

  /**
   * 弹窗选角色 + 注入（v0.9.13 老大反馈：选错角色只能重开新对话 → 双击输入框可重选）。
   * @returns {{ ok: boolean, name?: string, reason?: string }}
   */
  async function pickAndInject() {
    const roles = configuredRoles();
    if (roles.length === 0) return { ok: false, reason: 'no-roles' }; // 未配置角色不弹
    const chosen = await pickRole(roles);
    if (!chosen) return { ok: false, reason: 'cancelled' };
    const name = String(chosen.name).trim();
    const filePath = deps.roleFilePath ? deps.roleFilePath(name) : null;
    const text = `本次对话角色为 ${name}${filePath ? `，角色定义文件为 ${filePath}` : ''}`;
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) {
      injectText(mw, text, { celebrate: false }).catch(() => { /* ignore */ });
      appendLog('info', `已为新对话选择角色：${name}（${filePath || '无文件'}）`);
    }
    return { ok: true, name };
  }

  /**
   * 注入「双击输入框重选角色」监听（v0.9.13 老大反馈）：
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

  /** 开始轮询（幂等）：检测 DSH 会话切换 */
  function start() {
    if (timer) return;
    timer = setInterval(async () => {
      const mw = getMainWindow();
      if (!mw || mw.isDestroyed()) return;
      const sid = await currentSessionIdFromPage(mw).catch(() => null);
      if (sid == null) return;
      if (lastSessionId === null) {
        lastSessionId = sid; // 首次记录基线，不弹窗
        return;
      }
      if (sid !== lastSessionId) {
        lastSessionId = sid;
        onSessionChanged();
      }
    }, pollMs);
    appendLog('info', `角色选择轮询已启动（每 ${pollMs / 1000}s 检测会话切换）`);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  return { start, stop, configuredRoles, onSessionChanged, pickAndInject, injectDblclick };
}

module.exports = { createRoleSelector };
