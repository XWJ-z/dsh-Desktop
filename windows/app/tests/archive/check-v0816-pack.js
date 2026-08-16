'use strict';
// v0.8.16 打包内容核对
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const pet = fs.readFileSync(app + 'modules/pet.js', 'utf8');
const menu = fs.readFileSync(app + 'modules/menu.js', 'utf8');
const ipc = fs.readFileSync(app + 'modules/ipc.js', 'utf8');
const main = fs.readFileSync(app + 'main.js', 'utf8');
const v = JSON.parse(fs.readFileSync(app + 'package.json', 'utf8'));
const out = {
  'version 0.8.16': v.version === '0.8.16',
  'main.js dev==packaged': main === fs.readFileSync('main.js', 'utf8'),
  'pet.js isToolbox': pet.includes('let isToolbox = petHidden;'),
  'pet.js dataset.mode': pet.includes("pet.dataset.mode = petHidden ? 'toolbox' : 'pet';"),
  'pet.js hover toolbox only menu': pet.includes('if (isToolbox) { showMenu(true); return; }'),
  'pet.js click toolbox no-op': pet.includes('if (isToolbox) return;'),
  'pet.js night egg only pet': pet.includes('if (!isToolbox && (h >= 23 || h < 5))'),
  'ipc celebrate only pet': ipc.includes("if (!p || p.dataset.mode !== 'pet') return;"),
  'menu no 显示桌面宠物': !menu.includes("label: '显示桌面宠物'"),
  'menu file no minimize action': !/label: '最小化到托盘', click: \(\) => \{ const mw = getMainWindow\(\); if \(mw && !mw\.isDestroyed\(\)\) mw\.hide\(\); \}/.test(menu),
  'menu keeps minimize setting': menu.includes("label: '最小化到托盘',\n            type: 'checkbox'"),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
