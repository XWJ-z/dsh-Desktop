'use strict';

/**
 * DSH-Desktop e2e 用例（T7 严格测试门禁首批 6 条，Windows 真机跑）
 *
 * 运行：npm run test:e2e
 * 说明见 playwright.config.js 与 README.md
 */

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');

const {
  APP_ROOT,
  launchApp,
  waitForMainWindow,
  waitForDropInstalled,
  waitForNewWindow,
} = require('./helpers');

// ---------------------------------------------------------------------------
// 读取主窗口输入框当前内容（DSH 透明 TEXTAREA + 渲染层；读辅助 textarea 的 value）
// ---------------------------------------------------------------------------
async function inputValue(win) {
  try {
    return await win.evaluate(() => {
      const el = document.activeElement;
      if (!el) return '';
      return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? (el.value || '') : (el.textContent || '');
    });
  } catch { return ''; }
}

test.describe.configure({ mode: 'serial' });

test('T1 启动：loading → 主窗口出现（DSH 服务就绪）', async () => {
  const app = await launchApp();
  try {
    const win = await waitForMainWindow(app);
    await win.waitForLoadState('domcontentloaded');
    expect(win.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+/);
    // 页面有真实内容（DSH React 挂载后 body 有子元素）
    await expect.poll(async () => {
      try {
        return await win.evaluate(() => document.body && document.body.children.length > 0);
      } catch { return false; }
    }, { timeout: 60_000 }).toBe(true);
  } finally {
    await app.close();
  }
});

test('T2 托盘常驻：关窗 → 进程存活 → 二次启动恢复', async () => {
  const app = await launchApp();
  try {
    const win = await waitForMainWindow(app);
    const url = win.url();
    // 关掉主窗口（按托盘常驻设置 → 隐藏而非退出）
    await win.close();
    await new Promise((r) => setTimeout(r, 3000));
    // 进程仍存活（托盘驻留）
    await expect(app.evaluate(() => true)).resolves.toBe(true);
    // 主窗口关闭后不应再有 GUI 窗口（托盘常驻）
    const visibleWins = app.windows().filter((w) => {
      try { return !w.isDestroyed(); } catch { return false; }
    });
    expect(visibleWins.length).toBe(0);
    // 二次启动（单实例锁 → 触发已运行实例 second-instance → showMainWindow）
    const child = isPackagedSpawn();
    child.unref();
    await expect.poll(async () => {
      for (const w of app.windows()) {
        try {
          if (!w.isDestroyed() && w.url() === url && (await inputValue(w)) !== undefined) return true;
        } catch { /* ignore */ }
      }
      return false;
    }, { timeout: 30_000 }).toBe(true);
  } finally {
    await app.close();
  }
});

/** 二次启动命令（打包 exe 或 dev electron） */
function isPackagedSpawn() {
  const { isPackaged, packagedExe } = require('./helpers');
  if (isPackaged()) {
    return spawn(packagedExe(), [], { stdio: 'ignore', detached: true, windowsHide: true });
  }
  return spawn(process.execPath, [path.join('node_modules', 'electron', 'cli.js'), path.join(APP_ROOT, 'main.js')], {
    cwd: APP_ROOT, stdio: 'ignore', detached: true, windowsHide: true,
  });
}

test('T3 全局快捷键 Ctrl+Alt+D 呼出/隐藏', async () => {
  const app = await launchApp();
  try {
    const win = await waitForMainWindow(app);
    await win.bringToFront();
    // 系统级 SendKeys 触发全局快捷键（Windows 真机）
    try {
      execFileSync('powershell', [
        '-NoProfile', '-STA', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^%d\')',
      ], { stdio: 'ignore', timeout: 10_000 });
    } catch (err) {
      console.warn('SendKeys 发送失败（继续按可见性断言）：', err.message);
    }
    // 快捷键为「呼出/隐藏」切换：窗口应隐藏
    await expect.poll(async () => {
      try {
        return await win.evaluate(() => document.visibilityState === 'hidden');
      } catch { return false; }
    }, { timeout: 10_000 }).toBe(true);
  } finally {
    await app.close();
  }
});

