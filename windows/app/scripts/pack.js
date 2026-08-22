'use strict';

/**
 * pack.js — 打包为 Windows 桌面应用（win32-x64，绿色目录版）
 *
 * 封装 @electron/packager：
 *  - 自动设置 Electron 下载镜像（默认 npmmirror）与工作区缓存（.electron-cache），
 *    避免系统缓存目录权限问题与 GitHub 网络不稳定；
 *  - 排除 docs / dist / 开发脚本等无需随应用分发的文件；
 *  - 壳含 Electron + 内置 npm + 内置 Node 运行时（resources/node/node.exe，
 *    真实 Node 保证 DSH 原生模块 ABI 兼容）；DSH 由壳在运行时按版本拉取。
 *
 * 用法：npm run pack
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

// 网络与缓存配置（可被环境变量覆盖）
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
process.env.electron_config_cache = process.env.electron_config_cache || path.join(root, '.electron-cache');
process.env.ELECTRON_CACHE = process.env.ELECTRON_CACHE || path.join(root, '.electron-cache');

const ignore = [
  /^\/docs(\/|$)/,
  /^\/dist(\/|$)/,
  /^\/\.npm-cache(\/|$)/,
  /^\/\.electron-cache(\/|$)/,
  /^\/scripts(\/|$)/,
  /^\/electron-out\.log$/,
  /^\/electron-err\.log$/,
  /^\/skills(\/|$)/, // v1.2.1 T6：技能本体在 GitHub 仓库（市场按需 raw 拉取），不随壳分发
];

async function main() {
  // 确保内置 Node 运行时就绪（审查 H3：DSH 原生模块需真实 Node ABI）
  if (!fs.existsSync(path.join(root, 'resources', 'node', 'node.exe'))) {
    console.log('[pack] 内置 Node 缺失，先执行 fetch-node …');
    const fetch = spawnSync(process.execPath, [path.join(root, 'scripts', 'fetch-node.js')], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
      windowsHide: false,
    });
    if (fetch.status !== 0) process.exit(fetch.status || 1);
  }

  const { packager } = await import('@electron/packager');
  console.log('[pack] 开始打包 win32-x64 …');
  const appPaths = await packager({
    dir: root,
    name: 'DSH-Desktop',
    platform: 'win32',
    arch: 'x64',
    out: path.join(root, 'dist'),
    overwrite: true,
    icon: path.join(root, 'assets', 'icon.ico'),
    prune: true,
    // 关闭 ASAR：DSH（npx 安装到用户目录）的 healProfilesModuleFallback 会创建
    // $DSH_HOME/profiles/node_modules 符号链接；壳自身平铺布局与之一致。
    asar: false,
    ignore,
    appVersion: require(path.join(root, 'package.json')).version,
  });
  console.log('[pack] 完成，产物：');
  for (const p of appPaths) console.log(`  ${p}`);
}

main().catch((err) => {
  console.error('[pack] 失败：', err);
  process.exit(1);
});
