'use strict';
/**
 * 渲染 SVG 预览脚本（本地目检用，不打包）。
 * 用法：electron.exe tests/render-svg-preview.js <svg路径> <输出png> <显示尺寸>
 * 例：electron.exe tests/render-svg-preview.js assets/pet-whale.svg tmp-pet-200.png 200
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svgPath = process.argv[2];
const outPath = process.argv[3];
const size = Number(process.argv[4] || 200);

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: size + 80, height: size + 80, show: true, frame: false,
      x: -20000, y: -20000, // 屏幕外显示，避免打扰
    });
    const svg = fs.readFileSync(path.resolve(svgPath), 'utf8');
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#101216;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="width:${size}px;height:${size}px;filter:drop-shadow(0 6px 18px rgba(77,107,254,.45))">${svg}</div>
</body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 600));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.resolve(outPath), image.toPNG());
    console.log('OK -> ' + path.resolve(outPath));
  } catch (e) {
    console.error('ERR', e);
    process.exitCode = 1;
  }
  app.quit();
});
