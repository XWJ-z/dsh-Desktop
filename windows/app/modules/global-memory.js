'use strict';

/**
 * DSH-Desktop — 全局记忆模块（v0.9.12，动态字段列表版）
 *
 * 全局记忆 = DSH 原生 `~/.dsh/AGENTS.md`（DSH 启动时自动读取，无需手动发送）。
 * 本模块提供图形化编辑：
 *  - 首次没有 AGENTS.md → 自动创建模板；
 *  - 窗口是**动态字段列表**：内置默认字段 + 用户可「＋ 添加字段」任意增删、
 *    字段名/内容直接编辑；保存时全部写入「基础设定」区块
 *    （## 基础设定（DSH-Desktop 图形化编辑）），做区块级替换：文件其余内容
 *    （用户手写的其他记忆）原样保留；
 *  - 自定义字段随区块持久化（重开窗口仍在）；原子写盘（.tmp → rename）。
 *
 * 依赖注入（deps）：
 *  - fs / os / path           Node 模块（路径 ~/.dsh/AGENTS.md 经 os.homedir()）
 *  - appendLog                日志模块
 */

const FILE_NAME = 'AGENTS.md';

/** 基础设定区块标题（表单管理的区块；其余内容不动） */
const SECTION_TITLE = '基础设定（DSH-Desktop 图形化编辑）';

/** 内置默认字段（首次/初始行；用户可改名、删除、新增） */
const DEFAULT_FIELDS = ['你的称呼', '你的身份/角色', '项目背景', '语言风格', '输出习惯', '常用约定'];

/** 首次创建时的模板（含基础设定区块 + 使用引导 + 其他记忆区） */
const TEMPLATE = `# AGENTS.md（全局记忆）

> 此文件由 DSH-Desktop「全局记忆」窗口维护，DSH 会自动读取其中的内容作为长期记忆（无需手动发送）。
> 「基础设定」请用窗口中的表单编辑；其他内容可自行追加到「其他记忆」区。

## ${SECTION_TITLE}

${DEFAULT_FIELDS.map((f) => `- ${f}：`).join('\n')}

## 其他记忆

- （可在此追加你想让 DSH 长期记住的其他内容）
`;

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
   * 解析基础设定区块：找「## 基础设定（DSH-Desktop 图形化编辑）」区块，
   * 逐行匹配 `- 字段名：值` → 字段行数组 [{ name, value }]（保持文件顺序，
   * 自定义字段一并回填）；其余内容不解析（保存时原样保留）。
   * @returns {{ items: Array<{name:string,value:string}>, hasSection: boolean }}
   */
  function parseSections(content) {
    let hasSection = false;
    const items = [];
    if (!content) return { items, hasSection };
    const lines = String(content).split(/\r?\n/);
    let inSection = false;
    for (const line of lines) {
      const t = /^##\s+(.+)$/.exec(line);
      if (t) {
        inSection = t[1].trim() === SECTION_TITLE;
        if (inSection) hasSection = true;
        continue;
      }
      if (inSection) {
        const m = /^-\s*([^：:]+)[：:]\s*(.*)$/.exec(line);
        if (m) {
          items.push({ name: m[1].trim(), value: m[2].trim() });
        }
      }
    }
    return { items, hasSection };
  }

  /**
   * 渲染基础设定区块文本（items 顺序即写入顺序）。
   * @param {Array<{name:string,value:string}>} items
   */
  function renderSection(items) {
    const lines = [`## ${SECTION_TITLE}`, ''];
    items.forEach((it) => {
      const name = String(it.name || '').trim();
      if (!name) return; // 空字段名行丢弃（防脏数据）
      lines.push(`- ${name}：${String(it.value || '').trim()}`);
    });
    return lines.join('\n');
  }

  /**
   * 保存：把基础设定区块替换为字段列表内容；文件不存在 → 建模板；
   * 已有但无该区块 → 追加到文件末尾；其余内容一字不动。
   * @param {Array<{name:string,value:string}>} items
   * @returns {{ ok: boolean, file: string, message?: string }}
   */
  function save(items) {
    const clean = Array.isArray(items)
      ? items.map((it) => ({ name: String((it && it.name) || '').trim(), value: String((it && it.value) || '').trim() }))
      : [];
    const section = renderSection(clean);
    const raw = readRaw();
    const content = raw === null ? replaceSection(TEMPLATE, section) : replaceSection(raw, section);
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

  /** 区块替换（有则替换 [start,end)，无则追加文件末尾） */
  function replaceSection(content, section) {
    const lines = String(content).split(/\r?\n/);
    let start = -1;
    let end = lines.length;
    for (let i = 0; i < lines.length; i++) {
      const t = /^##\s+/.test(lines[i]);
      if (t) {
        if (lines[i].includes(SECTION_TITLE)) {
          start = i;
        } else if (start >= 0) {
          end = i;
          break;
        }
      }
    }
    if (start >= 0) {
      return [...lines.slice(0, start), section, ...lines.slice(end)].join('\n');
    }
    // 无该区块 → 追加（去掉文件尾空白行后加空行 + 区块）
    return String(content).replace(/\s*$/, '') + '\n\n' + section + '\n';
  }

  /** 读取窗口数据：文件是否存在 + 字段列表 + 默认字段（供窗口初始行）+ 文件路径 */
  function data() {
    const raw = readRaw();
    const { items, hasSection } = parseSections(raw);
    return { exists: raw !== null, hasSection, items, defaultFields: DEFAULT_FIELDS.slice(), file: file() };
  }

  return { file, data, save, DEFAULT_FIELDS, SECTION_TITLE };
}

module.exports = { createGlobalMemory, FILE_NAME, SECTION_TITLE, DEFAULT_FIELDS, TEMPLATE };
