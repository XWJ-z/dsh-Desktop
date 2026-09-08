'use strict';

/**
 * min-dsh-version-test.js — v2.1.2：跨版本覆盖安装兼容修复 行为单测
 *
 * 验证 dsh-runtime.dshUpToDate 的「latest 语义下最低内核版本门槛」：
 *  1. 已装内核低于 MIN_DSH_VERSION（0.1.2-rc.1）→ latest 也判"未满足"（触发升级）
 *  2. 已装内核等于门槛 → 满足（不升级）
 *  3. 已装内核高于门槛 → 满足（不升级，latest 不主动降级）
 *  4. 非 latest（固定版本）仍按精确匹配判断（不受门槛影响）
 *
 * 用法：node tests/min-dsh-version-test.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-minver-'));
  const appPath = path.join(tmp, 'app');
  const userData = path.join(tmp, 'userData');
  fs.mkdirSync(appPath, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(appPath, 'config.json'),
    JSON.stringify({ dshVersion: 'latest', dshPackage: '@deepseek-ai/dsh', registry: 'https://registry.npmmirror.com' }, null, 2),
    'utf8',
  );
  return { tmp, appPath, userData };
}

function makeRuntime(userData) {
  return createDshRuntime({
    app: { getAppPath: () => path.join(userData, '..', 'app'), getPath: () => userData },
    fs,
    path,
    spawn: () => { throw new Error('not used'); },
    appendLog: () => {},
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

/** 构造已装 DSH 内核：写 package.json（version）与 lib/bin.js */
function installDsh(userData, version) {
  const pkgDir = path.join(userData, 'dshenv', 'node_modules', '@deepseek-ai', 'dsh');
  fs.mkdirSync(path.join(pkgDir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }), 'utf8');
  fs.writeFileSync(path.join(pkgDir, 'lib', 'bin.js'), '// dsh bin', 'utf8');
}

async function main() {
  // 取 MIN_DSH_VERSION（用一次 setup 的实例即可，该临时目录随后删除）
  const probe = setup();
  const probeRt = makeRuntime(probe.userData);
  const MIN = probeRt.MIN_DSH_VERSION;
  ok(typeof MIN === 'string' && /^\d+\.\d+\.\d+/.test(MIN), `MIN_DSH_VERSION 导出为合法 semver（${MIN}）`);
  fs.rmSync(probe.tmp, { recursive: true, force: true });

  // ① 低于门槛 → latest 判"未满足"
  {
    const { tmp, userData } = setup();
    installDsh(userData, '0.1.0-rc.7'); // 客户案例：1.x 时代旧内核
    const rt = makeRuntime(userData);
    ok(rt.dshUpToDate({ dshVersion: 'latest' }) === false, '已装 0.1.0-rc.7 < 门槛 → latest 判为未满足（将升级）');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ② 等于门槛 → 满足
  {
    const { tmp, userData } = setup();
    installDsh(userData, '0.1.2-rc.1');
    const rt = makeRuntime(userData);
    ok(rt.dshUpToDate({ dshVersion: 'latest' }) === true, '已装 0.1.2-rc.1 = 门槛 → latest 判为满足（不升级）');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ③ 高于门槛 → 满足（latest 不主动降级）
  {
    const { tmp, userData } = setup();
    installDsh(userData, '0.2.0');
    const rt = makeRuntime(userData);
    ok(rt.dshUpToDate({ dshVersion: 'latest' }) === true, '已装 0.2.0 > 门槛 → latest 判为满足（不升级）');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // ④ 非 latest（固定版本）→ 不受门槛影响，按精确匹配
  {
    const { tmp, userData } = setup();
    installDsh(userData, '0.1.0-rc.7');
    const rt = makeRuntime(userData);
    ok(rt.dshUpToDate({ dshVersion: '0.1.0-rc.7' }) === true, '固定版本 0.1.0-rc.7 精确匹配 → 满足（不受门槛影响）');
    installDsh(userData, '0.1.0-rc.6');
    ok(rt.dshUpToDate({ dshVersion: '0.1.0-rc.7' }) === false, '固定版本不匹配（0.1.0-rc.6 vs 0.1.0-rc.7）→ 未满足');
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(`\nRESULT: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('测试运行异常：', e); process.exit(1); });
