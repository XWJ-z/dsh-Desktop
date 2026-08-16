'use strict';
// v0.8.22 打包内容核对（win-unpacked 内 app 与源码一致 + 两项修复在位）
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const mw = fs.readFileSync(app + 'modules/windows/main-window.js', 'utf8');
const menu = fs.readFileSync(app + 'modules/menu.js', 'utf8');
const v = JSON.parse(fs.readFileSync(app + 'package.json', 'utf8'));
const out = {
  'version 0.8.22': v.version === '0.8.22',
  'main-window dev==packaged': mw === fs.readFileSync('modules/windows/main-window.js', 'utf8'),
  'menu dev==packaged': menu === fs.readFileSync('modules/menu.js', 'utf8'),
  // T1: 持续守护
  'guardPet': mw.includes('const guardPet = () => {') && mw.includes('setInterval(guardPet, 3000)'),
  'no old 6-tries': !mw.includes('injectTries >= 6'),
  // T2: 设置菜单分组（设置块内 2 分隔符）
  'settings 2 separators': (() => {
    const s = menu.indexOf("label: '设置',");
    const e = menu.indexOf("label: '帮助',");
    return s !== -1 && e !== -1 && (menu.slice(s, e).match(/\{ type: 'separator' \}/g) || []).length === 2;
  })(),
  'appearance shows current': menu.includes("'（浅色）'") && menu.includes("'（深色）'") && menu.includes("'（跟随系统）'"),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
