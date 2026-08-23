'use strict';

/**
 * global-memory.js — 全局记忆窗口脚本（v1.0.2 四区块版）
 * 布局：左侧固定 4 个类别（用户指令 2026-08-18）——
 *  👤 用户设定 / 🤖 我的设定 / 🧠 全局记忆区块 / 🎭 DSH 角色
 *  - 用户设定 / 我的设定：字段列表可增删（默认角色为下拉选择）；
 *  - 全局记忆区块：合并展示所有 `## xxxx` 其他区块（卡片列表，标题可改 + 长文本可折叠）；
 *  - DSH 角色：卡片列表式 —— 每个角色一张卡（角色名 + 角色 .md 文件全文大输入框），
 *    与 ~/.dsh/roles/ 文件双向同步（v1.0.2 用户反馈 5②）；
 *  - 窗口聚焦时对比 AGENTS.md + 角色文件 变更指纹（signature）→ 自动重新加载（外部修改立即同步，v1.0.2b）；
 *  - 覆盖确认在前端（二次确认）+ 8s 超时兜底；保存后可选让 DSH 整理记忆。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

const USERS_KEY = '__users__';
const DSH_KEY = '__dsh__';
const MEMO_KEY = '__memo__';    // v1.0.2（用户指令 2）：全局记忆区块（合并所有 ## 区块）
const ROLES_KEY = '__roles__';
const DEFAULT_FIELDS = ['称呼', '身份/角色', '当前项目 1', '当前项目 2'];
const DEFAULT_DSH_FIELDS = ['名字', '语气风格', '输出习惯', '默认角色'];
const DEFAULT_ROLES = ['日常助理', '嵌入式开发工程师', '全栈工程师'];
const VALUE_HINTS = {
  称呼: '例：老大 / 张三',
  '身份/角色': '例：嵌入式开发教学、windows 应用开发师',
  '当前项目 1': '例：stm32入门PCB（适配江协）→ D:\\...',
  '当前项目 2': '例：DSH-Desktop（主项目）→ D:\\...',
  名字: '例：开发助手-6（小名：小六）',
  语气风格: '例：专业、简洁、中文',
  输出习惯: '例：代码带注释、结论先行',
  默认角色: '下拉选择：本次对话默认使用的角色',
  日常助理: '协助处理日常工作任务',
  嵌入式开发工程师: 'stm32 单片机开发（软件 + 硬件 + 教学）',
  全栈工程师: 'windows、fnos、安卓、鸿蒙软件开发',
};
const VALUE_HINT_FALLBACK = '填写内容…';
const TIDY_PROMPT = '整理你的全局记忆，不要改变原意'; // v0.9.12：保存后可选让 DSH 整理记忆
const SAVE_TIMEOUT_MS = 8000; // 保存超时兜底（任何挂起 8s 必恢复按钮）

let userFields = [];   // 用户设定 [{name,value}]
let dshFields = [];    // DSH 设定 [{name,value}]
let roleFields = [];   // DSH 角色 [{name, desc: 定位, memory: 详细记忆+其他}]（v1.0.3：字段输入化）
let sections = [];     // 其他 ## 区块 [{title, body}]（全局记忆区块类别下展示）
let activeKey = USERS_KEY;
let nextSectionNum = null; // v1.2.3（用户指令 4）：新区块自动编号基准（loadData 按所有 ## 标题算出）
let fileExists = false;
let filePath = '';
let fileSignature = ''; // v1.0.2b：AGENTS.md + 角色文件 变更指纹（聚焦自动刷新依据）
let fileCorrupt = false; // v1.0.5（用户反馈 4）：记忆文件解析异常 → 显示一键恢复条
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

/** v1.0.5（用户反馈 4）：解析异常恢复条显隐 */
function updateCorruptBar() {
  const bar = el('corrupt-bar');
  if (bar) bar.classList.toggle('show', !!fileCorrupt);
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

// ── 左侧类别列表（v1.0.2 用户指令：4 个固定类别，全局记忆区块/DSH 角色不再各自展开）──
function renderCats() {
  const cats = el('cats');
  let html = `<div class="cat ${activeKey === USERS_KEY ? 'active' : ''}" data-key="${USERS_KEY}">👤 用户设定<span class="tag">字段</span></div>`;
  html += `<div class="cat ${activeKey === DSH_KEY ? 'active' : ''}" data-key="${DSH_KEY}">🤖 我的设定<span class="tag">字段</span></div>`;
  html += `<div class="cat ${activeKey === ROLES_KEY ? 'active' : ''}" data-key="${ROLES_KEY}">🎭 DSH 角色<span class="tag">文件同步</span></div>`;
  html += `<div class="cat ${activeKey === MEMO_KEY ? 'active' : ''}" data-key="${MEMO_KEY}">🧠 全局记忆区块<span class="tag">## 汇总</span></div>`;
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
    // v1.2.3（用户指令）：所有 ## 区块合并到一个「全局记忆区块」类别，左侧列表 + 右侧编辑（对齐 DSH 角色）
    head.innerHTML = '全局记忆区块 <span class="tag">## 标题可改 · 长文本 · 可编辑</span>';
    body.innerHTML = `
      <div class="guide-tip">💡 这里汇总 AGENTS.md 里除 用户设定 / 我的设定 / DSH 角色 外的全部 ## 区块，各自独立保存，内容格式原样保留。</div>
      <div class="memo-layout">
        <div class="memo-list" id="memo-list"></div>
        <div class="memo-editor" id="memo-editor"></div>
      </div>
      <div class="memo-addbar">
        <button id="btn-add-sub-sec" class="add-field add-sec-btn add-sec-sub" title="给左侧选中的区块添加一个 ### 子区块">＋ 添加子区块</button>
        <button id="btn-add-sec" class="add-field add-sec-btn" title="新建一个 ## 区块">＋ 添加区块</button>
      </div>`;
    renderMemoList();
    const addBtn = el('btn-add-sec');
    if (addBtn) addBtn.addEventListener('click', addSection);
    // v1.2.3（用户指令）：「＋ 添加子区块」—— 给当前选中的区块添加子区块
    const addSubBtn = el('btn-add-sub-sec');
    if (addSubBtn) addSubBtn.addEventListener('click', addSub);
    return;
  }
  if (activeKey === ROLES_KEY) {
    // v1.0.2（用户指令 3）：DSH 角色 = 卡片列表式
    // v1.0.3（用户反馈 2）：改为「左侧角色列表 + 右侧点击进入编辑」—— 角色名 ≤30 字符
    head.innerHTML = 'DSH 角色 <span class="tag">点击角色进入编辑 · 可增删</span>';
    body.innerHTML = `
      <div class="guide-tip">💡 点击左侧角色进入编辑；「我的设定 → 默认角色」选默认角色；双击 DSH 输入框可随时切换角色。</div>
      <div class="role-layout">
        <div class="role-list" id="role-list"></div>
        <div class="role-editor" id="role-editor"></div>
      </div>
      <button id="btn-add-role" class="add-field">＋ 添加角色</button>`;
    renderRoleList();
    renderRoleEditor();
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
 *  v1.0.2c（用户反馈）：「默认角色」字段**不可删除**（下拉是功能入口，误删后 DSH 没默认角色）。 */
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

// ── v1.2.3（用户指令）：全局记忆区块 —— 左侧层级列表（## 组头 + 缩进 ### 子项）+ 右侧编辑 ──
let selectedSectionIndex = -1; // 当前编辑的区块下标（-1 = 无）
let selectedSubIndex = -1;     // 当前编辑的子区块下标（-1 = 区块级/前言；>=0 = ### 子区块）
function renderMemoList() {
  const list = el('memo-list');
  if (!list) return;
  // 选中下标越界时回落到最后一个；无区块则置 -1
  if (sections.length === 0) { selectedSectionIndex = -1; selectedSubIndex = -1; }
  else if (selectedSectionIndex < 0 || selectedSectionIndex >= sections.length) { selectedSectionIndex = sections.length - 1; selectedSubIndex = -1; }
  const hasSubs = (s) => Array.isArray(s.subs) && s.subs.length > 0;
  list.innerHTML = sections.map((s, i) => {
    if (!hasSubs(s)) {
      // 无子区块 → 普通项（编辑 ## 标题 + 内容）
      return `<div class="memo-item${i === selectedSectionIndex && selectedSubIndex === -1 ? ' active' : ''}" data-i="${i}" title="点击编辑此区块">
        <span class="memo-item-icon">##</span>
        <span class="memo-item-name">${escapeHtml(s.title || '（未命名）')}</span>
        <button class="del" data-i="${i}" title="删除此区块">✕</button>
      </div>`;
    }
    // 有子区块 → ## 组头 + 缩进 ### 子项
    const group = `<div class="memo-group${i === selectedSectionIndex && selectedSubIndex === -1 ? ' active' : ''}" data-i="${i}" title="点击编辑此区块标题/前言">
      <span class="memo-item-icon">##</span>
      <span class="memo-group-name">${escapeHtml(s.title || '（未命名）')}</span>
      <button class="del" data-i="${i}" title="删除此区块（含子区块）">✕</button>
    </div>`;
    const subs = s.subs.map((sb, j) => `
      <div class="memo-sub${i === selectedSectionIndex && selectedSubIndex === j ? ' active' : ''}" data-i="${i}" data-j="${j}" title="点击编辑此子区块">
        <span class="memo-item-icon memo-sub-icon">###</span>
        <span class="memo-sub-name">${escapeHtml(sb.title || '（未命名）')}</span>
        <button class="del" data-i="${i}" data-j="${j}" title="删除此子区块">✕</button>
      </div>`).join('');
    return group + subs;
  }).join('')
    + (sections.length === 0 ? '<div class="sec-empty">还没有 ## 区块 —— 点下方「＋ 添加区块」新建，或直接编辑保存后自动识别</div>' : '');
  list.querySelectorAll('.memo-item, .memo-group').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.del')) return;
      selectedSectionIndex = Number(row.dataset.i);
      selectedSubIndex = -1;
      renderMemoList();
    });
  });
  list.querySelectorAll('.memo-sub').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.del')) return;
      selectedSectionIndex = Number(row.dataset.i);
      selectedSubIndex = Number(row.dataset.j);
      renderMemoList();
    });
  });
  list.querySelectorAll('.memo-item .del, .memo-group .del').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sections.splice(Number(b.closest('[data-i]').dataset.i), 1);
      selectedSubIndex = -1;
      renderMemoList();
    });
  });
  list.querySelectorAll('.memo-sub .del').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = Number(b.dataset.i);
      const j = Number(b.dataset.j);
      const sec = sections[i];
      if (sec && Array.isArray(sec.subs)) sec.subs.splice(j, 1);
      if (selectedSubIndex >= (sec.subs ? sec.subs.length : 0)) selectedSubIndex = -1;
      renderMemoList();
    });
  });
  renderMemoEditor();
}

