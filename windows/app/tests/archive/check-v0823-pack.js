'use strict';
// v0.8.23 打包内容核对
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const pet = fs.readFileSync(app + 'modules/pet.js', 'utf8');
const mw = fs.readFileSync(app + 'modules/windows/main-window.js', 'utf8');
const prog = fs.readFileSync(app + 'renderer/progress.html', 'utf8');
const v = JSON.parse(fs.readFileSync(app + 'package.json', 'utf8'));
const out = {
  'version 0.8.23': v.version === '0.8.23',
  'pet dev==packaged': pet === fs.readFileSync('modules/pet.js', 'utf8'),
  'main-window dev==packaged': mw === fs.readFileSync('modules/windows/main-window.js', 'utf8'),
  // T1: 页面内自愈
  'ensurePet + observer': pet.includes('window.__dshEnsurePet') && pet.includes('new MutationObserver(onDomChange)'),
  'observer attributes watch': pet.includes("attributeFilter: ['style', 'class']"),
  'self-heal idempotent': pet.includes('if (window.__dshPetSelfHeal) {'),
  'guard visibility': mw.includes('缺失或不可见，重新注入'),
  // T2: 弹窗外观统一
  'progress shared.css': prog.includes('shared.css'),
  'progress dark tokens': prog.includes('var(--brand)'),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
