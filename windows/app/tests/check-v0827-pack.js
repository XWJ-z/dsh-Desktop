'use strict';
// v0.8.27 打包内容核对：DeepSeek logo 鲸鱼 SVG 已进包 + 代码与开发版一致 + 版本号
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const svg = fs.readFileSync(app + 'assets/pet-whale.svg', 'utf8');
const svgDev = fs.readFileSync('assets/pet-whale.svg', 'utf8');
const pet = fs.readFileSync(app + 'modules/pet.js', 'utf8');
const v = JSON.parse(fs.readFileSync(app + 'package.json', 'utf8'));
const out = {
  'version 0.8.27': v.version === '0.8.27',
  'SVG dev==packaged': svg === svgDev,
  'DeepSeek body in pkg': svg.includes('M989.5616455,63.0478363'),
  'bodyG in pkg': svg.includes('id="bodyG"'),
  'eye class in pkg': svg.includes('class="eye eye-r"'),
  'mouth class in pkg': svg.includes('class="mouth"'),
  'viewBox 680 in pkg': svg.includes('viewBox="0 0 680 680"'),
  'no Twemoji in pkg': !svg.includes('M36 7.001c'),
  'pet dev==packaged': pet === fs.readFileSync('modules/pet.js', 'utf8'),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
