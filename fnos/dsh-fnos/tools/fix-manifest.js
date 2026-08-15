// fix-manifest.js — 修复 fpk 内 manifest 为紧凑格式（fnpack 1.2.3 重写为对齐格式导致飞牛解析 Syntax error）
// 用法: node fix-manifest.js <input.fpk> <source-manifest> <output.fpk>
// 步骤: 解包 fpk → 用源码紧凑 manifest 替换 → 重新 tar 打包
'use strict';
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const [input, srcManifest, output] = process.argv.slice(2);
if (!input || !srcManifest || !output) { console.error('用法: node fix-manifest.js <input.fpk> <source-manifest> <output.fpk>'); process.exit(1); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fpkfix-'));
function run(cmd) { execSync(cmd, { stdio: 'inherit', shell: 'cmd.exe' }); }

try {
  // 1) 解包外层 tar
  run(`tar -xf "${input}" -C "${tmp}"`);
  // 2) 替换 manifest（紧凑格式，无 checksum）
  const mf = path.join(tmp, 'manifest');
  if (!fs.existsSync(mf)) throw new Error('fpk 内无 manifest');
  const compact = fs.readFileSync(srcManifest, 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
  fs.writeFileSync(mf, compact + '\n', 'utf8');
  console.log(`manifest 已替换为紧凑格式（${Buffer.byteLength(compact, 'utf8')} bytes）`);
  // 3) 重新打包外层 tar（gzip 压缩 —— fpk 是 gzip 流，头字节 1F 8B；plain tar 飞牛不认）
  const entries = fs.readdirSync(tmp);
  const cwd = process.cwd();
  process.chdir(tmp);
  try {
    run(`tar -czf "${output}" ${entries.map((e) => `"${e}"`).join(' ')}`);
  } finally {
    process.chdir(cwd);
  }
  console.log(`已生成: ${output}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
