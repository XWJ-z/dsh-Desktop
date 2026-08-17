'use strict';

/**
 * global-memory.js — 全局记忆窗口脚本（v0.9.12 用户/DSH 独立区块版）
 * 布局参考提示词库：左边选类别（用户设定 / DSH 设定 / 各 ## 记忆区块），右边编辑内容。
 *  - 用户设定 / DSH 设定 是两个独立顶层区块（老大指令：删除"基础设定"容器），字段列表可增删；
 *  - 其他 ## 区块 → 标题可直接修改 + 长文本编辑（自动识别，格式原样保留）；
 *  - 覆盖确认在**前端**（保存按钮二次确认）+ 8s 超时兜底；保存后可选让 DSH 整理记忆。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

// v0.9.13（老大方案）：用户设定 / 我的设定 / DSH 角色 三个独立顶层区块（DSH 视角）
const USERS_KEY = '__users__';
const DSH_KEY = '__dsh__';
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
let roleFields = [];   // DSH 角色 [{name,value}]（新对话时选择）
let activeRole = 0;    // v1.0.1（老大指令）：DSH 角色页顶部 tab 当前选中
let sections = [];     // 其他 ## 区块 [{title, body}]
let activeKey = USERS_KEY;
let fileExists = false;
let filePath = '';
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

// ── 左侧类别列表 ──
function renderCats() {
  const cats = el('cats');
  let html = `<div class="cat ${activeKey === USERS_KEY ? 'active' : ''}" data-key="${USERS_KEY}">👤 用户设定<span class="tag">字段</span></div>`;
  html += `<div class="cat ${activeKey === DSH_KEY ? 'active' : ''}" data-key="${DSH_KEY}">🤖 我的设定<span class="tag">字段</span></div>`;
  html += `<div class="cat ${activeKey === ROLES_KEY ? 'active' : ''}" data-key="${ROLES_KEY}">🎭 DSH 角色<span class="tag">双击切换</span></div>`;
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
  if (activeKey === ROLES_KEY) {
    // v1.0.1（老大指令）：顶部 tab 选角色（角色1/2/3/＋添加角色），下方全是输入位置（角色名 + 定位/详细记忆），不再拥挤
    head.innerHTML = 'DSH 角色 <span class="tag">顶部选择 · 下方输入 · 可增删</span>';
    body.innerHTML = `
      <div class="guide-tip">💡 每个角色保存后自动建立角色文件（~/.dsh/roles/）；「我的设定 → 默认角色」选默认角色；双击 DSH 输入框可随时切换角色。</div>
      <div class="role-tabs" id="role-tabs"></div>
      <div class="role-edit">
        <div class="role-edit-name"><span>角色名</span><input id="role-name" placeholder="如：学习导师" /></div>
        <textarea id="role-body" class="sec-body" rows="12" placeholder="角色定位 / 详细记忆（保存后写入 ~/.dsh/roles/ 角色文件，DSH 切到此角色时按此扮演）…"></textarea>
      </div>`;
    renderRoleTabs();
    renderRoleEdit();
    return;
  }
  const idx = sections.findIndex((s) => secKey(s) === activeKey);
  if (idx < 0) { activeKey = USERS_KEY; renderRight(); return; }
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

/** 通用字段行渲染（listElId：容器 id；arr：数据数组）。
 *  v0.9.13：「默认角色」字段渲染为下拉选择（选项 = DSH 角色区块的角色名）。 */
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
      <button class="del" title="删除这一条">✕</button>
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
    row.querySelector('.del').addEventListener('click', () => {
      arr.splice(i, 1);
      renderRows(listElId, arr);
    });
  });
}

function renderFields() { renderRows('fields', userFields); }
function renderDshFields() { renderRows('dsh-fields', dshFields); }

// ── v1.0.1（老大指令）：DSH 角色页 = 顶部 tab 选择角色 + 下方大输入区（不拥挤）──
function renderRoleTabs() {
  const tabs = el('role-tabs');
  if (!tabs) return;
  tabs.innerHTML = roleFields.map((r, i) => `
    <div class="role-tab ${i === activeRole ? 'active' : ''}" data-i="${i}" title="点击选择此角色">
      <span class="rt-name">${escapeHtml(r.name || '未命名')}</span>
      <button class="rt-del" data-i="${i}" title="删除此角色">✕</button>
    </div>`).join('')
    + `<button class="role-add" id="btn-add-role">＋ 添加角色</button>`;
  tabs.querySelectorAll('.role-tab').forEach((t) => {
    const i = Number(t.dataset.i);
    t.addEventListener('click', (e) => {
      if (e.target.closest('.rt-del')) return; // 删除按钮单独处理
      activeRole = i;
      renderRoleTabs();
      renderRoleEdit();
    });
  });
  tabs.querySelectorAll('.rt-del').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      roleFields.splice(Number(b.dataset.i), 1);
      if (activeRole >= roleFields.length) activeRole = Math.max(0, roleFields.length - 1);
      renderRoleTabs();
      renderRoleEdit();
    });
  });
  const add = el('btn-add-role');
  if (add) add.addEventListener('click', addRole);
}

function addRole() {
  let n = `角色 ${roleFields.length + 1}`;
  let i = 1;
  while (roleFields.some((r) => r.name === n)) { i++; n = `角色 ${i}`; }
  roleFields.push({ name: n, value: '' });
  activeRole = roleFields.length - 1;
  renderRoleTabs();
  renderRoleEdit();
  const ni = el('role-name');
  if (ni) { ni.focus(); ni.select(); }
}

function renderRoleEdit() {
  const r = roleFields[activeRole];
  const nameEl = el('role-name');
  const bodyEl = el('role-body');
  if (!nameEl || !bodyEl) return;
  if (!r) { nameEl.value = ''; bodyEl.value = ''; nameEl.disabled = true; bodyEl.disabled = true; return; }
  nameEl.disabled = false;
  bodyEl.disabled = false;
  nameEl.value = r.name || '';
  bodyEl.value = r.value || '';
  nameEl.oninput = () => { r.name = nameEl.value; renderRoleTabs(); };
  bodyEl.oninput = () => { r.value = bodyEl.value; };
}

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
  return { users: clean(userFields), dsh: clean(dshFields), roles: clean(roleFields), sections: cleanSections };
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
    roleFields = rolesSec.fields.map((it) => ({ name: it.name || '', value: it.value || '' }));
  } else {
    const defs = (data && Array.isArray(data.defaultRoles)) ? data.defaultRoles : DEFAULT_ROLES;
    roleFields = defs.map((n) => ({ name: n, value: '' }));
  }
  guidePending = !!(usersSec && usersSec.guide);
  sections = list
    .filter((s) => s.kind === 'long')
    .map((s) => ({ title: s.title, body: (s.body || []).join('\n') }));
  // v1.0.1（老大指令）：左下角显示 记忆文件 + 角色文件 两个路径
  el('path-memory').textContent = filePath;
  el('path-roles').textContent = (data && data.rolesDir) || '';
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
  // 保存后整理记忆确认条
  const tidyYes = el('tidy-yes');
  const tidyNo = el('tidy-no');
  if (tidyYes) tidyYes.addEventListener('click', onTidy);
  if (tidyNo) tidyNo.addEventListener('click', hideTidyBar);
}

init();
