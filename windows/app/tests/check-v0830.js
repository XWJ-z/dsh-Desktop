'use strict';
// v0.8.30 代码级验证：审查报告 v24.0 修改项（R1-R5 + P2-1 确认）+ 版本号
const fs = require('fs');
const path = require('path');
const main = fs.readFileSync('main.js', 'utf8');
const aboutWin = fs.readFileSync('modules/windows/about-window.js', 'utf8');
const miscWin = fs.readFileSync('modules/windows/misc-windows.js', 'utf8');
const security = fs.readFileSync('modules/security.js', 'utf8');
const tray = fs.readFileSync('modules/tray.js', 'utf8');
const pet = fs.readFileSync('modules/pet.js', 'utf8');
const yml = fs.readFileSync('electron-builder.yml', 'utf8');
const changelog = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vjson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));
const checks = [
  // ── P2-1：killRunningProcesses 确认（electron-builder 26 内置等效逻辑，yml 有说明） ──
  ['P2-1 yml 覆盖安装说明', yml.includes('CHECK_APP_RUNNING')],
  // ── R1：secureWebPreferences 抽公共模块 ──
  ['security.js 公共模块存在', security.includes('function secureWebPreferences()')],
  ['about-window 无本地定义', !aboutWin.includes('function secureWebPreferences()')],
  ['about-window 注入使用', aboutWin.includes('secureWebPreferences,')],
  ['misc-windows 无本地定义', !miscWin.includes('function secureWebPreferences()')],
  ['misc-windows 注入使用', miscWin.includes('secureWebPreferences,')],
  ['main.js 组装 security 模块', main.includes('createSecurityModule({ app, path })')],
  ['main.js 注入两窗口模块', (main.match(/secureWebPreferences,/g) || []).length >= 2],
  // ── R2：tray.js 未用解构清理 ──
  ['tray.js 无 getIsQuitting 解构', !/getIsQuitting,/.test(tray) && !/getIsQuitting\s+setIsQuitting/.test(tray)],
  ['tray.js 保留 setIsQuitting', tray.includes('setIsQuitting')],
  // ── R3：main.js 缩进修复 ──
  ['main.js resolvedPort 4 空格缩进', /^ {4}resolvedPort = parsePortArg\(\) \?\? await pickPort\(DEFAULT_PORT\);$/m.test(main)],
  // ── R4：tests 归档 ──
  ['tests 归档目录存在', fs.existsSync('tests/archive')],
  ['旧 check-v0824 已归档', fs.existsSync('tests/archive/check-v0824.js')],
  ['旧 cdp-v0821 已归档', fs.existsSync('tests/archive/cdp-v0821-test.js')],
  ['当前 check-v0827 保留', fs.existsSync('tests/check-v0827.js')],
  // ── R5：pet.js DOMParser ──
  ['pet.js 用 DOMParser', pet.includes("new DOMParser().parseFromString(svg, 'image/svg+xml')")],
  ['pet.js 无 tmp.innerHTML = svg', !pet.includes('tmp.innerHTML = svg')],
  // ── CHANGELOG / 版本 ──
  ['CHANGELOG 补 0.8.11~0.8.30', changelog.versions.some((v) => v.version === '0.8.11') && changelog.versions.some((v) => v.version === '0.8.30')],
  ['package version 0.8.30', pkg.version === '0.8.30'],
  ['version.json 0.8.30', vjson.version === '0.8.30'],
];
let ok = true;
for (const [n, pass] of checks) { console.log((pass ? 'PASS' : 'FAIL'), n); if (!pass) ok = false; }
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
