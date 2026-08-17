'use strict';

/**
 * DSH-Desktop — 全局记忆模块（v0.9.12，区块化识别版）
 *
 * 全局记忆 = DSH 原生 `~/.dsh/AGENTS.md`（DSH 启动时自动读取，无需手动发送）。
 * 本模块提供图形化编辑：
 *  - **自动识别全部 `## 标题` 区块**：除「基础设定」用动态字段列表外，
 *    其他 `## xxxx` 区块（如 身份与称呼 / 项目通用约定 / 发布流程…）以
 *    **长文本**形式在界面展示编辑（标题只读，内容可改），保存时按原顺序重组，
 *    区块内原有格式（列表/代码块/表格/空行）原样保留；
 *  - 首次没有 AGENTS.md → 自动创建模板；
 *  - 区块级替换：文件头部（# 标题 + 说明）与各区块原样保留，只替换用户编辑过的内容；
 *  - 原子写盘（.tmp → rename）；覆盖已有内容由主进程弹窗确认（见 ipc.js）。
 *
 * 依赖注入（deps）：
 *  - fs / os / path           Node 模块（路径 ~/.dsh/AGENTS.md 经 os.homedir()）
 *  - appendLog                日志模块
 */

const FILE_NAME = 'AGENTS.md';

/** 基础设定区块标题（字段列表模式；其余 ## 区块为长文本模式） */
const SECTION_TITLE = '基础设定（DSH-Desktop 图形化编辑）';

/** 内置默认字段（首次/空区块时窗口初始行） */
const DEFAULT_FIELDS = ['你的称呼', '你的身份/角色', '项目背景', '语言风格', '输出习惯', '常用约定'];

/** 首次创建时的模板（头部 + 基础设定 + 其他记忆区） */
const TEMPLATE = `# AGENTS.md（全局记忆）

> 此文件由 DSH-Desktop「全局记忆」窗口维护，DSH 会自动读取其中的内容作为长期记忆（无需手动发送）。
> 「基础设定」请用窗口中的表单编辑；其他内容可自行追加到「其他记忆」区。

## ${SECTION_TITLE}

${DEFAULT_FIELDS.map((f) => `- ${f}：`).join('\n')}

## 其他记忆

- （可在此追加你想让 DSH 长期记住的其他内容）
`;

/** 模板的头部文本（第一个 ## 之前），供创建/重组用 */
function templateHead() {
  return TEMPLATE.split('\n## ')[0];
}

