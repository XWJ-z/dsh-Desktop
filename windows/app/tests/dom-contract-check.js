'use strict';
// dom-contract-check.js — 校验 renderer JS 引用的 DOM id 在同类 HTML 中已定义
// 用法：node tests/dom-contract-check.js <js> <html>
const fs = require('node:fs');
const js = fs.readFileSync(process.argv[2], 'utf8');
const html = fs.readFileSync(process.argv[3], 'utf8');
const ids = new Set();
for (const m of js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) ids.add(m[1]);
for (const m of js.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)) ids.add(m[1]);
for (const m of js.matchAll(/\bel\(\s*['"]([^'"]+)['"]\s*\)/g)) ids.add(m[1]);
const missing = [];
for (const id of ids) {
  if (!html.includes('id="' + id + '"') && !html.includes("id='" + id + "'")) missing.push(id);
}
console.log(`referenced ids: ${ids.size}`);
console.log(`missing: ${missing.length}`);
if (missing.length) { missing.forEach((id) => console.log('  MISSING: ' + id)); process.exit(1); }
console.log('ALL_PRESENT');
