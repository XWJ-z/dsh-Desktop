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
    ipcMain, app, clipboard, shell, dialog, path, fs, // dialog/appName：memory:save 覆盖确认弹窗
    appendLog, // v0.9.12：memory:save 异常记录
    readShellConfig, installedDshVersion,
    fetchLatestDshVersion, fetchLatestShellVersion, compareSemver, effectiveLatest,
    queryUpdateInfo, upgradeDshVersion, downloadShellUpdate,
    getMainWindow, getUpdateWin, getAboutWin,
    getSettings, saveSettings, refreshMenus,
    openPromptLibWindow, openUpdateWindow, getWebUrl,
    // v0.9：提示词注入公共链路 + 拖文件处理（drop:files）
    promptInject, handleDropFiles,
    // v0.9.5（T2）：自定义提示词 + （T3）公告条
    customPrompts, noticeApi,
    // v0.9.12（老大指令）：全局记忆（读写 ~/.dsh/AGENTS.md + 打开编辑窗口）
    globalMemory, openGlobalMemoryWindow, getGlobalMemoryWin,
    appName, // v0.9.12：覆盖确认弹窗标题
  } = deps;
  // P2-2（外审 zx(9)）：外部链接域名白名单 —— 渲染进程可达的 openExternal 一律过白名单
  const { isAllowedExternalUrl } = require('./external-links');

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
  // v0.9.5（T3.4）：公告唯一源改为 notice.json（noticeApi），不再读 version.json notices
  ipcMain.handle('notice:data', () => {
    const notices = noticeApi.getNotices() || [];
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
    // v0.9.7：附带完整 marquee —— 公告窗口顶部横幅显示全文（菜单栏公告条截断的内容这里看全）
    return { notices, current: app.getVersion(), marquee: noticeApi.getMarquee() };
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
  // P3-3（外审 zx(9)）：版本排序收敛到主进程 compareSemver（共享 modules/semver.js），
  // 渲染端 changelog.js 不再自行实现（此前忽略 -rc 预发布号，语义不一致）
  ipcMain.handle('changelog:data', () => {
    try {
      const changelogData = require(path.join(app.getAppPath(), 'CHANGELOG.json'));
      const versions = (changelogData.versions || []).slice()
        .sort((a, b) => (compareSemver(b.version, a.version) < 0 ? -1 : 1));
      return { versions, current: app.getVersion() };
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
  // v0.9：提示词注入链路抽到 modules/prompt-inject.js（v0.8.6 两段式：
  // ①聚焦输入框 ②主进程 insertText 模拟真实键盘输入；v0.8.7 P0-3 覆盖/追加
  // 询问 + 记住选择；v0.8.11 注入庆祝）。提示词库与拖文件（drop:files）共用，
  // 行为完全一致，此处仅做薄封装。
  ipcMain.handle('promptlib:inject', async (_e, text) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, reason: 'no-window' };
    return promptInject.injectTextIntoInput(mainWindow, text);
  });
  // v0.9.5（T2.2）：自定义提示词 —— 列表 / 保存（新增+更新）/ 删除
  ipcMain.handle('promptlib:custom-list', () => customPrompts.read());
  ipcMain.handle('promptlib:custom-save', (_e, item) => customPrompts.save(item));
  ipcMain.handle('promptlib:custom-delete', (_e, id) => customPrompts.remove(String(id || '')));
  // v0.9（T4）：拖文件 → 复制进工作区 + 注入提示词（处理逻辑见 drop-files 模块）
  ipcMain.handle('drop:files', (_e, paths) => handleDropFiles(paths));
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
  // v0.9.12（老大指令）：全局记忆 —— 读写 ~/.dsh/AGENTS.md（DSH 自动读取），
  // 图形化编辑：基础设定字段列表 + 自动识别所有 ## 区块长文本编辑
  ipcMain.handle('memory:open-window', () => { openGlobalMemoryWindow(); return true; });
  ipcMain.handle('memory:data', () => globalMemory.data());
  ipcMain.handle('memory:save', async (_e, payload) => {
    try {
      // 覆盖确认（老大指令）：文件已存在 → 弹窗确认后才写盘
      const existing = globalMemory.data();
      if (existing && existing.exists) {
        const owner = getGlobalMemoryWin && getGlobalMemoryWin() && !getGlobalMemoryWin().isDestroyed()
          ? getGlobalMemoryWin()
          : (getMainWindow() && !getMainWindow().isDestroyed() ? getMainWindow() : undefined);
        const { response } = await dialog.showMessageBox(owner, {
          type: 'warning',
          title: appName,
          message: '将覆盖已有全局记忆内容？',
          detail: '保存会用当前表单/区块内容覆盖 ~/.dsh/AGENTS.md 中展示的内容（其余未展示部分保持不变）。',
          buttons: ['保存', '取消'],
          defaultId: 0, cancelId: 1, noLink: true, // defaultId=保存（老大反馈：误按取消导致没写入）
        });
        if (response !== 0) return { ok: false, reason: 'cancelled' };
      }
      return globalMemory.save(payload || {});
    } catch (err) {
      // v0.9.12（老大反馈：点保存一直"保存中"）：handler 绝不 reject ——
      // 之前 dialog 未解构抛 TypeError 导致 IPC reject，前端 await 无 catch 卡死按钮
      appendLog('error', `保存全局记忆异常：${err.message}`);
      return { ok: false, message: err.message };
    }
  });
  ipcMain.handle('memory:open-folder', () => {
    shell.openPath(path.dirname(globalMemory.file()));
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
  // P2-2（外审 zx(9)）：外部链接白名单 —— 渲染进程可达，仅放行白名单域名
  // （github.com / deepseek.com / qq.com 及子域），防 DSH 页面注入恶意链接钓鱼
  ipcMain.handle('app:open-external', (_e, url) => {
    if (isAllowedExternalUrl(url)) shell.openExternal(url);
    return true;
  });
}

module.exports = { registerIpc };
