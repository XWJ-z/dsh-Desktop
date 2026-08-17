'use strict';

/**
 * cdp-drag-sim-check.js — v0.9 拖动文件 CDP 仿真真实验证（本机可跑）
 *
 * 背景：老大提问「CDP 仿真了吗」—— e2e T5 用例采用 CDP `Input.dispatchDragEvent`
 * （带 files）仿真 OS 文件拖拽，但从未真正跑过。本脚本实测验证这条关键链路：
 *
 *   CDP files → 渲染进程真实 File → preload webUtils.getPathForFile 取到绝对路径
 *   → dropFiles IPC → 真实 drop-files 复制逻辑 → 文件落盘 + 反馈
 *
 * 为什么不直接启动完整应用：本机 3080 正运行 DSH-Desktop（本会话），第二个实例
 * 会撞 requestSingleInstanceLock（锁基于 userData，Electron 用已知文件夹 API 取
 * appData，不认 APPDATA 环境变量）→ 启动即退出。因此用**最小 Electron 测试宿主**
 * （独立 userData → 锁不冲突），宿主加载 **真实 preload.js + 真实 modules/drag-drop.js
 * 注入 + 真实 modules/drop-files.js 复制逻辑**，其余（工作区定位/注入链路）由
 * tests/check-v090.js 单测覆盖 —— 两者合起来即完整 v0.9 链路。
 *
 * 用法：node tests/cdp-drag-sim-check.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('@playwright/test');

const APP_ROOT = path.join(__dirname, '..');

const HARNESS_MAIN = `
'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// 独立 userData（单实例锁基于 userData → 不与本机运行的 DSH-Desktop 冲突）
app.setPath('userData', process.env.SIM_USER_DATA);

const APP_ROOT = process.env.SIM_APP_ROOT;
const WORKSPACE = process.env.SIM_WORKSPACE;
const RESULT_FILE = process.env.SIM_RESULT_FILE;

const { createDragDrop } = require(path.join(APP_ROOT, 'modules', 'drag-drop.js'));
const { createDropFiles } = require(path.join(APP_ROOT, 'modules', 'drop-files.js'));

const win = null;
const dragDrop = createDragDrop({ appendLog: () => {} });
const bubbles = [];
const dropFiles = createDropFiles({
  fs, path,
  appendLog: () => {},
  getWorkspacePath: async () => WORKSPACE,
  promptInject: { injectTextIntoInput: async () => ({ ok: true, mode: 'overwrite' }) },
  petBubble: (_w, text) => bubbles.push(text),
  getMainWindow: () => BrowserWindow.getAllWindows()[0],
});
ipcMain.handle('drop:files', (_e, paths) => dropFiles.handleDropFiles(paths));

app.whenReady().then(() => {
  const w = new BrowserWindow({
    width: 1000, height: 700, show: false,
    webPreferences: {
      preload: path.join(APP_ROOT, 'preload.js'), // 真实 preload（webUtils）
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.loadURL('data:text/html,<title>cdp-sim</title><body><div id="app">cdp drag sim</div></body>');
  w.webContents.on('did-finish-load', () => {
    dragDrop.injectDropHandler(w); // 真实拖拽注入脚本
    w.show();
    // 就绪信号：写完 result 文件后再响应（测试侧轮询该文件）
    setTimeout(() => {
      fs.writeFileSync(RESULT_FILE + '.ready', 'ready', 'utf8');
    }, 500);
  });
  w.webContents.on('render-process-gone', (_e, d) => { fs.writeFileSync(RESULT_FILE + '.gone', JSON.stringify(d), 'utf8'); });
});

app.on('window-all-closed', () => app.quit());
`;

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cdp-sim-'));
  const workspace = path.join(tmpRoot, 'workspace');
  const userData = path.join(tmpRoot, 'userdata');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });

  const harnessFile = path.join(tmpRoot, 'harness-main.js');
  fs.writeFileSync(harnessFile, HARNESS_MAIN, 'utf8');

  const resultFile = path.join(tmpRoot, 'result');
  const srcFile = path.join(tmpRoot, `dsh-cdp-sim-${Date.now()}.txt`);
  fs.writeFileSync(srcFile, 'cdp drag simulation content', 'utf8');

  let passed = 0;
  let failed = 0;
  const ok = (cond, name) => { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.error(`  ✗ ${name}`); } };

  console.log('[1] 启动最小测试宿主（真实 preload + 真实 drag-drop 注入 + 真实 drop-files）');
  const app = await electron.launch({
    args: [harnessFile],
    cwd: APP_ROOT,
    env: {
      ...process.env,
      SIM_USER_DATA: userData,
      SIM_APP_ROOT: APP_ROOT,
      SIM_WORKSPACE: workspace,
      SIM_RESULT_FILE: resultFile,
    },
  });

  try {
    // 等待宿主就绪
    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
      if (fs.existsSync(resultFile + '.ready')) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    ok(fs.existsSync(resultFile + '.ready'), '宿主就绪（drag-drop 注入完成）');

    const win = app.windows()[0];
    ok(!!win, '拿到宿主窗口');

    // 确认注入脚本已安装
    const installed = await win.evaluate(() => !!window.__dshDropInstalled);
    ok(installed, '拖拽监听已注入（__dshDropInstalled）');

    // CDP 原生文件拖拽仿真
    const client = await win.context().newCDPSession(win);
    const box = await win.evaluate(() => ({ x: 500, y: 300 }));
    const dragData = {
      items: [
        { mimeType: 'text/plain', data: 'dsh-cdp-sim' },
        { mimeType: 'text/uri-list', data: `file:///${srcFile.replace(/\\/g, '/')}` },
      ],
      files: [srcFile],
      dragOperationsMask: 1,
    };
    try {
      await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x: box.x, y: box.y, data: dragData });
      await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: box.x, y: box.y, data: dragData });
      await client.send('Input.dispatchDragEvent', { type: 'drop', x: box.x, y: box.y, data: dragData });
      ok(true, 'CDP Input.dispatchDragEvent 派发成功（dragEnter/dragOver/drop）');
    } catch (err) {
      ok(false, `CDP 派发失败：${err.message}`);
    }

    // ★ 硬证据：文件被复制进隔离工作区的「拖入文件」专用文件夹
    // （CDP files → File → getPathForFile → IPC → 复制；v0.9.3 起归入子目录）
    const t1 = Date.now();
    let copied = null;
    const dropDir = path.join(workspace, '拖入文件');
    while (Date.now() - t1 < 20_000) {
      const entries = fs.existsSync(dropDir)
        ? fs.readdirSync(dropDir).filter((n) => n.startsWith('dsh-cdp-sim-'))
        : [];
      if (entries.length > 0) { copied = entries[0]; break; }
      await new Promise((r) => setTimeout(r, 300));
    }
    ok(!!copied, `★ 文件复制进隔离工作区/拖入文件/（${copied}）—— CDP 仿真全链路打通`);
    if (copied) {
      const content = fs.readFileSync(path.join(dropDir, copied), 'utf8');
      ok(content === 'cdp drag simulation content', '复制内容完整');
    }

    // 页面未导航（URL 仍是 data: 页面）
    const url = win.url();
    ok(url.startsWith('data:'), `页面未导航（${url.slice(0, 40)}…）`);

    // 渲染进程崩溃检查
    ok(!fs.existsSync(resultFile + '.gone'), '渲染进程未崩溃');
  } finally {
    await app.close();
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log('');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('验证异常：', err);
  process.exit(1);
});
