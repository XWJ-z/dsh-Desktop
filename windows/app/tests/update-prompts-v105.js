'use strict';

/**
 * update-prompts-v105.js — v1.0.5 问题①：提示词内置库 +100 条（101 → 201）
 * 合并 prompts-new-part1/part2.js 到 prompts.json，版本号 5 → 6，并做完整性校验：
 *  - 每个新条目的 sub id 必须存在于现有分类；
 *  - 全部条目 title 全局唯一（新旧合并后）；
 *  - 总条数 = 201。
 *
 * 用法：node tests/update-prompts-v105.js
 */

const fs = require('node:fs');
const path = require('node:path');

const PROMPTS_FILE = path.join(__dirname, '..', 'prompts.json');
const part1 = require('./prompts-new-part1.js');
const part2 = require('./prompts-new-part2.js');

const data = JSON.parse(fs.readFileSync(PROMPTS_FILE, 'utf8'));
const newGroups = [...part1, ...part2];

// sub id 索引
const subIndex = new Map();
for (const cat of data.categories) {
  for (const sub of cat.subs) subIndex.set(sub.id, sub);
}

let added = 0;
const problems = [];
const seenTitles = new Set();
// 现有标题登记
for (const cat of data.categories) {
  for (const sub of cat.subs) {
    for (const it of sub.items) {
      if (seenTitles.has(it.title)) problems.push(`现有标题重复：${it.title}`);
      seenTitles.add(it.title);
    }
  }
}

for (const g of newGroups) {
  const sub = subIndex.get(g.sub);
  if (!sub) { problems.push(`未知 sub id：${g.sub}`); continue; }
  for (const it of g.items) {
    if (!it.title || !it.text) { problems.push(`${g.sub} 条目缺 title/text`); continue; }
    if (seenTitles.has(it.title)) { problems.push(`新标题与现有冲突：${it.title}`); continue; }
    seenTitles.add(it.title);
    sub.items.push(it);
    added++;
  }
}

if (added !== 100) problems.push(`新增数量应为 100，实际 ${added}`);
const total = data.categories.reduce((n, c) => n + c.subs.reduce((m, s) => m + s.items.length, 0), 0);
if (total !== 201) problems.push(`总条数应为 201，实际 ${total}`);

if (problems.length > 0) {
  console.error('✗ 校验失败：');
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}

data.version = 6;
data.description = 'DSH-Desktop 内置提示词库（v1.0.5：6 分类下细分二级子分类，共 201 条；我的提示词不受影响）';

fs.writeFileSync(PROMPTS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log(`✓ prompts.json 已更新：version 6，新增 ${added} 条，总计 ${total} 条（标题全部唯一）`);
