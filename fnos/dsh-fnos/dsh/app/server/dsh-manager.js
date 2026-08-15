'use strict';
/**
 * dsh-manager.js — DSH 运行时管理（移植自 DSH-Desktop Windows 版 main.js）
 *
 * 职责：
 *  1. 读配置（etc/config.json：dshPackage/dshVersion/registry）
 *  2. 用系统 node 执行 `npm install --prefix <dshenv> <pkg>@<version>`
 *  3. 幂等：已安装且版本匹配则直接返回；版本不符自动重装
 *  4. 首次安装需要联网（npmmirror 镜像），完成后离线可用
 *
 * 用法：
 *  node dsh-manager.js ensure   # 确保 DSH 就绪，输出 bin.js 路径（stdout）
 *  node dsh-manager.js version  # 输出已安装 DSH 版本（未安装输出 none）
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// 环境变量由 cmd/main 传入（飞牛生命周期脚本设置）
const PKGETC = process.env.TRIM_PKGETC || path.join(__dirname, '..', '..', 'etc');
const PKGVAR = process.env.TRIM_PKGVAR || path.join(__dirname, '..', '..', 'var');
const DSHENV = path.join(PKGVAR, 'dshenv');
// npm 用户目录/缓存重定向到应用数据目录：
// 飞牛 package 用户（dsh）可能没有可写的 $HOME（/home/dsh 不存在 → npm mkdir EACCES 立即失败），
// 把 HOME 与 npm cache 指向 $TRIM_PKGVAR 即可绕开。
const NPM_CACHE = path.join(PKGVAR, 'npm-cache');
// 配置读取顺序：$TRIM_PKGETC/config.json（用户可改，优先）→ 包内 app/server/config.json（默认）
const CONFIG_CANDIDATES = [
  path.join(PKGETC, 'config.json'),
  path.join(__dirname, 'config.json'),
];

function resolveConfigFile() {
  for (const p of CONFIG_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return CONFIG_CANDIDATES[0];
}

function readConfig() {
  const file = resolveConfigFile();
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const cfg = JSON.parse(raw.replace(/^\uFEFF/, '')); // 剥离 BOM
    return {
      dshPackage: String(cfg.dshPackage || '@deepseek-ai/dsh'),
      dshVersion: String(cfg.dshVersion || 'latest'),
      registry: String(cfg.registry || 'https://registry.npmmirror.com'),
    };
  } catch (err) {
    console.error(`[dsh-manager] 警告：读取配置失败 ${file}（${err.message}），使用默认配置`);
    return { dshPackage: '@deepseek-ai/dsh', dshVersion: 'latest', registry: 'https://registry.npmmirror.com' };
  }
}

function dshDir() {
  const cfg = readConfig();
  const [scope, name] = cfg.dshPackage.startsWith('@') ? cfg.dshPackage.split('/') : ['', cfg.dshPackage];
  return scope
    ? path.join(DSHENV, 'node_modules', scope, name)
    : path.join(DSHENV, 'node_modules', name);
}

function dshBin() {
  return path.join(dshDir(), 'lib', 'bin.js');
}

function installedVersion() {
  try {
    const raw = fs.readFileSync(path.join(dshDir(), 'package.json'), 'utf8');
    const pkg = JSON.parse(raw.replace(/^\uFEFF/, '')); // 剥离 BOM（防编辑工具污染）
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function upToDate(cfg) {
  if (!fs.existsSync(dshBin())) return false;
  const installed = installedVersion();
  if (installed == null) return false;
  if (cfg.dshVersion === 'latest') return true;
  return installed === cfg.dshVersion;
}

function ensure() {
  const cfg = readConfig();
  const CONFIG = resolveConfigFile();
  if (upToDate(cfg)) {
    console.log(dshBin());
    return 0;
  }
  const spec = cfg.dshVersion === 'latest' ? cfg.dshPackage : `${cfg.dshPackage}@${cfg.dshVersion}`;

  // 预置 .npmrc：npmmirror 镜像 + 放行 DSH 依赖的原生模块脚本（同 Windows 版）
  try {
    fs.mkdirSync(DSHENV, { recursive: true });
    fs.writeFileSync(
      path.join(DSHENV, '.npmrc'),
      `allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs\nregistry=${cfg.registry}\n`,
      'utf8',
    );
  } catch { /* ignore */ }

  console.error(`[dsh-manager] 安装 DSH 运行时：${spec}（配置文件：${CONFIG}，HOME→${PKGVAR}，cache→${NPM_CACHE}）`);
  // 跨平台 npm 调用：Linux（飞牛）直接 spawn npm；Windows（本地验证）经 shell 走 npm.cmd
  // stdio: stdin 关闭（防 npm/postinstall 读 stdin 挂起死锁）；网络重试参数收紧（registry 不可达时快速失败，
  // 避免用户看到"卡住"10 分钟才超时）；HOME/cache 指向数据目录（防 /home/dsh EACCES）
  const r = spawnSync('npm', ['install', '--prefix', DSHENV, '--cache', NPM_CACHE, '--no-save', '--no-audit', '--no-fund', '--no-progress', '--loglevel', 'warn', '--fetch-retries=2', '--fetch-retry-mintimeout=5000', '--fetch-retry-maxtimeout=15000', spec], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 600_000, // 10 分钟（正常下载 3-8 分钟；超时视为失败并给出明确日志）
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      HOME: PKGVAR,                                     // 用户目录 → 可写数据目录
      npm_config_cache: NPM_CACHE,
      npm_config_update_notifier: 'false',
    },
  });
  if (r.error && r.error.code === 'ETIMEDOUT') {
    console.error('[dsh-manager] 安装超时（10 分钟）：请检查网络后重试（重启应用）');
    return 1;
  }
  if (r.status !== 0) {
    console.error('[dsh-manager] 安装失败：', (r.stderr || r.stdout || '').slice(-800));
    return 1;
  }
  if (!fs.existsSync(dshBin())) {
    console.error('[dsh-manager] 安装完成但未找到 bin.js，请检查包名/版本配置');
    return 1;
  }
  console.error(`[dsh-manager] DSH 就绪：${cfg.dshPackage}@${installedVersion()}`);
  console.log(dshBin());
  return 0;
}

const cmd = process.argv[2] || 'ensure';
if (cmd === 'version') {
  const v = installedVersion();
  console.log(v ?? 'none');
  process.exit(0);
}
process.exit(ensure());
