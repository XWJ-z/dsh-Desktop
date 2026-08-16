'use strict';

/**
 * changelog.js — 更新日志窗口脚本（v0.8.1 T3）
 * 经 preload：getChangelog() 获取本地 CHANGELOG.json 数据 + 当前版本。
 * 版本按降序渲染，最新置顶；当前运行版本卡片高亮。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function init() {
  if (!dsh || !dsh.getChangelog) return;
  const data = await dsh.getChangelog();
  if (!data || !Array.isArray(data.versions) || data.versions.length === 0) {
    el('list').innerHTML = '<div class="empty">暂无更新记录</div>';
    return;
  }

  const list = el('list');
  // 服务端已按降序维护，这里再保险排序一次（最新置顶）
  const versions = [...data.versions].sort((a, b) =>
    compareVersion(b.version, a.version));

  list.innerHTML = versions.map((v) => {
    const current = v.version === data.current;
    const notes = (Array.isArray(v.notes) ? v.notes : [])
      .map((n) => `<li>${escapeHtml(n)}</li>`).join('');
    return `
      <div class="ver-card${current ? ' current' : ''}">
        <div class="ver-head">
          <span class="ver-title">v${escapeHtml(v.version)}</span>
          <span class="ver-date">${escapeHtml(v.date || '')}</span>
          ${current ? '<span class="badge latest">当前版本</span>' : ''}
        </div>
        <ul class="ver-notes">${notes}</ul>
      </div>`;
  }).join('');
}

/** 语义化版本比较（仅 x.y.z 数字比较；返回 a 是否 ≥ b 用于降序排序） */
function compareVersion(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number);
  const pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

init();