/** 右侧编辑面板：区块级（## 标题 + 前言）或子区块级（### 标题 + 内容） */
function renderMemoEditor() {
  const ed = el('memo-editor');
  if (!ed) return;
  const s = sections[selectedSectionIndex];
  if (!s) {
    ed.innerHTML = '<div class="sec-empty">点击左侧区块进入编辑，或「＋ 添加区块」新建</div>';
    return;
  }
  if (selectedSubIndex >= 0) {
    const sb = s.subs && s.subs[selectedSubIndex];
    if (!sb) { ed.innerHTML = '<div class="sec-empty">该子区块不存在</div>'; return; }
    ed.innerHTML = `
      <div class="memo-editor-head">
        <span class="hash">###</span>
        <input class="memo-editor-title" value="${escapeHtml(sb.title)}" placeholder="子区块标题（如：4.1 日常对话）" />
        <button class="del" title="删除此子区块">✕</button>
      </div>
      <div class="memo-editor-field">
        <div class="memo-editor-label">子区块内容<span class="hint">（长文本 · 格式原样保留）</span></div>
        <textarea class="memo-editor-body" rows="10" placeholder="此子区块内容…">${escapeHtml(sb.body)}</textarea>
      </div>`;
    const title = ed.querySelector('.memo-editor-title');
    title.addEventListener('input', () => {
      s.subs[selectedSubIndex].title = title.value;
      const item = document.querySelector(`.memo-sub[data-i="${selectedSectionIndex}"][data-j="${selectedSubIndex}"] .memo-sub-name`);
      if (item) item.textContent = title.value || '（未命名）';
    });
    ed.querySelector('.memo-editor .del').addEventListener('click', () => {
      s.subs.splice(selectedSubIndex, 1);
      selectedSubIndex = -1;
      renderMemoList();
    });
    ed.querySelector('.memo-editor-body').addEventListener('input', (e) => { s.subs[selectedSubIndex].body = e.target.value; });
    return;
  }
  // 区块级：## 标题 + 前言内容；已含子区块时提供「＋ 添加子区块」
  const hasSubs = Array.isArray(s.subs) && s.subs.length > 0;
  const hasIntro = String(s.body || '').trim() !== '';
  // 区块内容（前言）：有子区块且前言为空时不再展示空占位框（如「## 四」这种内容全在 ### 子区块的）；
  // 有子区块且有前言时，标签右侧提供「✕ 删除前言」（只删前言、不删子区块）。
  let introField = '';
  if (!hasSubs || hasIntro) {
    introField = `
    <div class="memo-editor-field">
      <div class="memo-editor-label${hasSubs ? ' with-del' : ''}">区块内容<span class="hint">（长文本 · 格式原样保留）</span>${hasSubs ? '<button class="del intro-del" title="删除此区块的前言内容">✕</button>' : ''}</div>
      <textarea class="memo-editor-body${hasSubs ? ' compact' : ''}" rows="10" placeholder="此区块内容…">${escapeHtml(s.body)}</textarea>
    </div>`;
  }
  // v1.2.3（用户指令 2）：「＋ 添加子区块」放到子区块内容汇总之后、更醒目的全宽按钮（不再被前言框遮挡）
  const addSubBtn = '<button id="btn-add-sub" class="add-field add-sub-btn">＋ 添加子区块</button>';
  // v1.2.3（用户修复）：该 ## 下所有 ### 子区块内容汇总（只读预览；编辑请在左侧点 ### 子项）——
  // 解决「点 ## 组头显示空白」。# # 本身可能没有前言，内容都收在 ### 子区块里。
  const subPreview = hasSubs ? `
    <div class="memo-sub-preview">
      <div class="memo-editor-label">本区块全部内容<span class="hint">（只读汇总 · 编辑请在左侧点 ### 子项）</span></div>
      ${s.subs.map((sb, j) => `
        <div class="memo-sub-preview-item">
          <div class="memo-sub-preview-head"><span class="hash">###</span>${escapeHtml(sb.title || '（未命名）')}</div>
          <pre class="memo-sub-preview-body">${escapeHtml(sb.body || '')}</pre>
        </div>`).join('')}
    </div>` : '';
  ed.innerHTML = `
    <div class="memo-editor-head">
      <span class="hash">##</span>
      <input class="memo-editor-title" value="${escapeHtml(s.title)}" placeholder="区块标题（如：项目备忘）" />
      <button class="del" title="删除此区块">✕</button>
    </div>${introField}${subPreview}${addSubBtn}`;
  const title = ed.querySelector('.memo-editor-title');
  title.addEventListener('input', () => {
    s.title = title.value;
    const item = document.querySelector(`.memo-item[data-i="${selectedSectionIndex}"] .memo-item-name, .memo-group[data-i="${selectedSectionIndex}"] .memo-group-name`);
    if (item) item.textContent = title.value || '（未命名）';
  });
  ed.querySelector('.memo-editor-head .del').addEventListener('click', () => { sections.splice(selectedSectionIndex, 1); selectedSubIndex = -1; renderMemoList(); });
  const introDel = ed.querySelector('.intro-del');
  if (introDel) introDel.addEventListener('click', () => { s.body = ''; renderMemoList(); });
  const introBody = ed.querySelector('.memo-editor-body');
  if (introBody) introBody.addEventListener('input', (e) => { s.body = e.target.value; });
  const addSubBtnEl = el('btn-add-sub');
  if (addSubBtnEl) addSubBtnEl.addEventListener('click', addSub);
}

