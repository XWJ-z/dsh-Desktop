'use strict';

/**
 * DSH-Desktop — Electron 主进程（纯套壳）
 *
 * 职责：
 *  1. 读取壳配置（app/config.json：DSH 包名 + 版本号，可随时改版本升级）
 *  2. 用内置 npm（随壳分发）把 `@deepseek-ai/dsh@<版本>` 安装到用户数据目录
 *     （首次运行联网下载，之后离线可用；与官方 `npx @deepseek-ai/dsh web` 同机制）
 *  3. 以子进程方式启动 `dsh web`（默认 127.0.0.1:3080，端口被占用时自动顺延）
 *  4. 等待 HTTP 服务就绪后，在原生窗口中加载 DeepSeek Harness Web GUI
 *  5. 退出时优雅地关闭 DSH 子进程
 *
 * 开发模式：使用系统 Node 运行 DSH（原生模块 ABI 与 node_modules 一致）
 * 打包模式：优先使用内置 Node（resources/node/node.exe，真实 Node，ABI 完全匹配）；
 *   Electron-as-Node（ELECTRON_RUN_AS_NODE）仅作兜底。
 *  —— 壳只提供运行环境，DSH 本体始终来自 npm 安装，更新 DSH 只改版本号，
 *     壳代码不受 DSH 版本影响。
 */

const { app, BrowserWindow, clipboard, dialog, Menu, nativeTheme, screen, shell, ipcMain, Tray, globalShortcut } = require('electron');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const tar = require('tar'); // v0.7.0：数据备份/恢复（package.json dependencies 已显式声明，随包分发）

// v0.8.12（优化方案 2026-08-16）：main.js 拆分 —— 纯逻辑模块
const { createLogger } = require('./modules/logger');
const { createNodeResolver } = require('./modules/node-resolver');
const { createPortManager } = require('./modules/port-manager');
const { createDshRuntime } = require('./modules/dsh-runtime');
const { createServerLifecycle } = require('./modules/serverLifecycle');
const { createUpdater } = require('./modules/updater');
const { createPet } = require('./modules/pet');
const { createPromptInject } = require('./modules/prompt-inject'); // v0.9：提示词注入公共模块
const { createWorkspaceLocator } = require('./modules/workspace');  // v0.9（T1）：工作区定位
const { createDragDrop } = require('./modules/drag-drop');          // v0.9（T3）：拖拽监听注入
const { createDropFiles } = require('./modules/drop-files');        // v0.9（T4/T5）：拖文件处理
const { createCustomPrompts } = require('./modules/custom-prompts'); // v0.9.5（T2）：自定义提示词
const { createGlobalMemory } = require('./modules/global-memory');   // v0.9.12：全局记忆（宠物菜单）
const { createRoleSelector } = require('./modules/role-selector');   // v0.9.13：新对话选择角色
const { createRolePicker } = require('./modules/role-picker');       // v1.0.3（老大反馈 3）：角色选择竖排窗口
const { createNoticeModule } = require('./modules/notice');          // v0.9.5（T3）：公告条/公告源
const { createMenu } = require('./modules/menu');
const { registerIpc } = require('./modules/ipc');
const { createSecurityModule } = require('./modules/security'); // v0.8.30 R1
const { createMainWindowModule } = require('./modules/windows/main-window');
const { createLoadingWindowModule } = require('./modules/windows/loading-window');
const { createDialogWindowsModule } = require('./modules/windows/about-window');
const { createMiscWindowsModule } = require('./modules/windows/misc-windows');

const APP_NAME = 'DSH-Desktop';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3080;
const PORT_PROBE_RANGE = 50;          // 端口被占用时最多顺延多少个
const SERVER_READY_TIMEOUT_MS = 240_000; // 等待 dsh web 就绪的上限（含首次下载）
const CHILD_GRACE_MS = 5_000;         // 关闭子进程的宽限期
const NPM_INSTALL_TIMEOUT_MS = 600_000;  // 下载/安装 DSH 运行时的上限（10 分钟）

// 未捕获异常/拒绝：记录后继续（避免窗口服务抖动导致整体退出）；
// ENOENT 等致命错误（P2-8）额外弹窗提示，避免静默不稳定态
process.on('uncaughtException', (err) => {
  try { appendLog('error', `未捕获异常：${err && err.stack ? err.stack : String(err)}`); } catch { /* ignore */ }
  const code = err && err.code;
  if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
    try {
      dialog.showErrorBox(APP_NAME,
        `发生系统级错误（${code}）：${err && err.message ? err.message : String(err)}\n\n请检查文件/网络权限后重试。`);
    } catch { /* ignore */ }
  }
});
process.on('unhandledRejection', (reason) => {
  try { appendLog('error', `未处理的 Promise 拒绝：${String(reason)}`); } catch { /* ignore */ }
});

// ---------------------------------------------------------------------------
// 运行时状态
// ---------------------------------------------------------------------------
let mainWindow = null;          // 主窗口（GUI）
let loadingWindow = null;       // 启动加载窗口
let updateWin = null;           // 更新窗口（v0.5.3 现代化）
let contactWin = null;          // 联系我们窗口（v0.5.3 现代化）
let aboutWin = null;            // 关于窗口（v0.5.3 现代化）
let changelogWin = null;        // 更新日志窗口（v0.8.1 T3）
let promptLibWin = null;        // 提示词库窗口（v0.8.3 T4）
let noticeWin = null;          // 公告窗口（v0.8.11 T0.6）
let globalMemoryWin = null;    // 全局记忆窗口（v0.9.12）
let serverChild = null;         // dsh web 服务子进程
let resolvedPort = DEFAULT_PORT;
let quitting = false;
let dshHasUpdate = false;       // 启动后静默检查发现 DSH 新版（菜单提示后缀）
let shellHasUpdate = false;     // 启动后静默检查发现壳（DSH-Desktop）新版（菜单提示后缀）
// v0.6.0（T-025）：系统托盘（v0.8.1 T5：tray 状态收敛到 modules/tray.js，见 trayApi）
let isQuitting = false;         // 真正退出标志（区分"关窗隐藏"与"退出"）
let serverStopRequested = false; // v0.7.10：主动停止 DSH 服务（恢复数据前释放占用），
                                  // 避免触发「服务意外退出」误报弹窗

// 登记所有由本进程派生的子进程（npm install + dsh 服务），退出时统一清理，
// 避免 Windows 下残留 node/npm 进程（审查 M1）。
const trackedChildren = new Set();
function trackChild(child, role) {
  child.role = role;
  trackedChildren.add(child);
  child.on('exit', () => trackedChildren.delete(child));
  child.on('error', () => trackedChildren.delete(child));
  return child;
}
function killTrackedChildren() {
  for (const child of trackedChildren) {
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    } catch { /* ignore */ }
  }
}

