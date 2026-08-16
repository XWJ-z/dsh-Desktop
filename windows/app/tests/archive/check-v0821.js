'use strict';
// v0.8.21 代码级验证：①启动不再自动打开 DSH 设置面板 ②DSH 面板改外观→壳反向同步 ③公告菜单移到帮助右边
const fs = require('fs');
const main = fs.readFileSync('main.js', 'utf8');
const menu = fs.readFileSync('modules/menu.js', 'utf8');
const path = require('path');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vjson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));
const checks = [
  // T1: applyAppearance 不再调用 syncDshAppearance（启动只设壳外观）
  ['applyAppearance no sync call', !/function applyAppearance[\s\S]*?syncDshAppearance\(m\)/.test(main)],
  // T1: whenReady 删除 4s 自动同步（不再每次启动开 DSH 面板）
  ['no auto sync at 4s', !main.includes('setTimeout(() => syncDshAppearance(settings.appearance')],
  ['no auto sync at all in whenReady', !/createMainWindow\(\);\s*\n\s*\/\/ v0\.8\.19/.test(main)],
  // T1: 用户主动选择时才 sync（openAppearanceDialog 显式调用）
  ['user choice syncs DSH', /settings\.appearance = mode;[\s\S]*?syncDshAppearance\(mode\);[\s\S]*?refreshMenusRef\(\);/.test(main)],
  // T1: syncDshAppearance 记录面板原状态 + 同步后关闭（不残留）
  ['sync records wasOpen', main.includes('const wasOpen = !!document.querySelector(\'[class*="themeCube"]\')')],
  ['sync closes panel after', main.includes('if (r && r.ok && !wasOpen)')],
  // T2: 反向监听 startDshThemeWatch
  ['startDshThemeWatch defined', main.includes('function startDshThemeWatch()')],
  ['watch reads themeCube selected', main.includes('/themeCube/.test(b.className || \'\') && /_selected/.test(b.className || \'\')')],
  ['watch maps labels', main.includes("if (t === '浅色') return 'light'") && main.includes("if (t === '深色') return 'dark'") && main.includes("if (t === '跟随系统') return 'system'")],
  ['watch updates shell settings', /检测到 DSH 面板外观变更/.test(main) && /settings\.appearance = mode;[\s\S]*?applyAppearance\(mode\);[\s\S]*?refreshMenusRef\(\);/.test(main)],
  ['watch started in whenReady', /createMainWindow\(\);\s*\n\s*\/\/ v0\.8\.21/.test(main) && main.includes('startDshThemeWatch();')],
  // T3: 公告菜单在帮助菜单右边（帮助 label 位置 < 公告 label 位置）
  ['help before notice', menu.indexOf("label: '帮助',") !== -1 && menu.indexOf("label: '帮助',") < menu.indexOf('label: `公告')],
  // 版本
  ['package version 0.8.21', pkg.version === '0.8.21'],
  ['version.json 0.8.21', vjson.version === '0.8.21'],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