// ── v1.2.3（用户指令 3/4）：新区块 / 子区块自动编号 ──
const CN_NUMS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
/** 1..99 → 中文数字（一…九 / 十 / 十一… / 二十… / 九十九） */
function cnNum(n) {
  const x = Math.floor(Number(n) || 0);
  if (x <= 0) return String(x);
  if (x < 10) return CN_NUMS[x];
  const tens = Math.floor(x / 10);
  const ones = x % 10;
  if (x < 20) return '十' + (ones ? CN_NUMS[ones] : '');
  return CN_NUMS[tens] + '十' + (ones ? CN_NUMS[ones] : '');
}
/** 中文数字（一…九 / 十 / 十一… / 二十…）→ 整数；不认识返回 null */
function cnToNum(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  if (str.length === 1) { const i = CN_NUMS.indexOf(str); return i >= 0 ? i : null; }
  if (str === '十') return 10;
  const shi = str.indexOf('十');
  if (shi === -1) return null;
  const tens = shi === 0 ? 1 : CN_NUMS.indexOf(str[shi - 1]);
  if (tens <= 0) return null;
  let val = tens * 10;
  const tail = str.slice(shi + 1);
  if (tail) { const o = CN_NUMS.indexOf(tail); if (o < 0) return null; val += o; }
  return val;
}
/** 从标题开头提取序号（中文 一… 或 数字 1…）；无序号返回 null */
function numFromTitle(title) {
  const t = String(title || '').trim();
  const c = /^([零一二三四五六七八九十]+)/.exec(t);
  if (c) { const v = cnToNum(c[1]); if (v != null) return v; }
  const a = /^(\d+)/.exec(t);
  if (a) return parseInt(a[1], 10);
  return null;
}
/** 计算下一个子区块序号（沿用现有「n.m 标题」规律，如 4.3 → 4.4）；无规律返回 null */
function nextSubNum(subs) {
  let maxM = 0, sectionN = null;
  (Array.isArray(subs) ? subs : []).forEach((sb) => {
    const m = /^(\d+)[.、](\d+)\b/.exec(String(sb.title || '').trim());
    if (m) {
      const thisN = parseInt(m[1], 10);
      const thisM = parseInt(m[2], 10);
      if (thisM > maxM) { maxM = thisM; sectionN = thisN; }
    }
  });
  return sectionN === null ? null : `${sectionN}.${maxM + 1}`;
}

