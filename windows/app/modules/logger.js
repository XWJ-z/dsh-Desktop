'use strict';

/**
 * DSH-Desktop — 日志模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：
 *  - 本地时间戳/日期（北京时间语义，UTC+8 由系统时区决定）
 *  - 日志文件路径（userData/logs 优先，回落 app/logs、tmpdir；P2-6 超限轮转）
 *  - appendLog：内存环形缓冲（800 条）+ 落盘 + 控制台 + 广播启动加载窗口
 *  - pushStage / pushProgress：向启动加载窗口推送阶段与下载进度
 *  - dirSizeMB：目录体积统计（下载进度可视化用）
 *
 * 依赖注入（deps）：
 *  - app / fs / os / path       Node 与 Electron 模块
 *  - getLoadingWindow           启动加载窗口 getter（null 时跳过广播）
 */

function createLogger(deps) {
  const { app, fs, os, path, getLoadingWindow } = deps;

  const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024; // P2-6：单日日志超 5MB 轮转
  let logFilePath = null;                       // 当前日志文件（含轮转后缀），缓存避免重复探测
  let logLines = [];                            // 内存环形缓冲（最近 800 条）
  let currentStage = 'check';                   // 当前启动阶段（L6：页面脚本就绪后可主动查询）

  /** 本地时间戳（yyyy-MM-dd HH:mm:ss），解决 UTC 与北京时间差 8 小时 */
  function localTimestamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /** 本地日期（yyyy-MM-dd），用于日志文件名（避免深夜日志归到前一天） */
  function localDate() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function logPath() {
    const stamp = localDate();
    const candidates = [
      path.join(app.getPath('userData'), 'logs'),
      path.join(app.getAppPath(), 'logs'),
      path.join(os.tmpdir(), 'dsh-desktop', 'logs'),
    ];
    for (const dir of candidates) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        // P2-6：若当前文件超限，轮转到 dsh-YYYY-MM-DD-N.log（N 递增）
        const base = path.join(dir, `dsh-${stamp}.log`);
        if (!logFilePath || path.dirname(logFilePath) !== dir || !fs.existsSync(logFilePath)) {
          if (!fs.existsSync(base) || fs.statSync(base).size < MAX_LOG_FILE_BYTES) {
            logFilePath = base;
          } else {
            let n = 1;
            while (fs.existsSync(path.join(dir, `dsh-${stamp}-${n}.log`))) n++;
            logFilePath = path.join(dir, `dsh-${stamp}-${n}.log`);
          }
        }
        return logFilePath;
      } catch { /* try next */ }
    }
    return path.join(os.tmpdir(), `dsh-${stamp}.log`);
  }

  function appendLog(level, message) {
    const line = `[${localTimestamp()}] [${level}] ${message}`;
    logLines.push(line);
    if (logLines.length > 800) logLines.shift();
    try {
      // P2-6：写前检查当前文件是否超限，超限则强制下次轮转（重置缓存）
      if (logFilePath && fs.existsSync(logFilePath) &&
          fs.statSync(logFilePath).size >= MAX_LOG_FILE_BYTES) {
        logFilePath = null;
      }
      fs.appendFileSync(logPath(), line + os.EOL);
    } catch { /* ignore */ }
    console.log(line);
    // 仅向启动加载窗口广播日志（审查 M3：GUI 窗口不监听 dsh:log，避免无效 IPC）
    const loadingWindow = getLoadingWindow();
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.webContents.send('dsh:log', line);
    }
  }

  /** 向启动加载窗口推送阶段（①检查 ②下载/安装 ③启动服务 ④就绪） */
  function pushStage(stage) {
    currentStage = stage;
    const loadingWindow = getLoadingWindow();
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.webContents.send('dsh:stage', stage);
    }
  }

  /** 向启动加载窗口推送下载/安装进度（{ mb: '23.4' }） */
  function pushProgress(mb) {
    const loadingWindow = getLoadingWindow();
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.webContents.send('dsh:progress', { mb });
    }
  }

  /** 统计目录体积（MB，一位小数）；目录不存在/读取失败返回 '0.0' */
  function dirSizeMB(dir) {
    try {
      let total = 0;
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else total += fs.statSync(p).size;
        }
      };
      walk(dir);
      return (total / 1024 / 1024).toFixed(1);
    } catch { return '0.0'; }
  }

  /** v1.0.2（老大反馈 1）：异步统计目录体积（不阻塞主进程；启动下载阶段每 3 秒调用，
   *  同步版遍历 node_modules 几万文件会卡 UI）。失败返回 '0.0'。 */
  async function dirSizeMBAsync(dir) {
    try {
      let total = 0;
      const walk = async (d) => {
        for (const e of await fs.promises.readdir(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) await walk(p);
          else total += (await fs.promises.stat(p)).size;
        }
      };
      await walk(dir);
      return (total / 1024 / 1024).toFixed(1);
    } catch { return '0.0'; }
  }

  return {
    localTimestamp,
    localDate,
    logPath,
    appendLog,
    pushStage,
    pushProgress,
    dirSizeMB,
    dirSizeMBAsync, // v1.0.2
    getLogLines: () => logLines,
    getCurrentStage: () => currentStage,
  };
}

module.exports = { createLogger };
