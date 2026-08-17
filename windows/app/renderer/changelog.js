'use strict';

/**
 * changelog.js — 更新日志窗口脚本（v0.8.1 T3）
 * 经 preload：getChangelog() 获取本地 CHANGELOG.json 数据 + 当前版本。
 * 版本按降序渲染，最新置顶；当前运行版本卡片高亮。
 * v0.9.9（老大指令）：只显示已发布到 GitHub 的版本（released=true），内部版本不展示；
 *   当前运行版本若未发布 → 顶部提示「内部测试版」。
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
  // v0.9.9：只显示已发布版本（released=true）。
  // P3-3（外审 zx(9)）：版本比较/排序已收敛到主进程 compareSemver（共享
  // modules/semver.js，支持 -rc 预发布号语义），changelog:data 返回即降序，
  // 渲染端不再自行实现 compareVersion（此前忽略预发布号，行为与主进程不一致）。
  const versions = data.versions.filter((v) => v.released !== false);

  // v0.9.9：当前运行版本若未发布（内部测试版）→ 顶部提示
  const current = data.current;
  const currentReleased = data.versions.some((v) => v.version === current && v.released !== false);
  const tip = el('current-tip');
  if (tip && !currentReleased) {
    tip.hidden = false;
    tip.textContent = `当前运行版本 v${current}（内部测试版，更新日志仅展示已发布版本）`;
  }

  if (versions.length === 0) {
    list.innerHTML = '<div class="empty">暂无已发布版本记录</div>';
    return;
  }

  list.innerHTML = versions.map((v) => {
    const isCurrent = v.version === current;
    const notes = (Array.isArray(v.notes) ? v.notes : [])
      .map((n) => `<li>${escapeHtml(n)}</li>`).join('');
    return `
      <div class="ver-card${isCurrent ? ' current' : ''}">
        <div class="ver-head">
          <span class="ver-title">v${escapeHtml(v.version)}</span>
          <span class="ver-date">${escapeHtml(v.date || '')}</span>
          ${isCurrent ? '<span class="badge latest">当前版本</span>' : ''}
        </div>
        <ul class="ver-notes">${notes}</ul>
      </div>`;
  }).join('');
}

/** P3-3（外审 zx(9)）：版本比较已收敛到主进程共享 modules/semver.js，
 *  changelog:data 返回即按 compareSemver 降序，此处不再重复实现 */

init();
