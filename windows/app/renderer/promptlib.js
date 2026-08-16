'use strict';

/**
 * promptlib.js — 提示词库面板脚本（v0.8.3 T4 → v0.8.7 UI 升级）
 * 经 preload：getPrompts() 获取内置提示词库；injectPrompt() 注入主窗口 DSH 输入框
 * （v0.8.6 起 insertText 两段式，发送按钮可点）。
 * v0.8.7：搜索实时过滤 / 卡片点击展开完整内容 + hint / 「使用」「复制」按钮 /
 * 面板级反馈横幅；注入被用户取消（reason='cancelled'）时不做降级复制。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

let data = null;
let currentCat = null;
let keyword = '';
let bannerTimer = null;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 面板级反馈横幅（成功绿 / 失败黄），1.8s 自动消失 */
function showBanner(text, ok) {
  const b = el('banner');
  b.textContent = text;
  b.className = 'banner show ' + (ok ? 'ok' : 'fail');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = 'banner'; }, 1800);
}

/** 注入（失败自动降级复制）；用户取消（cancelled）时不复制不提示 */
async function injectOrCopy(item) {
  if (!dsh || !dsh.injectPrompt || !dsh.copyText) { showBanner('功能不可用', false); return; }
  const res = await dsh.injectPrompt(item.text);
  if (res && res.ok) {
    showBanner('✅ 已填入输入框', true);
  } else if (res && res.reason === 'cancelled') {
    /* 用户在选择弹窗里点了取消：什么都不做 */
  } else {
    await dsh.copyText(item.text);
    showBanner('已复制到剪贴板，去输入框粘贴（Ctrl+V）', false);
    if (dsh.petNotify) dsh.petNotify('copied'); // v0.8.11（T5.3）：鲸鱼气泡提示
  }
}

/** 仅复制（「复制」按钮） */
async function copyOnly(item) {
  if (!dsh || !dsh.copyText) { showBanner('功能不可用', false); return; }
  await dsh.copyText(item.text);
  showBanner('✅ 已复制，把 [ ] 换成你的内容', true);
}

/** 当前分类 + 关键字过滤后的条目 */
function filteredItems() {
  const cat = data.categories.find((c) => c.id === currentCat);
  if (!cat) return [];
  const kw = keyword.trim().toLowerCase();
  if (!kw) return cat.items;
  return cat.items.filter((it) =>
    it.title.toLowerCase().includes(kw) || it.text.toLowerCase().includes(kw));
}

function renderItems() {
  const items = el('items');
  const list = filteredItems();
  if (list.length === 0) {
    items.innerHTML = '<div class="empty">没有匹配的提示词</div>';
    return;
  }
  items.innerHTML = list.map((it, i) => {
    const hint = it.hint ? `<div class="item-hint">${escapeHtml(it.hint)}</div>` : '';
    return `
      <div class="item" data-index="${i}">
        <div class="item-title">${escapeHtml(it.title)}</div>
        <div class="item-text">${escapeHtml(it.text)}</div>
        ${hint}
        <div class="item-actions">
          <button class="act use" data-action="use">使用</button>
          <button class="act copy" data-action="copy">复制</button>
        </div>
      </div>`;
  }).join('');

  items.querySelectorAll('.item').forEach((card) => {
    const it = list[Number(card.dataset.index)];
    if (!it) return;
    // 点击卡片：展开/收起完整内容
    card.addEventListener('click', () => { card.classList.toggle('expanded'); });
    // 操作按钮：不触发卡片展开
    const useBtn = card.querySelector('[data-action="use"]');
    const copyBtn = card.querySelector('[data-action="copy"]');
    if (useBtn) {
      useBtn.addEventListener('click', (e) => { e.stopPropagation(); injectOrCopy(it); });
    }
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyOnly(it); });
    }
  });
}

function selectCat(id) {
  currentCat = id;
  document.querySelectorAll('.cat').forEach((c) => c.classList.toggle('active', c.dataset.id === id));
  renderItems();
}

function renderCats() {
  const cats = el('cats');
  cats.innerHTML = data.categories.map((c) =>
    `<div class="cat" data-id="${escapeHtml(c.id)}">${escapeHtml(c.icon)} ${escapeHtml(c.name)}<span class="count">${c.items.length}</span></div>`).join('');
  cats.addEventListener('click', (e) => {
    const catEl = e.target.closest('.cat');
    if (catEl) selectCat(catEl.dataset.id);
  });
}

async function init() {
  if (!dsh || !dsh.getPrompts) return;
  data = await dsh.getPrompts();
  if (!data || !Array.isArray(data.categories) || data.categories.length === 0) {
    el('items').innerHTML = '<div class="empty">暂无提示词</div>';
    return;
  }
  renderCats();
  selectCat(data.categories[0].id); // 默认选中第一个分类
  // 搜索：输入即过滤（标题+内容）
  el('search').addEventListener('input', (e) => {
    keyword = e.target.value;
    renderItems();
  });
}

init();
