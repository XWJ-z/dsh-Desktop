'use strict';

/**
 * test-v0911-trust.js — v0.9.11 信任模型行为级验证（外审 zx(9) 整改）
 *
 * 不启动 Electron，直接驱动 modules/updater.js / shell-hashes.js / semver.js：
 *  - P1-1 壳更新三源多数一致（sourcesAgree 判定正确性，非字符串存在性）
 *  - P1-1 壳内置期望 hash 台账核对（verifyKnownHash）
 *  - P1-2 registry dist-tags + dist.integrity 解析（fetchLatestDshInfo）
 *  - P1-1 doShellDownload 信任门（源不一致 / 台账不符 → 拒绝下载）
 *  - P2-2 外部链接白名单边界（isAllowedExternalUrl）
 *
 * 用法：node tests/test-v0911-trust.js
 */

const os = require('node:os');
const { Readable } = require('node:stream');
const { createUpdater } = require('../modules/updater');
const { verifyKnownHash } = require('../modules/shell-hashes');
const { isAllowedExternalUrl } = require('../modules/external-links');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const REAL_HASH_096 = '23b984d4e57e0d6b506cae48ba82d6aeae041fd7cfad5580a6b7bf170c6fe910';

/**
 * 构造 updater。updater 内部 fetchJson 走 deps.https（非注入 fetchJson），
 * 故 mock https.get：按调用序返回 sourceBodies 对应 JSON 字符串（null = 网络失败）。
 * @param {Array<string|null>} sourceBodies 依次对应三源（jsDelivr/API/raw）响应体
 */
function mkUpdater(sourceBodies, currentVersion) {
  const logs = [];
  let call = 0;
  const https = {
    get(_url, _opts, cb) {
      const idx = Math.min(call, sourceBodies.length - 1);
      call++;
      const body = sourceBodies[idx];
      const req = {
        on: (ev, h) => {
          if (ev === 'error' && body === null) setImmediate(() => h(new Error('net-fail')));
          return req;
        },
        destroy: () => {},
      };
      if (body === null) return req; // 失败：不触发 cb，随后 req error
      const res = new Readable();
      res._read = () => {};
      res.setEncoding = () => {};
      setImmediate(() => { res.push(body); res.push(null); });
      cb(res);
      return req;
    },
  };
  return {
    api: createUpdater({
      app: {
        getVersion: () => currentVersion || '0.9.10',
        getAppPath: () => __dirname,
        getPath: () => os.tmpdir(),
      },
      shell: { openPath: () => {} },
      https,
      crypto: require('node:crypto'),
      fs: require('node:fs'),
      path: require('node:path'),
      rmQuiet: () => {},
      appendLog: (lvl, msg) => logs.push(`${lvl}:${msg}`),
      readShellConfig: () => ({ dshPackage: '@deepseek-ai/dsh', dshVersion: 'latest', registry: 'https://registry.npmmirror.com' }),
      installedDshVersion: () => '0.1.0-rc.6',
      updateDshVersion: () => true,
      shellUpdateUrls: [
        { name: 'A', url: 'https://a' },
        { name: 'B', url: 'https://b' },
        { name: 'C', url: 'https://c' },
      ],
    }),
    logs,
  };
}

const mkInfo = (version, hash, urls) => JSON.stringify({
  version, download_urls: urls || [], release_notes: '', force: false, hash, minVersion: '',
});

async function testMajority() {
  console.log('[1] P1-1 三源多数一致（fetchLatestShellVersion）');
  // 用例 1：三源完全一致 → agree
  {
    const { api } = mkUpdater([mkInfo('0.9.11', 'h'), mkInfo('0.9.11', 'h'), mkInfo('0.9.11', 'h')]);
    const r = await api.fetchLatestShellVersion();
    ok(r && r.version === '0.9.11' && r.sourcesAgree === true, '三源一致 → sourcesAgree=true');
  }
  // 用例 2：两源一致 + 一源旧版 → 取多数一致版本
  {
    const { api } = mkUpdater([mkInfo('0.9.11', 'h'), mkInfo('0.9.11', 'h'), mkInfo('0.9.6', 'old')]);
    const r = await api.fetchLatestShellVersion();
    ok(r && r.version === '0.9.11' && r.sourcesAgree === true, '2 源同版本一致 → 取该版本 agree=true');
  }
  // 用例 3：一源最新 + 两源旧版一致 → 取多数一致（旧版），agree=true
  {
    const { api } = mkUpdater([mkInfo('0.9.11', 'h'), mkInfo('0.9.6', 'old'), mkInfo('0.9.6', 'old')]);
    const r = await api.fetchLatestShellVersion();
    ok(r && r.version === '0.9.6' && r.sourcesAgree === true, '一源新 + 两源旧一致 → 取多数一致旧版（不取单源新版）');
  }
  // 用例 4：三源各不相同 → 无一致组 → sourcesAgree=false（取最高版本仅提示）
  {
    const { api } = mkUpdater([mkInfo('0.9.11', 'h1'), mkInfo('0.9.10', 'h2'), mkInfo('0.9.9', 'h3')]);
    const r = await api.fetchLatestShellVersion();
    ok(r && r.version === '0.9.11' && r.sourcesAgree === false, '三源互不一致 → agree=false 取最高（仅提示）');
  }
  // 用例 5：两源同版本但 hash 不同 → 组内 hash 不唯一 → 不构成多数一致
  {
    const { api } = mkUpdater([mkInfo('0.9.11', 'h-a'), mkInfo('0.9.11', 'h-b'), mkInfo('0.9.6', 'old')]);
    const r = await api.fetchLatestShellVersion();
    ok(r && r.sourcesAgree === false, '同版本 hash 不同 → 不构成一致（防 hash 篡改）');
  }
  // 用例 6：全部失败 → null
  {
    const { api } = mkUpdater([null, null, null]);
    const r = await api.fetchLatestShellVersion();
    ok(r === null, '三源全失败 → null（静默）');
  }
  // 用例 7：仅一源可达 → 无法多数一致 → agree=false
  {
    const { api } = mkUpdater([mkInfo('0.9.11', 'h'), null, null]);
    const r = await api.fetchLatestShellVersion();
    ok(r && r.version === '0.9.11' && r.sourcesAgree === false, '仅一源可达 → 无多数一致 → 不自动下载');
  }
}

