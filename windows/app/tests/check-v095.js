'use strict';

/**
 * check-v095.js — v0.9.5 功能自动验证（不启动 Electron）
 *
 * 覆盖：
 *  1. prompts.json：101 条（6 分类分布）+ 每条含 hint/text/title + JSON 合法
 *  2. modules/custom-prompts.js：空库 / 新增 / 更新 / 删除 / 校验 /
 *     损坏备份 .bak / id 唯一 / 原子写盘 / 分类自动维护
 *  3. modules/notice.js：parse 容错 / 缓存损坏回退 / marquee 默认值 /
 *     getNotices 结构 / 三源拉取（mock fetchJson）
 *
 * 用法：node tests/check-v095.js
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

// ---------------------------------------------------------------------------
// 1. prompts.json 101 条
// ---------------------------------------------------------------------------
function testPrompts() {
  console.log('[1] prompts.json（101 条）');
  const p = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'prompts.json'), 'utf8'));
  ok(Array.isArray(p.categories), 'categories 是数组');
  // 纯指令型条目（无参数，无需 [占位符]）—— v0.8.7 原有，保留不动
  const noPlaceholder = new Set(['分析我的项目', '依赖检查']);
  let total = 0;
  for (const c of p.categories) {
    ok(Array.isArray(c.items) && c.items.length > 0, `分类「${c.name}」有条目（${c.items.length}）`);
    for (const it of c.items) {
      ok(typeof it.title === 'string' && it.title.length > 0, `「${c.name}」条目有 title（${it.title.slice(0, 10)}…）`);
      ok(typeof it.text === 'string' && it.text.length > 0
        && (it.text.includes('[') || noPlaceholder.has(it.title)),
      `「${it.title}」含 [占位符]（或为纯指令型）`);
      ok(typeof it.hint === 'string' && it.hint.length > 0, `「${it.title}」有 hint`);
    }
    total += c.items.length;
  }
  ok(total === 101, `总条数 = 101（实际 ${total}）`);
}

// ---------------------------------------------------------------------------
// 2. custom-prompts.js
// ---------------------------------------------------------------------------
function testCustomPrompts() {
  console.log('[2] custom-prompts.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v095-cp-'));
  const fakeApp = { getPath: (name) => (name === 'userData' ? tmp : tmp) };
  const { createCustomPrompts } = require('../modules/custom-prompts');
  const api = createCustomPrompts({ fs, path, app: fakeApp, appendLog: () => {} });

  // 文件不存在 → 空库
  let lib = api.read();
  ok(lib.categories.length === 0 && lib.items.length === 0, '文件不存在 → 空库');

  // 新增
  let r = api.save({ cat: '我的工作', name: '周报生成', content: '生成周报：[内容]', hint: '换内容' });
  ok(r.ok && r.item && r.item.id, '新增成功（生成 id）');
  const id1 = r.item.id;
  lib = api.read();
  ok(lib.items.length === 1 && lib.items[0].name === '周报生成', '落盘后可读回');
  ok(lib.categories.includes('我的工作'), '分类自动记录');

  // 新增第二条（默认分类）
  r = api.save({ name: '无分类条目', content: '默认分类：[x]' });
  ok(r.ok, 'cat 缺省保存成功');
  lib = api.read();
  ok(lib.categories.includes('我的'), 'cat 缺省 → 「我的」');

  // 更新（id 相同 → 不新增）
  r = api.save({ id: id1, cat: '我的工作', name: '周报生成 v2', content: '新内容：[y]' });
  ok(r.ok && r.item.name === '周报生成 v2', '更新成功');
  lib = api.read();
  ok(lib.items.length === 2, '更新不新增条目');
  ok(lib.items.find((i) => i.id === id1).content === '新内容：[y]', '更新内容生效');

  // 校验：name/content 空
  ok(api.save({ name: '', content: 'x' }).ok === false, '空 name 拒绝');
  ok(api.save({ name: 'x', content: '  ' }).ok === false, '空 content 拒绝');

  // 删除
  lib = api.remove(id1);
  ok(lib.items.length === 1 && lib.items[0].id !== id1, '删除生效');

  // 损坏文件 → 备份 .bak + 空库
  const f = path.join(tmp, 'custom-prompts.json');
  fs.writeFileSync(f, '{broken json', 'utf8');
  lib = api.read();
  ok(lib.items.length === 0, '损坏 → 空库（不崩溃）');
  ok(fs.existsSync(`${f}.bak`), '损坏文件已备份 .bak');

  // id 唯一性
  const ids = new Set();
  for (let i = 0; i < 20; i++) ids.add(api.newId());
  ok(ids.size === 20, 'id 生成唯一（20 个不重复）');

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 3. notice.js
// ---------------------------------------------------------------------------
function testNotice() {
  console.log('[3] notice.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v095-nt-'));
  const fakeApp = { getPath: (name) => (name === 'userData' ? tmp : tmp) };
  const { createNoticeModule } = require('../modules/notice');

  // 无缓存 → 默认 marquee / 空公告
  const api = createNoticeModule({ app: fakeApp, fs, path, appendLog: () => {}, fetchJson: async () => null });
  api.loadCache();
  ok(api.getMarquee() === '欢迎加入 QQ 群 916607090', '无缓存 marquee → 默认文案');
  ok(Array.isArray(api.getNotices()) && api.getNotices().length === 0, '无缓存 → 空公告列表');

  // 拉取成功（mock 两源成功一源失败）→ 取 version 最高 + 写缓存
  const good = { version: 2, updated: '2026-08-17', marquee: '测试公告！加群 916607090', items: [{ id: 'n1', title: 'T', date: 'd', content: 'C' }] };
  const better = { version: 3, updated: '2026-08-17', marquee: '版本 3 公告', items: [{ id: 'n3', title: 'T3', date: 'd', content: 'C3' }] };
  let call = 0;
  const api2 = createNoticeModule({
    app: fakeApp, fs, path, appendLog: () => {}, fetchJson: async () => {
      call++;
      return call === 1 ? good : call === 2 ? better : null; // 第三源失败
    },
  });
  return api2.fetchLatest().then((best) => {
    ok(best && best.version === 3, `取版本号最高者（v${best && best.version}）`);
    ok(api2.getMarquee() === '版本 3 公告', '拉取后 marquee 更新');
    ok(api2.getNotices().length === 1 && api2.getNotices()[0].id === 'n3', '拉取后公告列表更新');
    ok(fs.existsSync(path.join(tmp, 'notice-cache.json')), '缓存已写盘');

    // 重启场景：新实例 loadCache 读缓存
    const api3 = createNoticeModule({ app: fakeApp, fs, path, appendLog: () => {}, fetchJson: async () => null });
    api3.loadCache();
    ok(api3.getMarquee() === '版本 3 公告', '重启后读缓存（marquee 不丢）');

    // 缓存损坏 → 回退默认
    fs.writeFileSync(path.join(tmp, 'notice-cache.json'), '{bad', 'utf8');
    const api4 = createNoticeModule({ app: fakeApp, fs, path, appendLog: () => {}, fetchJson: async () => null });
    api4.loadCache();
    ok(api4.getMarquee() === '欢迎加入 QQ 群 916607090', '缓存损坏 → 回退默认文案');

    fs.rmSync(tmp, { recursive: true, force: true });
  });
}

testPrompts();
testCustomPrompts();
testNotice().then(() => {
  console.log('');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}).catch((err) => {
  failed++;
  console.error('  ✗ notice 测试异常：', err);
  console.log('');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
