'use strict';

/**
 * global-memory.js — 全局记忆窗口脚本（v0.9.12 左右分栏版）
 * 布局参考提示词库：左边选类别（基础设定 / 各 ## 记忆区块），右边编辑内容。
 *  - 基础设定 → 动态字段列表（可增删字段）；
 *  - 其他 ## 区块 → 标题可直接修改 + 长文本编辑（自动识别，格式原样保留）；
 *  - 「＋ 添加区块」在界面内新建（不用 prompt，沙箱渲染进程禁用）；
 *  - 保存调 saveGlobalMemory({ fields, sections })（覆盖确认弹窗在主进程）。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

const BASIC_KEY = '__basic__';
const SECTION_FULL = '基础设定（DSH-Desktop 图形化编辑）';
const DEFAULT_FIELDS = ['你的称呼', '你的身份/角色', '项目背景', '语言风格', '输出习惯', '常用约定'];
const VALUE_HINTS = {
  你的称呼: '例：老大 / 张三',
  你的身份角色: '例：技术总监 / 项目负责人',
  项目背景: '例：DSH-Desktop（Electron 套壳），团队 4 人',
  语言风格: '例：简洁、专业、中文回复',
  输出习惯: '例：代码带注释、结论先行',
  常用约定: '例：有改必升版本号；开发日志必写',
};
const VALUE_HINT_FALLBACK = '填写内容…';

let fields = [];   // 基础设定字段 [{name,value}]
let sections = []; // 其他 ## 区块 [{title, body}]
let activeKey = BASIC_KEY;
let filePath = '';
let bannerTimer = null;

function showBanner(text, ok) {
  const b = el('banner');
  b.textContent = text;
  b.className = 'banner show ' + (ok ? 'ok' : 'fail');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = 'banner'; }, 2600);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function valueHint(name) {
  const n = String(name || '').trim();
  return VALUE_HINTS[n] || VALUE_HINTS[n.replace(/\//g, '')] || VALUE_HINT_FALLBACK;
}

// ── 左侧类别列表 ──
function renderCats() {
  const cats = el('cats');
  let html = `<div class="cat ${activeKey === BASIC_KEY ? 'active' : ''}" data-key="${BASIC_KEY}">📋 基础设定<span class="tag">字段</span></div>`;
  html += sections.map((s) => {
    const key = secKey(s);
    return `<div class="cat ${activeKey === key ? 'active' : ''}" data-key="${escapeHtml(key)}"><span class="sec-title">## ${escapeHtml(s.title || '未命名')}</span></div>`;
  }).join('');
  html += '<div class="cat-add" id="btn-add-sec">＋ 添加区块</div>';
  cats.innerHTML = html;
  cats.querySelectorAll('.cat[data-key]').forEach((c) => {
    c.addEventListener('click', () => { activeKey = c.dataset.key; renderAll(); });
  });
  const addBtn = el('btn-add-sec');
  if (addBtn) addBtn.addEventListener('click', addSection);
}

/** 区块的唯一键（按标题；标题修改后重新计算） */
function secKey(s) {
  return 'sec:' + (s.title || '');
}

// ── 右侧内容 ──
function renderRight() {
  const head = el('right-head');
  const body = el('right-body');
  if (activeKey === BASIC_KEY) {
    head.innerHTML = '基础设定 <span class="tag">字段列表 · 可增删</span>';
    body.innerHTML = '<div class="fields" id="fields"></div>'
      + '<button id="btn-add-field" class="add-field">＋ 添加字段</button>';
    renderFields();
    el('btn-add-field').addEventListener('click', addField);
    return;
  }
  const idx = sections.findIndex((s) => secKey(s) === activeKey);
  if (idx < 0) { activeKey = BASIC_KEY; renderRight(); return; }
  const s = sections[idx];
  head.innerHTML = '记忆区块 <span class="tag">## 标题可改 · 长文本</span>';
  body.innerHTML = `
    <div class="sec-title-input">
      <span class="hash">##</span>
      <input id="sec-title" value="${escapeHtml(s.title)}" placeholder="区块标题（如：项目备忘）" />
    </div>
    <textarea id="sec-body" class="sec-body" rows="10" placeholder="此区块内容…">${escapeHtml(s.body)}</textarea>`;
  el('sec-title').addEventListener('input', (e) => {
    const t = e.target.value.trim();
    // 同步标题并更新左侧列表（保持选中）
    const old = s.title;
    s.title = t || old;
    renderCats();
    // 重新选中该区块
    activeKey = secKey(s);
    document.querySelectorAll('.cat[data-key]').forEach((c) => {
      c.classList.toggle('active', c.dataset.key === activeKey);
    });
  });
  el('sec-body').addEventListener('input', (e) => { s.body = e.target.value; });
}