/** 「＋ 添加区块」：界面内新建（不用 prompt —— 沙箱渲染进程禁用 window.prompt）
 *  v1.2.3（用户指令 4）：自动编号 —— 现有 ## 最大序号 +1（如已有 四 → 新加 五、新区块）。 */
function addSection() {
  const baseName = '新区块';
  const num = nextSectionNum;
  let title = num !== null ? `${cnNum(num)}、${baseName}` : baseName;
  let i = 1;
  while (sections.some((s) => s.title === title)) {
    i++;
    title = num !== null ? `${cnNum(num)}、${baseName}${i}` : `${baseName}${i}`;
  }
  sections.push({ title, body: '', subs: [] });
  if (num !== null) nextSectionNum = num + 1; // 后续新增继续递增
  selectedSectionIndex = sections.length - 1;
  selectedSubIndex = -1;
  renderMemoList();
  const t = document.querySelector('.memo-editor-title');
  if (t) { t.focus(); t.select(); }
}

/** 「＋ 添加子区块」：给当前 ## 追加一个 ### 子区块
 *  v1.2.3（用户指令 3）：自动编号 —— 沿用现有「n.m」规律（如 4.1/4.2/4.3 → 4.4）；
 *  无编号规律时若区块标题带序号（如「五、…」），则子区块从 5.1 开始。 */
