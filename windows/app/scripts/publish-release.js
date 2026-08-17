'use strict';

/**
 * publish-release.js — 一键发布 vX.Y.Z（创建 Release + 上传安装包资产）
 *
 * 用法：node scripts/publish-release.js
 * 前置：
 *  - env GH_TOKEN 已设置（fine-grained PAT，Contents Read/Write）
 *  - version.json 已是目标版本（version/hash/download_urls 三处一致）
 *  - dist/installer/DSH-Desktop-Setup-<version>.exe 已构建（实测 hash 已填 version.json）
 * 输出：release id / asset id / 资产 URL（供 HEAD 验证与镜像下载比对 hash）
 *
 * 说明：用 Node fetch（Node 24 内置），避免 PowerShell 中文 JSON 编码坑；
 * GitHub 直连不稳 → 每步最多重试 3 次（间隔 10s）。
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..'); // 仓库根（version.json 所在）
const appRoot = path.join(__dirname, '..');         // windows/app（dist/installer 所在）
const repo = 'XWJ-z/dsh-Desktop';
const token = process.env.GH_TOKEN || '';
if (!token) {
  console.error('[publish] 缺少 GH_TOKEN 环境变量');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retry(fn, label, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === tries) throw err;
      console.log(`[publish] ${label} 第 ${i} 次失败（${err.message}），10s 后重试…`);
      await sleep(10_000);
    }
  }
}

async function main() {
  const vj = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  const version = vj.version;
  const tag = `v${version}`;
  const assetName = `DSH-Desktop-Setup-${version}.exe`;
  const assetPath = path.join(appRoot, 'dist', 'installer', assetName);
  if (!fs.existsSync(assetPath)) {
    console.error(`[publish] 资产不存在：${assetPath}`);
    process.exit(1);
  }
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'DSH-Desktop-publish' };

  // 1) 创建 Release（tag 已存在则复用）
  console.log(`[publish] 创建 Release ${tag} …`);
  let release = null;
  const createBody = JSON.stringify({
    tag_name: tag, name: tag, body: vj.release_notes, draft: false, prerelease: false,
  });
  try {
    release = await retry(async () => {
      const res = await fetch(`https://api.github.com/repos/${repo}/releases`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: createBody,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      return res.json();
    }, '创建 Release');
  } catch (err) {
    if (String(err.message).includes('already_exists')) {
      const list = await retry(async () => {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }, '查询已有 Release');
      release = list;
      console.log(`[publish] Release 已存在（id=${release.id}），复用`);
    } else {
      throw err;
    }
  }
  console.log(`[publish] Release id=${release.id} url=${release.html_url}`);

  // 2) 上传资产
  const buf = fs.readFileSync(assetPath);
  console.log(`[publish] 上传资产 ${assetName}（${(buf.length / 1024 / 1024).toFixed(1)}MB）…`);
  const asset = await retry(async () => {
    const res = await fetch(
      `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`,
      { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: buf },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    return res.json();
  }, '上传资产', 5);
  console.log(`[publish] 资产 id=${asset.id} size=${asset.size} url=${asset.browser_download_url}`);

  // 3) 资产 HEAD 验证（非 404）
  const head = await retry(async () => {
    const res = await fetch(asset.browser_download_url, { method: 'HEAD', redirect: 'follow' });
    return { status: res.status, len: res.headers.get('content-length') };
  }, '资产 HEAD 验证');
  console.log(`[publish] 资产 HEAD status=${head.status} content-length=${head.len}`);
  if (head.status === 404) {
    console.error('[publish] 资产 404，发布未完成');
    process.exit(1);
  }
  console.log(`[publish] ✅ 发布完成：${asset.browser_download_url}`);
}

main().catch((err) => {
  console.error('[publish] 失败：', err.message);
  process.exit(1);
});
