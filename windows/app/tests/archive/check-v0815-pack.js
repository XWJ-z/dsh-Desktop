'use strict';
// v0.8.15 打包内容核对 v2（switchMode 重构后）
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const s = fs.readFileSync(app + 'main.js', 'utf8');
const dev = fs.readFileSync('main.js', 'utf8');
const pet = fs.readFileSync(app + 'modules/pet.js', 'utf8');
const ipc = fs.readFileSync(app + 'modules/ipc.js', 'utf8');
const out = {
  'main.js dev==packaged': dev === s,
  'pet.js switchMode': pet.includes('const switchMode = (hidden) =>'),
  'pet.js dual showpet': pet.includes('data-action="showpet"'),
  'pet.js dual hide': pet.includes('data-action="hide"'),
  'pet.js toolboxSvgText': pet.includes('toolboxSvgText'),
  'pet.js both svgs': pet.includes('const petSvg = ') && pet.includes('const toolboxSvg = '),
  'hide branch no remove': !/setTimeout\(\(\) => \{\s*pet\.remove\(\)/.test(pet),
  'toolbox.svg packaged': fs.existsSync(app + 'assets/toolbox.svg'),
  'ipc.js no injectPet dep': !ipc.includes('injectPet,'),
  'ipc.js pet:hidden simple': ipc.includes('ipcMain.handle(\'pet:hidden\'') && !ipc.includes('injectPet(mw)'),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
