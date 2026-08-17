'use strict';

/**
 * global-memory.js — 全局记忆窗口脚本（v0.9.12 角色设定 + 前端确认版）
 * 布局参考提示词库：左边选类别（基础设定 / 各 ## 记忆区块），右边编辑内容。
 *  - 基础设定 → 两组动态字段列表：「你的信息」+「角色设定（DSH 扮演）」（均可增删）；
 *  - 其他 ## 区块 → 标题可直接修改 + 长文本编辑（自动识别，格式原样保留）；
 *  - 覆盖确认在**前端**（保存按钮二次确认）—— 主进程 dialog 在子窗口上会挂起
 *    导致"保存中"卡死，故确认逻辑移到前端；保存带 8s 超时兜底，绝不卡按钮。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

const BASIC_KEY = '__basic__';
const SECTION_FULL = '基础设定（DSH-Desktop 图形化编辑）';
const DEFAULT_FIELDS = ['你的称呼', '你的身份/角色', '项目背景', '语言风格', '输出习惯', '常用约定'];
const DEFAULT_ROLES = ['角色 1'];
const VALUE_HINTS = {
  你的称呼: '例：老大 / 张三',
  你的身份角色: '例：技术总监 / 项目负责人',
  项目背景: '例：DSH-Desktop（Electron 套壳），团队 4 人',
  语言风格: '例：简洁、专业、中文回复',
  输出习惯: '例：代码带注释、结论先行',
  常用约定: '例：有改必升版本号；开发日志必写',
};
const VALUE_HINT_FALLBACK = '填写内容…';
const SAVE_TIMEOUT_MS = 8000; // 保存超时兜底（任何挂起 8s 必恢复按钮）

let fields = [];       // 你的信息 [{name,value}]
let roleFields = [];   // 角色设定 [{name,value}]
let sections = [];     // 其他 ## 区块 [{title, body}]
let activeKey = BASIC_KEY;
let fileExists = false;
let filePath = '';
let bannerTimer = null;
let confirmTimer = null; // 保存二次确认计时

function showBanner(text, ok) {
  const b = el('banner');
  b.textContent = text;
  b.className = 'banner show ' + (ok ? 'ok' : 'fail');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = 'banner'; }, 3000);
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

function secKey(s) {
  return 'sec:' + (s.title || '');
}

// ── 右侧内容 ──
function renderRight() {
  const head = el('right-head');
  const body = el('right-body');
  if (activeKey === BASIC_KEY) {
    head.innerHTML = '基础设定 <span class="tag">你的信息 + 角色设定 · 可增删</span>';
    body.innerHTML = `
      <div class="group-label">你的信息</div>
      <div class="fields" id="fields"></div>
      <button id="btn-add-field" class="add-field">＋ 添加字段</button>
      <div class="group-label role">角色设定（DSH 扮演）</div>
      <div class="fields" id="role-fields"></div>
      <button id="btn-add-role" class="add-field">＋ 添加角色</button>`;
    renderFields();
    renderRoleFields();
    el('btn-add-field').addEventListener('click', () => addRow(fields, renderFields));
    el('btn-add-role').addEventListener('click', () => addRow(roleFields, renderRoleFields));
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
    const old = s.title;
    s.title = t || old;
    renderCats();
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

/** 通用字段行渲染（listElId：容器 id；arr：数据数组） */
function renderRows(listElId, arr) {
  const wrap = el(listElId);
  wrap.innerHTML = arr.map((it, i) => `
    <div class="row" data-i="${i}">
      <input class="f-name" placeholder="字段名" value="${escapeHtml(it.name)}" />
      <textarea class="f-value" rows="1" placeholder="${escapeHtml(valueHint(it.name))}">${escapeHtml(it.value)}</textarea>
      <button class="del" title="删除这一条">✕</button>
    </div>`).join('');
  wrap.querySelectorAll('.row').forEach((row) => {
    const i = Number(row.dataset.i);
    const name = row.querySelector('.f-name');
    const value = row.querySelector('.f-value');
    name.addEventListener('input', () => {
      arr[i].name = name.value;
      const ph = valueHint(name.value);
      if (value.placeholder !== ph) value.placeholder = ph;
    });
    value.addEventListener('input', () => { arr[i].value = value.value; });
    row.querySelector('.del').addEventListener('click', () => {
      arr.splice(i, 1);
      renderRows(listElId, arr);
    });
  });
}

function renderFields() { renderRows('fields', fields); }
function renderRoleFields() { renderRows('role-fields', roleFields); }

