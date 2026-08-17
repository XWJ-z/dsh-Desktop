'use strict';

/**
 * e2e 公共助手：应用启动 / 主窗口等待 / 注入就绪等待
 */

const { _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');

const APP_ROOT = path.join(__dirname, '..');

/** 打包产物路径（存在则优先用它；可被 DSH_E2E_EXE 覆盖） */
function packagedExe() {
  const env = process.env.DSH_E2E_EXE;
  if (env) return env;
  return path.join(APP_ROOT, 'dist', 'installer', 'win-unpacked', 'DSH-Desktop.exe');
}

function isPackaged() {
  return fs.existsSync(packagedExe());
}

/** 启动应用（打包 exe 或开发模式 electron .） */
async function launchApp() {
  const opts = { env: { ...process.env } };
  if (isPackaged()) {
    opts.executablePath = packagedExe();
    opts.args = [];
  } else {
    opts.args = [path.join(APP_ROOT, 'main.js')];
    opts.cwd = APP_ROOT;
  }
  return electron.launch(opts);
}

/** 等待主窗口（URL 为 http://127.0.0.1:<port>，即 DSH Web GUI） */
async function waitForMainWindow(electronApp, timeoutMs = 240_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const win of electronApp.windows()) {
      try {
        const url = win.url();
        if (/^http:\/\/127\.0\.0\.1:\d+/.test(url)) return win;
      } catch { /* 窗口可能正在销毁 */ }
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('等待 DSH 主窗口超时（240s）——请确认 DSH 服务能正常启动');
}

/** 等待页面内拖拽监听就绪（v0.9 T3 注入完成） */
async function waitForDropInstalled(page, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const installed = await page.evaluate(() => !!window.__dshDropInstalled);
      if (installed) return;
    } catch { /* 页面可能还在加载 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('拖拽监听未注入（30s 超时）');
}

/** 等待新窗口出现（提示词库/更新窗口等） */
async function waitForNewWindow(electronApp, currentWins, timeoutMs = 20_000) {
  const start = Date.now();
  const current = new Set(currentWins);
  while (Date.now() - start < timeoutMs) {
    for (const w of electronApp.windows()) {
      if (!current.has(w)) return w;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('新窗口未出现（20s 超时）');
}

module.exports = { APP_ROOT, packagedExe, isPackaged, launchApp, waitForMainWindow, waitForDropInstalled, waitForNewWindow };
