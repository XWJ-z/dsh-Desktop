'use strict';
// 核对 win-unpacked（安装版内容）pet.js 双形态 + 版本
const fs = require('fs');
const p = 'dist/installer/win-unpacked/resources/app/modules/pet.js';
const s = fs.readFileSync(p, 'utf8');
console.log('win-unpacked pet.js:');
console.log('  toolboxSvgText =', s.includes('function toolboxSvgText'));
console.log('  showpet =', s.includes('data-action="showpet"'));
console.log('  dual hide =', s.includes('data-action="hide"'));
console.log('  petHidden branch =', s.includes('const petHidden = ${petHidden};'));
const v = JSON.parse(fs.readFileSync('dist/installer/win-unpacked/resources/app/package.json', 'utf8'));
console.log('  packaged version =', v.version);
// 对比 dev
const dev = fs.readFileSync('modules/pet.js', 'utf8');
console.log('  dev==packaged =', dev === s);
