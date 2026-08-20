'use strict';

/**
 * resolve-runner-v111-test.js — v1.1.1（Issue #1 修复，26 方案 A）行为单测
 *
 * 验证 node-resolver.resolveRunner(minMajor)：
 *  1. 开发模式 + 系统 Node v16（<20）+ minMajor=20 → 回落 Electron 内置 Node
 *     （内置 npm 12 需 Node ≥20，否则 crypto.randomUUID 报错 —— Issue #1）
 *  2. 开发模式 + 系统 Node v22（≥20）→ 正常用系统 Node
 *  3. 不传 minMajor → 保持原行为（系统 Node 照用，向后兼容）
 *  4. 打包模式 → 内置 Node（minMajor 不生效，回归）
 *  5. 打包模式无内置 Node → Electron-as-Node 兜底（回归）
 *
 * 用法：node tests/resolve-runner-v111-test.js
 */

const path = require('node:path');
const { createNodeResolver } = require(path.join(__dirname, '..', 'modules', 'node-resolver'));

const FAKE_SYS_NODE = 'C:\\fake\\node.exe';

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function makeApp(packaged) {
  return { isPackaged: packaged, getAppPath: () => path.join(__dirname, '..') };
}

function makeFs(bundledExists) {
  return {
    existsSync: (p) => {
      if (p === FAKE_SYS_NODE) return true;
      if (typeof p === 'string' && p.endsWith(path.join('node', 'node.exe'))) return bundledExists;
      return false;
    },
  };
}

function makeExec(sysVersion) {
  return (cmd, args) => {
    if (cmd === FAKE_SYS_NODE && Array.isArray(args) && args[0] === '--version') return sysVersion + '\n';
    if (cmd === 'where.exe') return '';
    return '';
  };
}

function withSysNode(fn) {
  const old = process.env.SYSTEM_NODE;
  process.env.SYSTEM_NODE = FAKE_SYS_NODE;
  try {
    fn();
  } finally {
    if (old === undefined) delete process.env.SYSTEM_NODE;
    else process.env.SYSTEM_NODE = old;
  }
}

// 1. 开发模式 + 系统 Node v16 + minMajor=20 → 回落 Electron-as-Node
withSysNode(() => {
  const r = createNodeResolver({ app: makeApp(false), fs: makeFs(false), path, execFileSync: makeExec('v16.20.0') });
  const out = r.resolveRunner(20);
  ok(
    out.env.ELECTRON_RUN_AS_NODE === '1',
    '开发模式 + 系统 Node v16 + minMajor=20 → 回落 Electron 内置 Node',
  );
  ok(out.label.includes('过旧，兜底'), `兜底标签含「过旧，兜底」（实际：${out.label}）`);
});

// 2. 开发模式 + 系统 Node v22 + minMajor=20 → 正常用系统 Node
withSysNode(() => {
  const r = createNodeResolver({ app: makeApp(false), fs: makeFs(false), path, execFileSync: makeExec('v22.3.0') });
  const out = r.resolveRunner(20);
  ok(
    out.execPath === FAKE_SYS_NODE && !out.env.ELECTRON_RUN_AS_NODE,
    '开发模式 + 系统 Node v22 + minMajor=20 → 正常用系统 Node',
  );
});

// 3. 开发模式 + 系统 Node v16 + 不传 minMajor → 保持原行为（向后兼容）
withSysNode(() => {
  const r = createNodeResolver({ app: makeApp(false), fs: makeFs(false), path, execFileSync: makeExec('v16.20.0') });
  const out = r.resolveRunner();
  ok(out.execPath === FAKE_SYS_NODE, '不传 minMajor → 保持原行为（系统 Node 照用）');
});

// 4. 打包模式 + 内置 Node → 内置 Node（minMajor 不生效，回归）
{
  const r = createNodeResolver({ app: makeApp(true), fs: makeFs(true), path, execFileSync: makeExec('') });
  const out = r.resolveRunner(20);
  ok(
    out.execPath.endsWith(path.join('node', 'node.exe')) && !out.env.ELECTRON_RUN_AS_NODE,
    '打包模式 → 内置 Node（minMajor 不影响，回归）',
  );
}

// 5. 打包模式无内置 Node → Electron-as-Node 兜底（回归）
{
  const r = createNodeResolver({ app: makeApp(true), fs: makeFs(false), path, execFileSync: makeExec('') });
  const out = r.resolveRunner(20);
  ok(out.env.ELECTRON_RUN_AS_NODE === '1', '打包模式无内置 Node → Electron-as-Node 兜底（回归）');
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
