'use strict';

/**
 * check-v097.js — v0.9.7 功能自动验证（不启动 Electron）
 *
 * 覆盖（老大反馈三项）：
 *  1. 公告条内容显示不全 → menu.js 截断收紧 30 字符 + 公告条可点击打开公告窗口
 *     + 公告窗口顶部完整 marquee 横幅（ipc notice:data 附带 marquee）
 *  2. 公告要重启才刷新 → main.js 10 分钟定时自动刷新 + notice.js 版本未变静默
 *  3. 内置更新日志与 GitHub 不一致 → CHANGELOG.json 0.9.6 改为 version.json
 *     release_notes 12 条（与 GitHub Release body 同源）+ 新增 0.9.7 条目
 *
 * 用法：node tests/check-v097.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const APP = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

// ---------------------------------------------------------------------------
// 1. menu.js —— 公告条截断 30 + 可点击
// ---------------------------------------------------------------------------
function testMenu() {
  console.log('[1] menu.js 公告条');
  const src = read('modules/menu.js');
  ok(src.includes('t.length > 30'), 'truncateMarquee 截断阈值 = 30 字符');
  ok(src.includes('${t.slice(0, 27)}…'), '截断保留前 27 字符 + …');
  ok(!src.includes('t.length > 40'), '旧的 40 字符截断已移除');
  ok(src.includes('label: \'📢 \' + truncateMarquee(getMarquee())'), '公告条 label 保留');
  ok(src.includes('click: () => openNoticeWindow()'), '公告条可点击 → 打开公告窗口');
  ok(!src.includes('enabled: false, // 纯文字展示'), '公告条不再禁用（纯文字态移除）');
  // v0.9.8（老大指令）：公告菜单并入帮助菜单
  ok(!src.includes('label: `公告${'), '独立「公告」一级菜单已移除（并入帮助）');
  ok(src.includes('查看公告${'), '帮助菜单含「查看公告（新）」子项');
}

// ---------------------------------------------------------------------------
// 2. notice.js —— 版本未变静默（定时轮询不刷日志）
// ---------------------------------------------------------------------------
function testNoticeQuiet() {
  console.log('[2] notice.js 静默逻辑');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v097-nt-'));
  const fakeApp = { getPath: () => tmp };
  const { createNoticeModule } = require('../modules/notice');

  // mock 三源：每轮 fetchLatest 内 3 个源并发调用 fetchJson，同轮返回相同版本
  // （3 轮：v2 → v2 → v3；第 2 轮验证同版本静默，第 3 轮验证版本升级记日志）
  const versionsPerCall = [2, 2, 2, 2, 2, 2, 3, 3, 3];
  const logs = [];
  const mk = (v, m) => ({ version: v, updated: '2026-08-17', marquee: m, items: [] });
  let call = 0;
  const api = createNoticeModule({
    app: fakeApp, fs, path,
    appendLog: (lvl, msg) => logs.push(`${lvl}:${msg}`),
    fetchJson: async () => {
      const v = versionsPerCall[Math.min(call, versionsPerCall.length - 1)];
      call++;
      return mk(v, `第 ${v} 版公告`);
    },
  });
  api.loadCache();

  return (async () => {
    await api.fetchLatest();                 // 首次 → 记日志
    const firstLogs = logs.length;
    ok(api.getMarquee() === '第 2 版公告', '首次拉取后 marquee 更新');
    ok(firstLogs === 1 && /公告拉取/.test(logs[0]), '首次拉取记 1 条日志');

    await api.fetchLatest();                 // 同版本轮询 → 静默
    ok(logs.length === firstLogs, '同版本二次拉取不刷日志（静默）');

    await api.fetchLatest();                 // 版本升级 → 记日志
    ok(api.getMarquee() === '第 3 版公告', '版本升级后 marquee 更新');
    ok(logs.length === firstLogs + 1 && /公告拉取/.test(logs[firstLogs]), '版本变化再记 1 条日志');

    fs.rmSync(tmp, { recursive: true, force: true });
  })();
}

// ---------------------------------------------------------------------------
// 3. main.js —— 10 分钟定时自动刷新
// ---------------------------------------------------------------------------
function testMain() {
  console.log('[3] main.js 公告定时刷新');
  const src = read('main.js');
  ok(src.includes('const NOTICE_REFRESH_MS = 10 * 60 * 1000'), '定时间隔 10 分钟');
  ok(src.includes('function startNoticeAutoRefresh()'), 'startNoticeAutoRefresh 已定义');
  ok(src.includes('noticeApi.fetchLatest()'), '定时器内拉取公告');
  ok(src.includes('.then(() => refreshMenusRef())'), '拉取后刷新菜单（公告条即时更新）');
  ok(src.includes('startNoticeAutoRefresh();'), '启动流程调用 startNoticeAutoRefresh');
  ok(src.includes('clearInterval(noticeRefreshTimer)'), '退出时清理定时器');
}

// ---------------------------------------------------------------------------
// 4. ipc.js / notice.html / notice.js —— 公告窗口完整 marquee 横幅
// ---------------------------------------------------------------------------
function testNoticeWindow() {
  console.log('[4] 公告窗口完整 marquee');
  const ipcSrc = read('modules/ipc.js');
  ok(ipcSrc.includes('marquee: noticeApi.getMarquee()'), 'notice:data 附带完整 marquee');
  const html = read('renderer/notice.html');
  ok(html.includes('id="marquee"'), '公告窗口有 marquee 横幅容器');
  const js = read('renderer/notice.js');
  ok(js.includes('data.marquee'), '公告窗口读取 marquee 字段');
  ok(js.includes('最新公告'), '横幅标签「最新公告」');
}

// ---------------------------------------------------------------------------
// 5. CHANGELOG.json —— 0.9.6 与 GitHub Release 一致 + 0.9.7 条目
// ---------------------------------------------------------------------------
function testChangelog() {
  console.log('[5] CHANGELOG.json 与 GitHub 一致');
  const cl = JSON.parse(fs.readFileSync(path.join(APP, 'CHANGELOG.json'), 'utf8'));
  const vj = JSON.parse(fs.readFileSync(path.join(APP, '..', '..', 'version.json'), 'utf8'));
  ok(Array.isArray(cl.versions), 'versions 是数组');

  const v097 = cl.versions.find((v) => v.version === '0.9.7');
  ok(!!v097 && Array.isArray(v097.notes) && v097.notes.length === 3, '0.9.7 条目存在（3 条）');

  // v0.9.6 条目 = version.json release_notes（GitHub Release body 同源）
  const v096 = cl.versions.find((v) => v.version === '0.9.6');
  const expected = vj.release_notes.split('\n').filter(Boolean);
  ok(!!v096 && Array.isArray(v096.notes) && v096.notes.length === expected.length,
    `0.9.6 条目 ${v096 ? v096.notes.length : 0} 条 = version.json ${expected.length} 条`);
  if (v096 && expected.length === v096.notes.length) {
    let same = true;
    for (let i = 0; i < expected.length; i++) {
      if (v096.notes[i] !== expected[i]) { same = false; console.error(`    ✗ 第 ${i + 1} 条不一致：\n      CL: ${v096.notes[i]}\n      VJ: ${expected[i]}`); }
    }
    ok(same, '0.9.6 条目与 version.json release_notes 逐条一致');
  }
  // 开发视角技术细节已从 CHANGELOG 移除（移入开发日志）
  const all = JSON.stringify(cl);
  ok(!all.includes('builder-debug.yml'), '开发视角技术细节（builder-debug.yml）已移除');
  ok(!all.includes('MUI_PAGE_CUSTOMFUNCTION_SHOW'), '开发视角技术细节（NSIS 宏）已移除');
}

// ---------------------------------------------------------------------------
// 6. package.json 版本
// ---------------------------------------------------------------------------
function testVersion() {
  console.log('[6] package.json 版本');
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  ok(pkg.version === '0.9.8', `version = 0.9.8（实际 ${pkg.version}）`);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  testMenu();
  await testNoticeQuiet();
  testMain();
  testNoticeWindow();
  testChangelog();
  testVersion();
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
