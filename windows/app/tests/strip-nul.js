'use strict';
// 清理 dev-log 文件中的 NUL 字节（历史 PowerShell 追加混入），保留其余字节原样
const fs = require('node:fs');
const f = process.argv[2];
if (!f) { console.error('usage: node strip-nul.js <file>'); process.exit(1); }
const b = fs.readFileSync(f);
const nulCount = b.filter((x) => x === 0).length;
if (nulCount === 0) { console.log('no NUL, skip'); process.exit(0); }
fs.writeFileSync(f, Buffer.from(b.filter((x) => x !== 0)));
console.log(`stripped ${nulCount} NUL bytes`);