test('T4 提示词库：打开面板 → 注入输入框', async () => {
  const app = await launchApp();
  try {
    const win = await waitForMainWindow(app);
    await waitForDropInstalled(win);
    const before = app.windows().length;
    // 打开提示词库窗口（走 IPC 链路，与工具箱/宠物菜单同一入口）
    await win.evaluate(() => window.dshDesktop.openPromptLib());
    const libWin = await waitForNewWindow(app, before);
    await libWin.waitForLoadState('domcontentloaded');
    // 面板应渲染出内容（分类/列表）
    await expect.poll(async () => {
      try {
        return await libWin.evaluate(() => document.body.innerText.length > 50);
      } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);
    // 回到主窗口注入一条提示词（v0.8.6 链路：聚焦 + insertText）
    await win.evaluate(() => window.dshDesktop.injectPrompt('e2e 测试提示词'));
    await expect.poll(async () => inputValue(win), { timeout: 15_000 }).toContain('e2e 测试提示词');
  } finally {
    await app.close();
  }
});

test('T5 ★ 拖动文件：复制进工作区 + 注入提示词 + 不导航', async () => {
  const app = await launchApp();
  try {
    const win = await waitForMainWindow(app);
    await waitForDropInstalled(win);
    const urlBefore = win.url();

    // 构造真实拖入文件（临时目录，测试结束清理）
    const tmpFile = path.join(os.tmpdir(), `dsh-e2e-drop-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, 'e2e drag drop test content', 'utf8');

    // CDP 原生文件拖拽：Input.dispatchDragEvent 带 files → 渲染进程生成真实 File
    // （这是 Chromium 官方模拟 OS 文件拖拽的方式，webUtils.getPathForFile 可读到路径）
    const client = await win.context().newCDPSession(win);

    // ★ v0.9.2 防回归探针：模拟 DSH 自身 document 级拖放监听（DropOverlay owner），
    // 修复后 DSH 必须收不到任何文件拖放事件（否则「图片拖动添加界面」会激活并卡死）
    await win.evaluate(() => {
      window.__e2eDocDrag = { enter: 0, over: 0, drop: 0, leave: 0 };
      const count = (k) => () => { window.__e2eDocDrag[k]++; };
      document.addEventListener('dragenter', count('enter'), true);
      document.addEventListener('dragover', count('over'), true);
      document.addEventListener('drop', count('drop'), true);
      document.addEventListener('dragleave', count('leave'), true);
      window.__e2eStatusBaseline = Array.from(document.querySelectorAll('[role="status"]'))
        .map((el) => el.id || el.className || (el.textContent || '').slice(0, 24));
    });

    const box = await win.evaluate(() => {
      const r = document.documentElement.getBoundingClientRect();
      return { x: Math.round(r.width / 2), y: Math.round(r.height / 2) };
    });
    const dragData = {
      items: [
        { mimeType: 'text/plain', data: 'dsh-e2e' },
        { mimeType: 'text/uri-list', data: `file:///${tmpFile.replace(/\\/g, '/')}` },
      ],
      files: [tmpFile],
      dragOperationsMask: 1,
    };
    await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x: box.x, y: box.y, data: dragData });
    await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: box.x, y: box.y, data: dragData });
    await client.send('Input.dispatchDragEvent', { type: 'drop', x: box.x, y: box.y, data: dragData });

    // ① 不导航（页面仍在 DSH URL）
    expect(win.url()).toBe(urlBefore);

    // ①b ★ v0.9.2 防回归：DSH 页面收不到任何文件拖放事件 + 无拖放遮罩残留
    await expect.poll(async () => {
      try {
        const r = await win.evaluate(() => window.__e2eDocDrag);
        return r.enter === 0 && r.over === 0 && r.drop === 0 && r.leave === 0;
      } catch { return false; }
    }, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => {
      try {
        return await win.evaluate(() => {
          const now = Array.from(document.querySelectorAll('[role="status"]'))
            .map((el) => el.id || el.className || (el.textContent || '').slice(0, 24));
          return now.filter((s) => !(window.__e2eStatusBaseline || []).includes(s)).length === 0;
        });
      } catch { return false; }
    }, { timeout: 10_000 }).toBe(true);

    // ② 输入框被注入「请分析工作区里的文件：拖入文件/…」（复制 + 注入链路端到端）
    await expect.poll(async () => inputValue(win), { timeout: 20_000 })
      .toContain('请分析工作区里的文件：拖入文件/dsh-e2e-drop-');

    // ③ 气泡反馈出现（宠物气泡或 toast 含「文件已放入工作区」）
    await expect.poll(async () => {
      try {
        return await win.evaluate(() => {
          const b = document.querySelector('#dsh-pet .pet-bubble');
          if (b && b.style.display !== 'none' && b.textContent.includes('文件已放入工作区')) return true;
          const t = document.getElementById('dsh-drop-toast');
          if (t && t.style.display !== 'none' && t.textContent.includes('文件已放入工作区')) return true;
          return false;
        });
      } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);

    fs.rmSync(tmpFile, { force: true });
  } finally {
    await app.close();
  }
});

test('T6 更新窗口：打开 → 显示版本信息', async () => {
  const app = await launchApp();
  try {
    const win = await waitForMainWindow(app);
    const before = app.windows().length;
    await win.evaluate(() => window.dshDesktop.openUpdateWindow());
    const updWin = await waitForNewWindow(app, before);
    await updWin.waitForLoadState('domcontentloaded');
    await expect.poll(async () => {
      try {
        const text = await updWin.evaluate(() => document.body.innerText || '');
        return text.includes('DSH-Desktop') || text.includes('v0.9') || text.includes('版本');
      } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);
  } finally {
    await app.close();
  }
});
