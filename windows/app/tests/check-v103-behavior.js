'use strict';

/**
 * check-v103-behavior.js — v1.0.3 修复行为级测试（老大反馈 1/4/6）
 *
 * 1. 问题① 设置联动：最小化到托盘 / 关闭时总是询问 / 记住选择 三向联动；
 * 2. 问题④ 角色字段输入化：parseRoleContent / renderRoleContent 往返、
 *    save 兼容旧 value=全文 payload、data() 拆字段；
 * 3. 问题⑥ DSH 版本持久化：readShellConfig userData 覆盖 config、
 *    updateDshVersion config 写失败以 userData 为准。
 *
 * 用法：node tests/check-v103-behavior.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createSettings } = require('../modules/settings');
const { createGlobalMemory } = require('../modules/global-memory');
const { createDshRuntime } = require('../modules/dsh-runtime');
const { createRolePicker } = require('../modules/role-picker');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
/** role-picker 测试共享：已创建的 mock 窗口列表（模块级，跨函数可见） */
const created = [];

/** 可控 mock webContents：once('did-finish-load') 由 triggerLoad 触发，记录注入代码 */
class MockWebContents extends EventEmitter {
  constructor() { super(); this.injected = null; }
  executeJavaScript(code) { this.injected = code; return Promise.resolve(); }
}

/** 可控 mock BrowserWindow（EventEmitter：closed 事件可用；webContents 可触发 did-finish-load） */
class MockWin extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts || {};
    this.closed = false;
    this.webContents = new MockWebContents();
    created.push(this); // 登记到共享列表（跨函数可见）
  }
  loadFile() { return Promise.resolve(); }
  close() { if (!this.closed) { this.closed = true; this.emit('closed'); } }
  isDestroyed() { return this.closed; }
}

/** 构造 role-picker 测试环境；返回 { picker, ipcMain, triggerLoad } */
function makeRolePicker() {
  const ipcMain = new EventEmitter();
  const picker = createRolePicker({
    BrowserWindow: MockWin,
    app: { getAppPath: () => 'APP' },
    path, nativeTheme: {},
    ipcMain,
    secureWebPreferences: () => ({}),
  });
  // 模拟 did-finish-load：触发最后一个窗口 webContents 的注入回调
  const triggerLoad = () => {
    const w = created[created.length - 1];
    if (w && w.webContents) w.webContents.emit('did-finish-load');
  };
  return { picker, ipcMain, triggerLoad, last: () => created[created.length - 1] };
}

// ── 问题③：角色选择竖排窗口生命周期 ──
function testRolePicker() {
  console.log('[4] 问题③ 角色选择竖排窗口（role-picker）');
  // ① 空角色列表 → 立即 null（不创建窗口）
  {
    const before = created.length;
    const { picker } = makeRolePicker();
    return picker.openRolePicker([]).then((r) => {
      ok(r === null && created.length === before, '空角色列表 → 立即返回 null（不建窗口）');
      return testRolePickerFlow2();
    });
  }
}

async function testRolePickerFlow2() {
  // ② 选择角色 → resolve 对应 index + 窗口关闭
  {
    const before = created.length;
    const { picker, ipcMain, triggerLoad } = makeRolePicker();
    const p = picker.openRolePicker([{ name: '角色 1', desc: '定位A' }, { name: '角色 2' }]);
    triggerLoad();
    const win = created[created.length - 1];
    ok(created.length === before + 1, '非空角色列表 → 创建选择窗口');
    ok(!!win && typeof win.webContents.injected === 'string' && win.webContents.injected.includes('角色 1') && win.webContents.injected.includes('角色 2'),
      '窗口加载后注入角色列表数据（JSON）');
    ipcMain.emit('role-picker:select', {}, 1); // 模拟 renderer 点击选项 1
    const r2 = await p;
    ok(!!r2 && r2.index === 1 && r2.name === '角色 2', '选择 index=1 → resolve 对应角色对象');
    ok(win.closed === true, '选择后窗口已关闭');
    ok(!ipcMain.listenerCount('role-picker:select'), '选择后 IPC 监听已移除（防泄漏）');
  }
  // ③ 直接关闭窗口（取消）→ resolve null
  {
    const { picker, triggerLoad } = makeRolePicker();
    const p = picker.openRolePicker([{ name: '角色 A' }]);
    triggerLoad();
    const win = created[created.length - 1];
    win.close();
    const r = await p;
    ok(r === null, '窗口被关闭（取消）→ resolve null（不挂起 pickAndInject）');
  }
  // ④ 窗口高度随角色数量自适应
  {
    const { picker } = makeRolePicker();
    picker.openRolePicker([{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }]);
    const win = created[created.length - 1];
    ok(win.opts.height >= 220 && win.opts.height <= 560 && win.opts.width === 460, `窗口尺寸自适应（h=${win.opts.height}，在 220~560 内）`);
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `角色${i}` }));
    picker.openRolePicker(many);
    const win2 = created[created.length - 1];
    ok(win2.opts.height === 560, '角色很多时高度封顶 560（内部滚动）');
  }
}

