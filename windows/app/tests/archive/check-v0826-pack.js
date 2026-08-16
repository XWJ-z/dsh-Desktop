'use strict';
// v0.8.26 打包内容核对：SVG V3 已进包 + 代码与开发版一致 + 版本号
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const svg = fs.readFileSync(app + 'assets/pet-whale.svg', 'utf8');
const svgDev = fs.readFileSync('assets/pet-whale.svg', 'utf8');
const pet = fs.readFileSync(app + 'modules/pet.js', 'utf8');
const v = JSON.parse(fs.readFileSync(app + 'package.json', 'utf8'));
const out = {
  'version 0.8.26': v.version === '0.8.26',
  'SVG dev==packaged': svg === svgDev,
  'V3 body in packaged svg': svg.includes('M26 24 C 6 24 2 58 2 58'),
  'V3 tail in packaged svg': svg.includes('M112 56 C 115 49'),
  'V3 single eye in packaged svg': svg.includes('cx="20" cy="52" r="5.5"'),
  'V3 no Q elements': !svg.includes('rx="10"') && !svg.includes('#ff9db8') && !svg.includes('dsh-whale-belly'),
  'pet dev==packaged': pet === fs.readFileSync('modules/pet.js', 'utf8'),
  'pet reads pet-whale.svg': pet.includes("'pet-whale.svg'"),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