async function testHashLedger() {
  console.log('[2] P1-1 壳内置 hash 台账（verifyKnownHash）');
  const r1 = verifyKnownHash('0.9.6', REAL_HASH_096);
  ok(r1.ok === true, '台账内版本 + 正确 hash → 放行');
  const r2 = verifyKnownHash('0.9.6', 'deadbeef');
  ok(r2.ok === false && r2.reason === 'hash-mismatch', '台账内版本 + 错误 hash → 拒绝（投毒拦截）');
  const r3 = verifyKnownHash('0.9.6', '');
  ok(r3.ok === false, '台账内版本 + 空 hash → 拒绝');
  const r4 = verifyKnownHash('2.0.0', 'whatever');
  ok(r4.ok === true && r4.reason === 'unknown-version', '台账外版本（比壳新）→ 放行（交多数一致兜底）');
}

async function testDshInfo() {
  console.log('[3] P1-2 registry 版本 + integrity 解析（fetchLatestDshInfo）');
  const corgi = JSON.stringify({ 'dist-tags': { latest: '0.2.0' }, versions: { '0.2.0': { version: '0.2.0', dist: { integrity: 'sha512-abc123' } } } });
  {
    const { api } = mkUpdater([corgi, corgi, corgi]);
    const info = await api.fetchLatestDshInfo();
    ok(info && info.version === '0.2.0' && info.integrity === 'sha512-abc123', '解析 latest 版本 + dist.integrity');
    const v = await api.fetchLatestDshVersion();
    ok(v === '0.2.0', 'fetchLatestDshVersion 保持返回版本字符串（兼容旧调用）');
  }
  {
    const empty = JSON.stringify({ 'dist-tags': { latest: '0.2.0' }, versions: {} });
    const { api } = mkUpdater([empty, empty, empty]);
    const info = await api.fetchLatestDshInfo();
    ok(info === null, 'latest 指向的版本无元数据 → null');
  }
  {
    const { api } = mkUpdater([null, null, null]);
    const info = await api.fetchLatestDshInfo();
    ok(info === null, 'registry 不可达 → null');
  }
}

async function testDownloadGate() {
  console.log('[4] P1-1 doShellDownload 信任门');
  // 源不一致 → 拒绝下载（不触碰 https.get）
  {
    const { api, logs } = mkUpdater([mkInfo('0.9.11', 'h'), mkInfo('0.9.10', 'h'), mkInfo('0.9.9', 'h')]);
    const r = await api.downloadShellUpdate(null);
    ok(r && r.ok === false && r.reason === 'sources-disagree', '源不一致 → sources-disagree（拒绝自动下载）');
    ok(logs.some((l) => l.includes('拒绝自动下载')), '日志记录防投毒拒绝');
  }
  // 台账不符（版本 0.9.6 已发布，hash 被篡改；旧壳 0.9.5 收到投毒 version.json）→ 拒绝
  {
    const { api } = mkUpdater([mkInfo('0.9.6', 'deadbeef'), mkInfo('0.9.6', 'deadbeef'), mkInfo('0.9.6', 'deadbeef')], '0.9.5');
    const r = await api.downloadShellUpdate(null);
    ok(r && r.ok === false && r.reason === 'hash-mismatch', '台账内版本 hash 不符 → hash-mismatch（拒绝）');
  }
  // 无更新（当前 0.9.10 ≥ 目标）→ no-update
  {
    const { api } = mkUpdater([mkInfo('0.9.9', 'h'), mkInfo('0.9.9', 'h'), mkInfo('0.9.9', 'h')]);
    const r = await api.downloadShellUpdate(null);
    ok(r && r.ok === false && r.reason === 'no-update', '目标版本 ≤ 当前 → no-update');
  }
}

async function testWhitelistEdge() {
  console.log('[5] P2-2 白名单边界（isAllowedExternalUrl）');
  ok(!isAllowedExternalUrl('https://github.com.evil.com/x'), '伪造子域 github.com.evil.com 拒绝');
  ok(!isAllowedExternalUrl('https://evilgithub.com/x'), '相似域名 evilgithub.com 拒绝');
  ok(!isAllowedExternalUrl('javascript:alert(1)'), 'javascript: 协议拒绝');
  ok(!isAllowedExternalUrl('https://qq.com.evil.io/'), 'qq.com 伪装拒绝');
  ok(isAllowedExternalUrl('https://chat.deepseek.com/'), 'deepseek.com 子域放行');
  ok(isAllowedExternalUrl('https://qm.qq.com/q/xxxx'), 'qq.com 子域放行');
  ok(isAllowedExternalUrl('http://localhost:3080'), 'localhost 本地回环放行');
}

async function main() {
  await testMajority();
  await testHashLedger();
  await testDshInfo();
  await testDownloadGate();
  await testWhitelistEdge();
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
