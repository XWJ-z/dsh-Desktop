'use strict';

/**
 * global-memory.js — 全局记忆窗口脚本（v1.0.2 四区块版）
 * 布局：左侧固定 4 个类别（老大指令 2026-08-18）——
 *  👤 用户设定 / 🤖 我的设定 / 🧠 全局记忆区块 / 🎭 DSH 角色
 *  - 用户设定 / 我的设定：字段列表可增删（默认角色为下拉选择）；
 *  - 全局记忆区块：合并展示所有 `## xxxx` 其他区块（卡片列表，标题可改 + 长文本可折叠）；
 *  - DSH 角色：卡片列表式 —— 每个角色一张卡（角色名 + 角色 .md 文件全文大输入框），
 *    与 ~/.dsh/roles/ 文件双向同步（v1.0.2 老大反馈 5②）；
 *  - 窗口聚焦时对比 AGENTS.md + 角色文件 变更指纹（signature）→ 自动重新加载（外部修改立即同步，v1.0.2b）；
 *  - 覆盖确认在前端（二次确认）+ 8s 超时兜底；保存后可选让 DSH 整理记忆。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

const USERS_KEY = '__users__';
const DSH_KEY = '__dsh__';
const MEMO_KEY = '__memo__';    // v1.0.2（老大指令 2）：全局记忆区块（合并所有 ## 区块）
const ROLES_KEY = '__roles__';
const DEFAULT_FIELDS = ['用户的称呼', '用户的身份/角色', '当前项目', '常用约定'];
const DEFAULT_DSH_FIELDS = ['我的名字', '语气风格', '输出习惯', '默认角色'];
const DEFAULT_ROLES = ['角色 1', '角色 2', '角色 3'];
const VALUE_HINTS = {
  用户的称呼: '例：老大 / 张三',
  用户的身份角色: '例：技术总监 / 项目负责人',
  当前项目: '例：DSH-Desktop（Electron 套壳）',
  常用约定: '例：有改必升版本号；开发日志必写',
  我的名字: '例：小鲸鱼',
  语气风格: '例：专业、简洁、中文',
  输出习惯: '例：代码带注释、结论先行',
  默认角色: '下拉选择：本次对话默认使用的角色',
  '角色 1': '角色定位（文件：~/.dsh/roles/角色 1.md）',
  '角色 2': '角色定位（文件：~/.dsh/roles/角色 2.md）',
  '角色 3': '角色定位（文件：~/.dsh/roles/角色 3.md）',
};
const VALUE_HINT_FALLBACK = '填写内容…';
const TIDY_PROMPT = '整理你的全局记忆，不要改变原意'; // v0.9.12：保存后可选让 DSH 整理记忆
const SAVE_TIMEOUT_MS = 8000; // 保存超时兜底（任何挂起 8s 必恢复按钮）

let userFields = [];   // 用户设定 [{name,value}]
let dshFields = [];    // DSH 设定 [{name,value}]
let roleFields = [];   // DSH 角色 [{name, value: 角色 .md 全文, desc}]（v1.0.2：value=全文）
let sections = [];     // 其他 ## 区块 [{title, body}]（全局记忆区块类别下展示）
let activeKey = USERS_KEY;
let fileExists = false;
let filePath = '';
let fileSignature = ''; // v1.0.2b：AGENTS.md + 角色文件 变更指纹（聚焦自动刷新依据）
let guidePending = false; // 未配置引导标记（文件用户设定区有引导句）
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

// ── 左侧类别列表（v1.0.2 老大指令：4 个固定类别，全局记忆区块/DSH 角色不再各自展开）──
function renderCats() {
  const cats = el('cats');
  let html = `<div class="cat ${activeKey === USERS_KEY ? 'active' : ''}" data-key="${USERS_KEY}">👤 用户设定<span class="tag">字段</span></div>`;
  html += `<div class="cat ${activeKey === DSH_KEY ? 'active' : ''}" data-key="${DSH_KEY}">🤖 我的设定<span class="tag">字段</span></div>`;
  html += `<div class="cat ${activeKey === MEMO_KEY ? 'active' : ''}" data-key="${MEMO_KEY}">🧠 全局记忆区块<span class="tag">## 汇总</span></div>`;
  html += `<div class="cat ${activeKey === ROLES_KEY ? 'active' : ''}" data-key="${ROLES_KEY}">🎭 DSH 角色<span class="tag">文件同步</span></div>`;
  cats.innerHTML = html;
  cats.querySelectorAll('.cat[data-key]').forEach((c) => {
    c.addEventListener('click', () => { activeKey = c.dataset.key; renderAll(); });
  });
}

// ── 右侧内容 ──
function renderRight() {
  const head = el('right-head');
  const body = el('right-body');
  if (activeKey === USERS_KEY) {
    head.innerHTML = '用户设定 <span class="tag">关于你 · 可增删</span>';
    body.innerHTML = `
      ${guidePending ? '<div class="guide-tip">💡 检测到未配置引导句：DSH 第一次对话会主动引导你配置全局记忆，配置保存后该提示自动移除。</div>' : ''}
      <div class="fields" id="fields"></div>
      <button id="btn-add-field" class="add-field">＋ 添加字段</button>`;
    renderFields();
    el('btn-add-field').addEventListener('click', () => addRow(userFields, renderFields));
    return;
  }
  if (activeKey === DSH_KEY) {
    head.innerHTML = '我的设定 <span class="tag">DSH 的名字 / 语气 / 输出习惯 / 默认角色 · 可增删</span>';
    body.innerHTML = `
      <div class="fields" id="dsh-fields"></div>
      <button id="btn-add-dsh" class="add-field">＋ 添加 DSH 设定</button>`;
    renderDshFields();
    el('btn-add-dsh').addEventListener('click', () => addRow(dshFields, renderDshFields));
    return;
  }
  if (activeKey === MEMO_KEY) {
    // v1.0.2（老大指令 2）：所有 ## 区块合并到一个「全局记忆区块」类别，内部卡片列表
    head.innerHTML = '全局记忆区块 <span class="tag">## 标题可改 · 长文本 · 可折叠</span>';
    body.innerHTML = `
      <div class="guide-tip">💡 这里汇总 AGENTS.md 里除 用户设定 / 我的设定 / DSH 角色 外的全部 ## 区块，各自独立保存，内容格式原样保留。</div>
      <div class="memo-list" id="memo-list"></div>
      <button id="btn-add-sec" class="add-field">＋ 添加区块</button>`;
    renderMemoList();
    const addBtn = el('btn-add-sec');
    if (addBtn) addBtn.addEventListener('click', addSection);
    return;
  }
  if (activeKey === ROLES_KEY) {
    // v1.0.2（老大指令 3）：DSH 角色 = 卡片列表式（参考全局记忆区块），排在全局记忆区块后面
    head.innerHTML = 'DSH 角色 <span class="tag">每个角色一个文件 · 可增删</span>';
    body.innerHTML = `
      <div class="guide-tip">💡 每个角色的输入框 = 该角色文件（~/.dsh/roles/）全部内容，两边同步；「我的设定 → 默认角色」选默认角色；双击 DSH 输入框可随时切换角色。</div>
      <div class="role-cards" id="role-cards"></div>
      <button id="btn-add-role" class="add-field">＋ 添加角色</button>`;
    renderRoleCards();
    const addBtn = el('btn-add-role');
    if (addBtn) addBtn.addEventListener('click', addRole);
    return;
  }
  // 兼容旧 activeKey（sec:xxx）→ 回落到全局记忆区块
  activeKey = MEMO_KEY;
  renderRight();
}

function renderAll() {
  renderCats();
  renderRight();
}

/** 通用字段行渲染（listElId：容器 id；arr：数据数组）。
 *  v0.9.13：「默认角色」字段渲染为下拉选择（选项 = DSH 角色区块的角色名）。
 *  v1.0.2c（老大反馈）：「默认角色」字段**不可删除**（下拉是功能入口，误删后 DSH 没默认角色）。 */
