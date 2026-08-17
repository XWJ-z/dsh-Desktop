'use strict';

/**
 * check-v090.js — v0.9 拖动文件功能自动验证（不启动 Electron）
 *
 * 覆盖：
 *  1. preload.js：webUtils.getPathForFile 暴露 + dropFiles IPC 转发
 *  2. modules/workspace.js：三档工作区定位（当前会话→projcache cwd /
 *     最近活跃会话 / 唯一注册工作区）
 *  3. modules/drop-files.js：单文件 / 重名 (1) / 文件夹递归 / .lnk /
 *     大文件异步 / 无工作区 / 注入失败降级 / 提示词文案
 *  4. modules/prompt-inject.js：聚焦 + insertText 注入链路
 *
 * 用法：node tests/check-v090.js
 */

const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

// ---------------------------------------------------------------------------
// 1. preload.js
// ---------------------------------------------------------------------------
function testPreload() {
  console.log('[1] preload.js');
  let exposed = null;
  const invoked = [];
  const mockElectron = {
    contextBridge: { exposeInMainWorld: (key, api) => { exposed = api; } },
    ipcRenderer: { invoke: (channel, arg) => { invoked.push([channel, arg]); return Promise.resolve('ok'); } },
    webUtils: {
      getPathForFile: (file) => {
        if (file && file.__isRealFile) return 'C:\\real\\file.txt';
        throw new Error('not a File');
      },
    },
  };
  const origLoad = Module._load;
  Module._load = function (request, _parent, _isMain) {
    if (request === 'electron') return mockElectron;
    return origLoad.apply(this, arguments);
  };
  require('../preload.js');
  Module._load = origLoad;

  ok(exposed && typeof exposed.getPathForFile === 'function', '暴露 getPathForFile');
  ok(exposed && typeof exposed.dropFiles === 'function', '暴露 dropFiles');
  ok(exposed.getPathForFile({ __isRealFile: true }) === 'C:\\real\\file.txt', 'getPathForFile 返回真实路径');
  ok(exposed.getPathForFile({}) === '', 'getPathForFile 异常返回空串');
  exposed.dropFiles(['a.txt']);
  ok(invoked.length === 1 && invoked[0][0] === 'drop:files' && invoked[0][1][0] === 'a.txt', 'dropFiles → ipcRenderer.invoke("drop:files")');
}

// ---------------------------------------------------------------------------
// 2. workspace.js
// ---------------------------------------------------------------------------
function makeFakeWin(localStorageValue) {
  return {
    isDestroyed: () => false,
    webContents: {
      executeJavaScript: () => Promise.resolve(localStorageValue),
    },
  };
}

function testWorkspace() {
  console.log('[2] workspace.js 工作区定位');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v090-ws-'));
  const storages = path.join(tmp, 'storages');
  fs.mkdirSync(storages, { recursive: true });
  const wsA = path.join(tmp, 'workspace-a');
  const wsB = path.join(tmp, 'workspace-b');
  fs.mkdirSync(wsA, { recursive: true });
  fs.mkdirSync(wsB, { recursive: true });

  // projcache：session-cur → wsA（lastPromptAt 大），session-old → wsB（小）
  fs.writeFileSync(path.join(storages, 'session_projcache.json'), JSON.stringify({
    unit: { name: 'session_projcache', version: 3 },
    global: null,
    tables: {
      sessions: {
        'session-old': {
          identity: { createdAt: 1, cwd: wsB },
          rows: { sessionListMetadata: { ver: 1, val: { lastPromptAt: 100 } } },
        },
        'session-cur': {
          identity: { createdAt: 2, cwd: wsA },
          rows: { sessionListMetadata: { ver: 1, val: { lastPromptAt: 999 } } },
        },
      },
    },
  }), 'utf8');

  const { createWorkspaceLocator } = require('../modules/workspace');
  const api = createWorkspaceLocator({ fs, os, path, appendLog: () => {} });

  // ① 当前会话（localStorage dsh.sessions.current）
  process.env.DSH_HOME = tmp;
  api.getWorkspacePath(makeFakeWin(JSON.stringify({ sessionId: 'session-cur' })))
    .then((p) => {
      ok(p === wsA, `T1 当前会话 → projcache cwd（${p}）`);
      // ② localStorage 读不到 → 最近活跃会话（lastPromptAt 最大 = wsA）
      return api.getWorkspacePath(makeFakeWin(null));
    })
    .then((p) => {
      ok(p === wsA, `T2 localStorage 不可读 → 最近活跃会话（${p}）`);
      // ③ 无 projcache → 唯一注册工作区
      fs.rmSync(path.join(storages, 'session_projcache.json'), { force: true });
      fs.writeFileSync(path.join(storages, 'workspace.json'), JSON.stringify({
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, workspaceIds: ['w1'] },
        tables: { workspaces: { w1: { path: wsB, title: 'b' } } },
      }), 'utf8');
      return api.getWorkspacePath(makeFakeWin(null));
    })
    .then((p) => {
      ok(p === wsB, `T3 无会话记录 → 唯一注册工作区（${p}）`);
      // ④ 全无 → null
      fs.rmSync(path.join(storages, 'workspace.json'), { force: true });
      return api.getWorkspacePath(makeFakeWin(null));
    })
    .then((p) => {
      ok(p === null, 'T4 无任何记录 → null');
      fs.rmSync(tmp, { recursive: true, force: true });
      delete process.env.DSH_HOME;
    })
    .catch((err) => { failed++; console.error('  ✗ workspace 测试异常：', err); });
}

