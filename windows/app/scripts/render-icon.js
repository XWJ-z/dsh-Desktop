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

/**
 * pngToIco — 将多张 PNG 打包为标准多尺寸 ICO（Windows 图标规范）
 * @param {Array<{size: number, png: Buffer}>} multiPngs 建议 256/128/64/48/32/24/16
 * 注意：多尺寸 ICO 避免单尺寸在任务栏(16px)/资源管理器/快捷方式小图标场景被暴力
 * 缩放导致模糊（审查 v9.0 任务4b 根因）。
 */
function pngToIco(multiPngs) {
  const count = multiPngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let entries = Buffer.alloc(0);
  let offset = 6 + count * 16;
  for (const { size, png } of multiPngs) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries = Buffer.concat([entries, entry]);
    offset += png.length;
  }
  return Buffer.concat([header, entries, ...multiPngs.map((m) => m.png)]);
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

    // 用 nativeImage.resize 缩放出多尺寸 PNG（审查 v9.0：Windows 图标需多尺寸，
    // 避免任务栏/快捷方式小图标被暴力缩放模糊）
    const SIZES = [256, 128, 64, 48, 32, 24, 16];
    const multiPngs = SIZES.map((size) => ({
      size,
      png: image512.resize({ width: size, height: size }).toPNG(),
    }));
    fs.writeFileSync(path.join(assetsDir, 'icon.ico'), pngToIco(multiPngs));
    console.log(`已生成 icon.ico（${SIZES.join('/')}，${pngToIco(multiPngs).length} 字节）`);
  } catch (err) {
    console.error('[render-icon] 失败：', err);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
