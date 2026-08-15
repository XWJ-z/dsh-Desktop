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

function readConfig() {
  const file = path.join(PKGETC, 'config.json');
  try {
    const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      dshPackage: String(cfg.dshPackage || '@deepseek-ai/dsh'),
      dshVersion: String(cfg.dshVersion || 'latest'),
      registry: String(cfg.registry || 'https://registry.npmmirror.com'),
    };
  } catch {
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
    const pkg = JSON.parse(fs.readFileSync(path.join(dshDir(), 'package.json'), 'utf8'));
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

  console.error(`[dsh-manager] 安装 DSH 运行时：${spec}（首次启动需联网，请稍候…）`);
  const r = spawnSync('npm', ['install', '--prefix', DSHENV, '--no-save', '--no-audit', '--no-fund', '--no-progress', '--loglevel', 'warn', spec], {
    encoding: 'utf8',
    timeout: 600_000, // 10 分钟
    env: { ...process.env, npm_config_update_notifier: 'false' },
  });
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
