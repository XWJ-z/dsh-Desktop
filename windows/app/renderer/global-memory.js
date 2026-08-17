'use strict';

/**
 * global-memory.js — 全局记忆窗口脚本（v0.9.12 区块化识别版）
 * 经 preload：getGlobalMemory() 读取 ~/.dsh/AGENTS.md（头部 + 全部 ## 区块）；
 * saveGlobalMemory({ fields, sections }) 重组写回（覆盖弹窗在主进程）。
 *  - 「基础设定」→ 动态字段列表（可增删）；
 *  - 其他 ## 区块（身份与称呼 / 项目通用约定 / 发布流程…）→ 长文本编辑（自动识别）。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

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

/** 字段值提示：按字段名匹配（忽略 / 差异） */
function valueHint(name) {
  const n = String(name || '').trim();
  return VALUE_HINTS[n] || VALUE_HINTS[n.replace(/\//g, '')] || VALUE_HINT_FALLBACK;
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

function renderSections() {
  const wrap = el('sections');
  if (sections.length === 0) {
    wrap.innerHTML = '<div class="sec-empty">（没有其他 ## 区块，可点「＋ 添加区块」新建）</div>';
    return;
  }
  wrap.innerHTML = sections.map((s, i) => `
    <div class="sec" data-i="${i}">
      <div class="sec-head">## ${escapeHtml(s.title)}</div>
      <textarea class="sec-body" rows="4" placeholder="此区块内容…">${escapeHtml(s.body)}</textarea>
    </div>`).join('');
  wrap.querySelectorAll('.sec').forEach((sec) => {
    const i = Number(sec.dataset.i);
    sec.querySelector('.sec-body').addEventListener('input', (e) => { sections[i].body = e.target.value; });
  });
}

function render() {
  const scroll = el('scroll');
  scroll.innerHTML = `
    <div class="card">
      <div class="card-title">基础设定 <span class="tag">字段列表 · 可增删</span></div>
      <div id="fields"></div>
      <button id="btn-add" class="add">＋ 添加字段</button>
    </div>
    <div class="card">
      <div class="card-title">其他记忆区块 <span class="tag">自动识别 ## 标题 · 长文本</span></div>
      <div id="sections"></div>
      <button id="btn-add-sec" class="add">＋ 添加区块</button>
    </div>`;
  renderFields();
  renderSections();
  el('btn-add').addEventListener('click', addField);
  el('btn-add-sec').addEventListener('click', addSection);
}

function addField() {
  fields.push({ name: '', value: '' });
  renderFields();
  const rows = el('fields').querySelectorAll('.row');
  const last = rows[rows.length - 1];
  if (last) last.querySelector('.f-name').focus();
}

function addSection() {
  const title = window.prompt('新区块标题（将显示为 ## 标题）：', '其他记忆');
  if (title === null) return;
  const t = String(title).trim();
  if (!t) return;
  sections.push({ title: t, body: '' });
  renderSections();
  const secs = el('sections').querySelectorAll('.sec');
  const last = secs[secs.length - 1];
  if (last) last.querySelector('.sec-body').focus();
}

async function init() {
  if (!dsh || !dsh.getGlobalMemory) return;
  try {
    const data = await dsh.getGlobalMemory();
    filePath = (data && data.file) || '';
    // 基础设定字段：有则回填；无 → 默认字段
    const basic = data && data.sections.find((s) => s.title === '基础设定（DSH-Desktop 图形化编辑）');
    if (basic && Array.isArray(basic.items) && basic.items.length > 0) {
      fields = basic.items.map((it) => ({ name: it.name || '', value: it.value || '' }));
    } else {
      const defs = (data && Array.isArray(data.defaultFields)) ? data.defaultFields : DEFAULT_FIELDS;
      fields = defs.map((n) => ({ name: n, value: '' }));
    }
    // 其他 ## 区块（排除基础设定）
    sections = (data && Array.isArray(data.sections) ? data.sections : [])
      .filter((s) => s.title !== '基础设定（DSH-Desktop 图形化编辑）')
      .map((s) => ({ title: s.title, body: (s.body || []).join('\n') }));
    el('path').textContent = filePath;
  } catch {
    fields = DEFAULT_FIELDS.map((n) => ({ name: n, value: '' }));
    sections = [];
  }
  render();

  el('btn-save').addEventListener('click', async () => {
    const cleanFields = fields
      .map((it) => ({ name: String(it.name || '').trim(), value: String(it.value || '').trim() }))
      .filter((it) => it.name !== '');
    if (cleanFields.length === 0 && sections.length === 0) {
      showBanner('没有可保存的内容（至少保留一个字段）', false);
      return;
    }
    const payload = {
      fields: cleanFields,
      sections: sections.map((s) => ({ title: s.title, body: s.body })),
    };
    const btn = el('btn-save');
    btn.disabled = true;
    const res = await dsh.saveGlobalMemory(payload);
    btn.disabled = false;
    if (res && res.ok) {
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
