'use strict';
// v0.8.15 双形态（宠物/工具箱）模板校验 v2：检查 switchMode 前端同步切换逻辑
const fs = require('fs');
const src = fs.readFileSync('modules/pet.js', 'utf8');
const checks = [
  ['toolboxSvgText defined', src.includes('function toolboxSvgText()')],
  ['toolbox svg read', src.includes('toolbox.svg')],
  ['switchMode defined', src.includes('const switchMode = (hidden) =>')],
  ['switchMode svg replace', src.includes('cur.replaceWith(ns)')],
  ['switchMode menu swap', src.includes("last.dataset.action = hidden ? 'showpet' : 'hide'")],
  ['switchMode title swap', src.includes("pet.title = hidden ? '工具箱（可拖拽，悬停出菜单）'")],
  ['both svgs injected', src.includes('const petSvg = ') && src.includes('const toolboxSvg = ')],
  ['hide -> switchMode(true)', src.includes('switchMode(true);')],
  ['showpet -> switchMode(false)', src.includes('switchMode(false);')],
  // hide 分支（setTimeout 内）不再 remove —— 改 switchMode 同步切换；resetWebOpenBtnLayout 仍可 remove
  ['hide branch no remove', !/setTimeout\(\(\) => \{\s*pet\.remove\(\)/.test(src)],
  ['ipc.js no injectPet dep', !fs.readFileSync('modules/ipc.js', 'utf8').includes('injectPet,')],
  ['export toolboxSvgText', src.includes('toolboxSvgText, injectPet')],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
