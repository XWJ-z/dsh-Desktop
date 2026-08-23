'use strict';

/**
 * test-v105-behavior.js — v1.0.5 修复行为级测试（用户反馈 1/2/3/4 中 2/3/4 三项）
 *
 * 2. 问题② 全局记忆区块无法删除：save() 提交的区块集合 = 最终状态，
 *    删除后保存不再刷新出来（标题匹配原位覆盖 / 删除生效 / 新增追加末尾）；
 * 3. 问题③ ## DSH 角色 区块的「角色记忆」说明句：
 *    - TEMPLATE 含说明句；save 后文件必含（不重复累积）；
 *    - parse 把说明句识别为 roleNote 标记，不算角色字段；
 * 4. 问题④ 备份 / 一键恢复 / 损坏检测：
 *    - 保存前自动写 AGENTS.md.bak（有旧内容时）；
 *    - isCorrupt 检测解析异常（非空但无区块 / parse 抛错）；
 *    - restoreBackup 从 .bak 恢复并保留 .corrupt；无备份返回失败。
 *
 * 用法：node tests/test-v105-behavior.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createGlobalMemory } = require('../modules/global-memory');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

/** 临时 homedir：创建 模拟 ~/.dsh 目录 */
function makeEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v105-'));
  const gm = createGlobalMemory({
    fs, os, path,
    appendLog: () => {},
  });
  // 临时 homedir 生效：os.homedir() 由 mock 覆盖
  const realHomedir = os.homedir;
  os.homedir = () => home;
  const dshDir = path.join(home, '.dsh');
  fs.mkdirSync(dshDir, { recursive: true });
  return {
    gm, home, dshDir, realHomedir,
    file: () => path.join(dshDir, 'AGENTS.md'),
    bak: () => path.join(dshDir, 'AGENTS.md.bak'),
    restore: () => { os.homedir = realHomedir; },
  };
}