function renderAll() {
  renderCats();
  renderRight();
}

function renderFields() {
  const wrap = el('fields');
  wrap.innerHTML = fields.map((it, i) => `
    <div class="row" data-i="${i}">
      <input class="f-name" placeholder="字段名（例：我的微信号）" value="${escapeHtml(it.name)}" />
      <textarea class="f-value" rows="1" placeholder="${escapeHtml(valueHint(it.name))}">${escapeHtml(it.value)}</textarea>
      <button class="del" title="删除这一条">✕</button>
    </div>`).join('');
  wrap.querySelectorAll('.row').forEach((row) => {
    const i = Number(row.dataset.i);
    const name = row.querySelector('.f-name');
    const value = row.querySelector('.f-value');
    name.addEventListener('input', () => {
      fields[i].name = name.value;
      const ph = valueHint(name.value);
      if (value.placeholder !== ph) value.placeholder = ph;
    });
    value.addEventListener('input', () => { fields[i].value = value.value; });
    row.querySelector('.del').addEventListener('click', () => {
      fields.splice(i, 1);
      renderFields();
    });
  });
}

function addField() {
  fields.push({ name: '', value: '' });
  renderFields();
  const rows = el('fields').querySelectorAll('.row');
  const last = rows[rows.length - 1];
  if (last) last.querySelector('.f-name').focus();
}

/** 「＋ 添加区块」：界面内新建（不用 prompt —— 沙箱渲染进程禁用 window.prompt） */
function addSection() {
  let name = '新区块';
  let i = 1;
  while (sections.some((s) => s.title === name)) { i++; name = `新区块${i}`; }
  sections.push({ title: name, body: '' });
  activeKey = secKey(sections[sections.length - 1]);
  renderAll();
  // 聚焦标题输入框，用户直接改名
  const t = el('sec-title');
  if (t) { t.focus(); t.select(); }
}

function collectPayload() {
  const cleanFields = fields
    .map((it) => ({ name: String(it.name || '').trim(), value: String(it.value || '').trim() }))
    .filter((it) => it.name !== '');
  // 标题去重（重复标题仅保留第一个，避免保存时覆盖）
  const seen = new Set();
  const cleanSections = sections
    .map((s) => ({ title: String(s.title || '').trim(), body: s.body }))
    .filter((s) => {
      if (!s.title || seen.has(s.title)) return false;
      seen.add(s.title);
      return true;
    });
  return { fields: cleanFields, sections: cleanSections };
}

/** 加载数据（init 与保存成功后共用，保存后刷新界面展示最新文件内容） */
async function loadData() {
  const data = await dsh.getGlobalMemory();
  filePath = (data && data.file) || '';
  const basic = data && data.sections.find((s) => s.title === SECTION_FULL);
  if (basic && Array.isArray(basic.items) && basic.items.length > 0) {
    fields = basic.items.map((it) => ({ name: it.name || '', value: it.value || '' }));
  } else {
    const defs = (data && Array.isArray(data.defaultFields)) ? data.defaultFields : DEFAULT_FIELDS;
    fields = defs.map((n) => ({ name: n, value: '' }));
  }
  sections = (data && Array.isArray(data.sections) ? data.sections : [])
    .filter((s) => s.title !== SECTION_FULL)
    .map((s) => ({ title: s.title, body: (s.body || []).join('\n') }));
  el('path').textContent = filePath;
}

async function init() {
  if (!dsh || !dsh.getGlobalMemory) return;
  try {
    await loadData();
  } catch {
    fields = DEFAULT_FIELDS.map((n) => ({ name: n, value: '' }));
    sections = [];
  }
  renderAll();

  el('btn-save').addEventListener('click', async () => {
    const payload = collectPayload();
    if (payload.fields.length === 0 && payload.sections.length === 0) {
      showBanner('没有可保存的内容（至少保留一个字段）', false);
      return;
    }
    const btn = el('btn-save');
    btn.disabled = true;
    btn.textContent = '保存中…';
    const res = await dsh.saveGlobalMemory(payload);
    btn.disabled = false;
    btn.textContent = '保存';
    if (res && res.ok) {
      // v0.9.12（老大反馈：保存没写入）：保存成功后重新加载，界面即展示最新文件内容
      try { await loadData(); renderAll(); } catch { /* ignore */ }
      showBanner('✅ 已保存（DSH 新会话自动生效）', true);
    } else if (res && res.reason === 'cancelled') {
      showBanner('已取消保存（未改动文件）', false);
    } else {
      showBanner('保存失败：' + ((res && res.message) || '未知错误'), false);
    }
  });
  el('btn-open-folder').addEventListener('click', () => {
    if (dsh && dsh.openGlobalMemoryFolder) dsh.openGlobalMemoryFolder();
  });
}

init();
