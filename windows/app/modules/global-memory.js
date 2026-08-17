'use strict';

/**
 * DSH-Desktop — 全局记忆模块（v0.9.12，老大指令修正版）
 *
 * 全局记忆 = DSH 原生 `~/.dsh/AGENTS.md`（DSH 启动时自动读取，无需手动发送）。
 * 本模块提供图形化编辑：
 *  - 首次没有 AGENTS.md → 自动创建模板；
 *  - 窗口表单只管理「基础设定」区块（## 基础设定（DSH-Desktop 图形化编辑）），
 *    保存时做区块级替换：文件其余内容（用户手写的其他记忆）原样保留；
 *  - 原子写盘（.tmp → rename），不丢数据。
 *
 * 依赖注入（deps）：
 *  - fs / os / path           Node 模块（路径 ~/.dsh/AGENTS.md 经 os.homedir()）
 *  - appendLog                日志模块
 */

const FILE_NAME = 'AGENTS.md';

/** 基础设定区块标题（表单管理的区块；其余内容不动） */
const SECTION_TITLE = '基础设定（DSH-Desktop 图形化编辑）';

/** 基础设定字段（表单顺序即写入顺序） */
const FIELDS = ['我的姓名', '身份/角色', '语言风格', '输出习惯', '项目背景', '常用约定'];

/** 首次创建时的模板（含基础设定区块 + 使用引导 + 其他记忆区） */
const TEMPLATE = `# AGENTS.md（全局记忆）

> 此文件由 DSH-Desktop「全局记忆」窗口维护，DSH 会自动读取其中的内容作为长期记忆（无需手动发送）。
> 「基础设定」请用窗口中的表单编辑；其他内容可自行追加到「其他记忆」区。

## ${SECTION_TITLE}

- 我的姓名：
- 身份/角色：
- 语言风格：
- 输出习惯：
- 项目背景：
- 常用约定：

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
   * 逐行匹配 `- 字段名：值` 回填表单；其余内容不解析（保存时原样保留）。
   * @returns {{ form: Object, hasSection: boolean }}
   */
  function parseSections(content) {
    const form = {};
    FIELDS.forEach((f) => { form[f] = ''; });
    let hasSection = false;
    if (!content) return { form, hasSection };
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
        if (m && Object.prototype.hasOwnProperty.call(form, m[1].trim())) {
          form[m[1].trim()] = m[2].trim();
        }
      }
    }
    return { form, hasSection };
  }

  /** 渲染基础设定区块文本 */
  function renderSection(form) {
    const lines = [`## ${SECTION_TITLE}`, ''];
    FIELDS.forEach((f) => {
      lines.push(`- ${f}：${form[f] || ''}`);
    });
    return lines.join('\n');
  }

  /**
   * 保存：把基础设定区块替换为表单内容；文件不存在 → 建模板；
   * 已有但无该区块 → 追加到文件末尾；其余内容一字不动。
   * @returns {{ ok: boolean, file: string, message?: string }}
   */
  function save(form) {
    const clean = {};
    FIELDS.forEach((f) => { clean[f] = String((form && form[f]) || '').trim(); });
    const section = renderSection(clean);
    const raw = readRaw();
    let content;
    if (raw === null) {
      // 首次：模板 + 基础设定区块（模板已含，直接以模板为底再补区块占位即可）
      content = TEMPLATE;
      // 模板里已有空的基础设定区块 → 用表单内容替换
      content = replaceSection(content, section);
    } else {
      content = replaceSection(raw, section);
    }
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

  /** 读取窗口数据：文件是否存在 + 基础设定表单 + 文件路径 */
  function data() {
    const raw = readRaw();
    const { form, hasSection } = parseSections(raw);
    return { exists: raw !== null, hasSection, form, file: file() };
  }

  return { file, data, save, FIELDS, SECTION_TITLE };
}

module.exports = { createGlobalMemory, FILE_NAME, SECTION_TITLE, FIELDS, TEMPLATE };
