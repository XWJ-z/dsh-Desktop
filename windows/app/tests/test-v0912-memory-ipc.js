'use strict';

/**
 * test-v0912-memory-ipc.js — 全局记忆保存链路端到端测试（v0.9.12）
 *
 * 真实驱动 modules/ipc.js 的 registerIpc + memory:save handler（mock dialog/ipcMain），
 * 验证（针对老大反馈「点保存一直保存中」的回归防护）：
 *  1. dialog 解构修复：文件存在 + 确认「保存」→ 写盘成功（此前 dialog 未解构
 *     抛 TypeError → IPC reject → 前端卡死"保存中…"）；
 *  2. 确认「取消」→ 返回 cancelled 且不写盘；
 *  3. handler 内部异常 → 返回 {ok:false,message}（绝不 reject）；
 *  4. 文件不存在（首次）→ 不弹确认直接创建。
 *
 * 用法：node tests/test-v0912-memory-ipc.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createGlobalMemory } = require('../modules/global-memory');
const { registerIpc } = require('../modules/ipc');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

/** 构造 registerIpc 环境；dialogResponse 控制确认框返回（0=保存 1=取消） */
function setup({ dialogResponse = 0, saveThrow = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-memipc-'));
  const ipcMain = new EventEmitter();
  const handlers = {};
  ipcMain.handle = (channel, fn) => { handlers[channel] = fn; };
  const realMemory = createGlobalMemory({ fs, path, os: { homedir: () => tmp }, appendLog: () => {} });
  const globalMemory = saveThrow
    ? { ...realMemory, save: () => { throw new Error('模拟写盘失败'); } }
    : realMemory;
  const calls = { dialogs: 0 };
  const deps = {
    ipcMain,
    app: { getVersion: () => '0.9.12', getPath: () => tmp },
    clipboard: {}, shell: { openPath: async () => '' },
    dialog: { showMessageBox: async () => { calls.dialogs++; return { response: dialogResponse }; } },
    path, fs, appendLog: () => {},
    readShellConfig: () => ({}), installedDshVersion: () => null,
    fetchLatestDshVersion: async () => null, fetchLatestShellVersion: async () => null,
    compareSemver: () => 0, effectiveLatest: () => null,
    queryUpdateInfo: async () => ({}), upgradeDshVersion: async () => ({}), downloadShellUpdate: async () => ({}),
    getMainWindow: () => null, getUpdateWin: () => null, getAboutWin: () => null,
    getSettings: () => ({}), saveSettings: () => {}, refreshMenus: () => {},
    openPromptLibWindow: () => {}, openUpdateWindow: () => {}, getWebUrl: () => '',
    promptInject: {}, handleDropFiles: async () => ({}), getWorkspacePath: () => '',
    customPrompts: {}, noticeApi: {},
    globalMemory, openGlobalMemoryWindow: () => {}, getGlobalMemoryWin: () => null,
    appName: 'DSH-Desktop',
    getResolvedPort: () => 0, getCurrentStage: () => '',
  };
  registerIpc(deps);
  return { handlers, memory: realMemory, calls, tmp, target: path.join(tmp, '.dsh', 'AGENTS.md') };
}

async function main() {
  console.log('[1] 文件已存在 + 确认「保存」→ 写盘成功（回归：dialog 未解构卡死）');
  {
    const { handlers, target, tmp } = setup({ dialogResponse: 0 });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '# AGENTS.md\n\n## 身份与称呼\n\n- 我的姓名：**小六**\n', 'utf8');
    const r = await handlers['memory:save'](null, {
      fields: [{ name: '你的称呼', value: '老大' }],
      sections: [{ title: '身份与称呼', body: '- 我的姓名：**小六**' }],
    });
    ok(r && r.ok === true, 'memory:save 返回 ok（不 reject、不卡死）');
    const raw = fs.readFileSync(target, 'utf8');
    ok(raw.includes('- 你的称呼：老大'), '基础设定字段写入文件');
    ok(raw.includes('## 身份与称呼'), '区块保留');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('[2] 确认「取消」→ 返回 cancelled 且不写盘');
  {
    const { handlers, target, calls, tmp } = setup({ dialogResponse: 1 });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const before = '# 原内容\n';
    fs.writeFileSync(target, before, 'utf8');
    const r = await handlers['memory:save'](null, { fields: [{ name: '你的称呼', value: '老大' }], sections: [] });
    ok(r && r.ok === false && r.reason === 'cancelled', '取消返回 cancelled');
    ok(fs.readFileSync(target, 'utf8') === before, '文件未被改动');
    ok(calls.dialogs === 1, '确认弹窗弹出 1 次');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('[3] handler 内部异常 → 返回 {ok:false,message}（绝不 reject 卡死前端）');
  {
    const { handlers, target, tmp } = setup({ dialogResponse: 0, saveThrow: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '# 原内容\n', 'utf8');
    const r = await handlers['memory:save'](null, { fields: [{ name: 'a', value: 'b' }], sections: [] });
    ok(r && r.ok === false && typeof r.message === 'string' && r.message.includes('模拟写盘失败'), '异常被捕获返回 message');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('[4] 文件不存在（首次）→ 不弹确认直接创建');
  {
    const { handlers, target, calls, tmp } = setup({ dialogResponse: 0 });
    const r = await handlers['memory:save'](null, { fields: [{ name: '你的称呼', value: '小六' }], sections: [] });
    ok(r && r.ok === true, '首次保存成功');
    ok(calls.dialogs === 0, '首次不弹确认框');
    ok(fs.existsSync(target) && fs.readFileSync(target, 'utf8').includes('- 你的称呼：小六'), '文件创建且字段写入');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
