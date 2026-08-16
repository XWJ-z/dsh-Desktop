'use strict';

/**
 * DSH-Desktop — 数据备份 / 恢复模块（v0.7.10 从 main.js 抽出，29 改进意见 1：拆模块起步）
 *
 * 自包含函数，无全局状态依赖：运行时状态（主窗口/服务子进程/退出标志）经 deps
 * 注入（getter 形式，调用时实时取值），main.js 负责组装 deps 并调用。
 *
 * 依赖注入说明（deps 字段）：
 *   - appName           应用名（弹窗标题）
 *   - app / dialog / shell / fs / os / path / tar   Electron 与 Node 模块（tar 随包分发）
 *   - appendLog         日志函数
 *   - localTimestamp / localDate   本地时间戳 / 本地日期
 *   - readShellConfig   读取壳配置
 *   - installedDshVersion   已安装 DSH 版本（未安装返回 null）
 *   - settingsFile      设置文件路径（userData/settings.json）
 *   - getOwnerWindow    弹窗宿主窗口（getter；无主窗口返回 undefined）
 *   - isServerRunning   DSH 服务是否在运行（getter）
 *   - stopServerOnly    仅停止 DSH 服务（不退出应用），恢复数据前释放 ~/.dsh 占用
 *   - setQuitting       标记"真正退出"（恢复完成重启前调用）
 */

