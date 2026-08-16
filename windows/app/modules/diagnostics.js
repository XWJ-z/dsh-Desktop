'use strict';

/**
 * DSH-Desktop — 诊断报告模块（v0.7.10 从 main.js 抽出，29 改进意见 1：拆模块起步）
 *
 * 自包含函数，无全局状态依赖：运行时状态（端口/阶段/日志缓冲/主窗口）经
 * deps 注入（getter 形式，调用时实时取值），main.js 负责组装 deps 并调用。
 *
 * 依赖注入说明（deps 字段）：
 *   - appName           应用名（弹窗标题）
 *   - app / dialog / clipboard / shell / fs / os / path   Electron 与 Node 模块
 *   - appendLog         日志函数
 *   - localTimestamp    本地时间戳（yyyy-MM-dd HH:mm:ss）
 *   - readShellConfig   读取壳配置
 *   - installedDshVersion   已安装 DSH 版本（未安装返回 null）
 *   - resolveRunner     解析 Node 运行器
 *   - getResolvedPort   当前监听端口（getter）
 *   - getCurrentStage   当前启动阶段（getter）
 *   - getLogPath        当前日志文件路径（getter）
 *   - getLogLines       日志环形缓冲（getter）
 *   - getOwnerWindow    弹窗宿主窗口（getter；无主窗口返回 undefined）
 */

function createDiagnostics(deps) {
  const {
    appName, app, dialog, clipboard, shell, fs, os, path,
    appendLog, localTimestamp,
    readShellConfig, installedDshVersion, resolveRunner,
    getResolvedPort, getCurrentStage, getLogPath, getLogLines, getOwnerWindow,
  } = deps;

  /**
   * T1（v0.7.0）：生成诊断报告 —— 环境信息 + 最近日志 + 配置（脱敏），复制到剪贴板并落盘。
   * 内容/行为与抽模块前完全一致（纯搬运）。
   */
  function generateDiagnostics() {
    try {
      const cfg = readShellConfig();
      const lines = [];
      lines.push('DSH-Desktop 诊断报告');
      lines.push('====================');
      lines.push(`生成时间：${localTimestamp()}`);
      lines.push(`应用版本：${app.getVersion()}`);
      lines.push(`DSH 包：${cfg.dshPackage}@${installedDshVersion() ?? cfg.dshVersion}`);
      lines.push(`运行器：${resolveRunner().label}`);
      lines.push(`监听端口：${getResolvedPort()}`);
      lines.push(`启动阶段：${getCurrentStage()}`);
      lines.push(`数据目录：${app.getPath('userData')}`);
      lines.push(`日志文件：${getLogPath()}`);
      lines.push(`系统：${os.platform()} ${os.release()} (${os.arch()})`);
      lines.push(`内存：${(os.totalmem() / 1024 / 1024 / 1024).toFixed(1)} GB 总量`);
      lines.push('');
      lines.push('--- 配置（脱敏）---');
      // T4：防御性脱敏 —— 键名含 pass/token/secret/key/apiKey 的值打码
      const mask = (obj) => JSON.stringify(obj, (k, v) =>
        /pass|token|secret|api[_-]?key/i.test(k) && typeof v === 'string' && v ? '***' : v, 2);
      lines.push(mask(cfg));
      lines.push('');
      lines.push('--- 最近日志（末 200 行）---');
      lines.push(getLogLines().slice(-200).join('\n'));
      const text = lines.join('\n');

      // 落盘
      const dir = path.join(app.getPath('userData'), 'diagnostics');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `dsh-diagnostics-${localTimestamp().replace(/[: ]/g, '-')}.txt`);
      fs.writeFileSync(file, text, 'utf8');

      // 复制到剪贴板
      clipboard.writeText(text);

      dialog.showMessageBox(getOwnerWindow(), {
        type: 'info', title: appName,
        message: '诊断报告已生成',
        detail: `已复制到剪贴板，可直接粘贴发送。\n已保存：${file}`,
        buttons: ['打开所在目录', '关闭'],
        defaultId: 1, cancelId: 1, noLink: true,
      }).then(({ response }) => {
        if (response === 0) shell.openPath(dir);
      }).catch(() => { /* ignore */ });

      appendLog('info', `诊断报告已生成：${file}`);
    } catch (err) {
      appendLog('error', `生成诊断报告失败：${err.message}`);
      dialog.showErrorBox(appName, `生成诊断报告失败：${err.message}`);
    }
  }

  return generateDiagnostics;
}

module.exports = { createDiagnostics };
