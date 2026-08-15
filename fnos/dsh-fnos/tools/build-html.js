// build-html.js — 生成/更新 about.html / init.html 的内嵌 base64 图片
// 用法：
//   node build-html.js            从 *.tmpl.html 模板完整生成（模板不存在会报错）
//   node build-html.js update-logo 只替换现有页面里第一个 base64 图（logo）为新图标
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'dsh', 'app', 'server');
const UI_IMAGES = path.join(__dirname, '..', 'dsh', 'app', 'ui', 'images');
const ASSETS = path.join(__dirname, '..', 'assets');

const logoB64 = fs.readFileSync(path.join(UI_IMAGES, 'icon_64.png')).toString('base64');
const qrB64 = fs.readFileSync(path.join(ASSETS, 'qq-group.png')).toString('base64');

function buildFromTemplate(tmpl, out, repl) {
  let html = fs.readFileSync(path.join(SERVER, tmpl), 'utf8');
  for (const [k, v] of Object.entries(repl)) {
    html = html.split(k).join(v);
  }
  if (html.includes('{{')) throw new Error(`占位符未完全替换：${out}`);
  fs.writeFileSync(path.join(SERVER, out), html, 'utf8');
  fs.unlinkSync(path.join(SERVER, tmpl));
  console.log(`${out}: ${fs.statSync(path.join(SERVER, out)).size} bytes (template)`);
}

function updateLogo(out) {
  const file = path.join(SERVER, out);
  let html = fs.readFileSync(file, 'utf8');
  const before = html;
  html = html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/, 'data:image/png;base64,' + logoB64);
  if (html === before) throw new Error(`未找到 logo base64：${out}`);
  fs.writeFileSync(file, html, 'utf8');
  console.log(`${out}: logo 已更新为 ${logoB64.length} 字符 base64`);
}

const mode = process.argv[2];
if (mode === 'update-logo') {
  updateLogo('init.html');
  updateLogo('about.html');
} else {
  buildFromTemplate('init.tmpl.html', 'init.html', { '{{LOGO_B64}}': logoB64 });
  buildFromTemplate('about.tmpl.html', 'about.html', { '{{QR_B64}}': qrB64, '{{LOGO_B64}}': logoB64 });
}
console.log('done');
