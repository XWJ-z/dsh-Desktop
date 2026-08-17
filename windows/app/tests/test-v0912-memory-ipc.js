'use strict';

/**
 * test-v0912-memory-ipc.js — 全局记忆保存链路端到端测试（v0.9.12）
 *
 * 真实驱动 modules/ipc.js 的 registerIpc + memory:save handler（mock ipcMain），
 * 验证（针对老大反馈「点保存一直保存中」的回归防护）：
 *  1. 主进程 memory:save 不再 await dialog（v0.9.12：确认移前端，主进程 dialog
 *     在 modal:false 子窗口上可能不弹/挂起 → 卡死"保存中"）；
 *  2. 文件存在 + 保存 → 直接写盘（前端已二次确认）；
 *  3. handler 内部异常 → 返回 {ok:false,message}（绝不 reject）；
 *  4. 首次（文件不存在）→ 直接创建；
 *  5. 角色设定 roles 随保存写入。
 *
 * 用法：node tests/test-v0912-memory-ipc.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createGlobalMemory } = require('../modules/global-memory');
const { registerIpc } = require('../modules/ipc');
const { createRoleSelector } = require('../modules/role-selector');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

/** 构造 registerIpc 环境；saveThrow 模拟写盘异常 */
function setup({ saveThrow = false } = {}) {
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
    // dialog 故意不传 —— memory:save 不得依赖 dialog（确认已移前端，防挂起卡死）
    dialog: { showMessageBox: async () => { calls.dialogs++; return { response: 0 }; } },
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
    globalMemory, openGlobalMemoryWindow: () => {},
    getResolvedPort: () => 0, getCurrentStage: () => '',
  };
  registerIpc(deps);
  return { handlers, memory: realMemory, calls, tmp, target: path.join(tmp, '.dsh', 'AGENTS.md') };
}

async function main() {
  console.log('[1] 文件已存在 + 保存 → 直接写盘（主进程不 await dialog，防挂起卡死）');
  {
    const { handlers, target, calls, tmp } = setup();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '# AGENTS.md\n\n## 身份与称呼\n\n- 我的姓名：**小六**\n', 'utf8');
    const r = await handlers['memory:save'](null, {
      users: [{ name: '用户的称呼', value: '老大' }],
      dsh: [{ name: '我的名字', value: '小鲸鱼' }, { name: '角色 1', value: '资深 C++ 工程师' }],
      sections: [{ title: '身份与称呼', body: '- 我的姓名：**小六**' }],
    });
    ok(r && r.ok === true, 'memory:save 返回 ok（不 reject、不卡死）');
    ok(calls.dialogs === 0, '主进程不再弹 dialog（确认在前端）');
    const raw = fs.readFileSync(target, 'utf8');
    ok(raw.includes('## 用户设定') && raw.includes('- 用户的称呼：老大'), '用户设定独立区块写入文件');
    ok(raw.includes('## 我的设定') && raw.includes('- 我的名字：小鲸鱼') && raw.includes('- 角色 1：资深 C++ 工程师'), '我的设定独立区块写入文件');
    ok(raw.includes('## 身份与称呼'), '其他区块保留');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('[2] handler 内部异常 → 返回 {ok:false,message}（绝不 reject 卡死前端）');
  {
    const { handlers, target, tmp } = setup({ saveThrow: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '# 原内容\n', 'utf8');
    const r = await handlers['memory:save'](null, { fields: [{ name: 'a', value: 'b' }], roles: [], sections: [] });
    ok(r && r.ok === false && typeof r.message === 'string' && r.message.includes('模拟写盘失败'), '异常被捕获返回 message');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('[3] 文件不存在（首次）→ 直接创建（含用户/我的设定）');
  {
    const { handlers, target, tmp } = setup();
    const r = await handlers['memory:save'](null, {
      users: [{ name: '用户的称呼', value: '小六' }],
      dsh: [{ name: '我的名字', value: '小鲸鱼' }],
      sections: [],
    });
    ok(r && r.ok === true, '首次保存成功');
    ok(fs.existsSync(target) && fs.readFileSync(target, 'utf8').includes('- 用户的称呼：小六'), '文件创建且用户设定写入');
    ok(fs.readFileSync(target, 'utf8').includes('- 我的名字：小鲸鱼'), 'DSH 设定随首次保存写入');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 附加段：role-selector 行为（v0.9.13 老大方案 3/4）──
async function testRoleSelector() {
  console.log('[4] role-selector：会话切换 → 选角色 → 注入（老大方案）');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const mkRole = (opts = {}) => {
    const calls = { dialogs: 0, injects: [] };
    const api = createRoleSelector({
      dialog: { showMessageBox: async () => { calls.dialogs++; return { response: opts.dialogResponse ?? 0 }; } },
      appName: 'DSH-Desktop',
      appendLog: () => {},
      getMainWindow: () => ({ isDestroyed: () => false }),
      getRoles: opts.rolesFn || (() => [{ name: '角色 1', value: '工作' }, { name: '角色 2', value: '闲聊' }]),
      roleFilePath: (name) => `~/.dsh/roles/${name}.md`,
      injectText: async (_w, text, _o) => { calls.injects.push(text); return { ok: true }; },
      currentSessionIdFromPage: opts.sessionFn || (async () => null),
      pollMs: 50,
    });
    return { api, calls };
  };
  // ① 会话从 sid1 → sid2：弹窗选角色 1 → 注入提示词
  {
    let seq = ['sid-1', 'sid-1', 'sid-2', 'sid-2'];
    const { api, calls } = mkRole({ sessionFn: async () => seq.shift() || 'sid-2' });
    api.start();
    await sleep(220); // 4 次轮询
    api.stop();
    ok(calls.dialogs === 1, '会话切换触发 1 次弹窗');
    ok(calls.injects.length === 1 && calls.injects[0].includes('本次对话角色为 角色 1') && calls.injects[0].includes('角色定义文件为 ~/.dsh/roles/角色 1.md'),
      `注入提示词正确（${calls.injects[0]}）`);
  }
  // ② 会话不变 → 不弹窗
  {
    const { api, calls } = mkRole({ sessionFn: async () => 'same-session' });
    api.start();
    await sleep(150);
    api.stop();
    ok(calls.dialogs === 0, '会话不变 → 不弹窗');
  }
  // ③ 未配置角色 → 不弹窗（老大方案 3）
  {
    const { api, calls } = mkRole({ rolesFn: () => [], sessionFn: async () => { const s = Math.random(); return s > 0.5 ? 'a' : 'b'; } });
    api.start();
    await sleep(200);
    api.stop();
    ok(calls.dialogs === 0, '未配置角色 → 不弹窗');
  }
  // ④ 弹窗选「不选择」→ 不注入
  {
    let seq = ['s1', 's2'];
    const { api, calls } = mkRole({ dialogResponse: 2, sessionFn: async () => seq.shift() || 's2' });
    api.start();
    await sleep(180);
    api.stop();
    ok(calls.dialogs === 1 && calls.injects.length === 0, '选「不选择」→ 弹窗但不注入');
  }
}

main().then(() => {
  testRoleSelector().then(() => {
    console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
    process.exit(failed === 0 ? 0 : 1);
  });
});
