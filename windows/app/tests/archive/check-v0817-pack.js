'use strict';
// v0.8.17 打包内容核对
const fs = require('fs');
const app = 'dist/installer/win-unpacked/resources/app/';
const menu = fs.readFileSync(app + 'modules/menu.js', 'utf8');
const pet = fs.readFileSync(app + 'modules/pet.js', 'utf8');
const main = fs.readFileSync(app + 'main.js', 'utf8');
const v = JSON.parse(fs.readFileSync(app + 'package.json', 'utf8'));

const fileSection = menu.slice(menu.indexOf("label: '文件'"), menu.indexOf("label: '视图'"));
const viewSection = menu.slice(menu.indexOf("label: '视图'"), menu.indexOf("label: '设置'"));
const noticeSection = menu.slice(menu.indexOf('label: `公告'), menu.indexOf("label: '帮助'"));

const out = {
  'version 0.8.17': v.version === '0.8.17',
  'main.js dev==packaged': main === fs.readFileSync('main.js', 'utf8'),
  '文件菜单无重新加载': !fileSection.includes("label: '重新加载界面'"),
  '视图菜单有重新加载': viewSection.includes("label: '重新加载界面'"),
  '公告独立菜单': noticeSection.includes('公告${') && noticeSection.includes("label: '查看公告'"),
  '默认底部居中': pet.includes("Math.round((window.innerWidth - 64) / 2) + 'px;bottom:24px"),
};
let ok = true;
for (const [n, pass] of Object.entries(out)) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