/** 静默删除文件/目录（忽略一切错误） */
function rmQuiet(p) { try { fs.rmSync(p, { force: true }); } catch { /* ignore */ } }

// ---------------------------------------------------------------------------
// 模块组装（v0.8.12 优化方案）：日志 / Node 解析 / 端口 / DSH 运行时
// 依赖注入模式与既有 modules/（settings/tray/hotkey/backup/diagnostics）一致
// ---------------------------------------------------------------------------
const loggerApi = createLogger({
  app, fs, os, path,
  getLoadingWindow: () => loadingWindow, // 仅启动加载窗口广播日志/阶段/进度
});
const { localTimestamp, localDate, logPath, appendLog, pushStage, pushProgress, dirSizeMBAsync } = loggerApi; // v1.0.2：dirSizeMBAsync 异步统计（启动下载不卡 UI）
const { getLogLines, getCurrentStage } = loggerApi;

const nodeResolverApi = createNodeResolver({ app, fs, path, execFileSync });
const { resolveRunner } = nodeResolverApi;

const portApi = createPortManager({ net, http, defaultHost: DEFAULT_HOST, portProbeRange: PORT_PROBE_RANGE });
const { pickPort, waitForServer, parsePortArg } = portApi;

const runtimeApi = createDshRuntime({
  app, fs, path, os, spawn,
  appendLog, pushStage, pushProgress, dirSizeMBAsync, logPath, // v1.0.2：异步统计（缓存隔离+不卡 UI）
  resolveRunner, trackChild,
  npmInstallTimeoutMs: NPM_INSTALL_TIMEOUT_MS,
  // P1-2（外审 zx(9)）：晚绑定 updaterApi —— ensureDshRuntime 在启动时调用，
  // 彼时 updaterApi 已组装（L390），避免模块组装循环依赖
  fetchLatestDshInfo: () => updaterApi.fetchLatestDshInfo(),
});
const { readShellConfig, installedDshVersion, ensureDshRuntime, updateDshVersion } = runtimeApi;

// ---------------------------------------------------------------------------
// 端口探测 / 服务就绪探测（v0.8.12：逻辑已移入 modules/port-manager.js）
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DSH 服务子进程（v0.8.12：逻辑已移入 modules/serverLifecycle.js）
// ---------------------------------------------------------------------------
const serverApi = createServerLifecycle({
  app, dialog, spawn, appName: APP_NAME,
  appendLog, logPath,
  ensureDshRuntime, resolveRunner, readShellConfig, installedDshVersion,
  trackChild, killTrackedChildren, trackedChildren,
  waitForServer,
  defaultHost: DEFAULT_HOST, childGraceMs: CHILD_GRACE_MS,
  serverReadyTimeoutMs: SERVER_READY_TIMEOUT_MS,
  getQuitting: () => quitting,
  setQuitting: (v) => { quitting = v; },
  getServerChild: () => serverChild,
  setServerChild: (v) => { serverChild = v; },
  getServerStopRequested: () => serverStopRequested,
  setServerStopRequested: (v) => { serverStopRequested = v; },
  getMainWindow: () => mainWindow,
  getWebUrl: webUrl,
  getResolvedPort: () => resolvedPort,
});
const { stopServer, stopServerOnly, spawnServer } = serverApi;

function webUrl() {
  return `http://${DEFAULT_HOST}:${resolvedPort}`;
}

// ---------------------------------------------------------------------------
// v0.8.18 + v0.8.19 + v0.8.21：外观（nativeTheme.themeSource：'system' | 'light' | 'dark'）
// v0.8.19：DSH 硬编码 color-scheme 不响应 prefers-color-scheme，需额外
// syncDshAppearance 程序化点击 DSH 设置面板主题按钮同步。
// v0.8.21（老大反馈）：① applyAppearance 不再隐式打开 DSH 设置面板 ——
// 启动/恢复布局时只设壳外观，绝不自动打开 DSH 面板（v0.8.19 每次启动都弹面板）；
// DSH 同步仅发生在用户主动通过「外观…」弹窗选择时。
// ② 新增反向监听 startDshThemeWatch：用户直接在 DSH 设置面板改外观时，
// 壳外观设置同步跟随（双向同步）。
// ---------------------------------------------------------------------------
function applyAppearance(mode) {
  const m = (mode === 'light' || mode === 'dark') ? mode : 'system';
  try { nativeTheme.themeSource = m; } catch { /* ignore */ }
  appendLog('info', `外观已应用：${m}`);
  // v0.8.21：不再自动同步 DSH（避免每次启动打开 DSH 设置面板）；
  // DSH 同步只在用户主动选择外观时由 openAppearanceDialog 显式调用。
}

/** 设置菜单「外观…」：弹窗选择浅色/深色/跟随系统 */
function openAppearanceDialog() {
  const current = (settings.appearance === 'light' || settings.appearance === 'dark') ? settings.appearance : 'system';
  const options = ['light', 'dark', 'system'];
  const defIdx = options.indexOf(current) >= 0 ? options.indexOf(current) : 2;
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  dialog.showMessageBox(owner, {
    type: 'question',
    title: APP_NAME,
    message: '选择外观',
    detail: '浅色 / 深色 / 跟随系统（DSH 界面将自动同步）',
    buttons: ['浅色', '深色', '跟随系统'],
    defaultId: defIdx,
    cancelId: defIdx,
    noLink: true,
  }).then(({ response }) => {
    if (response < 0 || response > 2) return;
    const mode = options[response];
    settings.appearance = mode;
    saveSettingsRef();
    applyAppearance(mode);
    // v0.8.21：用户主动选择时才同步 DSH 面板（打开面板 → 点击主题按钮）
    syncDshAppearance(mode);
    refreshMenusRef();
  }).catch(() => { /* ignore */ });
}

/**
 * v0.8.19：同步外观到 DSH 页面 —— DSH 主题选择器是设置面板里的
 * `.themeCube` 按钮（浅色/深色/跟随系统），硬编码 color-scheme，不响应
 * prefers-color-scheme，必须程序化点击对应按钮。
 * 探测实证（CDP）：点击「浅色」后 body 背景 rgb(21,21,23) → rgb(255,255,255)。
 * v0.8.21：仅用户主动选择时调用；面板原本关闭则同步完成后自动关闭（不残留）。
 * v0.8.24（老大反馈：切换外观后 DSH 设置面板被打开）：探测实证 DSH 面板关闭
 * 方式是 ESC / 点面板外空白（「设置」按钮非 toggle，再点不会关）——
 * 关闭前先查面板是否仍打开，仍开则点面板外空白关闭，避免残留。
 */
