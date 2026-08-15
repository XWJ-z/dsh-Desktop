'use strict';

/**
 * update.js — 更新窗口脚本（v0.5.3）
 * 通过 preload 暴露的 window.dshDesktop 与主进程通信：
 *  - queryUpdate()：查询壳+DSH 两侧更新信息
 *  - upgradeDsh()：触发 DSH 升级（改 config + 重启）
 *  - downloadShellUpdate()：触发壳更新下载
 *  - onUpdateProgress()：订阅下载进度
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

function setBadge(id, state, text) {
  const b = el(id);
  b.className = 'badge ' + state; // latest / update / unknown
  b.textContent = text;
}

let shellDownloading = false;

async function load() {
  // 初始状态
  el('dsh-status').textContent = '查询中…';
  el('shell-status').textContent = '查询中…';
  if (!dsh || !dsh.queryUpdate) return;

  const info = await dsh.queryUpdate();
  if (!info) {
    el('dsh-status').textContent = '查询失败（请检查网络）';
    el('shell-status').textContent = '查询失败（请检查网络）';
    return;
  }

  // ── DSH 卡片 ──
  const d = info.dsh;
  el('dsh-current').textContent = d.current;
  if (d.latest) {
    el('dsh-latest').textContent = d.latest;
    // updatable 由主进程语义化比较得出（修复：最新<当前时不再误提示）
    const newer = !!d.updatable;
    setBadge('dsh-badge', newer ? 'update' : 'latest', newer ? '可更新' : '最新');
    if (d.notes) { el('dsh-notes').textContent = d.notes; el('dsh-notes').style.display = ''; }
    el('dsh-upgrade').style.display = newer ? '' : 'none';
  } else {
    el('dsh-latest').textContent = '未知';
    setBadge('dsh-badge', 'unknown', '未知');
  }
  el('dsh-status').textContent = '';

  // ── 桌面端卡片 ──
  const s = info.shell;
  el('shell-current').textContent = s.current;
  if (s.latest) {
    el('shell-latest').textContent = s.latest;
    const newer = !!s.updatable;
    setBadge('shell-badge', newer ? 'update' : 'latest', newer ? '可更新' : '最新');
    // v0.6.0（T-026）：release_notes 是多行文本（\n 分隔），textContent + pre-wrap 分行展示；
    // 小标题标注版本（产品决策：即使当前已最新也显示 latest 版本更新说明）
    if (s.notes) {
      el('shell-notes').textContent = s.notes;
      el('shell-notes').style.display = '';
      el('shell-notes-title').textContent = `v${s.latest} 更新内容`;
      el('shell-notes-title').style.display = '';
    } else {
      el('shell-notes').style.display = 'none';
      el('shell-notes-title').style.display = 'none';
    }
    el('shell-download').style.display = newer ? '' : 'none';
  } else {
    el('shell-latest').textContent = '未知';
    setBadge('shell-badge', 'unknown', '未知');
  }
  el('shell-status').textContent = '';
}

// ── DSH 立即升级 ──
el('dsh-upgrade').addEventListener('click', async () => {
  if (!dsh || !dsh.upgradeDsh) return;
  el('dsh-upgrade').disabled = true;
  el('dsh-status').innerHTML = '<span class="spinner"></span> 正在升级…';
  const r = await dsh.upgradeDsh();
  if (r && r.ok) {
    el('dsh-status').textContent = `已更新配置 ${r.from} → ${r.to}，即将重启…`;
    setTimeout(() => { /* 主进程 relaunch 前给用户看清提示 */ }, 800);
  } else {
    el('dsh-upgrade').disabled = false;
    el('dsh-status').textContent = r && r.reason === 'write-failed'
      ? `改写 config.json 失败（${r.configPath || ''}）。请以管理员身份运行，或手动编辑该文件后重启`
      : '当前已是最新版本或查询失败';
  }
});

// ── 壳下载更新 ──
el('shell-download').addEventListener('click', async () => {
  if (shellDownloading || !dsh || !dsh.downloadShellUpdate) return;
  shellDownloading = true;
  el('shell-download').disabled = true;
  el('shell-progress').style.display = '';
  el('shell-status').textContent = '开始下载…';

  // 订阅进度
  if (dsh.onUpdateProgress) {
    dsh.onUpdateProgress(({ percent }) => {
      if (percent < 0) {
        // 无总量（chunked）：显示已下载 MB + 不定进度动画
        const mb = (Math.abs(percent) / 1024 / 1024).toFixed(1);
        el('shell-progress-fill').style.width = '30%';
        el('shell-progress-text').textContent = `已下载 ${mb} MB…`;
        el('shell-progress-fill').classList.add('indeterminate');
      } else {
        el('shell-progress-fill').classList.remove('indeterminate');
        el('shell-progress-fill').style.width = `${percent}%`;
        el('shell-progress-text').textContent = `${percent}%`;
      }
    });
  }

  const r = await dsh.downloadShellUpdate();
  shellDownloading = false;
  if (r && r.ok) {
    el('shell-progress-fill').style.width = '100%';
    el('shell-progress-text').textContent = '100%';
    el('shell-status').textContent = `下载完成，已打开安装包（v${r.version}）`;
  } else {
    el('shell-download').disabled = false;
    const msg = {
      'fetch-failed': '无法连接更新源，请检查网络',
      'no-update': '当前已是最新版本',
      'download-failed': '所有下载源均失败，请稍后重试或到 GitHub Releases 手动下载',
      'hash-mismatch': '下载的安装包校验不通过（已删除），请重新下载',
    }[r && r.reason] || '下载失败';
    el('shell-status').textContent = msg;
    if (r && r.reason === 'download-failed' && r.message) {
      el('shell-status').textContent += `（${r.message}）`;
    }
  }
});

// ── 刷新 ──
el('refresh').addEventListener('click', () => { load(); });

load();
