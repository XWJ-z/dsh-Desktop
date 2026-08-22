'use strict';
// 生成 Release body.json（UTF8 无 BOM）—— 发布核对单步骤 4 用
const fs = require('node:fs');
const path = require('node:path');
const vj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));
const body = {
  tag_name: `v${vj.version}`,
  name: `v${vj.version}`,
  body: vj.release_notes,
  draft: false,
  prerelease: false,
};
const out = path.join(__dirname, 'body.json');
fs.writeFileSync(out, JSON.stringify(body, null, 2) + '\n', 'utf8');
// 校验：无 BOM + 可解析 + 无内部代号
const b = fs.readFileSync(out);
const noBom = !(b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF);
const text = b.toString('utf8');
const bad = ['zx(9)', 'zx(29)', 'zx(6)'].filter((w) => text.includes(w));
console.log(`body.json 生成：tag=v${vj.version}，无BOM=${noBom}，内部代号=${bad.length === 0 ? '无 ✓' : bad.join(',')}`);
if (!noBom || bad.length > 0) process.exit(1);
