'use strict';
// v0.8.21 打包内容核对（win-unpacked 内 app 与源码一致 + 三项修复在位）
const fs = require('fs');
const path = require('path');
const app = 'dist/installer/win-unpacked/resources/app/';
const main = fs.readFileSync(app + 'main.js', 'utf8');
const menu = fs.readFileSync(app + 'modules/menu.js', 'utf8');
const v = JSON.parse(fs.readFileSync(app + 'package.json', 'utf8'));
const out = {
  'version 0.8.21': v.version === '0.8.21',
  'main.js dev==packaged': main === fs.readFileSync('main.js', 'utf8'),
  'menu.js dev==packaged': menu === fs.readFileSync('modules/menu.js', 'utf8'),
  // T1: 启动不自动同步（无 4s setTimeout syncDshAppearance、applyAppearance 无 sync 调用）
  'no auto sync at 4s': !main.includes('setTimeout(() => syncDshAppearance(settings.appearance'),
  'applyAppearance no sync': !/function applyAppearance[\s\S]*?syncDshAppearance\(m\)/.test(main),
  'user choice syncs DSH': /settings\.appearance = mode;[\s\S]*?syncDshAppearance\(mode\);[\s\S]*?refreshMenusRef\(\);/.test(main),
  // T2: 反向监听
  'startDshThemeWatch': main.includes('function startDshThemeWatch()') && main.includes('startDshThemeWatch();'),
  'watch themeCube selected': main.includes('/themeCube/.test(b.className || \'\') && /_selected/.test(b.className || \'\')'),
  // T3: 公告在帮助右边
  'help before notice': menu.indexOf("label: '帮助',") !== -1 && menu.indexOf("label: '帮助',") < menu.indexOf('label: `公告'),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
