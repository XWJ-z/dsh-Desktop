'use strict';
// v0.8.27 代码级验证：宠物图标 = 手绘 DeepSeek 官方 logo 鲸鱼轮廓 + 表情 class
// （用户指令：太难看了，就用 DeepSeek 的图标轮廓；不改版本，仍在 0.8.27）
const fs = require('fs');
const path = require('path');
const svg = fs.readFileSync('assets/pet-whale.svg', 'utf8');
const pet = fs.readFileSync('modules/pet.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vjson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));
const checks = [
  // ── DeepSeek logo 鲸鱼轮廓 ──
  ['DeepSeek logo 鲸鱼 body path', svg.includes('M989.5616455,63.0478363')],
  ['bodyG 渐变', svg.includes('id="bodyG"')],
  ['深蓝腹部阴影区域', svg.includes('#3A52D8')],
  ['filter shadow', svg.includes('id="shadow"')],
  ['g transform translate/scale', svg.includes('translate(0, 85) scale(0.68)')],
  ['viewBox 680x680', svg.includes('viewBox="0 0 680 680"')],
  // ── 表情 class（用户图 + injectPet 兼容） ──
  ['class="eye eye-r"', svg.includes('class="eye eye-r"')],
  ['眼睛深色 #181A35', svg.includes('#181A35')],
  ['class="mouth"', svg.includes('class="mouth"')],
  ['腮红 cheekG', svg.includes('id="cheekG"')],
  ['肚皮 bellyG', svg.includes('id="bellyG"')],
  // ── 无旧版特征 ──
  ['无 Twemoji body path', !svg.includes('M36 7.001c')],
  ['无 V3 body path', !svg.includes('M26 24 C 6 24')],
  ['无腮红 #ff9db8', !svg.includes('#ff9db8')],
  // ── 引用与版本（不改版本，仍 0.8.27） ──
  ['pet.js 读取路径未变', pet.includes("'pet-whale.svg'")],
  ['package version 0.8.27', pkg.version === '0.8.27'],
  ['version.json 0.8.27', vjson.version === '0.8.27'],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
