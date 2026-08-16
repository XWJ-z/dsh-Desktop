'use strict';
// v0.8.19 打包内容核对
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const main = fs.readFileSync(app + 'main.js', 'utf8');
const mw = fs.readFileSync(app + 'modules/windows/main-window.js', 'utf8');
const pet = fs.readFileSync(app + 'modules/pet.js', 'utf8');
const v = JSON.parse(fs.readFileSync(app + 'package.json', 'utf8'));
const out = {
  'version 0.8.19': v.version === '0.8.19',
  'main.js dev==packaged': main === fs.readFileSync('main.js', 'utf8'),
  'main-window retry inject': mw.includes('const tryInject = () => {') && mw.includes('injectTries >= 6'),
  'pet savedValid': pet.includes('const savedValid = saved &&'),
  'pet fallback center': pet.includes('Math.round((window.innerWidth - 64) / 2)'),
  'syncDshAppearance': main.includes('function syncDshAppearance(mode)'),
  'sync theme click': main.includes('theme-btn-not-found'),
  'post-window sync': main.includes('setTimeout(() => syncDshAppearance'),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
