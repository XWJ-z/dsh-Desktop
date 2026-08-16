'use strict';
// v0.8.19 代码级验证：延迟重试注入 + 位置校验 + DSH 外观同步
const fs = require('fs');
const mw = fs.readFileSync('modules/windows/main-window.js', 'utf8');
const pet = fs.readFileSync('modules/pet.js', 'utf8');
const main = fs.readFileSync('main.js', 'utf8');
const checks = [
  // T1: 延迟重试注入
  ['did-finish-load tryInject', mw.includes('const tryInject = () => {')],
  ['inject after 1s', mw.includes('setTimeout(tryInject, 1000)')],
  ['retry up to 6', mw.includes('injectTries >= 6')],
  ['check pet exists before retry', mw.includes('!!document.getElementById')],
  // T1: 位置校验
  ['savedValid check', pet.includes('const savedValid = saved && typeof saved.x === \'number\'')],
  ['fallback bottom-center', pet.includes('Math.round((window.innerWidth - 64) / 2)')],
  // T2: DSH 外观同步
  ['syncDshAppearance defined', main.includes('function syncDshAppearance(mode)')],
  ['sync opens settings', main.includes("(b.textContent || '').trim() === '设置'")],
  ['sync clicks theme btn', main.includes('(b.textContent || \'\').trim() === ${JSON.stringify(label)}')],
  ['applyAppearance calls sync', main.includes('syncDshAppearance(m);')],
  ['post-window sync at 4s', main.includes('setTimeout(() => syncDshAppearance(settings.appearance || \'system\'), 4000)')],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
