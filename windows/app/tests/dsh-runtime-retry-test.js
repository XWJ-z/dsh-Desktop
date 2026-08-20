'use strict';

/**
 * dsh-runtime-retry-test.js — v1.1.1 三轮（老大指令）：安装失败自动重试 + 多源切换 行为单测
 *
 * 验证 ensureDshRuntime 的多源 + 重试循环（mock spawn，不真实联网）：
 *  1. 首次尝试失败（npm 退出码 1）→ 自动切换源（npmmirror → npmjs）重试 → 成功
 *  2. 全部尝试失败 → reject 且提示「自动重试后仍失败」
 *  3. 首次尝试成功 → 不重试（只 spawn 一次）
 *  4. OOM（退出码 134）→ 重试后仍失败 → 最终提示「内存不足」（不被"查网络"误导）
 *
 * 用法：node tests/dsh-runtime-retry-test.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createDshRuntime } = require(path.join(__dirname, '..', 'modules', 'dsh-runtime'));

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

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-retry-'));
  const appPath = path.join(tmp, 'app');
  const userData = path.join(tmp, 'userData');
  fs.mkdirSync(appPath, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(appPath, 'config.json'),
    JSON.stringify(
      { dshVersion: '0.1.0-rc.6', dshPackage: '@deepseek-ai/dsh', registry: 'https://registry.npmmirror.com' },
      null,
      2,
    ),
    'utf8',
  );
  return { tmp, appPath, userData };
}

/** mock spawn：按 plan（'success' | 退出码）依次出结果；写入 bin.js 模拟安装成功 */
function makeSpawn(userData, plan) {
  let i = 0;
  const calls = [];
  const spawnFn = (exe, args) => {
    const callIdx = i++;
    calls.push({ args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      const outcome = plan[callIdx];
      if (outcome === 'success') {
        const pkgDir = path.join(userData, 'dshenv', 'node_modules', '@deepseek-ai', 'dsh');
        fs.mkdirSync(path.join(pkgDir, 'lib'), { recursive: true });
        fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.6' }), 'utf8');
        fs.writeFileSync(path.join(pkgDir, 'lib', 'bin.js'), '// dsh bin', 'utf8');
        child.emit('exit', 0);
      } else {
        child.emit('exit', outcome);
      }
    }, 5);
    return child;
  };
  spawnFn.calls = calls;
  return spawnFn;
}

function registryOf(args) {
  const i = args.indexOf('--registry');
  return i >= 0 ? args[i + 1] : '';
}

function mkRuntime(userData, spawnMock, logs) {
  return createDshRuntime({
    app: { getAppPath: () => path.join(userData, '..', 'app'), getPath: () => userData },
    fs,
    path,
    spawn: spawnMock,
    appendLog: (level, msg) => logs.push(`${level}: ${msg}`),
    pushStage: () => {},
    pushProgress: () => {},
    dirSizeMBAsync: async () => '0.0',
    logPath: () => '',
    resolveRunner: () => ({ execPath: 'node', env: {} }),
    trackChild: (c) => c,
    npmInstallTimeoutMs: 60_000,
    fetchLatestDshInfo: async () => null,
  });
}

async function main() {
  // ① 首次失败 → 切源重试 → 成功
  {
    const { tmp, userData } = setup();
    const logs = [];
    const spawnMock = makeSpawn(userData, [1, 'success']);
    const rt = mkRuntime(userData, spawnMock, logs);
    const bin = await rt.ensureDshRuntime();
    ok(!!bin && bin.includes('bin.js'), '首次失败→切源重试→成功返回 bin.js');
    ok(spawnMock.calls.length === 2, `共 spawn ${spawnMock.calls.length} 次（1 失败 + 1 重试）`);
    ok(
      registryOf(spawnMock.calls[0].args) === 'https://registry.npmmirror.com',
      `第 1 次使用主源 npmmirror（实际 ${registryOf(spawnMock.calls[0].args)}）`,
    );
    ok(
      registryOf(spawnMock.calls[1].args) === 'https://registry.npmjs.org',
      `第 2 次自动切换 npmjs（实际 ${registryOf(spawnMock.calls[1].args)}）`,
    );
    ok(
      logs.some((m) => m.includes('自动重试：切换源')),
      '日志含「自动重试：切换源」',
    );
    ok(
      logs.some((m) => m.includes('尝试 2/2')),
      '日志含「尝试 2/2」',
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ② 全部失败 → reject「自动重试后仍失败」
  {
    const { tmp, userData } = setup();
    const logs = [];
    const spawnMock = makeSpawn(userData, [1, 1]);
    const rt = mkRuntime(userData, spawnMock, logs);
    let err = null;
    try {
      await rt.ensureDshRuntime();
    } catch (e) {
      err = e;
    }
    ok(!!err && err.message.includes('自动重试后仍失败'), `全部失败 → reject（实际「${err && err.message.slice(0, 60)}…」）`);
    ok(spawnMock.calls.length === 2, `两个源都尝试过（共 ${spawnMock.calls.length} 次）`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ③ 首次成功 → 不重试
  {
    const { tmp, userData } = setup();
    const logs = [];
    const spawnMock = makeSpawn(userData, ['success']);
    const rt = mkRuntime(userData, spawnMock, logs);
    const bin = await rt.ensureDshRuntime();
    ok(!!bin && bin.includes('bin.js'), '首次成功返回 bin.js');
    ok(spawnMock.calls.length === 1, `只 spawn 1 次（实际 ${spawnMock.calls.length}）`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ④ OOM（134）重试后仍失败 → 提示「内存不足」而非误导查网络
  {
    const { tmp, userData } = setup();
    const logs = [];
    const baseSpawn = makeSpawn(userData, [134, 134]);
    const rt = createDshRuntime({
      app: { getAppPath: () => path.join(userData, '..', 'app'), getPath: () => userData },
      fs,
      path,
      spawn: (exe, args, opts) => {
        const child = baseSpawn(exe, args, opts);
        const oomText =
          'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory';
        // 在 emit exit 前先喂 stderr（模拟 npm 崩溃输出）
        const origEmit = child.emit.bind(child);
        child.emit = (event, ...rest) => {
          if (event === 'exit' && rest[0] !== 0) {
            child.stderr.emit('data', Buffer.from(oomText));
          }
          return origEmit(event, ...rest);
        };
        return child;
      },
      appendLog: (level, msg) => logs.push(`${level}: ${msg}`),
      pushStage: () => {},
      pushProgress: () => {},
      dirSizeMBAsync: async () => '0.0',
      logPath: () => '',
      resolveRunner: () => ({ execPath: 'node', env: {} }),
      trackChild: (c) => c,
      npmInstallTimeoutMs: 60_000,
      fetchLatestDshInfo: async () => null,
    });
    let err = null;
    try {
      await rt.ensureDshRuntime();
    } catch (e) {
      err = e;
    }
    ok(
      !!err && err.message.includes('内存不足'),
      `OOM 重试后仍失败 → 提示「内存不足」（实际「${err && err.message.slice(0, 60)}…」）`,
    );
    ok(!(err && err.message.includes('请检查网络/源')), '未误导「检查网络/源」');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