function addSub() {
  const s = sections[selectedSectionIndex];
  if (!s) return;
  if (!Array.isArray(s.subs)) s.subs = [];
  let num = nextSubNum(s.subs);
  if (!num) {
    const sn = numFromTitle(s.title);
    if (sn != null && sn >= 1) num = `${sn}.${s.subs.length + 1}`;
  }
  const title = num ? `${num} 新区块` : `场景 ${s.subs.length + 1}`;
  s.subs.push({ title, body: '' });
  selectedSubIndex = s.subs.length - 1;
  renderMemoList();
  const t = document.querySelector('.memo-editor-title');
  if (t) { t.focus(); t.select(); }
}

// ── v1.0.2（用户指令 3）/ v1.0.3（用户反馈 2）：DSH 角色 —— 左侧列表 + 右侧点击进入编辑
// 角色名 ≤30 字符（前端 maxlength + 主进程保存校验双保险）；结构字段（# 角色：/ ## 定位 /
// ## 详细记忆）由程序组装，用户不直接编辑全文，防误删。
const MAX_ROLE_NAME = 30; // v1.0.3：角色名长度上限
let selectedRoleIndex = -1; // 当前编辑的角色下标（-1 = 无）

/** 左侧角色列表：每行 = 🎭 角色名 + 定位摘要，点击选中进入编辑 */
function renderRoleList() {
  const list = el('role-list');
  if (!list) return;
  list.innerHTML = roleFields.map((r, i) => `
    <div class="role-item${i === selectedRoleIndex ? ' active' : ''}" data-i="${i}" title="点击编辑此角色">
      <span class="role-item-icon">🎭</span>
      <span class="role-item-name">${escapeHtml(r.name || '（未命名）')}</span>
      ${r.desc ? `<span class="role-item-desc">${escapeHtml(String(r.desc).split('\n')[0])}</span>` : ''}
      <button class="del" data-i="${i}" title="删除此角色（同时删除 ~/.dsh/roles/ 角色文件）">✕</button>
    </div>`).join('')
    + (roleFields.length === 0 ? '<div class="sec-empty">还没有角色</div>' : '');
  list.querySelectorAll('.role-item').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.del')) return;
      selectedRoleIndex = Number(row.dataset.i);
      renderRoleList();
      renderRoleEditor();
    });
  });
  list.querySelectorAll('.role-item .del').forEach((b) => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      roleFields.splice(Number(b.closest('.role-item').dataset.i), 1);
      if (selectedRoleIndex >= roleFields.length) selectedRoleIndex = roleFields.length - 1;
      renderRoleList();
      renderRoleEditor();
    });
  });
}

