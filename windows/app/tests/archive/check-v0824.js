'use strict';
// v0.8.24 代码级验证：①移动位置后重开消失（top 重复覆盖 bug）②切换外观后面板被打开
const fs = require('fs');
const path = require('path');
const pet = fs.readFileSync('modules/pet.js', 'utf8');
const main = fs.readFileSync('main.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vjson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));
const checks = [
  // T2: 移动位置重开消失 —— saved 分支不再有重复 top（top:auto 覆盖 bug）
  ['saved branch no dup top', !/left:' \+ saved\.x \+ 'px;top:' \+ saved\.y \+ 'px;right:auto;top:auto;'/.test(pet)],
  ['saved branch keeps top:Y', /left:' \+ saved\.x \+ 'px;top:' \+ saved\.y \+ 'px;right:auto;'/.test(pet)],
  // T1: 切换外观后面板被打开 —— 关闭改用点面板外空白（「设置」按钮非 toggle）
  ['close checks stillOpen', main.includes('const stillOpen = !!document.querySelector(\'[class*="themeCube"]\')')],
  ['close via outside click', main.includes('document.elementFromPoint(8, 8)')],
  ['skip close when auto-closed', main.includes("reason: 'already-auto-closed'")],
  // 版本
  ['package version 0.8.24', pkg.version === '0.8.24'],
  ['version.json 0.8.24', vjson.version === '0.8.24'],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