function addRow(arr, renderFn) {
  arr.push({ name: '', value: '' });
  renderFn();
}

/** 「＋ 添加区块」：界面内新建（不用 prompt —— 沙箱渲染进程禁用 window.prompt） */
function addSection() {
  let name = '新区块';
  let i = 1;
  while (sections.some((s) => s.title === name)) { i++; name = `新区块${i}`; }
  sections.push({ title: name, body: '' });
  activeKey = secKey(sections[sections.length - 1]);
  renderAll();
  const t = el('sec-title');
  if (t) { t.focus(); t.select(); }
}

function collectPayload() {
  const clean = (arr) => arr
    .map((it) => ({ name: String(it.name || '').trim(), value: String(it.value || '').trim() }))
    .filter((it) => it.name !== '');
  const seen = new Set();
  const cleanSections = sections
    .map((s) => ({ title: String(s.title || '').trim(), body: s.body }))
    .filter((s) => {
      if (!s.title || seen.has(s.title)) return false;
      seen.add(s.title);
      return true;
    });
  return { fields: clean(fields), roles: clean(roleFields), sections: cleanSections };
}

/** 保存（覆盖确认在前端：文件已存在 → 按钮二次确认；首次直接保存） */
async function doSave() {
  const payload = collectPayload();
  if (payload.fields.length === 0 && payload.roles.length === 0 && payload.sections.length === 0) {
    showBanner('没有可保存的内容（至少保留一个字段）', false);
    return;
  }
  const btn = el('btn-save');
  btn.disabled = true;
  btn.textContent = '保存中…';
  let res;
  try {
    res = await Promise.race([
      dsh.saveGlobalMemory(payload),
      new Promise((resolve) => setTimeout(() => resolve({ ok: false, message: '保存超时，请重试' }), SAVE_TIMEOUT_MS)),
    ]);
  } catch (err) {
    res = { ok: false, message: String((err && err.message) || err || '内部错误') };
  }
  btn.disabled = false;
  btn.textContent = '保存';
  if (res && res.ok) {
    try { await loadData(); renderAll(); } catch { /* ignore */ }
    showBanner('✅ 已保存（DSH 新会话自动生效）', true);
  } else if (res && res.reason === 'cancelled') {
    showBanner('已取消保存（未改动文件）', false);
  } else {
    showBanner('保存失败：' + ((res && res.message) || '未知错误'), false);
  }
}

function onSaveClick() {
  // 文件已存在 → 二次确认（避免误覆盖）
  if (fileExists && !el('btn-save').dataset.confirm) {
    const btn = el('btn-save');
    btn.dataset.confirm = '1';
    btn.textContent = '⚠ 确认保存？';
    showBanner('将覆盖 ~/.dsh/AGENTS.md 已有内容，再次点击确认保存', false);
    clearTimeout(confirmTimer);
    confirmTimer = setTimeout(resetSaveBtn, 3000);
    return;
  }
  resetSaveBtn();
  doSave();
}

function resetSaveBtn() {
  const btn = el('btn-save');
  btn.dataset.confirm = '';
  btn.textContent = '保存';
  clearTimeout(confirmTimer);
}

async function loadData() {
  const data = await dsh.getGlobalMemory();
  filePath = (data && data.file) || '';
  fileExists = !!(data && data.exists);
  const basic = data && data.sections.find((s) => s.title === SECTION_FULL);
  if (basic && Array.isArray(basic.items) && basic.items.length > 0) {
    fields = basic.items.map((it) => ({ name: it.name || '', value: it.value || '' }));
  } else {
    const defs = (data && Array.isArray(data.defaultFields)) ? data.defaultFields : DEFAULT_FIELDS;
    fields = defs.map((n) => ({ name: n, value: '' }));
  }
  if (basic && Array.isArray(basic.roleItems) && basic.roleItems.length > 0) {
    roleFields = basic.roleItems.map((it) => ({ name: it.name || '', value: it.value || '' }));
  } else {
    const defs = (data && Array.isArray(data.defaultRoles)) ? data.defaultRoles : DEFAULT_ROLES;
    roleFields = defs.map((n) => ({ name: n, value: '' }));
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
    roleFields = DEFAULT_ROLES.map((n) => ({ name: n, value: '' }));
    sections = [];
  }
  renderAll();
  el('btn-save').addEventListener('click', onSaveClick);
  el('btn-open-folder').addEventListener('click', () => {
    if (dsh && dsh.openGlobalMemoryFolder) dsh.openGlobalMemoryFolder();
  });
}

init();
