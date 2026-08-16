'use strict';
// v0.8.26 代码级验证：宠物图标 V3 扁平图标风（去 Q 版呆萌）+ 表情 class/渐变 id 兼容保留
const fs = require('fs');
const path = require('path');
const svg = fs.readFileSync('assets/pet-whale.svg', 'utf8');
const pet = fs.readFileSync('modules/pet.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vjson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));
const checks = [
  // ── V3 扁平图标风特征 ──
  ['V3 身体：大头流线水滴剪影', svg.includes('M26 24 C 6 24 2 58 2 58')],
  ['V3 尾部收口贴外轮廓(无自交)', svg.includes('C 114 48 98 44 84 43')],
  ['V3 分叉尾鳍', svg.includes('M112 56 C 115 49 117 47 119 49')],
  ['V3 单只小圆点眼', svg.includes('cx="20" cy="52" r="5.5"')],
  ['V3 小嘴弧', svg.includes('M14 70 Q 22 75 30 70')],
  ['V3 背部高光弧(身体内)', svg.includes('M40 42 C 54 42 68 43 80 46')],
  ['V3 腹部弧线', svg.includes('M24 80 C 48 80 74 74 92 66')],
  ['V3 喷水柱+水滴', svg.includes('M26 20 C 22 13 25 7 30 4')],
  // ── 去掉 Q 版元素 ──
  ['无大眼(rx=10 已移除)', !svg.includes('rx="10"')],
  ['无腮红(ff9db8 已移除)', !svg.includes('#ff9db8')],
  ['无肚皮渐变(已移除)', !svg.includes('dsh-whale-belly')],
  // ── 表情/渐变兼容保留（injectPet 依赖） ──
  ['class="tail" 保留', svg.includes('class="tail"')],
  ['class="eye eye-r" 保留', svg.includes('class="eye eye-r"')],
  ['class="mouth" 保留', svg.includes('class="mouth"')],
  ['dsh-whale-grad 渐变 id 保留', svg.includes('id="dsh-whale-grad"')],
  ['viewBox 120x120 保留', svg.includes('viewBox="0 0 120 120"')],
  // ── 引用与版本 ──
  ['pet.js 读取路径未变', pet.includes("'pet-whale.svg'")],
  ['package version 0.8.26', pkg.version === '0.8.26'],
  ['version.json 0.8.26', vjson.version === '0.8.26'],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