function syncDshAppearance(mode) {
  const mw = mainWindow;
  if (!mw || mw.isDestroyed()) return;
  const label = mode === 'light' ? '浅色' : mode === 'dark' ? '深色' : '跟随系统';
  mw.webContents.executeJavaScript(`
    (() => {
      const wasOpen = !!document.querySelector('[class*="themeCube"]');
      // 面板未打开才点「设置」按钮（已打开则复用，避免 toggle 误关）
      if (!wasOpen) {
        const openBtn = Array.from(document.querySelectorAll('button,[role="button"]'))
          .find((b) => (b.textContent || '').trim() === '设置');
        if (openBtn) openBtn.click();
      }
      return wasOpen;
    })()
  `).then((wasOpen) => new Promise((r) => setTimeout(() => r(wasOpen), 400))).then((wasOpen) => {
    mw.webContents.executeJavaScript(`
      (() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find((b) => (b.textContent || '').trim() === ${JSON.stringify(label)});
        if (!btn) return { ok: false, reason: 'theme-btn-not-found' };
        btn.click();
        return { ok: true, label: ${JSON.stringify(label)} };
      })()
    `).then((r) => {
      // v0.8.21 + v0.8.24：面板原本关闭 → 同步完成后关闭（不残留）。
      // 探测实证（CDP v0.8.24）：DSH 设置面板**不是**「设置」按钮 toggle ——
      // 再点「设置」不会关闭（v0.8.21 的关闭逻辑其实从未生效）；真实关闭方式是
      // ESC 或点击面板外空白区域。这里先查面板是否仍打开（themeCube 还在），
      // 仍开着 → 点面板外左上角空白处关闭（与 ESC 等效，实测 themeCube→0）。
      if (r && r.ok && !wasOpen) {
        setTimeout(() => {
          mw.webContents.executeJavaScript(`
            (() => {
              const stillOpen = !!document.querySelector('[class*="themeCube"]');
              if (!stillOpen) return { closed: true, reason: 'already-auto-closed' };
              // 点面板外空白（左上角 8,8，属主界面区域）关闭设置面板
              const el = document.elementFromPoint(8, 8);
              if (el) {
                el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
                el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
              }
              return { closed: !document.querySelector('[class*="themeCube"]'), clicked: !!el };
            })()
          `).catch(() => { /* ignore */ });
        }, 300);
      }
    }).catch(() => { /* ignore */ });
  }).catch(() => { /* ignore */ });
}

// v0.8.21（老大反馈）：DSH 设置面板改外观 → 壳外观反向同步。
// 轮询读取 DSH 面板当前选中的主题按钮（.themeCube._selected 文本），
// 与壳设置不一致时更新壳外观（nativeTheme + 持久化 + 菜单）。
// 仅面板打开时能读到选中态，面板关闭时轮询自动空转，开销可忽略。
// v0.9.9（老大反馈：壳延迟大）：轮询 2500ms → 400ms —— 用户在 DSH 面板直接切外观时，
// 壳（nativeTheme/菜单）最多 0.4s 内跟上（此前最长等 2.5s）。
// v0.9.11（外审 zx(9) P2-1）：保留 400ms 快跟随（老大指令），但主窗口隐藏/
// 最小化/销毁时跳过本轮（不执行 executeJavaScript，省 IPC/CPU）；恢复可见立即恢复。
let dshThemeWatchTimer = null;
function startDshThemeWatch() {
  if (dshThemeWatchTimer) return;
  dshThemeWatchTimer = setInterval(() => {
    const mw = mainWindow;
    // P2-1：仅窗口可见时轮询（隐藏/最小化/销毁 → 空转跳过，不打扰且省资源）
    if (!mw || mw.isDestroyed() || !mw.isVisible() || mw.isMinimized()) return; // v0.9.16（zx(9) 复核 P2-1）：最小化时 isVisible 仍为 true，需同时跳过
    mw.webContents.executeJavaScript(`
      (() => {
        const sel = Array.from(document.querySelectorAll('button'))
          .find((b) => /themeCube/.test(b.className || '') && /_selected/.test(b.className || ''));
        if (!sel) return null;
        const t = (sel.textContent || '').trim();
        if (t === '浅色') return 'light';
        if (t === '深色') return 'dark';
        if (t === '跟随系统') return 'system';
        return null;
      })()
    `).then((mode) => {
      if (!mode) return;
      const cur = (settings.appearance === 'light' || settings.appearance === 'dark') ? settings.appearance : 'system';
      if (mode === cur) return;
      appendLog('info', `检测到 DSH 面板外观变更：${mode}（原 ${cur}），同步壳外观`);
      settings.appearance = mode;
      saveSettingsRef();
      applyAppearance(mode); // applyAppearance 不触发 DSH 同步，无循环
      refreshMenusRef();
    }).catch(() => { /* ignore */ });
  }, 400);
}

// ---------------------------------------------------------------------------
const petApi = createPet({
  app, fs, path, appendLog,
  getSettings: () => settings,
  saveSettings: () => settingsApi.saveSettings(),
  getMainWindow: () => mainWindow,
  getWebUrl: webUrl,
});
const { injectPet, resetWebOpenBtnLayout, petBubble } = petApi;

// ---------------------------------------------------------------------------
// v0.9（T1/T3/T4/T5）：拖文件入工作区 —— 提示词注入公共模块 / 工作区定位 /
// 拖拽监听注入 / 拖文件处理。放在 petApi 之后（需要 petBubble）与窗口模块之前。
// ---------------------------------------------------------------------------
// 提示词注入链路（v0.8.6 两段式：聚焦 + insertText），提示词库与拖文件共用。
// settingsApi 在下方才组装 —— 全部经 getter 晚绑定，运行时取值无时序问题。
const promptInject = createPromptInject({
  dialog, appName: APP_NAME,
  getSettings: () => settings,
  saveSettings: () => settingsApi.saveSettings(),
  refreshMenus: () => refreshMenusRef(),
  localDate,
});

// 工作区定位（当前 DSH 工作区绝对路径；途径 A localStorage + 途径 B 存储兜底）
const workspaceApi = createWorkspaceLocator({ fs, os, path, appendLog });
const { getWorkspacePath } = workspaceApi;

// 主窗口拖拽监听注入（防导航 + overlay + 同步取路径）
const dragDropApi = createDragDrop({ appendLog });
const { injectDropHandler } = dragDropApi;

// 拖文件处理（复制进工作区 + 注入提示词 + 气泡反馈）
const dropFilesApi = createDropFiles({
  fs, path, appendLog,
  getWorkspacePath,
  promptInject,
  petBubble,
  getMainWindow: () => mainWindow,
});
const { handleDropFiles } = dropFilesApi;

// v0.9.5（T2.1）：自定义提示词存储（userData/custom-prompts.json）
const customPromptsApi = createCustomPrompts({ fs, path, app, appendLog });

