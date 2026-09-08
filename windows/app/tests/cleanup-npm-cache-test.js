'use strict';

/**
 * cleanup-npm-cache-test.js — v2.1.2：DSH 升级后清理旧 npm 缓存残留 行为单测
 *
 * 验证 dsh-runtime.cleanupNpmCache（mock spawn，不真实联网）：
 *  1. 升级成功后清理：spawn 出 `npm cache verify --cache <dshenv>/npm-cache`，exit 0 → resolve true
 *  2. 清理失败（非 0 退出）→ resolve false（不抛，降级为日志）
 *  3. spawn 抛错（无法创建子进程）→ resolve false（降级为日志）
 *
 * 用法：node tests/cleanup-npm-cache-test.js
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-clean-'));
  const appPath = path.join(tmp, 'app');
  const userData = path.join(tmp, 'userData');
  fs.mkdirSync(appPath, { recursive: true });
  fs.mkdirSync(path.join(userData, 'dshenv', 'npm-cache'), { recursive: true });
  fs.writeFileSync(
    path.join(appPath, 'config.json'),
    JSON.stringify({ dshVersion: '0.1.0-rc.6', dshPackage: '@deepseek-ai/dsh', registry: 'https://registry.npmmirror.com' }, null, 2),
    'utf8',
  );
  const npmCli = path.join(tmp, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  fs.mkdirSync(path.dirname(npmCli), { recursive: true });
  fs.writeFileSync(npmCli, '// npm cli', 'utf8'); // 占位，不在断言内校验内容
  return { tmp, appPath, userData };
}

/** mock spawn：立即按 plan 出结果 */
function makeSpawn(plan) {
  const calls = [];
  const spawnFn = (exe, args) => {
    calls.push({ exe, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setTimeout(() => {
      if (typeof plan === 'function') plan(child);
    }, 5);
    return child;
  };
  spawnFn.calls = calls;
  return spawnFn;
}

function mkRuntime(userData, spawnMock, logs, sizeMap) {
  return createDshRuntime({
    app: { getAppPath: () => path.join(userData, '..', 'app'), getPath: () => userData },
    fs,
    path,
    spawn: spawnMock,
    appendLog: (level, msg) => logs.push(`${level}: ${msg}`),
    pushStage: () => {},
    pushProgress: () => {},
    dirSizeMBAsync: async (dir) => {
      // 注入一个随调用次序变化的体积，便于断言「清理前 > 清理后」
      const size = sizeMap.splice(0, 1)[0];
      return size;
    },
    logPath: () => '',
    resolveRunner: () => ({ execPath: 'node', env: {} }),
    trackChild: (c) => c,
    npmInstallTimeoutMs: 60_000,
    fetchLatestDshInfo: async () => null,
  });
}

function isVerify(sub, cacheDir) {
  return (
    sub.args.some((a) => a === 'cache') &&
    sub.args.some((a) => a === 'verify') &&
    sub.args.includes(cacheDir)
  );
}

async function main() {
  // ① 成功清理：spawn npm cache verify，exit 0，且 args 指向 dshenv/npm-cache
  {
    const { tmp, userData } = setup();
    const logs = [];
    const sizeMap = [100, 70]; // 清理前 100MB → 清理后 70MB
    const spawnMock = makeSpawn((child) => child.emit('exit', 0));
    const rt = mkRuntime(userData, spawnMock, logs, sizeMap);
    const cacheDir = path.join(userData, 'dshenv', 'npm-cache');
    const r = await rt.cleanupNpmCache();
    ok(spawnMock.calls.length === 1, '清理只 spawn 一次（npm cache verify）');
    ok(isVerify(spawnMock.calls[0], cacheDir), `cleanupNpmCache 用 npm cache verify 指向 ${cacheDir}`);
    ok(r === true, 'exit 0 → resolve true');
    ok(logs.some((l) => /清理旧 npm 缓存完成/.test(l) && /回收约 30.0 MB/.test(l)), '日志含回收体积（约 30 MB）');
    ok(logs.some((l) => /清理 DSH 旧 npm 缓存前体积/.test(l)), '日志含清理前体积记录');
  }

  // ② 清理失败（非 0 退出）→ resolve false，不抛
  {
    const { tmp, userData } = setup();
    const logs = [];
    const spawnMock = makeSpawn((child) => child.emit('exit', 1));
    const rt = mkRuntime(userData, spawnMock, logs, [50, 50]);
    const r = await rt.cleanupNpmCache();
    ok(r === false, '清理失败（退出码非 0）→ resolve false');
    ok(logs.some((l) => /清理旧 npm 缓存失败/.test(l)), '失败降级为日志（不抛异常）');
  }

  // ③ spawn 抛错（无法创建子进程）→ resolve false，不抛
  {
    const { tmp, userData } = setup();
    const logs = [];
    const spawnMock = () => { throw new Error('spawn fail'); };
    const rt = mkRuntime(userData, spawnMock, logs, [10, 10]);
    const r = await rt.cleanupNpmCache();
    ok(r === false, 'spawn 抛错 → resolve false');
    ok(logs.some((l) => /无法创建子进程/.test(l)), '无法创建子进程降级为日志');
  }

  console.log(`\nRESULT: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('测试运行异常：', e); process.exit(1); });