function run() {
  console.log('[2] 问题② 全局记忆区块删除生效');
  {
    const e = makeEnv();
    const { gm } = e;
    // 首次保存：2 个长区块 A、B + 基础字段
    let r = gm.save({ users: [{ name: '用户的称呼', value: '用户' }], sections: [
      { title: '区块A', body: '内容A' },
      { title: '区块B', body: '内容B' },
    ] });
    ok(r.ok === true, '首次保存成功（含 A、B 两区块）');
    let raw = fs.readFileSync(e.file(), 'utf8');
    ok(raw.includes('## 区块A') && raw.includes('## 区块B'), '首次保存后文件含 区块A/区块B');
    ok(!fs.existsSync(e.bak()), '首次保存（无旧文件）不生成 .bak');
    // 第二次保存：只提交 A（用户删除了 B）→ B 必须消失
    r = gm.save({ users: [{ name: '用户的称呼', value: '用户' }], sections: [
      { title: '区块A', body: '内容A改' },
    ] });
    ok(r.ok === true, '第二次保存成功（只提交 A）');
    raw = fs.readFileSync(e.file(), 'utf8');
    ok(raw.includes('## 区块A') && raw.includes('内容A改'), '区块A 原位覆盖（内容已更新）');
    ok(!raw.includes('## 区块B'), '删除的 区块B 保存后不再出现（bug 修复）');
    ok(fs.existsSync(e.bak()), '第二次保存（有旧文件）自动生成 .bak');
    ok(fs.readFileSync(e.bak(), 'utf8').includes('## 区块B'), '.bak = 上一次版本（含 区块B）');
    // 第三次：提交 A + 新 C → C 追加末尾
    gm.save({ users: [{ name: '用户的称呼', value: '用户' }], sections: [
      { title: '区块A', body: '内容A改' },
      { title: '区块C', body: '内容C' },
    ] });
    raw = fs.readFileSync(e.file(), 'utf8');
    ok(raw.includes('## 区块C'), '新增 区块C 保存成功');
    ok(raw.indexOf('## 区块C') > raw.indexOf('## 区块A'), '新增区块追加在末尾');
    // 第四次：改标题（A → D）→ 旧标题删除、新标题出现
    gm.save({ users: [{ name: '用户的称呼', value: '用户' }], sections: [
      { title: '区块D', body: '内容D' },
      { title: '区块C', body: '内容C' },
    ] });
    raw = fs.readFileSync(e.file(), 'utf8');
    ok(!raw.includes('## 区块A') && raw.includes('## 区块D'), '改标题后旧标题消失、新标题生效');
    e.restore();
  }

  console.log('[3] 问题③ ## DSH 角色 区块「角色记忆」说明句');
  {
    const e = makeEnv();
    const { gm } = e;
    // TEMPLATE 含说明句
    const { TEMPLATE } = require('../modules/global-memory');
    ok(TEMPLATE.includes('角色记忆') && TEMPLATE.includes('`~/.dsh/roles/`'), 'TEMPLATE 含「角色记忆」说明句');
    // 首次保存 → 文件必含说明句
    gm.save({ users: [{ name: '用户的称呼', value: '用户' }] });
    let raw = fs.readFileSync(e.file(), 'utf8');
    const noteLine = '- 角色记忆：各角色的详细记忆写入 `~/.dsh/roles/` 下对应角色文件。';
    ok(raw.includes(noteLine), '保存后 AGENTS.md 含「角色记忆」说明句');
    // parse：说明句是 roleNote 标记，不是角色字段
    const parsed = gm.parse(raw);
    const rolesSec = parsed.sections.find((s) => s.kind === 'roles');
    ok(!!rolesSec && rolesSec.roleNote === true, 'parse 识别 roleNote=true');
    ok(!rolesSec.fields.some((f) => f.name === '角色记忆'), '说明句不算角色字段（不进 fields）');
    // 连续保存两次 → 说明句不重复累积（只一行）
    gm.save({ users: [{ name: '用户的称呼', value: '用户' }] });
    gm.save({ users: [{ name: '用户的称呼', value: '用户' }] });
    raw = fs.readFileSync(e.file(), 'utf8');
    const count = raw.split(noteLine).length - 1;
    ok(count === 1, `说明句不重复累积（连续保存后仍只有 1 行，实际 ${count}）`);
    // 带角色保存也正常
    const r2 = gm.save({ users: [{ name: '用户的称呼', value: '用户' }], roles: [{ name: '测试角色', desc: '定位', memory: '记忆内容' }] });
    ok(r2.ok === true, '带角色保存正常');
    raw = fs.readFileSync(e.file(), 'utf8');
    ok(raw.includes('- 测试角色：定位'), '角色行输出为「角色名：定位」');
    e.restore();
  }

  console.log('[4] 问题④ 备份 / 一键恢复 / 损坏检测');
  {
    const e = makeEnv();
    const { gm } = e;
    // isCorrupt：空文件 / 正常文件 → false；非空无区块 → true
    ok(gm.isCorrupt() === false, '无文件 → 不损坏');
    fs.writeFileSync(e.file(), '随便一行没有区块的内容');
    ok(gm.isCorrupt() === true, '非空但无 ## 区块 → 判定损坏');
    fs.writeFileSync(e.file(), '# 只有标题\n\n没有区块\n');
    ok(gm.isCorrupt() === true, '只有 # 标题无 ## 区块 → 判定损坏');
    fs.writeFileSync(e.file(), '');
    ok(gm.isCorrupt() === false, '空文件 → 不算损坏');
    // 正常保存两次 → 生成 .bak，恢复可用
    gm.save({ users: [{ name: '用户的称呼', value: '用户' }], sections: [{ title: '区块A', body: 'AAA' }] });
    gm.save({ users: [{ name: '用户的称呼', value: '用户' }], sections: [{ title: '区块A', body: 'BBB' }] });
    ok(fs.readFileSync(e.bak(), 'utf8').includes('AAA'), '.bak = 上一次保存内容（AAA）');
    // 损坏当前文件 → isCorrupt true → restoreBackup 恢复
    fs.writeFileSync(e.file(), '损坏的内容没有区块结构');
    ok(gm.isCorrupt() === true, '人为损坏 → 判定损坏');
    const rr = gm.restoreBackup();
    ok(rr.ok === true, '从备份恢复成功');
    ok(fs.readFileSync(e.file(), 'utf8').includes('AAA'), '恢复后文件内容 = .bak（AAA）');
    ok(fs.existsSync(`${e.file()}.corrupt`), '恢复前损坏文件保留为 .corrupt');
    ok(gm.isCorrupt() === false, '恢复后不再判定损坏');
    // 无备份 → 恢复失败
    fs.rmSync(e.bak(), { force: true });
    fs.writeFileSync(e.file(), 'x');
    const rr2 = gm.restoreBackup();
    ok(rr2.ok === false && /备份/.test(rr2.message || ''), '无 .bak → 恢复返回失败提示');
    e.restore();
  }

  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