// v0.9.12（老大指令）：全局记忆 —— 读写 DSH 原生 ~/.dsh/AGENTS.md（DSH 自动读取，
// 无需手动发送）；图形化表单编辑基础设定（区块级写回，不破坏其他内容）
const globalMemoryApi = createGlobalMemory({ app, fs, os, path, appendLog });

// v0.9.15（老大指令）：新建对话不再弹窗提示角色 —— 角色切换改为双击 DSH 输入框随时重选
// v1.0.3（老大反馈 3）：选择弹窗从原生横排按钮改为竖排列表窗口（rolePickerApi 晚绑定组装）
const roleSelectorApi = createRoleSelector({
  dialog, appName: APP_NAME, appendLog,
  getMainWindow: () => mainWindow,
  getRoles: () => {
    const d = globalMemoryApi.data();
    const sec = d && d.sections && d.sections.find((s) => s.kind === 'roles');
    return sec ? (sec.fields || []) : [];
  },
  roleFilePath: (name) => globalMemoryApi.roleFile(name),
  injectText: (win, text, opts) => promptInject.injectTextIntoInput(win, text, opts),
  openRolePicker: (roles) => rolePickerApi.openRolePicker(roles),
});

// ----
// 更新检查/下载（v0.8.12：逻辑已移入 modules/updater.js）
// ---------------------------------------------------------------------------
// 壳（DSH-Desktop）自动更新（v0.5）：GitHub version.json 三源并发 + 镜像下载
// 与「检查 DSH 更新」（官方 DSH 包）完全独立：本区检查的是壳自身版本
// v0.5.9：三源并发（jsDelivr @main 快但会卡缓存 / api.github.com 国内最稳、
// 永远最新 / raw.githubusercontent 兜底），取可达源中版本号最高者，
// 规避 jsDelivr @main 解析缓存卡死导致漏报更新。
const SHELL_UPDATE_URLS = [
  {
    name: 'jsDelivr',
    url: 'https://cdn.jsdelivr.net/gh/XWJ-z/dsh-Desktop@main/version.json',
  },
  {
    // api.github.com：Accept raw+json 直接返回文件原文，无 CDN 缓存，永远最新
    name: 'GitHub API',
    url: 'https://api.github.com/repos/XWJ-z/dsh-Desktop/contents/version.json?ref=main',
    headers: { 'User-Agent': 'DSH-Desktop', Accept: 'application/vnd.github.raw+json' },
  },
  {
    name: 'raw.githubusercontent',
    url: 'https://raw.githubusercontent.com/XWJ-z/dsh-Desktop/main/version.json',
  },
];

// v0.8.11（T0.6）：远程公告 —— v0.9.5（T3）起公告唯一源 = notice.json，
// 独立公告模块（三源并发 + 本地缓存），不再依赖 version.json notices。
const updaterApi = createUpdater({
  app, shell, https, crypto, fs, path, rmQuiet,
  appendLog,
  readShellConfig, installedDshVersion, updateDshVersion,
  getMainWindow: () => mainWindow,
  shellUpdateUrls: SHELL_UPDATE_URLS,
});
const { fetchLatestDshVersion, compareSemver, effectiveLatest, queryUpdateInfo, upgradeDshVersion, downloadShellUpdate, fetchLatestShellVersion, fetchJson } = updaterApi;

// v0.9.5（T3）：公告模块 —— notice.json 三源并发 + userData 缓存；菜单栏公告条 + 公告窗口
const noticeApi = createNoticeModule({ app, fs, path, appendLog, fetchJson });
noticeApi.loadCache(); // 启动即载入缓存（buildMenu 用缓存 marquee，拉取失败不闪没）

// ---------------------------------------------------------------------------
// 窗口模块组装（v0.8.12：逻辑已移入 modules/windows/）
// ---------------------------------------------------------------------------
// v0.8.30 R1：安全基线 webPreferences 抽为公共模块（modules/security.js），
// 由各窗口模块注入使用（消除 about-window/misc-windows 重复定义）
const securityModule = createSecurityModule({ app, path });
const { secureWebPreferences } = securityModule;

const miscWindowsModule = createMiscWindowsModule({
  BrowserWindow, app, dialog, path, nativeTheme, // v0.9.9：窗口背景跟随外观
  appendLog, appName: APP_NAME,
  getSettings: () => settings,
  setCloseChoice: (action, remember) => settingsApi.setCloseChoice(action, remember),
  getMainWindow: () => mainWindow,
  getIsQuitting: () => isQuitting,
  setQuitting: (v) => { isQuitting = v; },
  getChangelogWin: () => changelogWin, setChangelogWin: (v) => { changelogWin = v; },
  getNoticeWin: () => noticeWin, setNoticeWin: (v) => { noticeWin = v; },
  getPromptLibWin: () => promptLibWin, setPromptLibWin: (v) => { promptLibWin = v; },
  getGlobalMemoryWin: () => globalMemoryWin, setGlobalMemoryWin: (v) => { globalMemoryWin = v; }, // v0.9.12
  secureWebPreferences,
});
const { openChangelogWindow, openNoticeWindow, hasNewNotices, openPromptLibWindow, openGlobalMemoryWindow, openCloseChoiceWindow, openBackupProgress, updateBackupProgress, closeBackupProgress } = miscWindowsModule;

// v1.0.3（老大反馈 3）：角色选择竖排窗口 —— 依赖 secureWebPreferences（组装于其后）
const rolePickerApi = createRolePicker({
  BrowserWindow, app, path, nativeTheme, ipcMain,
  secureWebPreferences,
});

const mainWindowModule = createMainWindowModule({
  BrowserWindow, app, dialog, shell, screen, path, nativeTheme, // v0.9.9：窗口背景跟随外观
  appendLog, logPath, appName: APP_NAME,
  getSettings: () => settings,
  saveSettings: () => settingsApi.saveSettings(),
  injectPet, openCloseChoiceWindow,
  injectDropHandler, // v0.9（T3）：拖拽监听注入
  getWebUrl: webUrl,
  getIsQuitting: () => isQuitting,
  setQuitting: (v) => { isQuitting = v; },
  getMainWindow: () => mainWindow,
  setMainWindow: (v) => { mainWindow = v; },
});
const { attachWebDiagnostics, createMainWindow } = mainWindowModule;

const dialogWindowsModule = createDialogWindowsModule({
  BrowserWindow, app, path, nativeTheme, // v0.9.9：窗口背景跟随外观
  getMainWindow: () => mainWindow,
  getUpdateWin: () => updateWin, setUpdateWin: (v) => { updateWin = v; },
  getContactWin: () => contactWin, setContactWin: (v) => { contactWin = v; },
  getAboutWin: () => aboutWin, setAboutWin: (v) => { aboutWin = v; },
  secureWebPreferences,
});
const { openUpdateWindow, openContactWindow, openAboutWindow } = dialogWindowsModule;

