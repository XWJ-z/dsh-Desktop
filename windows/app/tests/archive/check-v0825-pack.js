'use strict';
// v0.8.25 打包内容核对：SVG V2 已进包 + 代码与开发版一致 + 版本号
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const svg = fs.readFileSync(app + 'assets/pet-whale.svg', 'utf8');
const svgDev = fs.readFileSync('assets/pet-whale.svg', 'utf8');
const pet = fs.readFileSync(app + 'modules/pet.js', 'utf8');
const v = JSON.parse(fs.readFileSync(app + 'package.json', 'utf8'));
const out = {
  'version 0.8.25': v.version === '0.8.25',
  'SVG dev==packaged': svg === svgDev,
  'V2 body in packaged svg': svg.includes('M60 14 C 90 14 104 34 104 60'),
  'V2 belly grad in packaged svg': svg.includes('id="dsh-whale-belly"'),
  'V2 blush white base in packaged svg': svg.includes('fill="#ff9db8" opacity="0.95"'),
  'pet dev==packaged': pet === fs.readFileSync('modules/pet.js', 'utf8'),
  'pet reads pet-whale.svg': pet.includes("'pet-whale.svg'"),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
