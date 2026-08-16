'use strict';
// v0.8.18 代码级验证：气泡下方 + 外观菜单 + 公告位置
const fs = require('fs');
const pet = fs.readFileSync('modules/pet.js', 'utf8');
const menu = fs.readFileSync('modules/menu.js', 'utf8');
const main = fs.readFileSync('main.js', 'utf8');

const settingsSection = menu.slice(menu.indexOf("label: '设置'"), menu.indexOf('label: `公告'));
const noticeSection = menu.slice(menu.indexOf('label: `公告'), menu.indexOf("label: '帮助'"));
const helpSection = menu.slice(menu.indexOf("label: '帮助'"));

const checks = [
  // T1: 气泡在下方（菜单 .pet-menu 保留上方 —— 悬停才出，不遮挡；老大指对话词气泡）
  ['bubble top:100%', pet.includes("'position:absolute;top:100%;left:50%;transform:translateX(-50%);'")],
  ['bubble margin-top', pet.includes("margin-top:8px")],
  ['menu still bottom:100%', pet.includes("menu.style.cssText = 'position:absolute;bottom:100%;left:50%;transform:translateX(-50%);'")],
  // T2: 外观菜单
  ['菜单含外观…', menu.includes("label: '外观…'")],
  ['菜单含 openAppearanceDialog dep', menu.includes('openAppearanceDialog,')],
  ['main.js nativeTheme import', main.includes('nativeTheme')],
  ['main.js applyAppearance', main.includes('function applyAppearance(mode)')],
  ['main.js themeSource set', main.includes('nativeTheme.themeSource = m;')],
  ['main.js openAppearanceDialog', main.includes('function openAppearanceDialog()')],
  ['main.js whenReady apply', main.includes('applyAppearance(settings.appearance || \'system\')')],
  ['main.js saveSettingsRef', main.includes('let saveSettingsRef = () => {};')],
  ['settings appearance default', main.includes("appearance: 'system',")],
  // T3: 公告位置（设置右边、帮助左边）
  ['公告在设置之后', menu.indexOf('label: `公告') > menu.indexOf("label: '设置'")],
  ['公告在帮助之前', menu.indexOf('label: `公告') < menu.indexOf("label: '帮助'")],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
