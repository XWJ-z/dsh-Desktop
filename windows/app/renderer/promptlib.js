'use strict';

/**
 * promptlib.js — 提示词库面板脚本（v0.8.3 T4 → v0.8.7 UI 升级 → v0.9.5 T2 双 tab）
 * 经 preload：getPrompts() 获取内置提示词库；injectPrompt() 注入主窗口 DSH 输入框
 * （v0.8.6 起 insertText 两段式，发送按钮可点）。
 * v0.8.7：搜索实时过滤 / 卡片点击展开完整内容 + hint / 「使用」「复制」按钮 /
 * 面板级反馈横幅；注入被用户取消（reason='cancelled'）时不做降级复制。
 * v0.9.5（T2）：顶部双 tab —— 📚 内置库 | ✏️ 我的提示词（自定义）：
 *  - 自定义提示词存 userData/custom-prompts.json（经 getCustomPrompts/
 *    saveCustomPrompt/deleteCustomPrompt IPC）
 *  - 空状态引导 + 新建/编辑弹窗（分类/名称/内容/hint）+ 删除二次确认
 *  - 两个 tab 完全独立；「使用」复用内置注入链路（injectPrompt）
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

let data = null;
let currentCat = null;
let keyword = '';
let bannerTimer = null;
let bannerTimer2 = null;

// v0.9.5：自定义提示词状态
let customData = { categories: [], items: [] };
let editingId = null;   // 弹窗当前编辑的条目 id（null = 新建）
// v0.9.6：自定义分组状态（'__all__' = 全部）
let customCat = '__all__';

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

/** 自定义 tab 反馈横幅 */
function showBannerCustom(text, ok) {
  const b = el('banner-custom');
  b.textContent = text;
  b.className = 'banner show ' + (ok ? 'ok' : 'fail');
  clearTimeout(bannerTimer2);
  bannerTimer2 = setTimeout(() => { b.className = 'banner'; }, 1800);
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

// ---------------------------------------------------------------------------
// 内置库（原逻辑）
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// v0.9.5：自定义提示词
// ---------------------------------------------------------------------------

/** 内置分类名（弹窗分类下拉复用） */
function builtinCatNames() {
  return (data && data.categories || []).map((c) => c.name);
}

// ---------------------------------------------------------------------------
// v0.9.6：自定义分组（像内置库一样左侧分组显示）
// ---------------------------------------------------------------------------

/** 自定义条目实际用到的全部分组（去重、保持顺序：内置类在前，自定义类在后） */
function customGroups() {
  const used = new Set(customData.items.map((i) => i.cat).filter(Boolean));
  const builtin = builtinCatNames().filter((c) => used.has(c));
  const custom = customData.categories.filter((c) => used.has(c) && !builtin.includes(c));
  return [...builtin, ...custom];
}

/** 按当前分组过滤的条目 */
function filteredCustom() {
  if (customCat === '__all__') return customData.items;
  return customData.items.filter((i) => i.cat === customCat);
}

/** 渲染左侧自定义分组（「全部」+ 有条目的内置类 + 自定义类，带计数徽章） */
function renderCustomCats() {
  const cats = el('custom-cats');
  const groups = customGroups();
  const total = customData.items.length;
  const render = (key, label, count) =>
    `<div class="cat" data-cat="${escapeHtml(key)}">${escapeHtml(label)}<span class="count">${count}</span></div>`;
  let html = render('__all__', '全部', total);
  html += groups.map((g) => {
    const n = customData.items.filter((i) => i.cat === g).length;
    return render(g, g, n);
  }).join('');
  cats.innerHTML = html;
  cats.querySelectorAll('.cat').forEach((c) => {
    c.classList.toggle('active', c.dataset.cat === customCat);
  });
}

/** 渲染自定义列表（空状态 / 分组过滤后的卡片） */
function renderCustom() {
  const items = el('custom-items');
  const empty = el('custom-empty');
  renderCustomCats();
  const list = filteredCustom();
  if (customData.items.length === 0) {
    items.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  if (list.length === 0) {
    items.innerHTML = '<div class="empty">该分组暂无提示词</div>';
    return;
  }
  items.innerHTML = list.map((it, i) => {
    const hint = it.hint ? `<div class="item-hint">${escapeHtml(it.hint)}</div>` : '';
    const catTag = it.cat ? `<span class="item-title">${escapeHtml(it.name)} <span style="font-size:11px;color:var(--text-quaternary);font-weight:400;">· ${escapeHtml(it.cat)}</span></span>` : '';
    return `
      <div class="item" data-index="${i}">
        ${catTag || `<div class="item-title">${escapeHtml(it.name)}</div>`}
        <div class="item-text">${escapeHtml(it.content)}</div>
        ${hint}
        <div class="item-actions">
          <button class="act use" data-action="use">使用</button>
          <button class="act edit" data-action="edit">编辑</button>
          <button class="act del" data-action="del">删除</button>
        </div>
      </div>`;
  }).join('');

  items.querySelectorAll('.item').forEach((card) => {
    const it = list[Number(card.dataset.index)];
    if (!it) return;
    card.addEventListener('click', () => { card.classList.toggle('expanded'); });
    const useBtn = card.querySelector('[data-action="use"]');
    const editBtn = card.querySelector('[data-action="edit"]');
    const delBtn = card.querySelector('[data-action="del"]');
    if (useBtn) {
      useBtn.addEventListener('click', (e) => { e.stopPropagation(); useCustom(it); });
    }
    if (editBtn) {
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openModal(it); });
    }
    if (delBtn) {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 删除二次确认：第一次点击变「确认删除？」，3 秒内再点才执行
        if (delBtn.classList.contains('confirm')) {
          doDelete(it.id);
        } else {
          delBtn.classList.add('confirm');
          delBtn.textContent = '确认删除？';
          setTimeout(() => {
            delBtn.classList.remove('confirm');
            delBtn.textContent = '删除';
          }, 3000);
        }
      });
    }
  });
}