// ── 问题①：设置联动 ──
function testSettingsLink() {
  console.log('[1] 问题① 设置联动（最小化到托盘 / 总是询问 / 记住选择）');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v103-settings-'));
  let settings = { minimizeToTray: true, closeChoice: null, rememberCloseChoice: false, closeAsk: false };
  const logs = [];
  const api = createSettings({
    app: { getPath: () => tmp },
    fs, path,
    appendLog: (l, m) => logs.push(`${l}:${m}`),
    getSettings: () => settings,
    setSettings: (s) => { settings = s; },
    refreshMenus: () => {},
  });

  // ① 记忆=退出 时开启最小化到托盘 → 清除记忆（防矛盾）
  settings = { minimizeToTray: false, closeChoice: 'quit', rememberCloseChoice: true, closeAsk: false };
  api.setMinimizeToTray(true);
  ok(settings.minimizeToTray === true && settings.rememberCloseChoice === false && settings.closeChoice === null,
    '开启最小化到托盘时清除「记住退出」记忆（消除矛盾状态）');
  ok(logs.some((l) => l.includes('已清除「记住退出」记忆')), '联动日志：已清除「记住退出」记忆');

  // ② 记住退出 → 取消最小化到托盘勾选
  settings = { minimizeToTray: true, closeChoice: null, rememberCloseChoice: false, closeAsk: false };
  api.setCloseChoice('quit', true);
  ok(settings.minimizeToTray === false && settings.rememberCloseChoice === true && settings.closeAsk === false,
    '记住退出 → 最小化到托盘自动取消勾选（关闭即退出）');

  // ③ 记住托盘 → 保持托盘 + 取消总是询问
  settings = { minimizeToTray: false, closeChoice: null, rememberCloseChoice: false, closeAsk: true };
  api.setCloseChoice('tray', true);
  ok(settings.minimizeToTray === true && settings.rememberCloseChoice === true && settings.closeAsk === false,
    '记住关闭到托盘 → 最小化到托盘勾选 + 取消总是询问');

  // ④ 勾选总是询问 → 清除记忆（询问优先）
  settings = { minimizeToTray: true, closeChoice: 'quit', rememberCloseChoice: true, closeAsk: false };
  api.setCloseAsk(true);
  ok(settings.closeAsk === true && settings.rememberCloseChoice === false && settings.closeChoice === null,
    '勾选「关闭时总是询问」→ 清除记忆（询问优先于记忆）');

  // ⑤ 不勾选总是询问 → 直接托盘（无记忆时）
  settings = { minimizeToTray: true, closeChoice: null, rememberCloseChoice: false, closeAsk: true };
  api.setCloseAsk(false);
  ok(settings.closeAsk === false, '取消「关闭时总是询问」→ closeAsk=false（关闭直接驻留托盘）');

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 问题④：角色字段输入化 ──
function testRoleFields() {
  console.log('[2] 问题④ 角色字段输入化（定位/详细记忆）');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v103-roles-'));
  const api = createGlobalMemory({ fs, path, os: { homedir: () => tmp }, appendLog: () => {} });

  // 模板全文 → 拆字段 → 组装往返（不丢数据）
  const full = '# 角色：学习导师\n\n## 定位\n\n嵌入式开发教学专家\n\n## 详细记忆\n\n- 精通 stm32\n- 擅长 PCB 设计';
  const p = api.parseRoleContent(full);
  ok(p.desc === '嵌入式开发教学专家', 'parseRoleContent：提取 ## 定位 节全文');
  ok(p.rest === '## 详细记忆\n\n- 精通 stm32\n- 擅长 PCB 设计', 'parseRoleContent：rest = 详细记忆节及其内容（原样保留）');
  const rebuilt = api.renderRoleContent('学习导师', p.desc, p.rest);
  ok(rebuilt === full + '\n', 'renderRoleContent：往返组装 = 原文（模板格式稳定）');
  ok(!rebuilt.includes('## 详细记忆\n\n## 详细记忆'), 'renderRoleContent：rest 自带 ## 详细记忆 标题时去重（无双标题）');

  // 无结构全文（用户手写一段话）→ 组装进标准模板（不丢数据）
  const raw = '我是一名全栈工程师';
  const p2 = api.parseRoleContent(raw);
  ok(p2.desc === '' && p2.rest === raw, 'parseRoleContent：无结构 → desc 空、rest = 原文');
  const rebuilt2 = api.renderRoleContent('角色 A', p2.desc, p2.rest);
  ok(rebuilt2.includes('# 角色：角色 A') && rebuilt2.includes('## 定位') && rebuilt2.includes('## 详细记忆\n\n我是一名全栈工程师'),
    '无结构原文 → 组装为标准模板，原文进详细记忆（不丢数据）');

  // save 兼容旧 payload（value=全文）→ 拆分再组装
  const target = path.join(tmp, '.dsh', 'AGENTS.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const r = api.save({
    users: [{ name: '用户的称呼', value: '老大' }],
    dsh: [],
    roles: [{ name: '学习导师', value: full }],
    sections: [],
  });
  ok(r.ok === true, 'save：兼容旧 payload（value=全文）保存成功');
  const written = fs.readFileSync(path.join(tmp, '.dsh', 'roles', '学习导师.md'), 'utf8');
  ok(written === full + '\n', 'save：旧 payload 全文 → 解析拆分 → 重新组装还原（无重复结构）');
  const agents = fs.readFileSync(target, 'utf8');
  ok(agents.includes('- 学习导师：嵌入式开发教学专家'), 'save：AGENTS.md 角色行只存定位（## 定位 首行）');

  // data() 拆字段
  const d = api.data();
  const rolesSec = d.sections.find((s) => s.kind === 'roles');
  ok(!!rolesSec && rolesSec.fields[0].desc === '嵌入式开发教学专家'
    && rolesSec.fields[0].value === '## 详细记忆\n\n- 精通 stm32\n- 擅长 PCB 设计',
    'data()：desc = 定位全文、value = 详细记忆及剩余（窗口字段输入展示）');

  // 新 payload（desc/memory 字段）→ 组装正确
  const r2 = api.save({
    users: [{ name: '用户的称呼', value: '老大' }], dsh: [],
    roles: [{ name: '测试角色', desc: '测试定位', memory: '测试详细记忆\n第二行' }],
    sections: [],
  });
  ok(r2.ok === true, 'save：新 payload（desc/memory 字段）保存成功');
  const written2 = fs.readFileSync(path.join(tmp, '.dsh', 'roles', '测试角色.md'), 'utf8');
  ok(written2.includes('# 角色：测试角色') && written2.includes('## 定位\n\n测试定位') && written2.includes('## 详细记忆\n\n测试详细记忆\n第二行'),
    'save：新 payload 组装为标准结构（字段输入化）');

  // v1.0.3（老大反馈 2）：角色名 ≤30 字符校验（前端 maxlength + 主进程保存校验）
  ok(api.MAX_ROLE_NAME === 30, 'MAX_ROLE_NAME = 30（导出常量）');
  const longName = '这是一个非常非常长的角色名称用来测试长度限制是否生效的角色名字';
  ok(longName.length > 30, `构造超长角色名（${longName.length} 字符）`);
  const rLen = api.save({
    users: [{ name: '用户的称呼', value: '老大' }], dsh: [],
    roles: [{ name: longName, desc: 'x', memory: 'y' }],
    sections: [],
  });
  ok(rLen.ok === false && rLen.message.includes('30'), 'save：角色名超 30 字符 → 拒绝保存并提示');
  ok(!fs.existsSync(path.join(tmp, '.dsh', 'roles', '这是一个非常非常长的角色名称用来测试长度限制是否生效的角色名字.md')),
    'save：超长角色名未写入角色文件');
  const rOk = api.save({
    users: [{ name: '用户的称呼', value: '老大' }], dsh: [],
    roles: [{ name: '三十个字符以内的角色名称测试', desc: 'x', memory: 'y' }],
    sections: [],
  });
  ok(rOk.ok === true, 'save：≤30 字符角色名正常保存');

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 问题⑥：DSH 版本选择持久化 ──
function testDshVersionPersist() {
  console.log('[3] 问题⑥ DSH 版本选择持久化（升级壳不回退）');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v103-ver-'));
  const appPath = path.join(tmp, 'app');
  const userData = path.join(tmp, 'userData');
  fs.mkdirSync(appPath, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  // config.json 内置旧版本（模拟壳内置 0.1.0-rc.6）
  fs.writeFileSync(path.join(appPath, 'config.json'), JSON.stringify({
    dshVersion: '0.1.0-rc.6', dshPackage: '@deepseek-ai/dsh',
    registry: 'https://registry.npmmirror.com',
  }, null, 2), 'utf8');
  const mkRuntime = () => createDshRuntime({
    app: { getAppPath: () => appPath, getPath: () => userData },
    fs, path, spawn: () => {},
    appendLog: () => {}, pushStage: () => {}, pushProgress: () => {},
    dirSizeMBAsync: async () => '0.0', logPath: () => '',
    resolveRunner: () => ({ execPath: 'node', env: {} }),
    trackChild: (c) => c, npmInstallTimeoutMs: 60000,
    fetchLatestDshInfo: async () => null,
  });

  // ① 无 userData 记录 → 用 config.json 默认
  const rt0 = mkRuntime();
  ok(rt0.readShellConfig().dshVersion === '0.1.0-rc.6', '无 userData 记录 → 用 config.json 版本');

  // ② updateDshVersion → userData 记录（模拟 config 可写）
  const rt1 = mkRuntime();
  ok(rt1.updateDshVersion('0.1.0-rc.7', 'sha512-abc') === true, 'updateDshVersion 成功（config + userData）');
  const cfg1 = JSON.parse(fs.readFileSync(path.join(appPath, 'config.json'), 'utf8'));
  ok(cfg1.dshVersion === '0.1.0-rc.7', 'config.json 已改写为 rc.7');
  ok(rt1.readShellConfig().dshVersion === '0.1.0-rc.7', 'readShellConfig 返回 rc.7（userData 优先）');
  ok(rt1.readUserDshVersion().version === '0.1.0-rc.7' && rt1.readUserDshVersion().integrity === 'sha512-abc',
    'userData 记录 version + integrity');

  // ③ 模拟「升级壳」：config.json 被新壳覆盖回 rc.6 → userData 记录仍在 → 不回退
  fs.writeFileSync(path.join(appPath, 'config.json'), JSON.stringify({
    dshVersion: '0.1.0-rc.6', dshPackage: '@deepseek-ai/dsh',
    registry: 'https://registry.npmmirror.com',
  }, null, 2), 'utf8');
  const rt2 = mkRuntime();
  ok(rt2.readShellConfig().dshVersion === '0.1.0-rc.7', '升级壳后 config 被重置 rc.6 → userData 记录 rc.7 优先（不回退）');

  // ④ config.json 只读（安装目录无写权限）→ userData 仍记录 → 返回 true
  const readOnlyFs = {
    ...fs,
    copyFileSync: () => { throw new Error('EACCES'); },
    writeFileSync: (f, ...a) => { if (f === path.join(appPath, 'config.json')) throw new Error('EACCES'); return fs.writeFileSync(f, ...a); },
    readFileSync: (f, ...a) => fs.readFileSync(f, ...a),
  };
  const rt3b = createDshRuntime({
    app: { getAppPath: () => appPath, getPath: () => userData },
    fs: readOnlyFs, path, spawn: () => {},
    appendLog: () => {}, pushStage: () => {}, pushProgress: () => {},
    dirSizeMBAsync: async () => '0.0', logPath: () => '',
    resolveRunner: () => ({ execPath: 'node', env: {} }),
    trackChild: (c) => c, npmInstallTimeoutMs: 60000,
    fetchLatestDshInfo: async () => null,
  });
  ok(rt3b.updateDshVersion('0.1.0-rc.8', 'sha512-xyz') === true, 'config 写失败（EACCES）→ userData 记录成功 → 返回 true');
  ok(rt3b.readShellConfig().dshVersion === '0.1.0-rc.8', 'config 只读场景：readShellConfig 仍返回用户选择的 rc.8（userData 主存储）');

  // ⑤ latest 语义不受影响：config=latest 且无 userData 记录 → latest
  fs.writeFileSync(path.join(appPath, 'config.json'), JSON.stringify({ dshVersion: 'latest' }, null, 2), 'utf8');
  fs.rmSync(path.join(userData, 'dsh-version.json'), { force: true });
  const rt4 = mkRuntime();
  ok(rt4.readShellConfig().dshVersion === 'latest', '无 userData 记录 + config=latest → 保持 latest 语义');

  fs.rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  testSettingsLink();
  testRoleFields();
  testDshVersionPersist();
  await testRolePicker();
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