function createBackup(deps) {
  const {
    appName, app, dialog, shell, fs, os, path, tar,
    appendLog, localTimestamp, localDate,
    readShellConfig, installedDshVersion, settingsFile,
    getOwnerWindow, isServerRunning, stopServerOnly, setQuitting,
    openBackupProgress, updateBackupProgress, closeBackupProgress,
  } = deps;

  /**
   * 统计目录文件数/字节数（跳过符号链接，与备份复制规则一致）。
   * @returns {Promise<{files:number, bytes:number}>}
   */
  async function statTree(dir) {
    let files = 0, bytes = 0;
    const walk = async (d) => {
      let ents;
      try { ents = await fs.promises.readdir(d, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(d, e.name);
        try {
          const st = await fs.promises.lstat(p);
          if (st.isSymbolicLink()) continue; // 与 cp filter 一致：跳过符号链接
          if (st.isDirectory()) { await walk(p); }
          else if (st.isFile()) { files++; bytes += st.size; }
        } catch { /* ignore */ }
      }
    };
    await walk(dir);
    return { files, bytes };
  }

  /** T2（v0.7.0）：备份 DSH 用户数据 + 设置 → 用户选路径的 tar.gz
   *  v0.7.10（老大反馈）：加进度条 —— 进度窗口 + 主窗口任务栏；复制按字节、打包按文件数推进 */
  async function backupUserData() {
    const owner = getOwnerWindow();
    const { canceled, filePath } = await dialog.showSaveDialog(owner, {
      title: '备份 DSH 数据',
      defaultPath: path.join(app.getPath('documents'), `dsh-backup-${localDate()}.tar.gz`),
      filters: [{ name: '备份包', extensions: ['tar.gz'] }],
    });
    if (canceled || !filePath) return;

    const dshHome = path.join(os.homedir(), '.dsh');
    const settings = settingsFile();
    const hasDsh = fs.existsSync(dshHome);
    const hasSettings = fs.existsSync(settings);

    if (!hasDsh && !hasSettings) {
      dialog.showMessageBox(owner, {
        type: 'warning', title: appName,
        message: '没有可备份的数据',
        detail: '未找到 DSH 用户数据（~/.dsh）和设置文件。首次使用后再备份。',
        buttons: ['确定'], noLink: true,
      });
      return;
    }

    appendLog('info', `开始备份：~/.dsh=${hasDsh} settings=${hasSettings} → ${filePath}`);

    // v0.7.10：进度条（替代原「正在备份…」info 弹窗）
    openBackupProgress();
    updateBackupProgress(0, '正在准备备份…');

    // 暂存目录：把 .dsh / settings.json / manifest.json 统一归位到 tar 根，
    // 保证包内只有相对路径（portable，解包到任意机器路径一致）
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-backup-'));
    try {
      const entries = [];
      // 预统计总工作量（进度分母）
      let totalBytes = 0, totalFiles = 0;
      if (hasDsh) {
        const t = await statTree(dshHome);
        totalBytes = t.bytes; totalFiles = t.files;
      }
      const COPY_SHARE = 0.7; // 复制阶段占进度 0~70%，打包阶段 70~100%

      if (hasDsh) {
        // v0.7.10（老大反馈）：
        // ① fs.cpSync 同步复制大目录会阻塞主进程事件循环 → 窗口卡死未响应；
        //    改用异步 fs.promises.cp，复制期间 UI 保持响应；
        // ② ~/.dsh/profiles/node_modules 下是 Junction（目录联接，指向 dshenv
        //    运行时），cp 复制它们时重建符号链接需要 SeCreateSymbolicLinkPrivilege
        //    → 普通用户 EPERM 备份失败。filter 跳过符号链接：这些联接指向可重建
        //    的运行时（本就排除在备份外），DSH 启动时 healProfilesModuleFallback
        //    会自动重建，跳过安全且不膨胀备份体积。
        // ③ filter 内累计已复制字节数 → 进度（复制阶段 0~70%）
        let copiedBytes = 0;
        let lastReport = -1;
        const report = () => {
          const pct = totalBytes > 0 ? (copiedBytes / totalBytes) * COPY_SHARE * 100 : 0;
          if (pct - lastReport >= 1 || pct >= 100) { // 节流：每 ≥1% 更新一次
            lastReport = pct;
            updateBackupProgress(pct, `正在复制文件… ${Math.round(pct)}%`);
          }
        };
        await fs.promises.cp(dshHome, path.join(staging, '.dsh'), {
          recursive: true,
          filter: (src) => {
            try {
              const st = fs.lstatSync(src);
              if (st.isSymbolicLink()) return false;
              if (st.isFile()) { copiedBytes += st.size; report(); }
              return true;
            } catch { return true; }
          },
        });
        entries.push('.dsh');
      }
      if (hasSettings) {
        fs.copyFileSync(settings, path.join(staging, 'settings.json'));
        entries.push('settings.json');
      }
      // manifest 记录（恢复时校验格式用）
      const manifest = {
        format: 'dsh-backup-v1',
        appVersion: app.getVersion(),
        dshPackage: readShellConfig().dshPackage,
        dshVersion: installedDshVersion() ?? readShellConfig().dshVersion,
        backupTime: localTimestamp(),
        entries,
      };
      fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

      // 打包阶段（70~100%）：tar 的 onWriteEntry 每写入一个条目回调，按文件数推进
      const packTotal = totalFiles + entries.length + 1; // + manifest.json
      let packed = 0;
      updateBackupProgress(COPY_SHARE * 100, `正在打包… 0/${packTotal} 个文件`);
      await tar.create(
        {
          gzip: true, file: filePath, cwd: staging, portable: true,
          onWriteEntry: () => {
            packed++;
            const pct = COPY_SHARE * 100 + (packed / packTotal) * (1 - COPY_SHARE) * 100;
            updateBackupProgress(pct, `正在打包… ${packed}/${packTotal} 个文件`);
          },
        },
        ['manifest.json', ...entries],
      );

      updateBackupProgress(100, '备份完成');
      appendLog('info', `备份完成：${filePath}`);
      dialog.showMessageBox(owner, {
        type: 'info', title: appName,
        message: '备份完成',
        detail: `${filePath}\n\n包含：${entries.join('、')}`,
        buttons: ['打开所在目录', '关闭'],
        defaultId: 1, cancelId: 1, noLink: true,
      }).then(({ response }) => {
        if (response === 0) shell.openPath(path.dirname(filePath));
      }).catch(() => { /* ignore */ });
    } catch (err) {
      appendLog('error', `备份失败：${err.message}`);
      dialog.showErrorBox(appName, `备份失败：${err.message}`);
    } finally {
      // v0.7.10（老大反馈）：同步删除大暂存目录同样会阻塞主进程，改异步
      try { await fs.promises.rm(staging, { recursive: true, force: true }); } catch { /* ignore */ }
      // v0.7.10：关闭进度窗口，清除任务栏进度
      closeBackupProgress();
    }
  }

  /** T3（v0.7.0）：从备份包恢复 DSH 数据（固定路径映射，不信任包内路径；内容与抽模块前一致） */
  async function restoreUserData() {
    const owner = getOwnerWindow();

    // v0.7.1（T-032）/ v0.7.10（老大反馈）：恢复前服务占用检查。
    // 原先要求「先退出应用再恢复」——但壳重启会自动拉起 DSH 服务，形成死循环，
    // 永远无法恢复。v0.7.10 改为提供「停止服务并恢复」：只停 DSH 服务子进程
    // （应用保持运行），恢复完成后用户重启应用即重新拉起服务。
    if (isServerRunning()) {
      const { response: stopRes } = await dialog.showMessageBox(owner, {
        type: 'warning', title: appName,
        message: '恢复数据前需要先停止 DSH 服务',
        detail: 'DSH 服务正在运行，数据文件（~/.dsh）可能被占用，直接恢复会导致失败或数据不一致。\n\n选择「停止服务并恢复」：只停止 DSH 服务（应用保持运行），恢复完成后重启应用即可重新使用。',
        buttons: ['停止服务并恢复', '取消'], defaultId: 0, cancelId: 1, noLink: true,
      });
      if (stopRes !== 0) return;
      await stopServerOnly();
    }

    const { canceled, filePaths } = await dialog.showOpenDialog(owner, {
      title: '选择 DSH 备份包',
      properties: ['openFile'],
      filters: [{ name: '备份包', extensions: ['tar.gz', 'tgz'] }],
    });
    if (canceled || !filePaths || !filePaths[0]) return;
    const backupFile = filePaths[0];

    // 确认
    const { response: confirmRes } = await dialog.showMessageBox(owner, {
      type: 'warning', title: appName,
      message: '恢复数据将覆盖本机现有 DSH 数据',
      detail: '现有数据会被重命名为 .bak 保留（不删除）。确定继续？',
      buttons: ['确定恢复', '取消'], defaultId: 1, cancelId: 1, noLink: true,
    });
    if (confirmRes !== 0) return;

    // 先解压到临时目录校验（不直接解到目标，防恶意包写任意路径）
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-restore-'));
    try {
      // v0.7.10：filter 跳过符号链接条目（SymbolicLink/Link）—— 旧版备份包或
      // 来源包若含 junction/符号链接，解压重建同样会 EPERM；链接指向可重建运行时，
      // 跳过安全（DSH 启动时自愈）
      await tar.extract({
        file: backupFile,
        cwd: tmp,
        portable: true,
        filter: (_path, entry) => entry && entry.type !== 'SymbolicLink' && entry.type !== 'Link',
      });

      // T4：校验 manifest（格式/版本），不存在则拒绝（防随意 tar 包）
      const manifestPath = path.join(tmp, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        dialog.showErrorBox(appName, '无效的备份包：缺少 manifest.json');
        return;
      }
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      } catch {
        dialog.showErrorBox(appName, '无效的备份包：manifest.json 解析失败');
        return;
      }
      if (manifest.format !== 'dsh-backup-v1') {
        dialog.showErrorBox(appName, '无效的备份包：格式不识别');
        return;
      }
      const entries = Array.isArray(manifest.entries) ? manifest.entries : [];

      // 固定路径映射（T4：不信任包内路径，只按约定落位）
      const dshHome = path.join(os.homedir(), '.dsh');
      const settings = settingsFile();
      const stamp = Date.now();
      const moveOld = (target) => {
        if (fs.existsSync(target)) fs.renameSync(target, `${target}.bak-${stamp}`);
      };

      if (entries.includes('.dsh') && fs.existsSync(path.join(tmp, '.dsh'))) {
        moveOld(dshHome);
        fs.renameSync(path.join(tmp, '.dsh'), dshHome);
      }
      if (entries.includes('settings.json') && fs.existsSync(path.join(tmp, 'settings.json'))) {
        moveOld(settings);
        fs.mkdirSync(path.dirname(settings), { recursive: true });
        fs.renameSync(path.join(tmp, 'settings.json'), settings);
      }

      appendLog('info', `数据恢复完成（来源：${backupFile}）`);

      // 版本差异提示
      const curDsh = installedDshVersion() ?? '未知';
      const bakDsh = manifest.dshVersion ?? '未知';
      const diff = curDsh !== bakDsh
        ? `\n\n注意：备份时的 DSH 版本为 ${bakDsh}，当前为 ${curDsh}。如需一致，请到「检查更新」窗口升级 DSH。`
        : '';

      dialog.showMessageBox(owner, {
        type: 'info', title: appName,
        message: '数据恢复完成',
        detail: `工作区/会话数据已还原。${diff}\n\nDSH 服务已停止，重启应用后自动恢复运行。`,
        buttons: ['立即重启', '稍后'],
        defaultId: 1, cancelId: 1, noLink: true,
      }).then(({ response }) => {
        if (response === 0) { setQuitting(); app.relaunch(); app.exit(0); }
      }).catch(() => { /* ignore */ });
    } catch (err) {
      appendLog('error', `恢复失败：${err.message}`);
      // T4：DSH 服务运行中占用 ~/.dsh 时重命名/写回会 EPERM —— 给出操作指引
      let detail = `恢复失败：${err.message}`;
      if (/EPERM|EACCES/.test(err.message)) {
        detail += '\n\n数据文件可能仍被 DSH 服务占用（重命名被拒绝）。请稍后重试，或完全退出应用后重试。';
      }
      dialog.showErrorBox(appName, detail);
    } finally {
      // v0.7.10（老大反馈）：同步删除大解压目录会阻塞主进程，改异步
      try { await fs.promises.rm(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  return { backupUserData, restoreUserData };
}

module.exports = { createBackup };
