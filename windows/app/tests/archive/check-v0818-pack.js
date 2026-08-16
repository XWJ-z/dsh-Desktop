'use strict';
// v0.8.18 打包内容核对
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const pet = fs.readFileSync(app + 'modules/pet.js', 'utf8');
const menu = fs.readFileSync(app + 'modules/menu.js', 'utf8');
const main = fs.readFileSync(app + 'main.js', 'utf8');
const v = JSON.parse(fs.readFileSync(app + 'package.json', 'utf8'));
const out = {
  'version 0.8.18': v.version === '0.8.18',
  'main.js dev==packaged': main === fs.readFileSync('main.js', 'utf8'),
  'bubble top:100%': pet.includes("'position:absolute;top:100%;left:50%;transform:translateX(-50%);'"),
  'menu has 外观': menu.includes("label: '外观…'"),
  'nativeTheme imported': main.includes('nativeTheme'),
  'themeSource set': main.includes('nativeTheme.themeSource = m;'),
  'notice after settings': menu.indexOf('label: `公告') > menu.indexOf("label: '设置'"),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
