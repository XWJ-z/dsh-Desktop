'use strict';
// v0.8.17 代码级验证 v3：用菜单项对象精确断言（排除注释文本干扰）
const fs = require('fs');
const menu = fs.readFileSync('modules/menu.js', 'utf8');
const pet = fs.readFileSync('modules/pet.js', 'utf8');

const fileSection = menu.slice(menu.indexOf("label: '文件'"), menu.indexOf("label: '视图'"));
const viewSection = menu.slice(menu.indexOf("label: '视图'"), menu.indexOf("label: '设置'"));
const helpSection = menu.slice(menu.indexOf("label: '帮助'"));
const noticeSection = menu.slice(menu.indexOf('label: `公告'), menu.indexOf("label: '帮助'"));

const checks = [
  // T1: 重新加载界面 —— 用菜单项对象精确匹配（{ label: '重新加载界面' 形式）
  ['文件菜单无重新加载项', !fileSection.includes("{ label: '重新加载界面'") && !fileSection.includes("label: '重新加载界面',\n")],
  ['视图菜单有重新加载项', viewSection.includes("{ label: '重新加载界面'")],
  // T2: 公告独立菜单
  ['帮助菜单无公告', !helpSection.includes('公告${')],
  ['公告是一级菜单', noticeSection.includes('公告${') && noticeSection.includes("label: '查看公告'")],
  // T3: 默认位置底部居中
  ['默认底部居中计算', pet.includes("Math.round((window.innerWidth - 64) / 2) + 'px;bottom:24px")],
  ['无右下角默认', !pet.includes("'right:24px;bottom:24px;left:auto;top:auto;'")],
  ['恢复默认布局注释更新', pet.includes('宠物/工具箱回底部居中')],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
