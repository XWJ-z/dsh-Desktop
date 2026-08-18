'use strict';

/**
 * verify-publish-v105.js — v1.0.5 发布后三源验证（发布核对单步骤 10）
 * 验证：raw / api / cdn 三源的 version.json 与 notice.json 内容与本地一致
 * （version=1.0.5、hash=49e32a45…d21de1、notice v7）。
 * 用法：node tests/verify-publish-v105.js（发布并 push 后执行）
 */

const EXPECT_VERSION = '1.0.5';
const EXPECT_HASH = '49e32a4553fe6928bfa4a0b941addcc8b6c71a0ae5e2821d0b99886d74d21de1';
const EXPECT_NOTICE_VERSION = 7;

const SOURCES = {
  'raw': 'https://raw.githubusercontent.com/XWJ-z/dsh-Desktop/main/version.json',
  'api': 'https://api.github.com/repos/XWJ-z/dsh-Desktop/contents/version.json',
  'cdn': 'https://cdn.jsdelivr.net/gh/XWJ-z/dsh-Desktop@main/version.json',
};

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'dsh-verify' } });
    if (res.status !== 200) return null;
    const text = await res.text();
    // api 源返回 base64 内容
    try {
      const j = JSON.parse(text);
      if (j && j.content) return JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
      return j;
    } catch { return null; }
  } catch { return null; } finally { clearTimeout(t); }
}

async function main() {
  console.log(`[验证] 三源 version.json 应均为 v${EXPECT_VERSION}（hash ${EXPECT_HASH.slice(0, 8)}…）`);
  let best = null;
  for (const [name, url] of Object.entries(SOURCES)) {
    const vj = await getJson(url);
    if (!vj) { ok(false, `${name}：拉取失败`); continue; }
    const verOk = vj.version === EXPECT_VERSION;
    const hashOk = (vj.hash || '') === EXPECT_HASH;
    ok(verOk && hashOk, `${name}：version=${vj.version}、hash=${(vj.hash || '').slice(0, 8)}… ${verOk && hashOk ? '一致' : '不一致'}`);
    if (verOk) best = vj;
  }
  // notice.json 验证（api 源权威）
  const apiNotice = await getJson('https://api.github.com/repos/XWJ-z/dsh-Desktop/contents/notice.json');
  ok(!!apiNotice && apiNotice.version === EXPECT_NOTICE_VERSION, `notice.json（api）version=${apiNotice ? apiNotice.version : '拉取失败'}（应为 v${EXPECT_NOTICE_VERSION}）`);
  if (apiNotice) {
    const marqueeOk = String(apiNotice.marquee || '').includes('v1.0.5');
    const latestOk = (apiNotice.items || []).some((i) => i.id === '20260818-3' && String(i.title || '').includes('1.0.5'));
    ok(marqueeOk && latestOk, 'notice.json：marquee 含 v1.0.5 + 最新公告条目 20260818-3');
  }
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