function createGlobalMemory(deps) {
  const { fs, os, path, appendLog } = deps;

  /** 全局记忆文件路径：~/.dsh/AGENTS.md（DSH 原生全局记忆，随 ~/.dsh 一起备份/恢复） */
  function file() {
    return path.join(os.homedir(), '.dsh', FILE_NAME);
  }

  /** 读原始内容；不存在/读失败返回 null */
  function readRaw() {
    try {
      return fs.readFileSync(file(), 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * 解析 AGENTS.md 为区块模型：
   *  - head：第一个 `## ` 之前的头部原文（# 标题 + 说明，保留原样）；
   *  - sections：[{ title, kind }] —— 基础设定 kind='fields'（items 字段行），
   *    其他 `## xxxx` kind='long'（body 为区块内原文行，含空行/列表/代码块，保留格式）。
   *  - 其他记忆区块（## 其他记忆）同样识别为 long 区块。
   * @returns {{ head: string, sections: Array, hasBasic: boolean }}
   */
  function parse(content) {
    const head = [];
    const sections = [];
    let cur = null; // { title, kind, body:[] | items:[] }
    let seenSection = false;
    const lines = String(content || '').split(/\r?\n/);
    for (const line of lines) {
      const t = /^##\s+(.+)$/.exec(line);
      if (t) {
        seenSection = true;
        const title = t[1].trim();
        if (title === SECTION_TITLE) {
          sections.push({ title, kind: 'fields', items: [] });
          cur = sections[sections.length - 1];
        } else {
          sections.push({ title, kind: 'long', body: [] });
          cur = sections[sections.length - 1];
        }
        continue;
      }
      if (cur) {
        if (cur.kind === 'fields') {
          const m = /^-\s*([^：:]+)[：:]\s*(.*)$/.exec(line);
          if (m) cur.items.push({ name: m[1].trim(), value: m[2].trim() });
        } else {
          cur.body.push(line);
        }
      } else if (!seenSection) {
        head.push(line); // 第一个 ## 之前 → 头部
      }
    }
    return { head: head.join('\n'), sections, hasBasic: sections.some((s) => s.kind === 'fields') };
  }

  /** 渲染基础设定区块（字段列表，顺序即写入顺序） */
  function renderFields(items) {
    const lines = [`## ${SECTION_TITLE}`, ''];
    items.forEach((it) => {
      const name = String(it.name || '').trim();
      if (!name) return; // 空字段名丢弃
      lines.push(`- ${name}：${String(it.value || '').trim()}`);
    });
    return lines.join('\n');
  }

  /** 渲染长文本区块（## 标题 + 原格式内容） */
  function renderLong(title, body) {
    // 防御：body 可能是数组（解析产物）或字符串（窗口提交），统一为字符串
    const raw = Array.isArray(body) ? body.join('\n') : String(body || '');
    const b = raw.replace(/^\s*\n+|\s+$/g, ''); // 去首尾多余空行
    return `## ${title}${b ? `\n\n${b}` : ''}`;
  }

  /**
   * 重组完整文件：head + 基础设定区块（无则插入最前）+ 其他区块（按序）。
   * @param {string} head
   * @param {Array} sections [{ title, kind, items?|body? }]
   */
  function render(head, sections) {
    const blocks = [];
    let fieldsBlock = null;
    const others = [];
    for (const s of sections) {
      if (s.kind === 'fields') {
        fieldsBlock = renderFields(s.items || []);
      } else {
        others.push(renderLong(s.title, s.body));
      }
    }
    if (fieldsBlock === null) fieldsBlock = renderFields([]); // 确保基础设定始终存在
    const headText = String(head || '').trim() || templateHead().trim();
    blocks.push(headText, fieldsBlock, ...others);
    return blocks.join('\n\n') + '\n';
  }

  /**
   * 保存：用窗口提交的字段 + 区块内容重组文件。
   * @param {{ fields?: Array, sections?: Array }} payload
   *  - fields: [{ name, value }]（基础设定）
   *  - sections: [{ title, body }]（其他长文本区块，窗口顺序）
   * @returns {{ ok: boolean, file: string, message?: string }}
   */
  function save(payload) {
    const p = payload || {};
    // 基础设定字段（过滤空字段名）
    const fields = (Array.isArray(p.fields) ? p.fields : [])
      .map((it) => ({ name: String((it && it.name) || '').trim(), value: String((it && it.value) || '').trim() }))
      .filter((it) => it.name !== '');
    // 其他长文本区块（窗口顺序；标题非空才保留）
    const longSections = (Array.isArray(p.sections) ? p.sections : [])
      .map((s) => ({ title: String((s && s.title) || '').trim(), body: String((s && s.body) || '') }))
      .filter((s) => s.title !== '');
    const raw = readRaw();
    // 重组：首次用完整模板解析（含「其他记忆」区块），已有文件保留原头部与区块
    const { head, sections } = raw === null ? parse(TEMPLATE) : parse(raw);
    // v0.9.12（老大反馈：保存没写入）：按序覆盖 —— 窗口区块顺序 = 原文件区块顺序
    //（窗口无排序功能），第 i 个长区块用窗口第 i 个提交值（标题与内容都可修改生效），
    // 原文件没有的新区块追加末尾；避免按标题匹配导致「改标题后旧区块残留 + 新增重复」。
    const merged = [];
    let fieldsPlaced = false;
    let li = 0;
    for (const s of sections) {
      if (s.kind === 'fields') {
        merged.push({ title: SECTION_TITLE, kind: 'fields', items: fields });
        fieldsPlaced = true;
      } else {
        const incoming = longSections[li] || null;
        li++;
        merged.push({
          title: incoming ? incoming.title : s.title,
          kind: 'long',
          body: incoming ? incoming.body : s.body,
        });
      }
    }
    if (!fieldsPlaced) merged.unshift({ title: SECTION_TITLE, kind: 'fields', items: fields });
    // 窗口新增区块（原文件区块数之后）追加末尾
    const originalLong = sections.filter((s) => s.kind !== 'fields').length;
    for (let i = originalLong; i < longSections.length; i++) {
      merged.push({ title: longSections[i].title, kind: 'long', body: longSections[i].body });
    }
    const content = render(head, merged);
    try {
      const f = file();
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = `${f}.tmp`;
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, f); // 原子落位
      appendLog('info', `全局记忆已保存：${f}`);
      return { ok: true, file: f };
    } catch (err) {
      appendLog('error', `保存全局记忆失败：${err.message}`);
      return { ok: false, file: file(), message: err.message };
    }
  }

  /** 读取窗口数据：头部 + 全部区块（含基础设定字段）+ 默认字段 + 文件路径 */
  function data() {
    const raw = readRaw();
    const parsed = raw === null ? parse('') : parse(raw);
    return {
      exists: raw !== null,
      hasBasic: parsed.hasBasic,
      head: parsed.head,
      sections: parsed.sections,
      defaultFields: DEFAULT_FIELDS.slice(),
      file: file(),
    };
  }

  return { file, data, save, parse, DEFAULT_FIELDS, SECTION_TITLE };
}

module.exports = { createGlobalMemory, FILE_NAME, SECTION_TITLE, DEFAULT_FIELDS, TEMPLATE };
