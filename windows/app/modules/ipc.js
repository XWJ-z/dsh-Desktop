'use strict';

/**
 * DSH-Desktop — IPC 集中注册模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：所有 ipcMain.handle 集中注册（窗口数据/提示词注入/更新/设置/宠物/公告…）。
 *
 * 依赖注入（deps）：main.js whenReady 时调用 registerIpc(deps)，全部业务函数经
 * deps 注入，不直接引用 main.js 全局。
 */

function registerIpc(deps) {
  const {
    ipcMain, app, clipboard, shell, dialog, path, fs,
    localDate, appName,
    readShellConfig, installedDshVersion,
    fetchLatestDshVersion, fetchLatestShellVersion, compareSemver, effectiveLatest,
    queryUpdateInfo, upgradeDshVersion, downloadShellUpdate,
    getMainWindow, getUpdateWin, getAboutWin,
    getSettings, saveSettings, refreshMenus, getShellNotices,
    openPromptLibWindow, openUpdateWindow, getWebUrl,
  } = deps;

  ipcMain.handle('dsh:version', () => app.getVersion());
  ipcMain.handle('dsh:installed-dsh-version', () => installedDshVersion());
  ipcMain.handle('dsh:port', () => deps.getResolvedPort());
  ipcMain.handle('dsh:stage', () => deps.getCurrentStage()); // L6：页面就绪后查询当前阶段
  // v0.7.5（T-036）/ v0.7.6（T-037）：网页打开按钮拖拽位置上报（立即落盘 + 退出时 saveSettings 双保险）
  ipcMain.handle('web-open-btn:pos', (_e, pos) => {
    const settings = getSettings();
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      settings.webOpenBtnPos = { x: pos.x, y: pos.y };
      saveSettings();
    }
    return true;
  });
  // v0.8.11（T0.6）：公告数据 —— 打开即标记已读（刷新菜单清「（新）」标记）
  ipcMain.handle('notice:data', () => {
    const notices = getShellNotices() || [];
    const settings = getSettings();
    const ids = (settings.readNotices || []).slice();
    let changed = false;
    for (const n of notices) {
      if (n.id && !ids.includes(n.id)) { ids.push(n.id); changed = true; }
    }
    if (changed) {
      settings.readNotices = ids;
      saveSettings();
      refreshMenus();
    }
    return { notices, current: app.getVersion() };
  });
  // v0.8.11（T5）/ v0.8.15：宠物隐藏状态（右键隐藏宠物 → 设置菜单勾选同步）
  // v0.8.15（真机修复）：隐藏/显示宠物由前端 injectPet 的 switchMode 同步切换形态
  // （即时生效，不依赖 IPC 往返）；本 handler 仅持久化 + 刷新菜单。
  // 注：did-finish-load / 设置菜单开关时按 petHidden 注入对应形态（含工具箱兜底入口）。
  ipcMain.handle('pet:hidden', (_e, v) => {
    getSettings().petHidden = !!v;
    saveSettings();
    refreshMenus();
    return true;
  });
  // v0.8.11（T5.3）：宠物气泡通知（提示词库降级复制后提示「复制好啦…」）
  ipcMain.handle('pet:notify', (_e, key) => {
    const texts = {
      copied: '复制好啦，去输入框粘贴吧（Ctrl+V）',
    };
    const text = texts[key];
    const mainWindow = getMainWindow();
    if (text && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        (() => {
          const p = document.getElementById('dsh-pet');
          if (!p || p.dataset.mode !== 'pet') return; // v0.8.16：工具箱形态无宠物气泡
          const b = p.querySelector('.pet-bubble');
          if (!b) return;
          b.textContent = ${JSON.stringify(text)};
          b.style.display = 'block';
          clearTimeout(p._bt);
          p._bt = setTimeout(() => { b.style.display = 'none'; }, 2200);
        })()
      `).catch(() => { /* ignore */ });
    }
    return true;
  });

  // v0.5.3：更新窗口 / 联系我们 IPC
  ipcMain.handle('update:query', () => queryUpdateInfo());
  // v0.8.1（T3）：更新日志窗口 —— 本地内置 CHANGELOG.json（离线可用）+ 当前版本
  ipcMain.handle('changelog:data', () => {
    try {
      const changelogData = require(path.join(app.getAppPath(), 'CHANGELOG.json'));
      return { versions: changelogData.versions || [], current: app.getVersion() };
    } catch {
      return { versions: [], current: app.getVersion() };
    }
  });
  // v0.8.3（T1/T4）：提示词库 —— 数据（内置 prompts.json）/ 注入输入框 / 工具箱入口
  ipcMain.handle('promptlib:data', () => {
    try {
      return require(path.join(app.getAppPath(), 'prompts.json')) || { categories: [] };
    } catch {
      return { categories: [] };
    }
  });
  ipcMain.handle('promptlib:inject', async (_e, text) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: 'no-window' };
    const payload = String(text ?? '');
    // v0.8.6（P0-2 修复）：注入两段式 —— ①聚焦输入框 ②主进程 insertText 模拟真实键盘输入。
    // 真机实测（2026-08-16，DSH web 0.1.0-rc.6）：
    //  - DSH 聊天输入框 = 透明辅助 TEXTAREA（color rgba(0,0,0,0)）+ 框架渲染层
    //    （overlay slot / mirror），非 CodeMirror/ProseMirror；
    //  - 直接赋 value + input 事件：value 虽保留但 React 状态不更新（发送按钮禁用、文字不可见）；
    //  - webContents.insertText：走真实输入路径，React 必然接收 → 文字注入 + 发送按钮变可点。
    // v0.8.7（P0-3）：输入框已有内容时弹原生对话框（覆盖/追加/取消 + 记住选择）。
    const focusRes = await mainWindow.webContents.executeJavaScript(`
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
        // 否则 insertText 会插入到错误位置。失败由前端降级为复制。
        if (document.activeElement !== el) return { ok: false, reason: 'focus-failed' };
        const current = (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')
          ? (el.value || '') : (el.textContent || '');
        return { ok: true, current };
      })()
    `).catch(() => ({ ok: false, reason: 'exec-error' }));
    if (!focusRes || !focusRes.ok) return focusRes;
    const current = focusRes.current || '';
    const settings = getSettings();
    // P0-3：输入框已有内容 → 询问覆盖/追加/取消（记住选择后不再询问；设置菜单可清除记忆）
    let mode;
    if (current.trim()) {
      if (settings.promptInjectChoice === 'overwrite') mode = 'overwrite';
      else if (settings.promptInjectChoice === 'append') mode = 'append';
      else {
        const choice = await dialog.showMessageBox(mainWindow, {
          type: 'question', title: appName,
          message: '输入框已有内容，怎么处理？',
          detail: '覆盖 —— 用提示词替换输入框现有内容\n追加 —— 接在现有内容后面继续输入\n取消 —— 不做任何修改',
          buttons: ['覆盖', '追加', '取消'], defaultId: 0, cancelId: 2, noLink: true,
          checkboxLabel: '记住我的选择，下次不再询问', checkboxChecked: false,
        }).catch(() => null);
        if (!choice || choice.response === 2) return { ok: false, reason: 'cancelled' };
        mode = choice.response === 0 ? 'overwrite' : 'append';
        if (choice.checkboxChecked) {
          settings.promptInjectChoice = mode;
          saveSettings();
          refreshMenus();
        }
      }
    } else {
      mode = 'overwrite'; // 空输入框：直接注入，不询问
    }
    // 第三步：按模式设置光标/选区（覆盖=全选待替换，追加=光标末尾），再 insertText
    await mainWindow.webContents.executeJavaScript(`
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
    mainWindow.webContents.insertText(payload);
    // v0.8.11（T4.3/T5.3）+ v0.8.16：注入成功 → 鲸鱼开心跳跃 + 气泡（仅宠物形态；
    // 工具箱形态静默 —— pet 元素 data-mode="pet" 才是宠物）。当天第 10 次注入触发庆祝彩蛋
    try {
      const today = localDate();
      if (settings.petInjectCountDate !== today) { settings.petInjectCountDate = today; settings.petInjectCount = 0; }
      settings.petInjectCount = (settings.petInjectCount || 0) + 1;
      saveSettings();
      const tenth = settings.petInjectCount === 10;
      const bubbleText = tenth ? '今天干得漂亮！🎉' : '搞定！去发送吧～';
      mainWindow.webContents.executeJavaScript(`
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
    return { ok: true, mode };
  });
  ipcMain.handle('toolbox:open-promptlib', () => { openPromptLibWindow(); return true; });
  ipcMain.handle('update:dsh-upgrade', () => upgradeDshVersion());
  ipcMain.handle('update:shell-download', () => {
    return downloadShellUpdate(getUpdateWin() || getMainWindow(), (percent) => {
      const updateWin = getUpdateWin();
      if (updateWin && !updateWin.isDestroyed()) {
        updateWin.webContents.send('update:progress', { percent });
      }
    });
  });
  ipcMain.handle('clip:copy', (_e, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });
  // 联系我们窗口：向渲染进程提供二维码路径与群号（文件路径经 IPC 传递最稳）
  ipcMain.handle('contact:info', () => {
    const group = readShellConfig().qqGroup;
    const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
    if (!group || !group.number) {
      return { number: '', qrPath: null, iconPath: fs.existsSync(iconPath) ? iconPath : null };
    }
    let qrPath = group.qrImage;
    if (qrPath && !path.isAbsolute(qrPath)) qrPath = path.join(app.getAppPath(), qrPath);
    return {
      number: group.number,
      qrPath: fs.existsSync(qrPath) ? qrPath : null,
      iconPath: fs.existsSync(iconPath) ? iconPath : null,
    };
  });
  // 关于窗口：版本信息 + 图标 + 动作
  ipcMain.handle('about:info', async () => {
    const cfg = readShellConfig();
    const [dshLatest, shellLatest] = await Promise.all([
      fetchLatestDshVersion(),
      fetchLatestShellVersion(),
    ]);
    const iconPath = path.join(app.getAppPath(), 'assets', 'icon.png');
    return {
      appVersion: app.getVersion(),
      dsh: `${cfg.dshPackage}@${installedDshVersion() ?? cfg.dshVersion}`,
      // T-028：latest ≤ current 时显示 current（防缓存旧版导致"降级"显示）
      dshLatest: dshLatest ? effectiveLatest(installedDshVersion() ?? cfg.dshVersion, dshLatest) : '未知',
      shellLatest: shellLatest ? effectiveLatest(app.getVersion(), shellLatest.version) : '未知',
      shellNewer: !!(shellLatest && compareSemver(app.getVersion(), shellLatest.version) < 0),
      url: getWebUrl(),
      iconPath: fs.existsSync(iconPath) ? iconPath : null,
    };
  });
  // 关于窗口动作：打开更新窗口（关闭关于）、打开外部链接
  ipcMain.handle('about:open-update', () => {
    const aboutWin = getAboutWin();
    if (aboutWin && !aboutWin.isDestroyed()) aboutWin.close();
    openUpdateWindow();
    return true;
  });
  ipcMain.handle('app:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:/i.test(url)) shell.openExternal(url);
    return true;
  });
}

module.exports = { registerIpc };
