'use strict';
// v0.8.22 代码级验证：①宠物/工具箱持续守护（被 SPA 清除自动重注入）②设置菜单分组优化
const fs = require('fs');
const path = require('path');
const mw = fs.readFileSync('modules/windows/main-window.js', 'utf8');
const menu = fs.readFileSync('modules/menu.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vjson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));
const checks = [
  // T1: 持续守护（替代 v0.8.19 的 6 次重试）
  ['guardPet defined', mw.includes('const guardPet = () => {')],
  ['guard re-injects when missing', /if \(!has\) \{[\s\S]*?injectPet\(win\);/.test(mw)],
  ['guard interval 3s', mw.includes('setInterval(guardPet, 3000)')],
  ['no old 6-tries logic', !mw.includes('injectTries >= 6') && !mw.includes('const tryInject = () => {')],
  ['guard cleaned on closed', /win\.on\('closed', \(\) => \{ if \(petGuardTimer\)/.test(mw)],
  // T2: 设置菜单分组优化
  ['settings 3 groups (2 separators)', (menu.match(/\{ type: 'separator' \}/g) || []).length >= 2],
  ['appearance label shows current', menu.includes("'（浅色）'") && menu.includes("'（深色）'") && menu.includes("'（跟随系统）'")],
  ['close-ask grouped with inject-ask', menu.indexOf('关闭时总是询问') !== -1 && menu.indexOf('关闭时总是询问') < menu.indexOf('提示词注入总是询问')],
  // 版本
  ['package version 0.8.22', pkg.version === '0.8.22'],
  ['version.json 0.8.22', vjson.version === '0.8.22'],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