function renderRows(listElId, arr) {
  const wrap = el(listElId);
  const roleNames = roleFields.map((r) => String(r.name || '').trim()).filter(Boolean);
  wrap.innerHTML = arr.map((it, i) => {
    const isRoleSelect = it.name === '默认角色';
    const valueCtrl = isRoleSelect
      ? `<select class="f-value f-select" data-i="${i}">
          <option value=""${!it.value ? ' selected' : ''}>（未设置）</option>
          ${roleNames.map((n) => `<option value="${escapeHtml(n)}"${it.value === n ? ' selected' : ''}>${escapeHtml(n)}</option>`).join('')}
        </select>`
      : `<textarea class="f-value" rows="1" placeholder="${escapeHtml(valueHint(it.name))}">${escapeHtml(it.value)}</textarea>`;
    return `
    <div class="row" data-i="${i}">
      <input class="f-name" placeholder="字段名" value="${escapeHtml(it.name)}" />
      ${valueCtrl}
      ${isRoleSelect ? '' : '<button class="del" title="删除这一条">✕</button>'}
    </div>`;
  }).join('');
  wrap.querySelectorAll('.row').forEach((row) => {
    const i = Number(row.dataset.i);
    const name = row.querySelector('.f-name');
    const value = row.querySelector('.f-value');
    name.addEventListener('input', () => {
      arr[i].name = name.value;
      const ph = valueHint(name.value);
      if (value.tagName === 'TEXTAREA' && value.placeholder !== ph) value.placeholder = ph;
    });
    if (value.tagName === 'SELECT') {
      value.addEventListener('change', () => { arr[i].value = value.value; });
    } else {
      value.addEventListener('input', () => { arr[i].value = value.value; });
    }
    const delBtn = row.querySelector('.del');
    if (delBtn) delBtn.addEventListener('click', () => {
      arr.splice(i, 1);
      renderRows(listElId, arr);
    });
  });
}

