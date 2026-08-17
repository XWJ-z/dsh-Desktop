'use strict';

/**
 * DSH-Desktop — 提示词注入公共模块（v0.9：从 ipc.js promptlib:inject 抽取）
 *
 * 职责：把一段文本注入 DSH 主窗口输入框（v0.8.6 两段式：①聚焦输入框
 * ②主进程 insertText 模拟真实键盘输入）。提示词库（promptlib:inject）与
 * 拖文件（drop:files）共用本模块，行为完全一致。
 *
 * 真机实测背景（2026-08-16，DSH web 0.1.0-rc.6）：
 *  - DSH 聊天输入框 = 透明辅助 TEXTAREA + 框架渲染层；
 *  - 直接赋 value + input 事件：React 状态不更新（发送按钮禁用）；
 *  - webContents.insertText 走真实输入路径，React 必然接收。
 *
 * 依赖注入（deps）：
 *  - dialog / appName           Electron 对话框与应用名
 *  - getSettings / saveSettings / refreshMenus   设置（promptInjectChoice 记忆）
 *  - localDate                  日志模块（注入次数统计日期）
 */

function createPromptInject(deps) {
  const { dialog, appName, getSettings, saveSettings, refreshMenus, localDate } = deps;

  /** ①聚焦输入框，返回 { ok, current? }；失败返回 { ok:false, reason } */
  async function focusInput(win) {
    return win.webContents.executeJavaScript(`
      (() => {
        // 多选择器探测输入框（可见的才用）；'textarea' 放最前（DSH 实测主输入框即 textarea）
        const selectors = ['textarea', '[contenteditable="true"]', 'div[role="textbox"]',
                           'input[type="text"]', '[data-testid*="input"]'];
        let el = null;
        for (const sel of selectors) {
          const found = document.querySelector(sel);
          if (found && found.offsetParent !== null) { el = found; break; }
        }
        if (!el) return { ok: false, reason: 'not-found' };
        el.focus();
        // 聚焦可能被模态弹窗（内测声明/API Key 对话框）拦截：必须确认焦点到位，
        // 否则 insertText 会插入到错误位置。失败由调用方降级处理。
        if (document.activeElement !== el) return { ok: false, reason: 'focus-failed' };
        const current = (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')
          ? (el.value || '') : (el.textContent || '');
        return { ok: true, current };
      })()
    `).catch(() => ({ ok: false, reason: 'exec-error' }));
  }

  /** 输入框已有内容时的处理模式（覆盖/追加/取消 + 记住选择；空框直接覆盖） */
  async function resolveInjectMode(win, current) {
    if (!current.trim()) return { mode: 'overwrite' }; // 空输入框：直接注入，不询问
    const settings = getSettings();
    if (settings.promptInjectChoice === 'overwrite') return { mode: 'overwrite' };
    if (settings.promptInjectChoice === 'append') return { mode: 'append' };
    const choice = await dialog.showMessageBox(win, {
      type: 'question', title: appName,
      message: '输入框已有内容，怎么处理？',
      detail: '覆盖 —— 用新内容替换输入框现有内容\n追加 —— 接在现有内容后面继续输入\n取消 —— 不做任何修改',
      buttons: ['覆盖', '追加', '取消'], defaultId: 0, cancelId: 2, noLink: true,
      checkboxLabel: '记住我的选择，下次不再询问', checkboxChecked: false,
    }).catch(() => null);
    if (!choice || choice.response === 2) return { cancelled: true };
    const mode = choice.response === 0 ? 'overwrite' : 'append';
    if (choice.checkboxChecked) {
      settings.promptInjectChoice = mode;
      saveSettings();
      refreshMenus();
    }
    return { mode };
  }

  /** ③按模式设置光标/选区（覆盖=全选待替换，追加=光标末尾），再 insertText */
  async function insertIntoInput(win, text, mode) {
    await win.webContents.executeJavaScript(`
      (() => {
        const el = document.activeElement;
        if (!el) return;
        const isInput = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';
        if (${mode === 'overwrite'}) {
          if (isInput) el.setSelectionRange(0, el.value.length);
          else { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
        } else if (isInput) {
          el.setSelectionRange(el.value.length, el.value.length);
        }
      })()
    `).catch(() => { /* ignore */ });
    // 主进程原生模拟输入（等同真实键盘输入，任何框架都必然接收；替换当前选区）
    win.webContents.insertText(text);
  }

  /** ④注入成功庆祝：鲸鱼开心跳跃 + 气泡（v0.8.11 T4.3/T5.3 + v0.8.16 工具箱静默） */
  function celebrateInject(win) {
    const settings = getSettings();
    try {
      const today = localDate();
      if (settings.petInjectCountDate !== today) { settings.petInjectCountDate = today; settings.petInjectCount = 0; }
      settings.petInjectCount = (settings.petInjectCount || 0) + 1;
      saveSettings();
      const tenth = settings.petInjectCount === 10;
      const bubbleText = tenth ? '今天干得漂亮！🎉' : '搞定！去发送吧～';
      win.webContents.executeJavaScript(`
        (() => {
          const p = document.getElementById('dsh-pet');
          if (!p || p.dataset.mode !== 'pet') return; // v0.8.16：工具箱形态不庆祝
          p.classList.add('happy');
          p.animate(
            [{ transform: 'translateY(0)' }, { transform: 'translateY(-18px)' },
             { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }],
            { duration: 600, easing: 'ease' });
          const b = p.querySelector('.pet-bubble');
          if (b) {
            b.textContent = ${JSON.stringify(bubbleText)};
            b.style.display = 'block';
            clearTimeout(p._bt);
            p._bt = setTimeout(() => { b.style.display = 'none'; }, 2000);
          }
          setTimeout(() => p.classList.remove('happy'), 2000);
        })()
      `).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  }

  /**
   * 完整注入：聚焦 → 决定模式 → insertText → 庆祝（可选）。
   * @param win 主窗口
   * @param text 要注入的文本
   * @param opts { celebrate?: boolean } 默认 true（提示词库）；拖文件传 false（走自己的气泡反馈）
   * @returns {Promise<{ok:boolean, reason?:string, mode?:string}>}
   */
  async function injectTextIntoInput(win, text, opts = {}) {
    if (!win || win.isDestroyed()) return { ok: false, reason: 'no-window' };
    const payload = String(text ?? '');
    const focusRes = await focusInput(win);
    if (!focusRes || !focusRes.ok) return focusRes;
    const resolved = await resolveInjectMode(win, focusRes.current || '');
    if (resolved.cancelled) return { ok: false, reason: 'cancelled' };
    await insertIntoInput(win, payload, resolved.mode);
    if (opts.celebrate !== false) celebrateInject(win);
    return { ok: true, mode: resolved.mode };
  }

  return { focusInput, resolveInjectMode, insertIntoInput, injectTextIntoInput };
}

module.exports = { createPromptInject };