/** 右侧编辑面板：角色名（≤30）+ ## 定位 + ## 详细记忆 */
function renderRoleEditor() {
  const ed = el('role-editor');
  if (!ed) return;
  const r = roleFields[selectedRoleIndex];
  if (!r) {
    ed.innerHTML = '<div class="sec-empty">点击左侧角色进入编辑，或「＋ 添加角色」新建</div>';
    return;
  }
  const name = String(r.name || '');
  ed.innerHTML = `
    <div class="role-editor-head">
      <input class="role-editor-name" maxlength="${MAX_ROLE_NAME}" value="${escapeHtml(name)}" placeholder="角色名（≤30 字符，如：学习导师）" />
      <span class="role-editor-count">${name.length}/${MAX_ROLE_NAME}</span>
    </div>
    <div class="role-field">
      <div class="role-field-label">## 定位<span class="role-field-hint">（AGENTS.md 角色行显示首行摘要）</span></div>
      <textarea class="role-field-input" data-field="desc" rows="2" placeholder="这个角色是做什么的（定位）…">${escapeHtml(r.desc || '')}</textarea>
    </div>
    <div class="role-field">
      <div class="role-field-label">## 详细记忆<span class="role-field-hint">（DSH 切换到此角色时按此扮演）</span></div>
      <textarea class="role-field-input" data-field="memory" rows="9" placeholder="角色的详细记忆、知识、风格…">${escapeHtml(r.memory || '')}</textarea>
    </div>`;
  const nameInput = ed.querySelector('.role-editor-name');
  const countEl = ed.querySelector('.role-editor-count');
  nameInput.addEventListener('input', () => {
    roleFields[selectedRoleIndex].name = nameInput.value;
    countEl.textContent = `${nameInput.value.length}/${MAX_ROLE_NAME}`;
    // 实时同步列表里的名称显示
    const item = document.querySelector(`.role-item[data-i="${selectedRoleIndex}"] .role-item-name`);
    if (item) item.textContent = nameInput.value || '（未命名）';
  });
  ed.querySelectorAll('.role-field-input').forEach((b) => {
    const field = b.dataset.field;
    b.addEventListener('input', () => { roleFields[selectedRoleIndex][field] = b.value; });
  });
}