const loadingWindowModule = createLoadingWindowModule({
  BrowserWindow, app, path, nativeTheme, // v0.9.9：窗口背景跟随外观 appName: APP_NAME,
  getResolvedPort: () => resolvedPort,
  getLoadingWindow: () => loadingWindow,
  setLoadingWindow: (v) => { loadingWindow = v; },
});
const { createLoadingWindow } = loadingWindowModule;


// 诊断 / 数据备份 / 数据恢复（v0.7.0 起；v0.7.10 拆为独立模块，29 改进意见 1）
// 设置 / 托盘 / 快捷键（v0.8.1 T5 延续拆分，29 意见 3.2-1）
// 自包含函数已抽到 modules/，main.js 只负责组装依赖注入（deps）并调用。
// ---------------------------------------------------------------------------
const { createDiagnostics } = require('./modules/diagnostics');
const { createBackup } = require('./modules/backup');
const { createSettings } = require('./modules/settings');
const { createTrayModule } = require('./modules/tray');
const { createHotkey } = require('./modules/hotkey');

const generateDiagnostics = createDiagnostics({
  appName: APP_NAME,
  app, dialog, clipboard, shell, fs, os, path,
  appendLog, localTimestamp,
  readShellConfig, installedDshVersion, resolveRunner,
  getResolvedPort: () => resolvedPort,
  getCurrentStage, // v0.8.12：logger 模块
  getLogPath: logPath,
  getLogLines,     // v0.8.12：logger 模块
  getOwnerWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined),
});

// v0.8.1（T5）：设置模块 —— settings 对象本体仍在本文件（大量代码直接读 settings.xxx），
// 本模块经 getSettings/setSettings 读写，函数实现全部收敛到 modules/settings.js
const settingsApi = createSettings({
  app, fs, path,
  appendLog,
  getSettings: () => settings,
  setSettings: (s) => { settings = s; },
  refreshMenus: () => refreshMenusRef(), // v0.8.12：menuApi 晚绑定（避免循环依赖）
});

// v0.8.1（T5）：托盘模块 —— tray / trayExitConfirmed 状态收敛到模块内部
const trayApi = createTrayModule({
  app, dialog, Menu, Tray, fs, path,
  appendLog, APP_NAME,
  getSettings: () => settings,
  setAutostart: settingsApi.setAutostart,
  showMainWindow,
  openUpdateWindow,
  readShellConfig, installedDshVersion,
  getMainWindow: () => mainWindow,
  getIsQuitting: () => isQuitting,
  setIsQuitting: (v) => { isQuitting = v; },
});

// v0.8.1（T4/T5）：全局快捷键模块
const hotkeyApi = createHotkey({
  globalShortcut, Menu,
  appendLog,
  getSettings: () => settings,
  saveSettings: settingsApi.saveSettings,
  getMainWindow: () => mainWindow,
  showMainWindow,
  getBuildMenu: () => menuApi.buildMenu(), // v0.8.12：menuApi 晚绑定
});

const { backupUserData, restoreUserData } = createBackup({
  appName: APP_NAME,
  app, dialog, shell, fs, os, path, tar,
  appendLog, localTimestamp, localDate,
  readShellConfig, installedDshVersion, settingsFile: settingsApi.settingsFile,
  getOwnerWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined),
  isServerRunning: () => !!(serverChild && serverChild.exitCode === null),
  // v0.7.10（老大反馈）：恢复数据前可只停 DSH 服务（不退出应用），而非要求整体退出
  stopServerOnly,
  // v0.7.10（老大反馈）：备份进度条 —— 进度窗口 + 主窗口任务栏进度
  openBackupProgress, updateBackupProgress, closeBackupProgress,
  setQuitting: () => { isQuitting = true; },
});

// ---------------------------------------------------------------------------
// 现代化窗口（v0.5.3）：更新 / 联系我们 / 关于（安全基线：contextIsolation+sandbox）
// ---------------------------------------------------------------------------
// 用户设置（v0.6.1 T-027）：持久化到 userData/settings.json
//  - autostart        开机自启（设置菜单 / 托盘菜单勾选）
//  - minimizeToTray   最小化到托盘总开关（关闭窗口行为：关闭即退出 / 托盘常驻）
//  - closeChoice      记住的关闭选择：'quit' | 'tray' | null（null = 每次询问）
//  - rememberCloseChoice 是否记住关闭选择
// ---------------------------------------------------------------------------
let settings = {
  autostart: false,
  minimizeToTray: true,
  closeChoice: null,
  rememberCloseChoice: false,
  closeAsk: false,            // v1.0.3：关闭时总是询问（勾选后每次关闭弹窗；默认不询问=直接托盘）
  checkUpdateOnStart: true,   // v0.6.5（T-030）：启动时检查更新并弹窗询问（默认开启）
  winBounds: null,            // T5（v0.6.6）：主窗口位置/大小 {x,y,width,height}
  winMaximized: false,        // T5：最大化状态
  webOpenBtnPos: null,        // v0.7.6（T-037）：网页打开按钮拖拽位置（退出保存，重启恢复；null=默认顶部居中）
  hotkey: 'Ctrl+Alt+D',       // v0.8.1（T4）：全局快捷键（呼出/隐藏主窗口；null = 禁用）
  promptInjectChoice: null,   // v0.8.7（P0-3）：提示词注入已有内容时的记住选择：'overwrite' | 'append' | null（null = 每次询问）
  readNotices: [],            // v0.8.11（T0.6）：已读公告 id 数组（有新公告时帮助菜单标「（新）」）
  petHidden: false,           // v0.8.11（T5）：桌面宠物隐藏（设置菜单开关 / 右键隐藏）
  petInjectCount: 0,          // v0.8.11（T4）：当天提示词注入次数（连续使用彩蛋）
  petInjectCountDate: '',     // v0.8.11（T4）：注入次数统计日期（localDate，跨天清零）
  appearance: 'system',       // v0.8.18：外观 'system' | 'light' | 'dark'（nativeTheme.themeSource）
};

// v0.8.1（T5）：settingsFile/loadSettings/saveSettings/setAutostart/setMinimizeToTray/
// setCloseChoice/clearCloseChoice/setCheckUpdateOnStart 已移至 modules/settings.js（settingsApi）

