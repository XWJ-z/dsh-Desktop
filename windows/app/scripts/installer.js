'use strict';

/**
 * installer.js — 制作 DSH-Desktop Windows 安装程序（NSIS）
 *
 * 基于 electron-builder（v26，纯 JS 实现，按需下载 7za/NSIS/rcedit 工具集）：
 *  - 产出 app/dist/installer/DSH-Desktop-Setup-<version>.exe
 *  - 向导式安装（默认 %LOCALAPPDATA%\Programs\DSH-Desktop，无需管理员）
 *  - 自动创建桌面/开始菜单快捷方式与卸载入口（添加/删除程序）
 *  - 壳自带 Electron + npm + 内置 Node 运行时（resources/node/node.exe），
 *    新电脑无需预装 DSH/Node；DSH 由壳运行时按版本拉取
 *
 * 网络与缓存配置（可被环境变量覆盖）：
 *  - 工具集（NSIS/7za/rcedit）走 npmmirror 镜像 + 工作区 .builder-cache，
 *    避免系统缓存目录权限问题（与 pack.js 同思路）；
 *  - Electron 运行时复用 .electron-cache 中已下载的 zip；
 *  - 内置 Node 由 scripts/fetch-node.js 获取（幂等，已存在则跳过）。
 *
 * 用法：npm run installer
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

// 网络与缓存配置（可被环境变量覆盖）
process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
process.env.electron_config_cache = process.env.electron_config_cache || path.join(root, '.electron-cache');
process.env.ELECTRON_CACHE = process.env.ELECTRON_CACHE || path.join(root, '.electron-cache');
process.env.ELECTRON_BUILDER_BINARIES_MIRROR =
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';
process.env.ELECTRON_BUILDER_CACHE = process.env.ELECTRON_BUILDER_CACHE || path.join(root, '.builder-cache');

function main() {
  // 确保内置 Node 运行时就绪（审查 H3：DSH 原生模块需真实 Node ABI）
  const nodeExe = path.join(root, 'resources', 'node', 'node.exe');
  if (!require('node:fs').existsSync(nodeExe)) {
    console.log('[installer] 内置 Node 缺失，先执行 fetch-node …');
    const fetch = spawnSync(process.execPath, [path.join(root, 'scripts', 'fetch-node.js')], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
      windowsHide: false,
    });
    if (fetch.status !== 0) {
      console.error('[installer] 获取内置 Node 失败，中止');
      process.exit(fetch.status || 1);
    }
  }

  const cli = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
  const args = ['--win', 'nsis', '--x64', '--config', path.join(root, 'electron-builder.yml')];
  console.log('[installer] 开始构建 NSIS 安装程序 …');
  console.log(`[installer] 命令：node ${cli} ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    windowsHide: false,
  });
  if (result.error) {
    console.error('[installer] 启动 electron-builder 失败：', result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[installer] electron-builder 退出码 ${result.status}`);
    process.exit(result.status || 1);
  }
  console.log('[installer] 完成，安装程序位于 dist/installer/');
}

main();