function renderFields() { renderRows('fields', userFields); }
function renderDshFields() { renderRows('dsh-fields', dshFields); }

// ── v1.0.2（老大指令 2）：全局记忆区块 —— 所有 ## 区块的卡片列表（可折叠）──
function renderMemoList() {
  const list = el('memo-list');
  if (!list) return;
  list.innerHTML = sections.map((s, i) => `
    <div class="memo-card" data-i="${i}">
      <div class="memo-head">
        <span class="hash">##</span>
        <input class="memo-title" value="${escapeHtml(s.title)}" placeholder="区块标题（如：项目备忘）" />
        <button class="fold" data-i="${i}" title="折叠/展开">${s.collapsed ? '▸' : '▾'}</button>
        <button class="del" data-i="${i}" title="删除此区块">✕</button>
      </div>
      <textarea class="memo-body sec-body" rows="4" placeholder="此区块内容…" ${s.collapsed ? 'style="display:none"' : ''}>${escapeHtml(s.body)}</textarea>
    </div>`).join('')
    + (sections.length === 0 ? '<div class="sec-empty">还没有 ## 区块 —— 点下方「＋ 添加区块」新建，或直接编辑保存后自动识别</div>' : '');
  list.querySelectorAll('.memo-title').forEach((t) => {
    const i = Number(t.closest('.memo-card').dataset.i);
    t.addEventListener('input', () => { sections[i].title = t.value; });
  });
  list.querySelectorAll('.memo-body').forEach((b) => {
    const i = Number(b.closest('.memo-card').dataset.i);
    b.addEventListener('input', () => { sections[i].body = b.value; });
  });
  list.querySelectorAll('.memo-card .fold').forEach((b) => {
    b.addEventListener('click', () => {
      const i = Number(b.closest('.memo-card').dataset.i);
      sections[i].collapsed = !sections[i].collapsed;
      renderMemoList();
    });
  });
  list.querySelectorAll('.memo-card .del').forEach((b) => {
    b.addEventListener('click', () => {
      sections.splice(Number(b.closest('.memo-card').dataset.i), 1);
      renderMemoList();
    });
  });
}

/** 「＋ 添加区块」：界面内新建（不用 prompt —— 沙箱渲染进程禁用 window.prompt） */
function addSection() {
  let name = '新区块';
  let i = 1;
  while (sections.some((s) => s.title === name)) { i++; name = `新区块${i}`; }
  sections.push({ title: name, body: '', collapsed: false });
  renderMemoList();
  const cards = document.querySelectorAll('.memo-card .memo-title');
  const t = cards[cards.length - 1];
  if (t) { t.focus(); t.select(); }
}