// v0.8.12（优化方案）：菜单逻辑已移入 modules/menu.js；refreshMenus 经晚绑定引用
// （createSettings/tray/hotkey 组装早于 menuApi，用引用打破循环依赖）
let refreshMenusRef = () => {};
let saveSettingsRef = () => {}; // v0.8.18：外观弹窗晚绑定（settingsApi 组装在后）
const menuApi = createMenu({
  Menu, shell, app, path,
  logPath,
  getSettings: () => settings,
  setAutostart: settingsApi.setAutostart,
  setMinimizeToTray: settingsApi.setMinimizeToTray,
  setCloseAsk: settingsApi.setCloseAsk, // v1.0.3：关闭时总是询问开关
  setCheckUpdateOnStart: settingsApi.setCheckUpdateOnStart,
  clearCloseChoice: settingsApi.clearCloseChoice,
  saveSettings: settingsApi.saveSettings,
  setHotkey: hotkeyApi.setHotkey,
  backupUserData, restoreUserData,
  openUpdateWindow, openNoticeWindow, openChangelogWindow, openContactWindow, openAboutWindow,
  generateDiagnostics,
  // v0.8.16：injectPet 传参移除（设置菜单「显示桌面宠物」已删，见 menu.js）
  resetWebOpenBtnLayout,
  hasNewNotices,
  getMainWindow: () => mainWindow,
  getShellHasUpdate: () => shellHasUpdate,
  getDshHasUpdate: () => dshHasUpdate,
  // v0.9.5（T3）：公告唯一源 notice.json（noticeApi），公告菜单「（新）」标记同源
  getShellNotices: () => noticeApi.getNotices(),
  getMarquee: () => noticeApi.getMarquee(),
  isTrayCreated: () => trayApi.isTrayCreated(),
  updateTrayMenu: () => trayApi.updateTrayMenu(),
  openAppearanceDialog, // v0.8.18：设置菜单「外观…」
});
refreshMenusRef = menuApi.refreshMenus;
saveSettingsRef = settingsApi.saveSettings;
// v0.8.13（T2 补充修复）：解构 buildMenu —— whenReady / checkUpdatesOnStart 直接调用
// buildMenu()，缺解构会抛 ReferenceError: buildMenu is not defined → 进程活着但
// 无窗口、无托盘（老大全新系统实测；0.8.12 覆盖安装"双击无反应"同因）。
const { buildMenu } = menuApi;


// v0.8.1（T5）：createTray/updateTrayMenu 已移至 modules/tray.js（trayApi）
// 系统托盘（v0.6.0 T-025）：关闭窗口 ≠ 退出，托盘常驻；仅托盘「退出」真正退出

/**
 * 等待 DSH 服务就绪（轮询 currentStage；timeoutMs 超时 reject）。
 * v0.8.1（T1）：静默启动后托盘点击可能早于服务就绪，等待就绪再建窗口避免加载失败/白屏。
 */
function waitForServerReady(timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (getCurrentStage() === 'ready') { clearInterval(timer); resolve(); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(timer); reject(new Error('timeout')); }
    }, 500);
  });
}

/** 恢复主窗口：存在则显示/还原/聚焦；已被关闭（托盘模式）则按需重建（服务就绪后才建） */
function showMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else if (serverChild && getCurrentStage() === 'ready') {
    createMainWindow();
  } else if (serverChild) {
    // 服务还在启动：等待就绪（最多 10s）再建窗口，避免加载失败/白屏
    appendLog('info', 'DSH 服务未就绪，等待就绪后打开主窗口…');
    waitForServerReady(10000).then(() => {
      if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    }).catch(() => appendLog('warn', '等待 DSH 服务就绪超时，请稍后从托盘重试'));
  } else {
    appendLog('warn', '主窗口恢复请求被忽略：DSH 服务未启动');
  }
}

// v0.8.1（T4/T5）：registerHotkey/toggleMainWindowByHotkey/setHotkey 已移至
// modules/hotkey.js（hotkeyApi）；启动注册与退出清理见 app ready / will-quit

// ---------------------------------------------------------------------------
// 菜单（v0.8.12：逻辑已移入 modules/menu.js）


/**
 * 启动时检查更新（v0.6.5 T-030）：并发检查 DSH + 壳。
 *  - 有新版 → 置标志 + 日志 + 重建菜单（「检查更新（有新版本）」提示）
 *  - 壳有新版且设置「启动时检查更新」开启 → 弹窗询问「立即更新 / 稍后」
 *    （立即更新 = 自动下载 + SHA256 校验 + 打开安装包）
 */
async function checkUpdatesOnStart() {
  const cfg = readShellConfig();
  // v0.9.5（T3）：公告拉取与版本检查并行；拉取成功 → 刷新菜单（公告条 + 「公告（新）」标记）
  noticeApi.fetchLatest().then((notice) => {
    if (notice) refreshMenusRef();
  }).catch(() => { /* ignore */ });
  const [dshLatest, shellInfo] = await Promise.all([
    fetchLatestDshVersion(),
    fetchLatestShellVersion(),
  ]);

  // DSH 侧：保持静默提示（升级入口在更新窗口，一键升级改 config 重启）
  if (dshLatest) {
    const dshCurrent = installedDshVersion() ?? cfg.dshVersion;
    if (compareSemver(dshCurrent, dshLatest) < 0) {
      dshHasUpdate = true;
      appendLog('info', `DSH 有新版本：${dshCurrent} → ${dshLatest}（更新窗口可一键升级）`);
    }
  }

  // 壳侧：有新版本 → 按设置弹窗询问（force=true 重大漏洞时无视开关强制弹窗）
  if (shellInfo && compareSemver(app.getVersion(), shellInfo.version) < 0) {
    shellHasUpdate = true;
    appendLog('info', `DSH-Desktop 有新版本：${app.getVersion()} → ${shellInfo.version}`);
    if (settings.checkUpdateOnStart || shellInfo.force) promptShellUpdate(shellInfo);
  }

  // v0.7.10（29 建议 A）：minVersion 门槛 —— 当前版本低于服务端声明的最低支持版本时，
  // 无视「启动时检查更新」开关强制提示升级（重大漏洞下线旧版场景，配合 force 使用）。
  // 仅当壳本身有新版本时才有意义（minVersion 由新 version.json 下发，若已是最新则无需处理）。
  if (shellInfo && shellInfo.minVersion &&
      compareSemver(app.getVersion(), shellInfo.version) < 0 &&
      compareSemver(app.getVersion(), shellInfo.minVersion) < 0) {
    appendLog('warn', `当前版本 v${app.getVersion()} 低于最低支持版本 v${shellInfo.minVersion}，强制提示更新`);
    promptShellUpdate(shellInfo);
  }

  if (dshHasUpdate || shellHasUpdate) Menu.setApplicationMenu(buildMenu());
}

/**
 * v0.9.7（老大反馈：公告要重启应用才刷新）：运行中定时自动拉取公告源。
 * 每 NOTICE_REFRESH_MS 拉一次 notice.json，拉到新内容 → 刷新菜单（公告条 + 「公告（新）」标记）；
 * 版本未变时 notice.js 静默（不刷日志）；拉取失败沿用缓存（公告条不闪没）。
 */
