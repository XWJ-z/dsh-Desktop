'use strict';
// release-publish.js — v0.9.6 发布：创建 Release + 上传资产 + 验证（zx(6)）
const fs = require('node:fs');
const path = require('node:path');

const TOKEN = process.env.GH_TOKEN;
const REPO = 'XWJ-z/dsh-Desktop';
const VERSION = '0.9.6';
const root = path.join(__dirname, '..', '..', '..'); // scripts → app → windows → 仓库根
const exePath = path.join(root, 'windows', 'app', 'dist', 'installer', `DSH-Desktop-Setup-${VERSION}.exe`);
const ASSET_NAME = `DSH-Desktop-Setup-${VERSION}.exe`;

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: `Bearer ${TOKEN}`, 'User-Agent': 'DSH-Desktop', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status} ${url}: ${text.slice(0, 300)}`);
  }
  return res;
}

async function main() {
  if (!fs.existsSync(exePath)) throw new Error(`安装包不存在：${exePath}`);
  const ver = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  if (ver.version !== VERSION) throw new Error(`version.json 版本不符：${ver.version} vs ${VERSION}`);

  // 1. 创建 Release
  console.log('[1] 创建 Release v' + VERSION);
  const rel = await api(`https://api.github.com/repos/${REPO}/releases`, {
    method: 'POST',
    headers: { Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: `v${VERSION}`,
      name: `v${VERSION}`,
      body: ver.release_notes,
      draft: false,
      prerelease: false,
    }),
  }).then((r) => r.json());
  console.log('    release id:', rel.id, '| tag:', rel.tag_name, '|', rel.html_url);
  const releaseId = rel.id;

  // 2. 上传资产
  console.log('[2] 上传资产 ' + ASSET_NAME);
  const file = fs.readFileSync(exePath);
  const up = await api(
    `https://uploads.github.com/repos/${REPO}/releases/${releaseId}/assets?name=${ASSET_NAME}`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
  ).then((r) => r.json());
  console.log('    asset uploaded:', up.name, '| size:', up.size);

  // 3. 验证资产非 404（HEAD）
  console.log('[3] 验证资产可访问');
  const head = await fetch(`https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET_NAME}`, { method: 'HEAD' });
  console.log('    HEAD status:', head.status, head.status === 200 || head.status === 302 ? '✓' : '✗');
  if (head.status === 404) throw new Error('资产 404！');

  console.log('');
  console.log('RELEASE_PUBLISHED', JSON.stringify({ id: releaseId, version: VERSION, asset: ASSET_NAME, url: rel.html_url }));
}

main().catch((err) => { console.error('发布失败：', err.message); process.exit(1); });