// ---------------------------------------------------------------------------
// 3. drop-files.js
// ---------------------------------------------------------------------------
function testDropFiles() {
  console.log('[3] drop-files.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v090-drop-'));
  const ws = path.join(tmp, 'ws');
  const src = path.join(tmp, 'src');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(src, { recursive: true });

  const bubbles = [];
  const fakeWin = { isDestroyed: () => false };
  const { createDropFiles } = require('../modules/drop-files');
  const api = createDropFiles({
    fs, path,
    appendLog: () => {},
    getWorkspacePath: async () => ws,
    promptInject: { injectTextIntoInput: async (_win, text) => ({ ok: true, mode: 'overwrite', text }) },
    petBubble: (_win, text) => bubbles.push(text),
    getMainWindow: () => fakeWin,
  });

  // ① 单文件复制 + 注入文案（v0.9.3：复制进工作区/拖入文件/，提示词带相对路径）
  fs.writeFileSync(path.join(src, 'a.txt'), 'hello');
  api.handleDropFiles([path.join(src, 'a.txt')]).then((r) => {
    ok(r.ok && r.copied.length === 1 && r.copied[0] === '拖入文件/a.txt', `单文件复制（${r.copied[0]}）`);
    ok(r.injected === '请分析工作区里的文件：拖入文件/a.txt', `单文件提示词（${r.injected}）`);
    ok(fs.readFileSync(path.join(ws, '拖入文件', 'a.txt'), 'utf8') === 'hello', '文件内容正确');
    ok(fs.statSync(path.join(ws, '拖入文件')).isDirectory(), '专用文件夹「拖入文件」已创建');

    // ② 重名 → a (1).txt
    return api.handleDropFiles([path.join(src, 'a.txt')]);
  }).then((r) => {
    ok(r.ok && r.copied[0] === '拖入文件/a (1).txt', `重名自动 (1)（${r.copied[0]}）`);
    ok(fs.existsSync(path.join(ws, '拖入文件', 'a.txt')), '原文件未被覆盖');

    // ③ 多文件提示词（用新文件，避免与前面的重名链叠加）
    fs.writeFileSync(path.join(src, 'c.txt'), 'c');
    fs.writeFileSync(path.join(src, 'd.txt'), 'd');
    return api.handleDropFiles([path.join(src, 'c.txt'), path.join(src, 'd.txt')]);
  }).then((r) => {
    ok(r.injected === '请分析工作区里的这些文件：拖入文件/c.txt、拖入文件/d.txt', `多文件提示词（${r.injected}）`);

    // ④ 文件夹递归复制（文件夹整体放入 拖入文件/ 下）
    const sub = path.join(src, 'folder');
    fs.mkdirSync(path.join(sub, 'deep'), { recursive: true });
    fs.writeFileSync(path.join(sub, 'f1.txt'), '1');
    fs.writeFileSync(path.join(sub, 'deep', 'f2.txt'), '2');
    return api.handleDropFiles([sub]);
  }).then((r) => {
    ok(r.ok && fs.existsSync(path.join(ws, '拖入文件', 'folder', 'deep', 'f2.txt')), '文件夹递归复制（拖入文件/folder/…）');
    ok(fs.readFileSync(path.join(ws, '拖入文件', 'folder', 'f1.txt'), 'utf8') === '1', '文件夹内容正确');

    // ⑤ .lnk 原样复制（不解析目标）
    fs.writeFileSync(path.join(src, 'shortcut.lnk'), 'LINK');
    return api.handleDropFiles([path.join(src, 'shortcut.lnk')]);
  }).then((r) => {
    ok(r.ok && r.copied[0] === '拖入文件/shortcut.lnk', '.lnk 原样复制');
    ok(fs.readFileSync(path.join(ws, '拖入文件', 'shortcut.lnk'), 'utf8') === 'LINK', '.lnk 内容未解析');

    // ⑥ 大文件（>50MB）异步复制 + 进行中气泡
    const big = path.join(src, 'big.bin');
    fs.writeFileSync(big, Buffer.alloc(51 * 1024 * 1024));
    return api.handleDropFiles([big]);
  }).then((r) => {
    ok(r.ok && fs.existsSync(path.join(ws, '拖入文件', 'big.bin')), '大文件异步复制成功');
    ok(bubbles.includes('正在复制大文件…请稍候'), '大文件复制气泡提示');
    ok(bubbles.includes('文件已放入工作区，发送消息即可分析～'), '成功气泡提示');

    // ⑦ 无工作区 → 友好提示
    const apiNoWs = createDropFiles({
      fs, path,
      appendLog: () => {},
      getWorkspacePath: async () => null,
      promptInject: { injectTextIntoInput: async () => ({ ok: true }) },
      petBubble: (_win, text) => bubbles.push(text),
      getMainWindow: () => fakeWin,
    });
    return apiNoWs.handleDropFiles([path.join(src, 'a.txt')]);
  }).then((r) => {
    ok(r.ok === false && r.reason === 'no-workspace', '无工作区 → no-workspace');
    ok(bubbles.some((t) => t.includes('请先在 DSH 里选择工作区')), '无工作区气泡提示');

    // ⑧ 注入失败 → 降级（文件已复制，用户自行输入）
    const apiFail = createDropFiles({
      fs, path,
      appendLog: () => {},
      getWorkspacePath: async () => ws,
      promptInject: { injectTextIntoInput: async () => ({ ok: false, reason: 'not-found' }) },
      petBubble: (_win, text) => bubbles.push(text),
      getMainWindow: () => fakeWin,
    });
    return apiFail.handleDropFiles([path.join(src, 'c.txt')]);
  }).then((r) => {
    ok(r.ok === true && r.injected === null, '注入失败 → ok:true + injected:null（降级不报错）');
    ok(bubbles.some((t) => t.includes('在输入框输入提示词即可分析')), '降级气泡提示');

    fs.rmSync(tmp, { recursive: true, force: true });
  }).catch((err) => { failed++; console.error('  ✗ drop-files 测试异常：', err); });
}