function addRole() {
  let n = `角色 ${roleFields.length + 1}`;
  let i = 1;
  while (roleFields.some((r) => r.name === n)) { i++; n = `角色 ${i}`; }
  roleFields.push({ name: n, desc: '', memory: '' });
  selectedRoleIndex = roleFields.length - 1;
  renderRoleList();
  renderRoleEditor();
  const ni = document.querySelector('.role-editor-name');
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
    .map((s) => ({
      title: String(s.title || '').trim(),
      body: s.body,
      subs: (Array.isArray(s.subs) && s.subs.length)
        ? s.subs.map((sb) => ({ title: String(sb.title || '').trim(), body: sb.body })).filter((sb) => sb.title !== '')
        : undefined,
    }))
    .filter((s) => {
      if (!s.title || seen.has(s.title)) return false;
      seen.add(s.title);
      return true;
    });
  // v1.0.2：角色 value = 角色 .md 全文（保留格式，不做 trim/换行替换）
  // v1.0.3：角色拆「定位 / 详细记忆」固定字段（desc / memory），主进程组装全文
  const cleanRoles = roleFields
    .map((it) => ({ name: String(it.name || '').trim(), desc: String(it.desc || ''), memory: String(it.memory || '') }))
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
    // v0.9.12（用户指令）：保存后询问是否让 DSH 整理记忆
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
  fileCorrupt = !!(data && data.corrupt); // v1.0.5（用户反馈 4）：解析异常 → 显示一键恢复条
  updateCorruptBar();
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
    // v1.0.2：value = 角色 .md 全文；v1.0.3：desc = ## 定位 全文（窗口字段输入），value = 详细记忆+其他
    roleFields = rolesSec.fields.map((it) => ({ name: it.name || '', desc: it.desc || '', memory: it.value || '' }));
  } else {
    const defs = (data && Array.isArray(data.defaultRoles)) ? data.defaultRoles : DEFAULT_ROLES;
    roleFields = defs.map((n) => ({ name: n, desc: '', memory: '' }));
  }
  guidePending = !!(usersSec && usersSec.guide);
  // v1.0.3：聚焦刷新/外部变更后角色列表可能变化，选中下标越界时回落到最后一个
  if (selectedRoleIndex >= roleFields.length) selectedRoleIndex = roleFields.length - 1;
  sections = list
    .filter((s) => s.kind === 'long')
    .map((s) => ({
      title: s.title,
      body: (s.body || []).join('\n'),
      subs: (Array.isArray(s.subs) && s.subs.length) ? s.subs.map((sb) => ({ title: sb.title, body: (sb.body || []).join('\n') })) : [],
    }));
  // v1.2.3（用户指令）：区块左列表+右编辑（支持 ### 子区块），选中下标越界时回落到第一个
  if (sections.length === 0) selectedSectionIndex = -1;
  else if (selectedSectionIndex < 0 || selectedSectionIndex >= sections.length) selectedSectionIndex = 0;
  if (selectedSubIndex !== -1 && !(sections[selectedSectionIndex] && sections[selectedSectionIndex].subs && sections[selectedSectionIndex].subs[selectedSubIndex])) selectedSubIndex = -1;
  // v1.2.3（用户指令 4）：新区块自动编号基准 —— 取所有 ## 区块标题的最大序号（中文/数字），新加继续
  let maxSecNum = 0;
  list.forEach((s) => { const n = numFromTitle(s.title); if (n != null && n > maxSecNum) maxSecNum = n; });
  nextSectionNum = maxSecNum >= 1 ? maxSecNum + 1 : null;
  // v1.0.1（用户指令）：左下角不再显示双路径（按钮直达目录即可）
  el('path').textContent = filePath;
}

async function init() {
  if (!dsh || !dsh.getGlobalMemory) return;
  try {
    await loadData();
  } catch {
    userFields = DEFAULT_FIELDS.map((n) => ({ name: n, value: '' }));
    dshFields = DEFAULT_DSH_FIELDS.map((n) => ({ name: n, value: '' }));
    roleFields = DEFAULT_ROLES.map((n) => ({ name: n, desc: '', memory: '' }));
    sections = [];
  }
  renderAll();
  el('btn-save').addEventListener('click', onSaveClick);
  // v1.0.1（用户指令）：两个按钮 —— 记忆文件位置 / 角色文件位置
  el('btn-open-memory').addEventListener('click', () => {
    if (dsh && dsh.openGlobalMemoryFolder) dsh.openGlobalMemoryFolder();
  });
  el('btn-open-roles').addEventListener('click', () => {
    if (dsh && dsh.openGlobalMemoryRoles) dsh.openGlobalMemoryRoles();
  });
  // v1.0.5（用户反馈 4）：解析异常 → 从备份一键恢复（AGENTS.md.bak）
  const restoreBtn = el('btn-restore-bak');
  if (restoreBtn) restoreBtn.addEventListener('click', async () => {
    if (!dsh || !dsh.restoreGlobalMemoryBackup) return;
    restoreBtn.disabled = true;
    try {
      const r = await dsh.restoreGlobalMemoryBackup();
      if (r && r.ok) {
        fileCorrupt = false;
        await loadData();
        renderAll();
        showBanner('✅ 已从备份恢复（AGENTS.md.bak）', true);
      } else {
        showBanner('恢复失败：' + ((r && r.message) || '没有可用备份'), false);
      }
    } catch (err) {
      showBanner('恢复失败：' + String((err && err.message) || err), false);
    } finally {
      restoreBtn.disabled = false;
    }
  });
  // v1.0.2b（用户反馈 2026-08-18：改角色 .md 后需重开窗口才刷新）：聚焦时对比
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