const NOTICE_REFRESH_MS = 10 * 60 * 1000; // 10 分钟
let noticeRefreshTimer = null;
function startNoticeAutoRefresh() {
  if (noticeRefreshTimer) return;
  noticeRefreshTimer = setInterval(() => {
    noticeApi.fetchLatest()
      .then(() => refreshMenusRef())
      .catch(() => { /* 拉取失败：沿用缓存，静默 */ });
  }, NOTICE_REFRESH_MS);
  appendLog('info', `公告自动刷新已启动（每 ${NOTICE_REFRESH_MS / 60000} 分钟）`);
}

/** 壳更新弹窗询问：立即更新（下载+校验+打开安装包）或稍后 */
function promptShellUpdate(info) {
  const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  dialog.showMessageBox(owner, {
    type: 'info',
    title: APP_NAME,
    message: `发现新版本 v${info.version}（当前 v${app.getVersion()}）`,
    detail: '是否立即下载更新？下载完成后自动打开安装包。',
    buttons: ['立即更新', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }).then(({ response }) => {
    if (response !== 0) return;
    appendLog('info', '用户确认更新，开始下载…');
    downloadShellUpdate(mainWindow, (percent) => {
      if (updateWin && !updateWin.isDestroyed()) {
        updateWin.webContents.send('update:progress', { percent });
      }
    }).then((r) => {
      if (r && !r.ok) {
        appendLog('error', `自动更新失败：${r.reason}${r.message ? ' ' + r.message : ''}`);
        let reasonText = {
          'fetch-failed': '无法连接更新源，请检查网络',
          'no-update': '当前已是最新版本',
          'download-failed': '所有下载源均失败，请稍后重试',
          'hash-mismatch': '下载的安装包校验不通过（已删除），请重新下载',
        }[r.reason] || '未知错误';
        // v0.6.7（T-031）：写入被拒（EPERM/EACCES）时给出可操作提示
        if (r.reason === 'download-failed' && r.message) {
          if (/EPERM|EACCES/.test(r.message)) {
            reasonText = '安装包写入被拒绝（可能被其他程序或安全软件占用/拦截）。请关闭可能占用文件的程序后重试，或到 GitHub Releases 手动下载安装包。';
          } else {
            reasonText += `（${r.message}）`;
          }
        }
        dialog.showMessageBox(mainWindow, {
          type: 'error',
          title: APP_NAME,
          message: '更新下载失败',
          detail: reasonText,
          buttons: ['打开更新窗口', '关闭'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        }).then(({ response: resp }) => {
          if (resp === 0) openUpdateWindow();
        }).catch(() => { /* ignore */ });
      }
    });
  }).catch(() => { /* ignore */ });
}

// ---------------------------------------------------------------------------
// 应用生命周期
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // v0.9.13（老大反馈：关闭到托盘后双击桌面图标弹"已在运行中"）：去掉该弹框 ——
  // 第二实例静默退出，第一实例的 second-instance 事件负责恢复显示主窗口
  //（双击桌面图标 = 直接显示界面，与托盘模式体验一致）
  app.quit();
} else {
  app.on('second-instance', () => {
    // P2-5 + v0.8.8（T4）：优先聚焦顶层 modal 窗口；无 modal 时走 showMainWindow()
    // 修复：主窗口隐藏（托盘）时双击快捷方式/图标，必须真正恢复显示（show+restore+focus），不能只 focus
    const modal = [updateWin, contactWin, aboutWin, changelogWin, promptLibWin, noticeWin].find((w) => w && !w.isDestroyed());
    if (modal) {
      if (modal.isMinimized()) modal.restore();
      modal.focus();
    } else {
      showMainWindow();
    }
  });

  app.whenReady().then(async () => {
    // v0.6.1（T-027）：加载设置；开机自启以注册表实际状态为准（用户可能在系统设置里改过）
    settingsApi.loadSettings();
    try { settings.autostart = app.getLoginItemSettings().openAtLogin; } catch { /* ignore */ }
    settingsApi.saveSettings();

    // v0.8.18：应用外观（nativeTheme.themeSource：'system' | 'light' | 'dark'）
    // 设置后 webContents 的 prefers-color-scheme 自动变化 → DSH 页面若用媒体查询即自动同步
    applyAppearance(settings.appearance || 'system');

    Menu.setApplicationMenu(buildMenu());
    trayApi.createTray(); // v0.6.0（T-025）：启动即创建托盘图标
    // v0.8.1（T4）：注册全局快捷键（呼出/隐藏主窗口；默认 Ctrl+Alt+D，注册失败仅告警不阻塞启动）
    hotkeyApi.registerHotkey(settings.hotkey);
    // v0.8.12（优化方案）：全部 IPC handler 集中注册到 modules/ipc.js
    registerIpc({
      ipcMain, app, clipboard, shell, dialog, path, fs,
      appendLog, localDate, appName: APP_NAME,
      readShellConfig, installedDshVersion,
      fetchLatestDshVersion, fetchLatestShellVersion, compareSemver, effectiveLatest,
      queryUpdateInfo, upgradeDshVersion, downloadShellUpdate,
      getMainWindow: () => mainWindow,
      getUpdateWin: () => updateWin,
      getAboutWin: () => aboutWin,
      getSettings: () => settings,
      saveSettings: () => settingsApi.saveSettings(),
      refreshMenus: () => refreshMenusRef(),
      openPromptLibWindow, openUpdateWindow,
      getWebUrl: webUrl,
      getResolvedPort: () => resolvedPort,
      getCurrentStage,
      // v0.9：提示词注入公共链路 + 拖文件处理 + 工作区定位
      promptInject, handleDropFiles, getWorkspacePath,
      // v0.9.5：自定义提示词（T2）+ 公告模块（T3，notice:data 唯一源）
      customPrompts: customPromptsApi,
      noticeApi,
      // v0.9.12：全局记忆（读写 AGENTS.md + 打开编辑窗口 + 覆盖确认宿主窗口）
      globalMemory: globalMemoryApi,
      openGlobalMemoryWindow,
      getGlobalMemoryWin: () => globalMemoryWin,
      // v0.9.13：角色选择（新对话选角色 / 双击输入框重选）
      pickAndInjectRole: () => roleSelectorApi.pickAndInject(),
    });

    resolvedPort = parsePortArg() ?? await pickPort(DEFAULT_PORT);
    appendLog('info', `${APP_NAME} v${app.getVersion()} 启动，目标端口 ${resolvedPort}`);
    appendLog('info', `用户数据目录：${app.getPath('userData')}`);
    appendLog('info', `DSH 运行器策略：${resolveRunner().label}`);

    // T4（v0.6.6）：自启静默启动 —— 开机自启时不弹窗口，后台运行 + 托盘常驻
    // v0.8.1（T1 修复）：用系统级 API 判断「本次启动确实由系统登录自启触发」，
    // 而非「用户是否勾选过自启」的持久化配置（双击快捷方式/更新后重启会误判为静默）
    const openedAtLogin = (() => {
      try { return app.getLoginItemSettings().wasOpenedAtLogin; } catch { return false; }
    })();
    const silentStart = openedAtLogin && settings.minimizeToTray;
    appendLog('info', `启动模式：${silentStart ? '静默（系统自启触发，托盘常驻）' : '正常（显示窗口）'}（wasOpenedAtLogin=${openedAtLogin}）`);

    if (!silentStart) {
      createLoadingWindow();
      attachWebDiagnostics(loadingWindow, 'loading');
    }
    pushStage('check');

    // v0.9.12（老大指令）：未配置全局记忆 → 插入引导句（DSH 第一次对话引导用户配置）
    // v0.9.13（老大指令）：已存在记忆但不符标准格式 → 记录，主窗口就绪后注入整理提示
    let memoryFormatMismatch = false;
    const guideRes = globalMemoryApi.ensureGuide();
    if (guideRes && guideRes.formatMismatch) memoryFormatMismatch = true;

    try {
      await spawnServer(resolvedPort);
      await waitForServer(DEFAULT_HOST, resolvedPort, SERVER_READY_TIMEOUT_MS);
      appendLog('info', `DSH 服务就绪：${webUrl()}`);
      pushStage('ready');

      // 审查 H2：服务就绪后关闭 loading 窗口，新建 1440×900 主窗口承载 GUI
      if (!silentStart) {
        if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.close();
        loadingWindow = null;
        createMainWindow();
        // v0.9.15（老大指令：新建对话不提示）：不再轮询/弹窗选角色；
        // 双击 DSH 输入框 → 随时重选角色（v0.9.13 老大反馈：选错角色不用重开新对话）
        roleSelectorApi.injectDblclick(mainWindow);
        // v0.9.13（老大指令）：记忆格式不符标准 → 主窗口加载完成后注入整理提示词
        // （让 DSH 按标准格式整理现有记忆，不改变原意）
        // v0.9.16（外审 zx(9) 复核 N3）：仅首次启动注入 —— 标记文件防每次启动重复覆盖输入框
        const tidyMarker = path.join(os.homedir(), '.dsh', '.format-tidy-injected');
        if (memoryFormatMismatch && !fs.existsSync(tidyMarker)) {
          setTimeout(() => {
            const mw = mainWindow;
            if (mw && !mw.isDestroyed()) {
              promptInject.injectTextIntoInput(mw, globalMemoryApi.FORMAT_TIDY_PROMPT, { celebrate: false })
                .then(() => {
                  try { fs.writeFileSync(tidyMarker, '1', 'utf8'); } catch { /* ignore */ }
                })
                .catch(() => { /* ignore */ });
            }
          }, 3500);
        }
        // v0.8.21（老大反馈）：不再启动时自动同步 DSH 外观 ——
        // v0.8.19 的 setTimeout(syncDshAppearance, 4000) 每次启动都会打开
        // DSH 设置面板；改为仅用户主动选择外观时同步（openAppearanceDialog）。
        // 启动时仅设置壳外观（applyAppearance 已去掉 DSH 同步），
        // 并启动反向监听：DSH 面板改外观 → 壳跟随。
        startDshThemeWatch();
      } else {
        appendLog('info', '静默启动：主窗口不创建（托盘常驻），可从托盘打开主界面');
      }

      // 任务B-B4 / G1 / v0.6.5（T-030）：启动时检查更新（DSH + 壳）——
      // 壳有新版且设置「启动时检查更新」开启（或 force 强制）时弹窗询问「立即更新 / 稍后」
      checkUpdatesOnStart();
      // v0.9.7：公告定时自动刷新（运行中改公告不须重启）
      startNoticeAutoRefresh();
    } catch (err) {
      appendLog('error', `启动失败：${err.message}`);
      if (loadingWindow && !loadingWindow.isDestroyed()) {
        // L5：HTML 转义先 & 后其他（审查 v2.0 低危项）
        const esc = String(err.message)
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        loadingWindow.webContents.executeJavaScript(
          `document.body.insertAdjacentHTML('beforeend',
            '<div style="position:fixed;inset:auto 0 0 0;padding:14px 20px;background:#3a1414;color:#ffb4b4;font-size:13px;text-align:center;">启动失败：${esc}</div>')`,
        ).catch(() => { /* ignore */ });
      }
      dialog.showErrorBox(APP_NAME, `无法启动 DSH 服务：\n${err.message}\n\n详细日志：${logPath()}`);
      stopServer(); // 清理可能残留的子进程（审查 M1）
      app.quit();
    }
  });

  // v0.6.0（T-025）：before-quit 统一标记"真正退出"（托盘退出/菜单退出/系统关机均走这里）
  app.on('before-quit', () => { isQuitting = true; stopServer(); });
  app.on('will-quit', () => {
    appendLog('info', '应用退出中…');
    // v0.9.7：退出清理公告自动刷新定时器
    if (noticeRefreshTimer) { clearInterval(noticeRefreshTimer); noticeRefreshTimer = null; }
    // v0.8.1（T4）：退出释放全局快捷键（防残留占用）
    hotkeyApi.unregisterAll();
    // 审查 v12 P1-2：SIGTERM 宽限期定时器可能随主进程退出被终止，导致残留子进程
    // 未被强制清理；这里在真正退出前同步兜底 SIGKILL 一次（幂等，安全）。
    for (const child of trackedChildren) {
      try {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      } catch { /* ignore */ }
    }
  });
  app.on('quit', (_event, exitCode) => { appendLog('info', `应用已退出，code=${exitCode}`); });
  // v0.6.0（T-025）/ v0.6.1（T-027）：关闭窗口 ≠ 退出 —— 启用托盘常驻时所有窗口关闭后
  // 托盘驻留、DSH 服务继续运行；未启用托盘常驻或"真正退出"（isQuitting）时随关窗退出。
  app.on('window-all-closed', () => {
    if (isQuitting || !settings.minimizeToTray) { app.quit(); return; }
    appendLog('info', '主窗口已关闭（最小化到托盘），DSH 服务继续运行，可从托盘恢复');
  });
  app.on('activate', () => {
    // Windows-only 应用；若服务已就绪且无窗口，重建主窗口（审查 L4）
    if (BrowserWindow.getAllWindows().length === 0 && serverChild) createMainWindow();
  });
}