// ---------------------------------------------------------------------------
// 4. prompt-inject.js
// ---------------------------------------------------------------------------
function testPromptInject() {
  console.log('[4] prompt-inject.js');
  let inserted = '';
  const fakeWin = {
    isDestroyed: () => false,
    webContents: {
      insertText: (t) => { inserted = t; },
      executeJavaScript: (code) => {
        // focus 阶段返回当前内容（空）；选区设置阶段返回 undefined
        if (code.includes('document.activeElement !== el')) return Promise.resolve({ ok: true, current: '' });
        return Promise.resolve(undefined);
      },
    },
  };
  const state = { promptInjectChoice: null };
  const { createPromptInject } = require('../modules/prompt-inject');
  const api = createPromptInject({
    dialog: { showMessageBox: async () => ({ response: 0, checkboxChecked: false }) },
    appName: 'DSH-Desktop',
    getSettings: () => state,
    saveSettings: () => {},
    refreshMenus: () => {},
    localDate: () => '2026-08-17',
  });

  api.injectTextIntoInput(fakeWin, '请分析工作区里的文件：a.txt', { celebrate: false })
    .then((r) => {
      ok(r.ok === true && r.mode === 'overwrite', '注入成功（overwrite 模式）');
      ok(inserted === '请分析工作区里的文件：a.txt', 'insertText 收到完整文案');
      ok(state.petInjectCount === undefined, 'celebrate:false 不触发庆祝计数');
    })
    .catch((err) => { failed++; console.error('  ✗ prompt-inject 测试异常：', err); });
}

testPreload();
testWorkspace();
testDropFiles();
testPromptInject();

// 汇总在最后一个异步链完成时打印
setTimeout(() => {
  console.log('');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}, 1500);
