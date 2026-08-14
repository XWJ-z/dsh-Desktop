'use strict';

/**
 * fetch-node.js — 获取内置 Node 运行时（win32-x64）
 *
 * 目的（审查任务 H3）：DSH 的原生模块（koffi/node-pty/sharp 等）按 Node ABI
 * 编译，打包模式下若用 ELECTRON_RUN_AS_NODE（Electron-as-Node）运行 DSH 会
 * ABI 不兼容（目录选择 worker 崩溃等）。方案：内置真实 Node 运行时，DSH
 * 全程在真实 Node 下运行，一劳永逸解决全部原生模块 ABI 问题。
 *
 * 产物：app/resources/node/node.exe（+ 最小运行所需文件），随安装包分发。
 * 下载源：npmmirror Node 二进制镜像（国内可达），版本见 NODE_VERSION。
 *
 * 用法：node scripts/fetch-node.js
 *  - 已存在且版本匹配则跳过（幂等）；
 *  - 通过 env NODE_VERSION / ELECTRON_MIRROR 可覆盖版本与镜像。
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const NODE_VERSION = process.env.NODE_VERSION || '24.19.0';
const MIRROR = process.env.NODE_MIRROR || 'https://registry.npmmirror.com/-/binary/node';
const OUT_DIR = path.join(root, 'resources', 'node');
const OUT_EXE = path.join(OUT_DIR, 'node.exe');

function log(msg) {
  console.log(`[fetch-node] ${msg}`);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { timeout: 120_000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        log(`重定向 → ${res.headers.location}`);
        req.destroy();
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`下载失败 HTTP ${res.statusCode}: ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('timeout', () => { req.destroy(new Error('下载超时')); });
    req.on('error', (err) => { fs.rmSync(dest, { force: true }); reject(err); });
  });
}

async function main() {
  if (fs.existsSync(OUT_EXE)) {
    // 幂等：已存在则校验版本，匹配即跳过
    try {
      const v = spawnSync(OUT_EXE, ['--version'], { encoding: 'utf8' }).stdout.trim();
      if (v === `v${NODE_VERSION}`) {
        log(`Node ${v} 已就绪，跳过下载`);
        return;
      }
      log(`现有版本 ${v} ≠ 目标 ${NODE_VERSION}，重新获取`);
    } catch {
      log('现有 node.exe 无法运行，重新获取');
    }
  }

  const zipName = `node-v${NODE_VERSION}-win-x64.zip`;
  const zipUrl = `${MIRROR}/v${NODE_VERSION}/${zipName}`;
  const zipPath = path.join(OUT_DIR, zipName);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  log(`下载 ${zipUrl}`);
  await download(zipUrl, zipPath);
  log(`下载完成，解压精简…`);

  // 用 Windows 自带 tar.exe 解压 zip（兼容性好，避免 PowerShell 模块沙箱问题）。
  const extractDir = path.join(OUT_DIR, 'extract');
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  const r = spawnSync('tar.exe', ['-xf', zipPath, '-C', extractDir], { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`解压失败：${r.stderr || r.stdout}`);
  }

  // 精简：只保留 node.exe（+ 版本说明）。Node win-x64 二进制自包含，
  // 运行 npm/DSH 不需要随附的 npm 目录（壳已内置 npm 包）。
  const inner = path.join(extractDir, `node-v${NODE_VERSION}-win-x64`, 'node.exe');
  if (!fs.existsSync(inner)) {
    throw new Error(`解压产物中未找到 node.exe：${inner}`);
  }
  fs.copyFileSync(inner, OUT_EXE);
  fs.writeFileSync(
    path.join(OUT_DIR, 'NODE_VERSION'),
    NODE_VERSION,
    'utf8',
  );
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(zipPath, { force: true });

  const v = spawnSync(OUT_EXE, ['--version'], { encoding: 'utf8' }).stdout.trim();
  log(`内置 Node 就绪：${v}（${OUT_EXE}）`);
}

main().catch((err) => {
  console.error('[fetch-node] 失败：', err.message);
  process.exit(1);
});
