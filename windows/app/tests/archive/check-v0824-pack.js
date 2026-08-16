'use strict';
// v0.8.24 打包内容核对
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const pet = fs.readFileSync(app + 'modules/pet.js', 'utf8');
const main = fs.readFileSync(app + 'main.js', 'utf8');
const v = JSON.parse(fs.readFileSync(app + 'package.json', 'utf8'));
const out = {
  'version 0.8.24': v.version === '0.8.24',
  'pet dev==packaged': pet === fs.readFileSync('modules/pet.js', 'utf8'),
  'main dev==packaged': main === fs.readFileSync('main.js', 'utf8'),
  // T2: saved 分支无重复 top
  'saved no dup top': !/top:' \+ saved\.y \+ 'px;right:auto;top:auto;'/.test(pet),
  // T1: 关闭用点空白 + stillOpen 检查
  'close via outside click': main.includes('document.elementFromPoint(8, 8)'),
  'close checks stillOpen': main.includes('const stillOpen = !!document.querySelector(\'[class*="themeCube"]\')'),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
