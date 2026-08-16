'use strict';
// v0.8.16 检查：工具箱形态禁用宠物交互 + 菜单项删除
const fs = require('fs');
const pet = fs.readFileSync('modules/pet.js', 'utf8');
const menu = fs.readFileSync('modules/menu.js', 'utf8');
const ipc = fs.readFileSync('modules/ipc.js', 'utf8');
const checks = [
  // T1: 工具箱形态禁用宠物交互
  ['isToolbox state', pet.includes('let isToolbox = petHidden;')],
  ['switchMode sets isToolbox', pet.includes('isToolbox = hidden;')],
  ['hover toolbox only menu', pet.includes('if (isToolbox) { showMenu(true); return; }')],
  ['mouseleave guard', pet.includes("if (!isToolbox) setCls('');")],
  ['click toolbox no-op', pet.includes('if (isToolbox) return; // v0.8.16')],
  ['idle blink toolbox skip', pet.includes('if (isToolbox) return;')],
  ['night egg only pet', pet.includes('if (!isToolbox && (h >= 23 || h < 5))')],
  ['welcome bubble only pet', pet.includes('if (!isToolbox) setTimeout(() => say(LINES.welcome), 2500)')],
  ['dataset.mode init', pet.includes("pet.dataset.mode = petHidden ? 'toolbox' : 'pet';")],
  ['dataset.mode on switch', pet.includes("pet.dataset.mode = hidden ? 'toolbox' : 'pet';")],
  // ipc: 注入庆祝/通知仅宠物形态
  ['inject celebrate only pet', ipc.includes("if (!p || p.dataset.mode !== 'pet') return;")],
  ['pet notify only pet', ipc.includes("if (!p || p.dataset.mode !== 'pet') return;")],
  // T2: 文件菜单删除最小化托盘
  ['file menu no minimize', !/label: '最小化到托盘', click: \(\) => \{ const mw = getMainWindow\(\); if \(mw && !mw\.isDestroyed\(\)\) mw\.hide\(\); \}/.test(menu)],
  // T3: 设置菜单删除显示桌面宠物
  ['settings no pet toggle', !menu.includes("label: '显示桌面宠物'")],
  ['menu no injectPet dep', !menu.includes('injectPet,')],
  ['menu keeps 最小化到托盘 setting', menu.includes("label: '最小化到托盘',\n            type: 'checkbox'")],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