/** 自定义条目「使用」→ 复用注入链路（失败降级复制） */
async function useCustom(item) {
  if (!dsh || !dsh.injectPrompt || !dsh.copyText) { showBannerCustom('功能不可用', false); return; }
  const res = await dsh.injectPrompt(item.content);
  if (res && res.ok) {
    showBannerCustom('✅ 已填入输入框', true);
  } else if (res && res.reason === 'cancelled') {
    /* 用户取消：不提示 */
  } else {
    await dsh.copyText(item.content);
    showBannerCustom('已复制到剪贴板，去输入框粘贴（Ctrl+V）', false);
  }
}

/** 删除自定义条目（IPC + 刷新列表） */
async function doDelete(id) {
  if (!dsh || !dsh.deleteCustomPrompt) return;
  await dsh.deleteCustomPrompt(id);
  await loadCustom();
  showBannerCustom('✅ 已删除', true);
}

/** 拉取自定义提示词并渲染 */
async function loadCustom() {
  if (!dsh || !dsh.getCustomPrompts) return;
  try {
    const r = await dsh.getCustomPrompts();
    if (r && Array.isArray(r.items)) customData = r;
  } catch {
    customData = { categories: [], items: [] };
  }
  renderCustom();
}

// ---------------------------------------------------------------------------
// 新建/编辑弹窗
// ---------------------------------------------------------------------------

/** 打开弹窗：item 为空 = 新建；否则编辑（预填） */
function openModal(item) {
  editingId = (item && item.id) || null;
  el('modal-title').textContent = editingId ? '编辑提示词' : '新建提示词';
  el('f-name').value = (item && item.name) || '';
  el('f-content').value = (item && item.content) || '';
  el('f-hint').value = (item && item.hint) || '';
  el('f-cat-new').value = '';
  // 分类下拉：内置 6 类 + 自定义分类（去重、去内置重名）+「新建分类…」
  const known = new Set([...builtinCatNames(), ...customData.categories]);
  const options = Array.from(known).map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`);
  options.push('<option value="__new__">＋ 新建分类…</option>');
  el('f-cat').innerHTML = options.join('');
  el('f-cat').value = (item && item.cat && known.has(item.cat)) ? item.cat : (known.size > 0 ? Array.from(known)[0] : '__new__');
  el('f-cat-new').style.display = el('f-cat').value === '__new__' ? 'block' : 'none';
  el('modal-mask').classList.add('show');
  setTimeout(() => el('f-name').focus(), 30);
}

function closeModal() {
  el('modal-mask').classList.remove('show');
  editingId = null;
}

/** 保存（新增/更新） */
async function saveFromModal() {
  const name = el('f-name').value.trim();
  const content = el('f-content').value.trim();
  const hint = el('f-hint').value.trim();
  let cat = el('f-cat').value;
  const newCat = el('f-cat-new').value.trim();
  if (cat === '__new__') cat = newCat; // 选「新建分类…」→ 用输入的新分类名
  if (!cat) { showBannerCustom('请选择或填写分类', false); return; }
  if (!name) { showBannerCustom('请填写名称', false); return; }
  if (!content) { showBannerCustom('请填写内容', false); return; }
  if (!dsh || !dsh.saveCustomPrompt) { showBannerCustom('功能不可用', false); return; }
  const wasEdit = !!editingId;
  const res = await dsh.saveCustomPrompt({
    id: editingId || undefined, cat,
    name, content, hint,
  });
  if (res && res.ok) {
    closeModal();
    await loadCustom();
    showBannerCustom(wasEdit ? '✅ 已更新' : '✅ 已保存', true);
  } else {
    showBannerCustom('保存失败：' + (res && res.reason ? res.reason : '未知错误'), false);
  }
}

// ---------------------------------------------------------------------------
// Tab 切换 + 初始化
// ---------------------------------------------------------------------------

function switchTab(tab) {
  const builtin = tab === 'builtin';
  el('tab-builtin').classList.toggle('active', builtin);
  el('tab-custom').classList.toggle('active', !builtin);
  el('view-builtin').style.display = builtin ? 'flex' : 'none';
  el('view-custom').style.display = builtin ? 'none' : 'flex';
  if (!builtin) loadCustom();
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
  // v0.9.5：tab 切换
  el('tab-builtin').addEventListener('click', () => switchTab('builtin'));
  el('tab-custom').addEventListener('click', (e) => {
    if (e.target.closest('#btn-add-custom')) { openModal(); return; }
    switchTab('custom');
  });
  el('btn-add-custom').addEventListener('click', (e) => { e.stopPropagation(); openModal(); });
  // v0.9.6：自定义分组点击切换（事件委托，一次性绑定）
  el('custom-cats').addEventListener('click', (e) => {
    const catEl = e.target.closest('.cat');
    if (!catEl) return;
    customCat = catEl.dataset.cat;
    renderCustom();
  });
  // 弹窗
  el('btn-cancel').addEventListener('click', closeModal);
  el('btn-save').addEventListener('click', saveFromModal);
  el('modal-mask').addEventListener('click', (e) => { if (e.target === el('modal-mask')) closeModal(); });
  el('f-cat').addEventListener('change', () => {
    el('f-cat-new').style.display = el('f-cat').value === '__new__' ? 'block' : 'none';
    if (el('f-cat').value === '__new__') el('f-cat-new').focus();
  });
  // Esc 关闭弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el('modal-mask').classList.contains('show')) closeModal();
  });
}

init();
