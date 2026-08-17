'use strict';

/**
 * notice.js — 公告窗口脚本（v0.8.11 T0.6）
 * 经 preload：getNotices() 获取远程公告（version.json notices 字段；打开即标记已读）。
 * 数据经 IPC 从主进程来，字段已字符串化；此处再 HTML 转义一层防注入。
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
  const list = el('list');
  if (!dsh || !dsh.getNotices) { list.innerHTML = '<div class="empty">暂无公告</div>'; return; }
  let notices = [];
  let marquee = '';
  try {
    const data = await dsh.getNotices();
    if (data && Array.isArray(data.notices)) notices = data.notices;
    // v0.9.7：完整 marquee 横幅（菜单栏公告条截断的内容这里看全）
    if (data && typeof data.marquee === 'string' && data.marquee.trim()) marquee = data.marquee.trim();
  } catch { /* 拉取失败/异常：按无公告处理，不报错 */ }
  const mc = el('marquee');
  if (marquee) {
    mc.hidden = false;
    mc.innerHTML = `<span class="marquee-label">最新公告</span>${escapeHtml(marquee)}`;
  }
  if (notices.length === 0) { list.innerHTML = '<div class="empty">暂无公告</div>'; return; }
  // 倒序展示（version.json 维护时新的在前；若乱序也无碍阅读）
  list.innerHTML = notices.map((n) => `
    <div class="notice-card">
      <div class="notice-head">
        <span class="notice-date">${escapeHtml(n.date || '')}</span>
        <span class="notice-title">${escapeHtml(n.title || '')}</span>
      </div>
      <div class="notice-content">${escapeHtml(n.content || '')}</div>
    </div>`).join('');
}

init();