// ── v1.0.2（老大指令 3）：DSH 角色 —— 卡片列表式（每角色 = 角色名 + 文件全文大输入框）──
function renderRoleCards() {
  const list = el('role-cards');
  if (!list) return;
  list.innerHTML = roleFields.map((r, i) => `
    <div class="role-card" data-i="${i}">
      <div class="role-card-head">
        <span class="role-icon">🎭</span>
        <input class="role-card-name" value="${escapeHtml(r.name || '')}" placeholder="角色名（如：学习导师）" />
        <button class="del" data-i="${i}" title="删除此角色（同时删除 ~/.dsh/roles/ 角色文件）">✕</button>
      </div>
      <textarea class="role-card-body sec-body" rows="10" placeholder="角色文件全文（# 角色：… / ## 定位 / ## 详细记忆），保存后写入 ~/.dsh/roles/ 对应文件，两边同步…">${escapeHtml(r.value || '')}</textarea>
    </div>`).join('')
    + (roleFields.length === 0 ? '<div class="sec-empty">还没有角色 —— 点下方「＋ 添加角色」新建</div>' : '');
  list.querySelectorAll('.role-card-name').forEach((n) => {
    const i = Number(n.closest('.role-card').dataset.i);
    n.addEventListener('input', () => { roleFields[i].name = n.value; });
  });
  list.querySelectorAll('.role-card-body').forEach((b) => {
    const i = Number(b.closest('.role-card').dataset.i);
    b.addEventListener('input', () => { roleFields[i].value = b.value; });
  });
  list.querySelectorAll('.role-card .del').forEach((b) => {
    b.addEventListener('click', () => {
      roleFields.splice(Number(b.closest('.role-card').dataset.i), 1);
      renderRoleCards();
    });
  });
}

function addRole() {
  let n = `角色 ${roleFields.length + 1}`;
  let i = 1;
  while (roleFields.some((r) => r.name === n)) { i++; n = `角色 ${i}`; }
  roleFields.push({ name: n, value: '' });
  renderRoleCards();
  const cards = document.querySelectorAll('.role-card .role-card-name');
  const ni = cards[cards.length - 1];
  if (ni) { ni.focus(); ni.select(); }
}

function addRow(arr, renderFn) {
  arr.push({ name: '', value: '' });
  renderFn();
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
  // v1.0.2：角色 value = 角色 .md 全文（保留格式，不做 trim/换行替换）
  const cleanRoles = roleFields
    .map((it) => ({ name: String(it.name || '').trim(), value: String(it.value || '') }))
    .filter((it) => it.name !== '');
  return { users: clean(userFields), dsh: clean(dshFields), roles: cleanRoles, sections: cleanSections };
}

/** 保存（覆盖确认在前端：文件已存在 → 按钮二次确认；首次直接保存） */
async function doSave() {
  const payload = collectPayload();
  if (payload.users.length === 0 && payload.dsh.length === 0 && payload.sections.length === 0) {
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
    // v0.9.12（老大指令）：保存后询问是否让 DSH 整理记忆
    showTidyBar();
  } else if (res && res.reason === 'cancelled') {
    showBanner('已取消保存（未改动文件）', false);
  } else {
    showBanner('保存失败：' + ((res && res.message) || '未知错误'), false);
  }
}

/** 保存后询问是否让 DSH 整理全局记忆（注入提示词到 DSH 输入框） */
function showTidyBar() {
  const bar = el('tidy-bar');
  if (!bar) return;
  bar.classList.add('show');
  const ask = el('tidy-ask');
  if (ask) ask.textContent = '要不要让 DSH 整理一下你的全局记忆？（不影响原意）';
}

function hideTidyBar() {
  const bar = el('tidy-bar');
  if (bar) bar.classList.remove('show');
}

