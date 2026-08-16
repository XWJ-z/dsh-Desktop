'use strict';
// v0.8.25 代码级验证：宠物图标 SVG V2 重设计（好看一点）+ 表情 class/渐变 id 兼容保留
const fs = require('fs');
const path = require('path');
const svg = fs.readFileSync('assets/pet-whale.svg', 'utf8');
const pet = fs.readFileSync('modules/pet.js', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vjson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));
const checks = [
  // ── V2 设计特征 ──
  ['V2 body: 圆润流线大头 path', svg.includes('M60 14 C 90 14 104 34 104 60')],
  ['V2 tail: 分叉尾鳍 path', svg.includes('M98 78 C 106 72 112 68 118 68')],
  ['V2 胸鳍 path', svg.includes('M18 54 C 10 56 5 60 5 66')],
  ['V2 肚皮渐变 id', svg.includes('id="dsh-whale-belly"')],
  ['V2 大眼 + 双高光', svg.includes('rx="10" ry="11.5"') && svg.includes('r="4"')],
  ['V2 腮红白底托底', svg.includes('fill="#ff9db8" opacity="0.95"')],
  ['V2 头部高光弧', svg.includes('stroke-width="7"')],
  ['V2 喷水孔 + 水珠', svg.includes('fill="#9db8ff"')],
  // ── 表情/渐变兼容保留（injectPet 依赖） ──
  ['class="tail" 保留', svg.includes('class="tail"')],
  ['class="eye eye-l" 保留', svg.includes('class="eye eye-l"')],
  ['class="eye eye-r" 保留', svg.includes('class="eye eye-r"')],
  ['class="mouth" 保留', svg.includes('class="mouth"')],
  ['dsh-whale-grad 渐变 id 保留', svg.includes('id="dsh-whale-grad"')],
  ['viewBox 120x120 保留', svg.includes('viewBox="0 0 120 120"')],
  // ── 引用与版本 ──
  ['pet.js 读取路径未变', pet.includes("'pet-whale.svg'")],
  ['package version 0.8.25', pkg.version === '0.8.25'],
  ['version.json 0.8.25', vjson.version === '0.8.25'],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
