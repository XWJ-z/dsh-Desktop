'use strict';

/**
 * common-env.js — 打包/安装脚本公共工具（2.0.1 去重）
 *
 * pack.js（@electron/packager）与 installer.js（electron-builder）此前各自复制了
 * 「网络/缓存环境变量设置」与「内置 Node 就绪检查」两段逻辑，抽取为公共模块。
 *
 * 说明：installer.js 额外设置的 ELECTRON_BUILDER_BINARIES_MIRROR / ELECTRON_BUILDER_CACHE
 * 是它独有的，仍保留在 installer.js 内，不并入此处。
 */

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

/**
 * 设置 Electron 下载镜像与工作区缓存环境变量（可被环境变量覆盖），返回项目根目录。
 * @returns {string} 项目根（app/ 目录）
 */
function setupCacheEnv() {
  const root = path.join(__dirname, '..');
  process.env.ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
  process.env.electron_config_cache = process.env.electron_config_cache || path.join(root, '.electron-cache');
  process.env.ELECTRON_CACHE = process.env.ELECTRON_CACHE || path.join(root, '.electron-cache');
  return root;
}

/**
 * 确保内置 Node 运行时就绪（DSH 原生模块需真实 Node ABI）；缺失则先跑 fetch-node.js。
 * 失败时以非零退出退出进程。
 * @param {string} root 项目根
 * @param {string} label 日志前缀（如 'pack' / 'installer'）
 */
function ensureNodeReady(root, label) {
  const nodeExe = path.join(root, 'resources', 'node', 'node.exe');
  if (fs.existsSync(nodeExe)) return;
  console.log(`[${label}] 内置 Node 缺失，先执行 fetch-node …`);
  const fetch = spawnSync(process.execPath, [path.join(root, 'scripts', 'fetch-node.js')], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    windowsHide: false,
  });
  if (fetch.status !== 0) {
    console.error(`[${label}] 获取内置 Node 失败，中止`);
    process.exit(fetch.status || 1);
  }
}

module.exports = { setupCacheEnv, ensureNodeReady };
