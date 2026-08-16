'use strict';
// v0.8.30 发布前核对（发布铁律：version/hash/download_urls 三处一致 + 安装包匹配）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const repoRoot = path.join(__dirname, '..', '..', '..');
const vjson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'version.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const changelog = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'));
const exe = 'dist/installer/DSH-Desktop-Setup-0.8.30.exe';

const checks = [
  ['package.json version 0.8.30', pkg.version === '0.8.30'],
  ['version.json version 0.8.30', vjson.version === '0.8.30'],
  ['version.json hash 已更新(非 0.8.9 旧值)', vjson.hash === '478abf4d9a3a82a55c24ab3f7d76c6d4a1845a61e29bbb664712c112aaa29c2c'],
  ['version.json download_urls 指向 v0.8.30', vjson.download_urls.every((u) => u.includes('/v0.8.30/DSH-Desktop-Setup-0.8.30.exe'))],
  ['release_notes 整合 0.8.9~0.8.30', vjson.release_notes.includes('桌面宠物') && vjson.release_notes.includes('外观') && vjson.release_notes.includes('0.8.11~0.8.30')],
  ['CHANGELOG 0.8.30 条目', changelog.versions.some((x) => x.version === '0.8.30')],
  ['安装包存在', fs.existsSync(exe)],
];

// 安装包实测 SHA256 vs version.json hash
if (fs.existsSync(exe)) {
  const buf = fs.readFileSync(exe);
  const real = crypto.createHash('sha256').update(buf).digest('hex');
  checks.push(['安装包 SHA256 == version.json hash', real === vjson.hash]);
  checks.push(['安装包体积合理(~114MB)', buf.length > 100 * 1024 * 1024 && buf.length < 130 * 1024 * 1024]);
  console.log(`exe 实测 sha256: ${real}`);
  console.log(`exe 体积: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
} else {
  checks.push(['安装包 SHA256 匹配（无包跳过）', false]);
}

let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
