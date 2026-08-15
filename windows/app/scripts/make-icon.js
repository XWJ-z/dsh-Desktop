'use strict';

/**
 * make-icon.js — 生成应用图标
 *  1. 若无 assets/icon.png，则用纯 Node（zlib）绘制一个占位 PNG（渐变方块 + 简笔图形）
 *  2. 将 icon.png 包装为 Windows 使用的 icon.ico（单张 256x256 PNG 条目）
 *
 * 用法：node scripts/make-icon.js
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const assetsDir = path.join(root, 'assets');
const pngPath = path.join(assetsDir, 'icon.png');
const icoPath = path.join(assetsDir, 'icon.ico');

fs.mkdirSync(assetsDir, { recursive: true });

// ---------------------------------------------------------------------------
// 简易 PNG 编码器（无外部依赖）：RGBA 像素数组 -> PNG 文件
// ---------------------------------------------------------------------------
function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// 绘制 256x256：深蓝渐变背景圆角方块 + 中央 "DSH" 三色柱状图形
function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const c = (x, y) => {
    const i = (y * size + x) * 4;
    return [px[i], px[i + 1], px[i + 2], px[i + 3]];
  };
  const set = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  };
  const inRoundRect = (x, y) => {
    const left = radius, right = size - radius, top = radius, bottom = size - radius;
    if (x >= left && x <= right) return y >= 0 && y < size;
    if (y >= top && y <= bottom) return x >= 0 && x < size;
    const cx = x < left ? left : right;
    const cy = y < top ? top : bottom;
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy <= radius * radius;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRoundRect(x, y)) continue;
      // 从 #4d7cfe 到 #7a5cff 的对角渐变
      const t = (x + y) / (2 * size);
      set(x, y, Math.round(77 + (122 - 77) * t), Math.round(124 + (92 - 124) * t), Math.round(254 + (255 - 254) * t), 255);
    }
  }
  // 三条竖柱（蓝/青/白），模拟对话/栏式图形
  const barW = size * 0.10, gap = size * 0.07;
  const barTop = size * 0.32, barBottom = size * 0.68;
  const colors = [
    [94, 234, 212],   // 青色
    [129, 140, 248],  // 靛蓝
    [255, 255, 255],  // 白色
  ];
  const startX = size * 0.28;
  for (let b = 0; b < 3; b++) {
    const x0 = Math.round(startX + b * (barW + gap));
    const h = barBottom - (b % 2 === 0 ? 0 : size * 0.08);
    for (let y = barTop; y < h; y++) {
      for (let x = x0; x < x0 + barW; x++) {
        const [r, g, bl] = colors[b];
        set(x, y, r, g, bl, 255);
      }
    }
  }
  return px;
}

// ---------------------------------------------------------------------------
// PNG -> ICO（单张 256x256 PNG 条目）
// ---------------------------------------------------------------------------
function pngToIco(pngBuffer) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 0;   // width 256 -> 0
  entry[1] = 0;   // height 256 -> 0
  entry[2] = 0;   // palette
  entry[3] = 0;   // reserved
  entry.writeUInt16LE(1, 4);  // planes
  entry.writeUInt16LE(32, 6); // bit count
  entry.writeUInt32LE(pngBuffer.length, 8);
  entry.writeUInt32LE(22, 12); // offset
  return Buffer.concat([header, entry, pngBuffer]);
}

// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(pngPath)) {
    console.log('生成占位 icon.png（256x256）…');
    const size = 256;
    const px = drawIcon(size);
    fs.writeFileSync(pngPath, encodePng(size, size, px));
  } else {
    console.log(`使用现有 icon.png：${pngPath}`);
  }
  const png = fs.readFileSync(pngPath);
  fs.writeFileSync(icoPath, pngToIco(png));
  console.log(`已生成 icon.ico：${icoPath}（${icoPath.length > 0 ? fs.statSync(icoPath).size : 0} 字节）`);
}

main();
