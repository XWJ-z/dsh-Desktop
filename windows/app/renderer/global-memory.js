'use strict';

/**
 * global-memory.js — 全局记忆窗口脚本（v0.9.12 老大指令修正版）
 * 经 preload：getGlobalMemory() 读取 ~/.dsh/AGENTS.md 的基础设定表单；
 * saveGlobalMemory(form) 区块级写回（其余内容原样保留）。
 * 「打开文件位置」经 openGlobalMemoryFolder() 打开所在目录。
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

// v0.9.12 修正：用户视角字段 + 分组 ——「你的信息」是 DSH 记住你是谁，
//「你希望 DSH 的方式」是 DSH 怎么配合你；消除「我的姓名」归属歧义。
const GROUPS = [
  {
    title: '你的信息',
    desc: 'DSH 记住你是谁',
    fields: ['你的称呼', '你的身份/角色', '项目背景'],
  },
  {
    title: '你希望 DSH 的方式',
    desc: 'DSH 怎么配合你',
    fields: ['语言风格', '输出习惯', '常用约定'],
  },
];
const PLACEHOLDERS = {
  '你的称呼': '例：老大 / 张三',
  '你的身份/角色': '例：技术总监 / 项目负责人',
  项目背景: '例：DSH-Desktop（Electron 套壳），团队 4 人',
  语言风格: '例：简洁、专业、中文回复',
  输出习惯: '例：代码带注释、结论先行',
  常用约定: '例：有改必升版本号；开发日志必写',
};
const TIPS = {
  '你的称呼': 'DSH 叫你什么（你的名字）',
  '你的身份/角色': '你的身份或角色定位',
  项目背景: '你的项目、技术栈、进度',
  语言风格: '你希望 DSH 用什么风格交流',
  输出习惯: '你希望 DSH 的输出格式/习惯',
  常用约定: '想让 DSH 长期遵守的约定',
};

let bannerTimer = null;
function showBanner(text, ok) {
  const b = el('banner');
  b.textContent = text;
  b.className = 'banner show ' + (ok ? 'ok' : 'fail');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.className = 'banner'; }, 2200);
}

function buildForm(form) {
  const wrap = el('form');
  wrap.innerHTML = GROUPS.map((g) => `
    <div class="group">
      <div class="group-title">${g.title}<span class="group-desc">${g.desc}</span></div>
      ${g.fields.map((f) => `
        <div class="field">
          <label>${f}<span class="tip">${TIPS[f] || ''}</span></label>
          <textarea data-field="${f}" placeholder="${PLACEHOLDERS[f] || ''}" rows="2">${escapeHtml(form[f] || '')}</textarea>
        </div>`).join('')}
    </div>`).join('');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function collectForm() {
  const form = {};
  el('form').querySelectorAll('textarea[data-field]').forEach((ta) => {
    form[ta.dataset.field] = ta.value;
  });
  return form;
}

async function init() {
  if (!dsh || !dsh.getGlobalMemory) return;
  try {
    const data = await dsh.getGlobalMemory();
    if (data && data.form) buildForm(data.form);
    el('path').textContent = (data && data.file) || '';
  } catch {
    buildForm({});
  }
  el('btn-save').addEventListener('click', async () => {
    const btn = el('btn-save');
    btn.disabled = true;
    const res = await dsh.saveGlobalMemory(collectForm());
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
