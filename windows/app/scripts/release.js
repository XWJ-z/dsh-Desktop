'use strict';

/**
 * DSH-Desktop — 发布脚本（优化方案 2026-08-16 阶段三：版本号单一数据源）
 *
 * 设计：windows/app/package.json 是 Windows 版本的唯一真相源。
 * version.json 的 version / hash / download_urls 与 CHANGELOG.json 条目
 * 均由本脚本从 package.json 推导/写入，不再手动同步（0.8.9 曾因 download_urls
 * 指向旧版本出过事故）。
 *
 * 用法：
 *   node scripts/release.js <新版本> [--hash <sha256>] [--notes <一句话更新说明>]
 *   例：node scripts/release.js 0.8.12 --hash abc123... --notes "修复 xxx"
 *
 * 流程（仅文件操作，不自动 push/tag —— 网络动作由人工执行）：
 *   1. 校验版本格式（x.y.z，z≠0 且 z≠4 预留）
 *   2. package.json version → 新版本
 *   3. version.json：version → 新版本；hash → --hash（缺省保持原值并告警）；
 *      download_urls → 自动生成 v<新版本> 双镜像直链
 *   4. CHANGELOG.json：顶部插入 { version, date, notes }（--notes 缺省用 version.json 旧 release_notes 首条）
 *   5. 打印后续发布清单（上传资产 → curl 验证 → purge → 三源验证）
 *
 * 注意：发布前必须按《v0.7.10开发与发布计划》§五 ★ 第 4 步验证资产已上传（curl -sI 非 404）。
 */

const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.join(__dirname, '..');
const repoRoot = path.join(appRoot, '..', '..');
const pkgFile = path.join(appRoot, 'package.json');
const versionFile = path.join(repoRoot, 'version.json');
const changelogFile = path.join(appRoot, 'CHANGELOG.json');

function fail(msg) {
  console.error('[release] ✗ ' + msg);
  process.exit(1);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { fail(`读取 ${file} 失败：${err.message}`); }
}

function writeJson(file, obj) {
  try { fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }
  catch (err) { fail(`写入 ${file} 失败：${err.message}`); }
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseArgs(argv) {
  const out = { version: null, hash: null, notes: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hash' && argv[i + 1]) { out.hash = String(argv[i + 1]).toLowerCase(); i++; }
    else if (a === '--notes' && argv[i + 1]) { out.notes = String(argv[i + 1]); i++; }
    else if (!a.startsWith('-')) out.version = a;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.version) {
    console.log('用法：node scripts/release.js <新版本> [--hash <sha256>] [--notes <更新说明>]');
    console.log('  --hash   安装包实际 SHA256（NSIS 非确定性，以最终 exe 实测为准；缺省保留旧值并告警）');
    console.log('  --notes  一句话更新说明（缺省复用 version.json 旧 release_notes 首条）');
    process.exit(0);
  }
  const v = args.version;
  if (!/^\d+\.\d+\.\d+$/.test(v)) fail(`版本格式非法：${v}（应为 x.y.z）`);
  const [, , z] = v.split('.').map(Number);
  if (z === 0) fail('Z 不能为 0（0 = 最终版，由发布流程确认后显式使用）');
  if (z === 4) fail('Z=4 为紧急版预留，正常迭代请勿使用');

  // 1. package.json（唯一真相源）
  const pkg = readJson(pkgFile);
  const oldVersion = pkg.version;
  console.log(`[release] 版本：${oldVersion} → ${v}`);
  pkg.version = v;
  writeJson(pkgFile, pkg);

  // 2. version.json
  const ver = readJson(versionFile);
  ver.version = v;
  if (args.hash) {
    ver.hash = args.hash;
    console.log(`[release] version.json hash → ${args.hash}`);
  } else {
    console.warn(`[release] ⚠ 未提供 --hash，保留旧值 ${ver.hash}。请打包后实测回填！`);
  }
  ver.download_urls = [
    `https://ghfast.top/https://github.com/XWJ-z/dsh-Desktop/releases/download/v${v}/DSH-Desktop-Setup-${v}.exe`,
    `https://gh-proxy.com/https://github.com/XWJ-z/dsh-Desktop/releases/download/v${v}/DSH-Desktop-Setup-${v}.exe`,
  ];
  if (ver.minVersion && /^\d+\.\d+\.\d+$/.test(ver.minVersion) && !ver.minVersion.startsWith('0.')) {
    // minVersion 保持现状（由发布流程决定），不改写
  }
  writeJson(versionFile, ver);

  // 3. CHANGELOG.json 顶部插入新条目
  const cl = readJson(changelogFile);
  const notes = args.notes
    ? [args.notes]
    : (Array.isArray(ver.release_notes) ? ver.release_notes : String(ver.release_notes || '').split('\n').filter(Boolean).slice(0, 3));
  const entry = {
    version: v,
    date: today(),
    notes: Array.isArray(notes) ? notes : [notes],
  };
  cl.versions = [entry, ...(Array.isArray(cl.versions) ? cl.versions : [])];
  writeJson(changelogFile, cl);

  // 4. 后续发布清单
  console.log('');
  console.log('[release] ✓ 文件更新完成。后续发布动作（人工执行）：');
  console.log(`  1. 上传 dist/installer/DSH-Desktop-Setup-${v}.exe 到 GitHub Releases v${v} 资产`);
  console.log(`  2. ★ 验证资产：curl -sI https://github.com/XWJ-z/dsh-Desktop/releases/download/v${v}/DSH-Desktop-Setup-${v}.exe | head -1`);
  console.log('     （必须 200/302 非 404 —— 0.8.9 教训：资产没上传 → 老用户下载 404 → 校验失败）');
  console.log('  3. push 仓库 + jsDelivr purge：curl -X POST https://purge.jsdelivr.net/gh/XWJ-z/dsh-Desktop@main/version.json');
  console.log('  4. 三源验证：jsDelivr / api.github.com / raw.githubusercontent 均返回新版本');
}

main();
