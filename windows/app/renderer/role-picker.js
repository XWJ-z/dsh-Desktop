'use strict';

/**
 * role-picker.js — 角色选择窗口脚本（v1.0.3，老大反馈 3）
 * 主进程 did-finish-load 后注入 window.__rolePickerInit(list)；
 * 竖排列表展示每个角色（名称 + 定位摘要），点击 → window.dshDesktop.rolePickerResult(index)。
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

function render(list) {
  const wrap = el('list');
  if (!Array.isArray(list) || list.length === 0) {
    wrap.innerHTML = '<div class="empty">还没有可用的角色</div>';
    return;
  }
  wrap.innerHTML = list.map((r) => `
    <button class="opt" data-index="${r.index}">
      <span class="icon">🎭</span>
      <span class="name">${escapeHtml(r.name)}</span>
      ${r.desc ? `<span class="desc">${escapeHtml(r.desc)}</span>` : ''}
      <span class="arrow">›</span>
    </button>`).join('');
  wrap.querySelectorAll('.opt').forEach((b) => {
    b.addEventListener('click', () => {
      if (dsh && dsh.rolePickerResult) dsh.rolePickerResult(Number(b.dataset.index));
    });
  });
}

window.__rolePickerInit = (list) => render(list);

el('cancel').addEventListener('click', () => {
  if (dsh && dsh.rolePickerResult) dsh.rolePickerResult(-1); // -1 = 不选择
});
