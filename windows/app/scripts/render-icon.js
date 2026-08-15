'use strict';

/**
 * render-icon.js — 用 Electron 离屏渲染把 DeepSeek 品牌 SVG 栅格化为应用图标
 *
 * 输入：assets/icon-source.svg（DeepSeek 鲸鱼 logo + 品牌渐变底）
 * 输出：assets/icon.png（512x512，窗口图标）、assets/icon.ico（256x256，Windows 打包图标）
 *
 * 用法（在 app/ 目录下）：
 *   npx electron scripts/render-icon.js
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const assetsDir = path.join(__dirname, '..', 'assets');
const svgContent = fs.readFileSync(path.join(assetsDir, 'icon-source.svg'), 'utf8');

// 内联 SVG 的 HTML 包装：铺满视口，保证离屏窗口尺寸即最终像素尺寸
function buildHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; }
    svg { display: block; width: 100%; height: 100%; }
  </style></head><body>${svgContent}</body></html>`;
}

function pngToIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 0;
  entry[1] = 0;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngBuffer]);
}

async function render(size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true },
  });
  const tmpHtml = path.join(app.getPath('temp'), `dsh-icon-${size}.html`);
  fs.writeFileSync(tmpHtml, buildHtml());
  await win.loadFile(tmpHtml);
  // 等待 SVG 完成绘制
  await new Promise((resolve) => setTimeout(resolve, 400));
  const image = await win.webContents.capturePage();
  win.destroy();
  fs.rmSync(tmpHtml, { force: true });
  return image;
}

app.whenReady().then(async () => {
  try {
    const image512 = await render(512);
    fs.writeFileSync(path.join(assetsDir, 'icon.png'), image512.toPNG());
    console.log(`已生成 icon.png（512x512，${image512.toPNG().length} 字节）`);

    // 用 nativeImage.resize 缩放出 256（避免二次开窗）
    const image256 = image512.resize({ width: 256, height: 256 });
    const png256 = image256.toPNG();
    fs.writeFileSync(path.join(assetsDir, 'icon.ico'), pngToIco(png256));
    console.log(`已生成 icon.ico（256x256，${png256.length + 22} 字节）`);
  } catch (err) {
    console.error('[render-icon] 失败：', err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