async function onTidy() {
  if (!dsh || !dsh.injectPrompt) { hideTidyBar(); return; }
  const res = await dsh.injectPrompt(TIDY_PROMPT);
  hideTidyBar();
  if (res && res.ok) {
    showBanner('已把「整理你的全局记忆」填入 DSH 输入框，发送即可', true);
  } else {
    showBanner('已复制整理提示词，到 DSH 输入框粘贴发送（Ctrl+V）', false);
    if (dsh.copyText) await dsh.copyText(TIDY_PROMPT);
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
  fileSignature = (data && data.signature) || ''; // v1.0.2b：AGENTS.md + 角色文件 变更指纹
  const list = (data && Array.isArray(data.sections)) ? data.sections : [];
  // 用户设定 / DSH 设定 / DSH 角色 三个独立顶层区块
  const usersSec = list.find((s) => s.kind === 'users');
  const dshSec = list.find((s) => s.kind === 'dsh');
  const rolesSec = list.find((s) => s.kind === 'roles');
  if (usersSec && Array.isArray(usersSec.fields) && usersSec.fields.length > 0) {
    userFields = usersSec.fields.map((it) => ({ name: it.name || '', value: it.value || '' }));
  } else {
    const defs = (data && Array.isArray(data.defaultFields)) ? data.defaultFields : DEFAULT_FIELDS;
    userFields = defs.map((n) => ({ name: n, value: '' }));
  }
  if (dshSec && Array.isArray(dshSec.fields) && dshSec.fields.length > 0) {
    dshFields = dshSec.fields.map((it) => ({ name: it.name || '', value: it.value || '' }));
  } else {
    const defs = (data && Array.isArray(data.defaultDshFields)) ? data.defaultDshFields : DEFAULT_DSH_FIELDS;
    dshFields = defs.map((n) => ({ name: n, value: '' }));
  }
  if (rolesSec && Array.isArray(rolesSec.fields) && rolesSec.fields.length > 0) {
    // v1.0.2：value = 角色 .md 全文（data() 已注入），desc = 定位
    roleFields = rolesSec.fields.map((it) => ({ name: it.name || '', value: it.value || '', desc: it.desc || '' }));
  } else {
    const defs = (data && Array.isArray(data.defaultRoles)) ? data.defaultRoles : DEFAULT_ROLES;
    roleFields = defs.map((n) => ({ name: n, value: '', desc: '' }));
  }
  guidePending = !!(usersSec && usersSec.guide);
  sections = list
    .filter((s) => s.kind === 'long')
    .map((s) => ({ title: s.title, body: (s.body || []).join('\n'), collapsed: false }));
  // v1.0.1（老大指令）：左下角不再显示双路径（按钮直达目录即可）
  el('path').textContent = filePath;
}

async function init() {
  if (!dsh || !dsh.getGlobalMemory) return;
  try {
    await loadData();
  } catch {
    userFields = DEFAULT_FIELDS.map((n) => ({ name: n, value: '' }));
    dshFields = DEFAULT_DSH_FIELDS.map((n) => ({ name: n, value: '' }));
    roleFields = DEFAULT_ROLES.map((n) => ({ name: n, value: '' }));
    sections = [];
  }
  renderAll();
  el('btn-save').addEventListener('click', onSaveClick);
  // v1.0.1（老大指令）：两个按钮 —— 记忆文件位置 / 角色文件位置
  el('btn-open-memory').addEventListener('click', () => {
    if (dsh && dsh.openGlobalMemoryFolder) dsh.openGlobalMemoryFolder();
  });
  el('btn-open-roles').addEventListener('click', () => {
    if (dsh && dsh.openGlobalMemoryRoles) dsh.openGlobalMemoryRoles();
  });
  // v1.0.2b（老大反馈 2026-08-18：改角色 .md 后需重开窗口才刷新）：聚焦时对比
  // AGENTS.md + 角色文件 变更指纹（signature），任何一处被外部修改都自动同步最新内容
  window.addEventListener('focus', async () => {
    try {
      const data = await dsh.getGlobalMemory();
      const s = (data && data.signature) || '';
      if (s && s !== fileSignature) {
        fileSignature = s;
        await loadData();
        renderAll();
        showBanner('检测到记忆文件已变更，已同步最新内容', true);
      }
    } catch { /* ignore */ }
  });
  // 保存后整理记忆确认条
  const tidyYes = el('tidy-yes');
  const tidyNo = el('tidy-no');
  if (tidyYes) tidyYes.addEventListener('click', onTidy);
  if (tidyNo) tidyNo.addEventListener('click', hideTidyBar);
}

init();
