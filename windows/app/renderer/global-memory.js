'use strict';

/**
 * global-memory.js — 全局记忆窗口脚本（v0.9.12 动态字段列表版）
 * 经 preload：getGlobalMemory() 读取 ~/.dsh/AGENTS.md 的字段列表；
 * saveGlobalMemory(items) 区块级写回（其余内容原样保留）。
 * 支持「＋ 添加字段」任意增删自定义条目；字段名/内容直接编辑。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

const NAME_PLACEHOLDERS = ['你的称呼', '你的身份/角色', '项目背景', '语言风格', '输出习惯', '常用约定'];
const VALUE_HINTS = {
  你的称呼: '例：老大 / 张三',
  你的身份角色: '例：技术总监 / 项目负责人',
  项目背景: '例：DSH-Desktop（Electron 套壳），团队 4 人',
  语言风格: '例：简洁、专业、中文回复',
  输出习惯: '例：代码带注释、结论先行',
  常用约定: '例：有改必升版本号；开发日志必写',
};
const VALUE_HINT_FALLBACK = '填写内容…';

let items = []; // [{ name, value }]
let bannerTimer = null;

function showBanner(text, ok) {
  const b = el('banner');
  b.textContent = text;
  b.className = 'banner show ' + (ok ? 'ok' : 'fail');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = 'banner'; }, 2200);
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

function render() {
  const list = el('list');
  list.innerHTML = items.map((it, i) => `
    <div class="row" data-i="${i}">
      <input class="f-name" placeholder="字段名（例：我的微信号）" value="${escapeHtml(it.name)}" />
      <textarea class="f-value" rows="1" placeholder="${escapeHtml(valueHint(it.name))}">${escapeHtml(it.value)}</textarea>
      <button class="del" title="删除这一条">✕</button>
    </div>`).join('');
  list.querySelectorAll('.row').forEach((row) => {
    const i = Number(row.dataset.i);
    const name = row.querySelector('.f-name');
    const value = row.querySelector('.f-value');
    // 输入即同步到内存（防重渲染丢焦点；值提示随字段名变化）
    name.addEventListener('input', () => {
      items[i].name = name.value;
      const ph = valueHint(name.value);
      if (value.placeholder !== ph) value.placeholder = ph;
    });
    value.addEventListener('input', () => { items[i].value = value.value; });
    row.querySelector('.del').addEventListener('click', () => {
      items.splice(i, 1);
      render();
    });
  });
}

function addField() {
  items.push({ name: '', value: '' });
  render();
  // 聚焦新行字段名
  const rows = el('list').querySelectorAll('.row');
  const last = rows[rows.length - 1];
  if (last) last.querySelector('.f-name').focus();
}

async function init() {
  if (!dsh || !dsh.getGlobalMemory) return;
  try {
    const data = await dsh.getGlobalMemory();
    if (data && Array.isArray(data.items) && data.items.length > 0) {
      items = data.items.map((it) => ({ name: it.name || '', value: it.value || '' }));
    } else {
      // 首次/空区块：初始为内置默认字段
      const defs = (data && Array.isArray(data.defaultFields)) ? data.defaultFields : NAME_PLACEHOLDERS;
      items = defs.map((n) => ({ name: n, value: '' }));
    }
    el('path').textContent = (data && data.file) || '';
  } catch {
    items = NAME_PLACEHOLDERS.map((n) => ({ name: n, value: '' }));
  }
  render();

  el('btn-add').addEventListener('click', addField);
  el('btn-save').addEventListener('click', async () => {
    // 收集 + 过滤空字段名行
    const clean = items
      .map((it) => ({ name: String(it.name || '').trim(), value: String(it.value || '').trim() }))
      .filter((it) => it.name !== '');
    if (clean.length === 0) {
      showBanner('至少保留一个字段（填写字段名）', false);
      return;
    }
    const btn = el('btn-save');
    btn.disabled = true;
    const res = await dsh.saveGlobalMemory(clean);
    btn.disabled = false;
    if (res && res.ok) {
      showBanner('✅ 已保存（DSH 新会话自动生效）', true);
    } else {
      showBanner('保存失败：' + ((res && res.message) || '未知错误'), false);
    }
  });
  el('btn-open-folder').addEventListener('click', () => {
    if (dsh && dsh.openGlobalMemoryFolder) dsh.openGlobalMemoryFolder();
  });
}

init();
