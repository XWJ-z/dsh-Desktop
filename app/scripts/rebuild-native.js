'use strict';

/**
 * rebuild-native.js — 原生模块 ABI 预检（原为重建脚本，已调整为预检）
 *
 * 背景：DSH 0.1.0-rc.6 依赖树中的原生模块（node-pty 1.1.0、koffi、sharp）均附带
 * N-API 预编译产物，可在系统 Node 与 Electron（ELECTRON_RUN_AS_NODE）下直接加载，
 * 通常【无需重建】。本脚本在 Electron 运行时下逐一加载关键原生模块并报告结果。
 *
 * 仅在预检失败、确需重建时执行：
 *   npx electron-rebuild -f -w <模块名>
 * （需要 Python + VS Build Tools；重建后请勿再跑本预检的失败项之外的流程）
 *
 * 用法：node scripts/rebuild-native.js
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');

// 需要校验的原生模块（相对项目根目录）
const MODULES = [
  { id: 'node-pty', path: 'node_modules/node-pty' },
  { id: 'koffi', path: 'node_modules/koffi' },
  { id: 'sharp', path: 'node_modules/sharp' },
  { id: 'node-addon-require-builtin', path: 'node_modules/node-addon-require-builtin' },
];

function probeModule(modulePath) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-abi-'));
  const script = path.join(tmpDir, 'probe.js');
  const outFile = path.join(tmpDir, 'out.txt');
  const scriptBody = `
const fs = require('node:fs');
try {
  const mod = require(${JSON.stringify(path.join(root, modulePath))});
  fs.writeFileSync(${JSON.stringify(outFile)}, 'OK:loadable');
} catch (err) {
  fs.writeFileSync(${JSON.stringify(outFile)}, 'FAIL:' + err.message.split('\\n')[0]);
}
`;
  fs.writeFileSync(script, scriptBody);
  return new Promise((resolvePromise) => {
    const child = spawn(electronExe, ['--expose-internals', script], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('exit', () => {
      let result = 'NO_RESULT';
      try { result = fs.readFileSync(outFile, 'utf8'); } catch { /* ignore */ }
      fs.rmSync(tmpDir, { recursive: true, force: true });
      resolvePromise(result);
    });
    child.on('error', () => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      resolvePromise('SPAWN_FAIL');
    });
  });
}

async function main() {
  console.log('[abi-preflight] 在 Electron 运行时下预检原生模块…');
  let allOk = true;
  for (const mod of MODULES) {
    if (!fs.existsSync(path.join(root, mod.path))) {
      console.log(`  - ${mod.id}: 未安装，跳过`);
      continue;
    }
    const result = await probeModule(mod.path);
    const ok = result.startsWith('OK');
    if (!ok) allOk = false;
    console.log(`  - ${mod.id}: ${ok ? '✓ 可加载' : `✗ ${result}`}`);
  }
  if (allOk) {
    console.log('[abi-preflight] 全部通过：无需重建原生模块，可直接打包。');
  } else {
    console.log('[abi-preflight] 存在不兼容模块：如需在打包模式下运行，请执行');
    console.log('  npx electron-rebuild -f -w <失败模块名>  （需要 Python + VS Build Tools）');
    process.exitCode = 1;
  }
}

main();
