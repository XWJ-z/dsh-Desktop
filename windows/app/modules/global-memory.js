'use strict';

/**
 * DSH-Desktop — 全局记忆模块（v1.0.2，区块化识别版）
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
 * v1.0.2（老大反馈 2026-08-18）角色文件全文同步：
 *  - **UI 编辑框 = 角色 .md 文件全文**（含 # 角色 / ## 定位 / ## 详细记忆），
 *    保存时全文写回 ~/.dsh/roles/<名>.md；AGENTS.md 的 DSH 角色区块行只存
 *    「角色名：定位」（定位 = 全文 ## 定位 节第一行，extractRoleDesc）；
 *  - **改名/删除文件同步**：保存时对比 AGENTS.md 旧角色名与新提交角色名，
 *    消失的角色删除其 .md（内容由窗口内存携带，无需真 rename）；
 *  - data() 返回 mtime 供窗口聚焦自动刷新（外部修改文件立即同步）。
 *
 * 依赖注入（deps）：
 *  - fs / os / path           Node 模块（路径 ~/.dsh/AGENTS.md 经 os.homedir()）
 *  - appendLog                日志模块
 */

const FILE_NAME = 'AGENTS.md';

/** 三个独立顶层区块（v0.9.13 老大方案：全局记忆是 DSH 的视角 —— 用户设定/我的设定/DSH 角色） */
const USER_SECTION = '用户设定';
const DSH_SECTION = '我的设定';          // v0.9.13：原「DSH 设定」改「我的设定」（DSH 视角）
const ROLES_SECTION = 'DSH 角色';

/** 旧版「DSH 设定」标题（兼容迁移：解析时归入「我的设定」） */
const LEGACY_DSH_SECTION = 'DSH 设定';

/** 旧版「基础设定」容器标题（兼容迁移：解析时拆成独立区块） */
const LEGACY_SECTION = '基础设定（DSH-Desktop 图形化编辑）';

/** 旧版角色设定子标题（兼容迁移：归入 DSH 设定） */
const LEGACY_ROLE_TITLE = '角色设定（DSH 扮演）';

/**
 * 旧版字段名 → DSH 视角新字段名（v0.9.14 老大反馈：旧窗口保存的 AGENTS.md 仍是
 * 「你的称呼 / DSH 的名字」等旧视角字段，解析时自动迁移，窗口与保存均显示新名）。
 */
const FIELD_MIGRATE = {
  '你的称呼': '用户的称呼',
  '你的身份/角色': '用户的身份/角色',
  '项目背景': '当前项目',
  'DSH 的名字': '我的名字',
};

/** 旧版模板头部特征句（含旧「DSH 设定」视角说明）→ 解析时替换为 DSH 视角新头部 */
const LEGACY_HEAD_MARK = '此文件由 DSH-Desktop「全局记忆」窗口维护';

/** 角色文件目录（~/.dsh/roles/，每个角色一个 md；AGENTS.md 只记录定位+文件名，避免文档过大） */
const ROLES_DIR = 'roles';

/** 角色名长度上限（v1.0.3 老大反馈 2：不超过 30 字符） */
const MAX_ROLE_NAME = 30;

/** v1.0.5（老大反馈 3）：DSH 角色区块的「角色记忆」说明句 —— 对话时 DSH 能知道各角色记忆文件的地址 */
const ROLE_NOTE_FIELD = '**角色记忆**';
const ROLE_NOTE_TEXT = '各角色的详细记忆写入 `~/.dsh/roles/` 下对应角色文件。';

/** v1.0.5（老大反馈 4）：全局记忆备份文件名（保存前自动备份上一次版本，解析异常时可一键恢复） */
const BACKUP_NAME = 'AGENTS.md.bak';

/** 未配置引导句的字段名与内容（老大指令 2026-08-17：第一次对话引导用户配置全局记忆） */
const GUIDE_FIELD = '引导提示';
const GUIDE_TEXT = '【请在对话中引导用户点击宠物/工具箱图标 进行配置全局记忆，或者发送给我进行配置。配置完成后删除此句】';

/**
 * 标准格式整理提示词（v0.9.13 老大指令）：检测到已存在记忆但不符合标准格式
 * （缺 用户设定 / DSH 设定 区块）→ 注入到聊天窗口，让 DSH 按此格式整理。
 */
const FORMAT_TIDY_PROMPT = `请按照以下标准格式整理你的全局记忆（~/.dsh/AGENTS.md），不要改变原意，把现有内容归类到对应区块（注意：这是 DSH 的视角，「用户设定」记录用户，「我的设定」记录 DSH 自己）：

# AGENTS.md（全局记忆）

## 用户设定

- 用户的称呼：
- 用户的身份/角色：
- 当前项目：
- 常用约定：

## 我的设定

- 我的名字：
- 语气风格：
- 输出习惯：
- 默认角色：角色 1

## DSH 角色

- ${ROLE_NOTE_FIELD}：${ROLE_NOTE_TEXT}
- 角色 1：角色定位（文件：~/.dsh/roles/角色 1.md）
- 角色 2：角色定位（文件：~/.dsh/roles/角色 2.md）
- 角色 3：角色定位（文件：~/.dsh/roles/角色 3.md）

## 其他记忆

（其他原有内容放在这里；各角色的详细记忆写入 ~/.dsh/roles/ 下对应角色文件）`;

/** 内置默认用户设定字段（v0.9.13 老大方案：DSH 视角 —— "用户的…"） */
const DEFAULT_FIELDS = ['用户的称呼', '用户的身份/角色', '当前项目', '常用约定'];

/** 内置默认 DSH（我的）设定字段（DSH 视角；默认角色为下拉选择） */
const DEFAULT_DSH_FIELDS = ['我的名字', '语气风格', '输出习惯', '默认角色'];

/** 内置默认角色字段（v0.9.13：角色 1/2/3，值 = 定位 + 角色文件名；可增删） */
const DEFAULT_ROLES = ['角色 1', '角色 2', '角色 3'];

/** 首次创建时的模板（头部 + 用户设定 + 我的设定 + DSH 角色 + 其他记忆区；DSH 视角说明） */
const TEMPLATE = `# AGENTS.md（全局记忆）

> 本文件是 DSH 的全局记忆（DSH 视角）：「用户设定」记录用户是谁、「我的设定」记录 DSH 自己
> （名字/语气/默认角色）、「DSH 角色」记录可切换的角色（详细记忆在 ~/.dsh/roles/ 角色文件）。
> 请用 DSH-Desktop「全局记忆」窗口编辑；其他内容可追加到「其他记忆」区。

## ${USER_SECTION}

${DEFAULT_FIELDS.map((f) => `- ${f}：`).join('\n')}

## ${DSH_SECTION}

${DEFAULT_DSH_FIELDS.map((f) => `- ${f}：`).join('\n')}

## ${ROLES_SECTION}

- ${ROLE_NOTE_FIELD}：${ROLE_NOTE_TEXT}
${DEFAULT_ROLES.map((f) => `- ${f}：`).join('\n')}

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
   *  - head：第一个 `## ` 之前的头部原文（保留原样）；
   *  - sections：[{ title, kind }] —— 用户设定 kind='users'（fields 字段行 + guide 标记）、
   *    DSH 设定 kind='dsh'（fields 字段行）、其他 `## xxxx` kind='long'（body 原文行）。
   *  - 旧版「基础设定」容器 → 拆成 用户设定/DSH 设定 两个独立区块（迁移）。
   * @returns {{ head: string, sections: Array }}
   */
  function parse(content) {
    const head = [];
    const sections = [];
    let cur = null;
    let legacy = null; // 旧容器缓冲区 { u, d, group }
    let seenSection = false;
    const lines = String(content || '').split(/\r?\n/);
    /** v0.9.14：旧字段名 → DSH 视角新字段名（老大反馈：旧文件仍是「你的称呼/DSH 的名字」） */
    const migrateName = (name) => (Object.prototype.hasOwnProperty.call(FIELD_MIGRATE, name) ? FIELD_MIGRATE[name] : name);
    const flushLegacy = () => {
      if (legacy) {
        sections.push(legacy.u, legacy.d);
        legacy = null;
      }
    };
    for (const line of lines) {
      const t = /^##\s+(.+)$/.exec(line);
      if (t) {
        flushLegacy();
        seenSection = true;
        const title = t[1].trim();
        if (title === USER_SECTION) {
          sections.push({ title, kind: 'users', fields: [], guide: false });
          cur = sections[sections.length - 1];
        } else if (title === DSH_SECTION || title === LEGACY_DSH_SECTION) {
          // v0.9.13：旧「DSH 设定」→ 归入「我的设定」（kind dsh）
          sections.push({ title: DSH_SECTION, kind: 'dsh', fields: [] });
          cur = sections[sections.length - 1];
        } else if (title === ROLES_SECTION) {
          sections.push({ title, kind: 'roles', fields: [] });
          cur = sections[sections.length - 1];
        } else if (title === LEGACY_SECTION) {
          // 旧容器：拆成 用户设定 + DSH 设定 两个独立区块（内部 ### 子组路由）
          legacy = {
            u: { title: USER_SECTION, kind: 'users', fields: [], guide: false },
            d: { title: DSH_SECTION, kind: 'dsh', fields: [] },
            group: 'users',
          };
          cur = legacy.u;
        } else {
          sections.push({ title, kind: 'long', body: [] });
          cur = sections[sections.length - 1];
        }
        continue;
      }
      if (cur) {
        if (legacy) {
          // 旧容器内部：### 子组路由 + 引导句 + 字段行
          const sub = /^###\s+(.+)$/.exec(line);
          if (sub) {
            const st = sub[1].trim();
            legacy.group = (st === USER_SECTION || st === LEGACY_ROLE_TITLE) ? 'dsh' : 'users';
            if (st === USER_SECTION || st === DSH_SECTION || st === LEGACY_ROLE_TITLE) {
              cur = legacy.group === 'dsh' ? legacy.d : legacy.u;
            } else {
              cur = legacy.u;
            }
            continue;
          }
          const m = /^-\s*([^：:]+)[：:]\s*(.*)$/.exec(line);
          if (m) {
            const name = m[1].trim();
            if (name === GUIDE_FIELD) { legacy.u.guide = true; continue; }
            const item = { name: migrateName(name), value: m[2].trim() };
            if (legacy.group === 'dsh') legacy.d.fields.push(item);
            else legacy.u.fields.push(item);
          }
        } else if (cur.kind === 'users' || cur.kind === 'dsh' || cur.kind === 'roles') {
          const m = /^-\s*([^：:]+)[：:]\s*(.*)$/.exec(line);
          if (m) {
            const name = m[1].trim();
            if (name === GUIDE_FIELD) { cur.guide = true; continue; }
            // v1.0.5（老大反馈 3）：「角色记忆」说明句是固定引导行，不算字段（防保存时重复累积）
            if (cur.kind === 'roles' && name === ROLE_NOTE_FIELD) { cur.roleNote = true; continue; }
            cur.fields.push({ name: migrateName(name), value: m[2].trim() });
          }
        } else {
          cur.body.push(line);
        }
      } else if (!seenSection) {
        head.push(line);
      }
    }
    flushLegacy();
    // v0.9.14：旧模板头部（含旧「DSH 设定」视角说明）→ 替换为 DSH 视角新头部；用户自定义头部不含特征句则原样保留
    let headText = head.join('\n');
    if (headText.includes(LEGACY_HEAD_MARK)) headText = templateHead().trim();
    return { head: headText, sections };
  }

  /** 渲染用户设定区块（字段行；guide=true 时带未配置引导句） */
  function renderUsers(fields, guide) {
    const lines = [`## ${USER_SECTION}`, ''];
    if (guide) lines.push(`- ${GUIDE_FIELD}：${GUIDE_TEXT}`);
    (fields || []).forEach((it) => {
      const name = String(it.name || '').trim();
      if (!name || name === GUIDE_FIELD) return;
      lines.push(`- ${name}：${String(it.value || '').trim()}`);
    });
    return lines.join('\n');
  }

  /** 渲染 DSH 设定区块（字段行） */
  function renderDsh(fields) {
    const ds = (fields || []).filter((it) => String(it.name || '').trim() !== '');
    if (ds.length === 0) return null; // 空则不输出（保持简洁）
    const lines = [`## ${DSH_SECTION}`, ''];
    ds.forEach((it) => {
      lines.push(`- ${it.name.trim()}：${String(it.value || '').trim()}`);
    });
    return lines.join('\n');
  }

  /** 渲染 DSH 角色区块（字段行；始终输出区块标题，保证标准格式完整）
   *  v1.0.5（老大反馈 3）：roleNote=true 时固定输出「角色记忆」说明句（DSH 对话时知道角色记忆文件地址） */
  function renderRoles(fields, roleNote) {
    const lines = [`## ${ROLES_SECTION}`, ''];
    if (roleNote) lines.push(`- ${ROLE_NOTE_FIELD}：${ROLE_NOTE_TEXT}`);
    (fields || []).forEach((it) => {
      const name = String(it.name || '').trim();
      if (!name) return;
      lines.push(`- ${name}：${String(it.value || '').trim()}`);
    });
    return lines.join('\n');
  }

  /** 角色文件名安全化（非法字符 → '-'，防路径穿越） */
  function safeRoleFileName(name) {
    const n = String(name || '').trim().replace(/[\\/:*?"<>|\s]+/g, '-');
    return n || 'role';
  }

  /** 角色文件路径：~/.dsh/roles/<安全名>.md */
  function roleFile(name) {
    return path.join(os.homedir(), '.dsh', ROLES_DIR, `${safeRoleFileName(name)}.md`);
  }

  /** 读取角色文件全文；不存在/读失败返回 ''（v1.0.2：UI 编辑框 = 文件全文） */
  function readRoleFile(name) {
    try {
      return fs.readFileSync(roleFile(name), 'utf8');
    } catch {
      return '';
    }
  }

  /** 角色文件模板（首次创建；详细记忆写入对应角色文件，避免 AGENTS.md 过大） */
  function roleFileTemplate(name, desc) {
    return `# 角色：${String(name || '').trim()}\n\n## 定位\n\n${String(desc || '').trim()}\n\n## 详细记忆\n\n（此角色的详细记忆写在这里，DSH 切换到此角色时按本文件内容扮演。）\n`;
  }

  /**
   * 从角色文件全文提取「定位」（AGENTS.md 角色行只存短定位）：
   *  - 优先取 `## 定位` 节第一个非空行；
   *  - 无 ## 定位 节 → 取全文第一个非空且非 `# ` 标题行。
   */
  function extractRoleDesc(content) {
    const c = String(content || '');
    const m = /##\s*定位\s*\n+([\s\S]*?)(?=\n##\s|\s*$)/.exec(c);
    const section = m ? m[1] : '';
    const firstLine = section.split(/\r?\n/).map((s) => s.trim()).find((s) => s !== '');
    if (firstLine) return firstLine;
    const fallback = c.split(/\r?\n/).map((s) => s.trim()).find((s) => s !== '' && !/^#\s/.test(s));
    return fallback || '';
  }

  /** 保证角色文件首行标题与角色名一致（`# 角色：<名>`；无标题行则插入） */
  function ensureRoleTitle(content, name) {
    const lines = String(content || '').split('\n');
    const head = `# 角色：${String(name || '').trim()}`;
    if (lines[0] && /^#\s*角色/.test(lines[0])) lines[0] = head;
    else lines.unshift(head);
    return lines.join('\n');
  }

  /**
   * 解析角色文件全文为「定位 + 其余内容」（v1.0.3 老大反馈 4：字段输入化）：
   *  - desc：`## 定位` 节全文（trim，多行保留）；无该节返回 ''；
   *  - rest：其余全部内容（含 `## 详细记忆` 节与用户其他自定义 ## 区块，原样保留不丢数据）；
   *  - 首行 `# 角色：xxx` 标题剥离（renderRoleContent 会按角色名重新生成）。
   * @param {string} content 角色 .md 全文
   * @returns {{ desc: string, rest: string }}
   */
  function parseRoleContent(content) {
    let c = String(content || '');
    const titleM = /^#\s*角色[：:][^\n]*\n+/.exec(c);
    if (titleM) c = c.slice(titleM[0].length);
    const m = /##\s*定位\s*\n+([\s\S]*?)(?=\n##\s|\s*$)/.exec(c);
    if (!m) return { desc: '', rest: c.replace(/^\s*\n+|\s*$/g, '') };
    const desc = m[1].replace(/^\s*\n+|\s*$/g, '');
    const rest = (c.slice(0, m.index) + c.slice(m.index + m[0].length)).replace(/^\s*\n+|\s*$/g, '');
    return { desc, rest };
  }

  /**
   * 组装角色文件全文（v1.0.3：字段输入 → 标准结构模板）：
   * `# 角色：<名>` + `## 定位` + `## 详细记忆` —— 结构字段由程序生成，用户不会误删。
   * @param {string} name 角色名
   * @param {string} desc 定位（## 定位 节）
   * @param {string} rest 详细记忆及其他内容（## 详细记忆 节；若已带节标题则去重）
   * @returns {string} 角色 .md 全文
   */
  function renderRoleContent(name, desc, rest) {
    let r = String(rest || '').trim();
    // 避免与生成的节标题重复（rest 来自 parseRoleContent 时可能带原 ## 详细记忆 标题）
    if (/^##\s*详细记忆\s*\n+/.test(r)) r = r.replace(/^##\s*详细记忆\s*\n+/, '');
    return `# 角色：${String(name || '').trim()}\n\n## 定位\n\n${String(desc || '').trim()}\n\n## 详细记忆\n\n${r}\n`;
  }

  /**
   * 角色文件同步（v1.0.2 老大反馈：改名残留旧文件 / 文件全文不同步）：
   * 保存后角色文件目录状态 = UI 角色列表状态：
   *  - 消失的角色（旧名不在新集合）→ 删除其 .md（改名场景内容由窗口内存携带，
   *    写回新文件时 ensureRoleTitle 保持标题一致，无需真 rename）；
   *  - 每个新角色 → 全文写回（空内容 → 模板）。
   * @param {Array} prevRoles 旧角色名列表（AGENTS.md 解析；[{name}] 或 [name]）
   * @param {Array} roles     新角色 [{ name, value: 全文 }]
   */
  function syncRoleFiles(prevRoles, roles) {
    const next = new Set((roles || []).map((r) => String((r && r.name) || '').trim()).filter(Boolean));
    (prevRoles || []).forEach((r) => {
      const name = String((r && r.name) || r || '').trim();
      if (!name || next.has(name)) return;
      const f = roleFile(name);
      try {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
          appendLog('info', `角色文件已删除（角色移除/改名）：${f}`);
        }
      } catch (err) {
        appendLog('warn', `删除角色文件失败（${name}）：${err.message}`);
      }
    });
    (roles || []).forEach((r) => {
      const name = String((r && r.name) || '').trim();
      if (!name) return;
      const f = roleFile(name);
      const content = String((r && r.value) || '');
      const finalContent = content.trim()
        ? ensureRoleTitle(content, name)
        : roleFileTemplate(name, extractRoleDesc(content));
      try {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, finalContent, 'utf8');
      } catch (err) {
        appendLog('warn', `写入角色文件失败（${name}）：${err.message}`);
      }
    });
  }

  /** 确保每个角色的角色文件存在（v0.9.13 老大方案 2；v1.0.2 起 = 仅创建不删除的兼容封装） */
  function ensureRoleFiles(roles) {
    syncRoleFiles([], roles);
  }

  /** 渲染长文本区块（## 标题 + 原格式内容） */
  function renderLong(title, body) {
    // 防御：body 可能是数组（解析产物）或字符串（窗口提交），统一为字符串
    const raw = Array.isArray(body) ? body.join('\n') : String(body || '');
    const b = raw.replace(/^\s*\n+|\s+$/g, ''); // 去首尾多余空行
    return `## ${title}${b ? `\n\n${b}` : ''}`;
  }

  /**
   * 重组完整文件：head + 用户设定 + DSH 设定 + DSH 角色 + 其他区块（按序）。
   * @param {string} head
   * @param {Array} sections [{ title, kind: 'users'|'dsh'|'roles'|'long', fields?|guide?|body? }]
   */
  function render(head, sections) {
    const blocks = [];
    let usersBlock = null;
    let dshBlock = null;
    let rolesBlock = null;
    const others = [];
    for (const s of sections) {
      if (s.kind === 'users') usersBlock = renderUsers(s.fields || [], !!s.guide);
      else if (s.kind === 'dsh') dshBlock = renderDsh(s.fields || []);
      else if (s.kind === 'roles') rolesBlock = renderRoles(s.fields || [], !!s.roleNote);
      else if (s.kind === 'long') others.push(renderLong(s.title, s.body));
    }
    if (usersBlock === null) usersBlock = renderUsers([], false);
    if (rolesBlock === null) rolesBlock = renderRoles([]); // 角色区块始终输出（标准格式完整）
    const headText = String(head || '').trim() || templateHead().trim();
    blocks.push(headText, usersBlock);
    if (dshBlock) blocks.push(dshBlock);
    blocks.push(rolesBlock);
    blocks.push(...others);
    return blocks.join('\n\n') + '\n';
  }

  /**
   * 保存：用窗口提交的用户/DSH 设定 + 区块内容重组文件。
   * 配置完成（用户设定有非空值）→ 移除未配置引导句。
   * @param {{ users?: Array, dsh?: Array, fields?: Array, roles?: Array, sections?: Array }} payload
   * @returns {{ ok: boolean, file: string, message?: string }}
   */
  function save(payload) {
    const p = payload || {};
    // N1（外审 zx(9) 复核）：payload 大小上限 1MB（对齐 custom-prompts P3-2，防被攻破的渲染进程写任意大文件到 ~/.dsh/AGENTS.md）
    let payloadSize;
    try { payloadSize = JSON.stringify(p).length; } catch { payloadSize = Number.MAX_SAFE_INTEGER; }
    if (payloadSize > 1024 * 1024) {
      appendLog('warn', `保存全局记忆拒绝：内容过大（${Math.round(payloadSize / 1024)}KB > 1MB）`);
      return { ok: false, file: file(), message: '内容过大（>1MB），请精简后再保存' };
    }
    const clean = (arr) => (Array.isArray(arr) ? arr : [])
      // N2（外审 zx(9) 复核）：字段值内换行替换为空格，防止把「- 字段：值」撕成多行破坏 markdown 字段解析
      .map((it) => ({ name: String((it && it.name) || '').trim(), value: String((it && it.value) || '').trim().replace(/\r?\n/g, ' ') }))
      .filter((it) => it.name !== '' && it.name !== GUIDE_FIELD);
    // 兼容旧 payload 字段名（fields/roles → users/dsh）
    const users = clean(p.users !== undefined ? p.users : p.fields);
    const dsh = clean(p.dsh !== undefined ? p.dsh : p.roles);
    // v1.0.2（老大反馈）：角色 value = 角色 .md 全文 —— 不能过 clean（换行→空格会毁全文），单独处理
    // v1.0.3（老大反馈 4）：窗口按「定位 / 详细记忆」固定字段提交，此处组装标准结构全文；
    // 兼容旧 payload（value = 全文，无 desc/memory 字段）→ 解析拆分再组装（不丢数据）；
    // v1.0.3（老大反馈 2）：角色名长度限制 ≤30 字符（前端 maxlength + 主进程校验双保险）
    const roles = (Array.isArray(p.roles) ? p.roles : [])
      .map((it) => {
        const name = String((it && it.name) || '').trim();
        if ((it && it.desc != null) || (it && it.memory != null)) {
          return {
            name,
            desc: String((it && it.desc) || ''),
            memory: String((it && it.memory) != null ? it.memory : (it && it.value) || ''),
          };
        }
        const { desc, rest } = parseRoleContent(String((it && it.value) || ''));
        return { name, desc, memory: rest };
      })
      .filter((it) => it.name !== '');
    for (const r of roles) {
      if (r.name.length > MAX_ROLE_NAME) {
        return { ok: false, file: file(), message: `角色名「${r.name}」超过 ${MAX_ROLE_NAME} 字符限制，请缩短后保存` };
      }
    }
    const roleContents = roles.map((it) => ({ name: it.name, value: renderRoleContent(it.name, it.desc, it.memory) }));
    // 配置完成判定：用户设定有非空值 → 不输出引导句
    const configured = users.some((it) => it.value !== '');
    const guide = !configured;
    // 其他长文本区块（窗口顺序；标题非空才保留）
    const longSections = (Array.isArray(p.sections) ? p.sections : [])
      .map((s) => ({ title: String((s && s.title) || '').trim(), body: String((s && s.body) || '') }))
      .filter((s) => s.title !== '');
    const raw = readRaw();
    // v1.0.5（老大反馈 4）：保存前自动备份上一次版本（.bak；有旧内容才备份，首次保存无需）
    if (raw !== null) writeBackup();
    // v1.0.2（老大反馈 5①）：改名/删除 → 角色 .md 文件同步（旧文件不再残留堆积）
    const prevParsed = raw === null ? parse(TEMPLATE) : parse(raw);
    const prevRolesSec = prevParsed.sections.find((s) => s.kind === 'roles');
    const prevRoles = prevRolesSec ? (prevRolesSec.fields || []).map((f) => ({ name: f.name })) : [];
    syncRoleFiles(prevRoles, roleContents);
    // 重组：首次用完整模板解析，已有文件保留原头部与区块（旧「基础设定」容器自动迁移）
    const { head, sections } = raw === null ? parse(TEMPLATE) : parse(raw);
    // v0.9.12（老大反馈：保存没写入）：按序覆盖 —— 窗口区块顺序 = 原文件区块顺序，
    // 第 i 个长区块用窗口第 i 个提交值（标题与内容都可修改生效），原文件没有的新区块追加末尾。
    const merged = [];
    // v1.0.2：AGENTS.md 角色行只存短定位（desc），全文在 ~/.dsh/roles/ 文件
    const roleLines = roleContents.map((r) => ({ name: r.name, value: extractRoleDesc(r.value) }));
    let usersPlaced = false;
    let dshPlaced = false;
    let rolesPlaced = false;
    // v1.0.5（老大反馈 1）：修复「删除 ## 区块后保存又刷新出来」——
    // 长区块以窗口提交集合为最终状态：原文件有、窗口未提交的区块 = 已删除（不保留）；
    // 同标题匹配原位覆盖（标题/内容以窗口为准）；窗口新增标题追加末尾。
    const submittedLongs = longSections.slice();
    const usedTitles = new Set();
    for (const s of sections) {
      if (s.kind === 'users') {
        merged.push({ title: USER_SECTION, kind: 'users', fields: users, guide });
        usersPlaced = true;
      } else if (s.kind === 'dsh') {
        merged.push({ title: DSH_SECTION, kind: 'dsh', fields: dsh });
        dshPlaced = true;
      } else if (s.kind === 'roles') {
        merged.push({ title: ROLES_SECTION, kind: 'roles', fields: roleLines, roleNote: true });
        rolesPlaced = true;
      } else {
        const idx = submittedLongs.findIndex((it) => it.title === s.title && !usedTitles.has(it.title));
        if (idx >= 0) {
          usedTitles.add(submittedLongs[idx].title);
          merged.push({ title: submittedLongs[idx].title, kind: 'long', body: submittedLongs[idx].body });
        }
        // 原文件有、窗口未提交 → 不 push（删除生效）
      }
    }
    if (!usersPlaced) merged.unshift({ title: USER_SECTION, kind: 'users', fields: users, guide });
    if (!rolesPlaced) merged.push({ title: ROLES_SECTION, kind: 'roles', fields: roleLines, roleNote: true });
    if (!dshPlaced) merged.splice(merged.findIndex((s) => s.kind === 'users') + 1, 0, { title: DSH_SECTION, kind: 'dsh', fields: dsh });
    // 窗口新增的 ## 区块（原文件没有的标题）追加末尾
    submittedLongs.forEach((it) => {
      if (!usedTitles.has(it.title)) merged.push({ title: it.title, kind: 'long', body: it.body });
    });
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

  /**
   * 未配置引导 + 格式检测（老大指令）：
   *  - 用户还没配置过全局记忆 → 在「用户设定」区块加引导句（DSH 第一次对话引导配置）；
   *  - 已存在记忆但**不符合标准格式**（缺 用户设定/DSH 设定 区块）→ 返回 formatMismatch，
   *    main.js 据此向聊天窗口注入 FORMAT_TIDY_PROMPT 让 DSH 按格式整理。
   * 每次启动调用，幂等；配置保存后 save() 自动删除引导句。
   * @returns {{ ok: boolean, guided: boolean, formatMismatch: boolean, file: string }}
   */
  function ensureGuide() {
    try {
      const raw = readRaw();
      let content;
      let guided = false;
      let formatMismatch = false;
      if (raw === null) {
        // 首次：创建模板 + 引导句（插入用户设定区块）
        const { head, sections } = parse(TEMPLATE);
        content = render(head, sections.map((s) => (s.kind === 'users' ? { ...s, fields: [], guide: true } : s)));
        guided = true;
      } else {
        const { head, sections } = parse(raw);
        const usersSec = sections.find((s) => s.kind === 'users');
        const dshSec = sections.find((s) => s.kind === 'dsh');
        // v0.9.13：格式检测 —— 标准格式 = 同时存在 用户设定 + DSH 设定 区块
        formatMismatch = !usersSec || !dshSec;
        const configured = usersSec && usersSec.fields.some((it) => it.value !== '');
        if (!configured && usersSec && !usersSec.guide) {
          // 未配置且无引导句 → 插入
          content = render(head, sections.map((s) => (s.kind === 'users' ? { ...s, guide: true } : s)));
          guided = true;
        } else {
          return { ok: true, guided: false, formatMismatch, file: file() };
        }
      }
      const f = file();
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = `${f}.tmp`;
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, f);
      appendLog(guided ? 'info' : 'debug', `全局记忆引导检查：引导句${guided ? '已插入' : '无变化'}，格式${formatMismatch ? '不符合标准（待整理）' : '符合'} → ${f}`);
      return { ok: true, guided, formatMismatch, file: f };
    } catch (err) {
      appendLog('error', `全局记忆引导检查失败：${err.message}`);
      return { ok: false, guided: false, formatMismatch: false, file: file(), message: err.message };
    }
  }

  /**
   * 保存前自动备份：把当前 AGENTS.md 复制为 AGENTS.md.bak（每次保存覆盖为"上一次版本"）。
   * v1.0.5（老大反馈 4）：怕手改/程序写坏文件 → 备份 + 解析异常一键恢复。
   * @returns {boolean} 是否成功备份（无旧文件返回 true，无需备份）
   */
  function writeBackup() {
    try {
      const f = file();
      if (fs.existsSync(f)) {
        fs.copyFileSync(f, backupFile());
        appendLog('debug', `全局记忆已备份：${backupFile()}`);
      }
      return true;
    } catch (err) {
      appendLog('warn', `备份全局记忆失败：${err.message}`);
      return false;
    }
  }

  /** 备份文件路径：~/.dsh/AGENTS.md.bak */
  function backupFile() {
    return path.join(os.homedir(), '.dsh', BACKUP_NAME);
  }

  /**
   * 一键恢复：把 AGENTS.md.bak 复制回 AGENTS.md（恢复前把当前文件保留为 .corrupt 防二次丢失）。
   * @returns {{ ok: boolean, file?: string, message?: string }}
   */
  function restoreBackup() {
    const bak = backupFile();
    if (!fs.existsSync(bak)) return { ok: false, message: '没有可用备份（AGENTS.md.bak）' };
    try {
      const f = file();
      if (fs.existsSync(f)) {
        fs.copyFileSync(f, `${f}.corrupt`);
        appendLog('info', `恢复前已保留当前文件：${f}.corrupt`);
      }
      fs.copyFileSync(bak, f);
      appendLog('info', `已从备份恢复全局记忆：${f}`);
      return { ok: true, file: f };
    } catch (err) {
      appendLog('error', `恢复全局记忆失败：${err.message}`);
      return { ok: false, message: err.message };
    }
  }

  /**
   * 解析异常检测：文件存在、内容非空、但解析不出任何区块 → 视为损坏
   * （正常 AGENTS.md 必有 ## 区块；空文件/全空白不算损坏）。
   * v1.0.5（老大反馈 4）：窗口据此提示「从备份一键恢复」。
   * @returns {boolean}
   */
  function isCorrupt() {
    try {
      const raw = readRaw();
      if (raw === null) return false;
      const parsed = parse(raw);
      return raw.trim() !== '' && parsed.sections.length === 0;
    } catch {
      return true;
    }
  }

  /**
   * 读取窗口数据：头部 + 全部区块 + 默认字段 + 文件路径 + 角色目录。
   * v1.0.2（老大反馈 5②）：DSH 角色 fields 的 value = 角色 .md 文件全文，desc = 定位。
   * v1.0.2b（老大反馈 2026-08-18：外部改角色 .md 后需重开窗口才刷新）：返回 signature =
   * AGENTS.md mtime + 各角色文件 mtime/size —— 聚焦刷新对比 signature，角色文件变更也能检测到。
   * v1.0.5（老大反馈 4）：返回 corrupt —— 解析异常标记，窗口提示一键恢复。
   */
  function data() {
    const raw = readRaw();
    // v1.0.5：首次（无文件）也用模板解析 —— 窗口首次打开即可见「其他记忆」等模板区块，
    // 保存时窗口提交完整集合（v1.0.5 起区块集合 = 最终状态，模板区块不提交会被视为删除）
    const parsed = raw === null ? parse(TEMPLATE) : parse(raw);
    const rolesSec = parsed.sections.find((s) => s.kind === 'roles');
    const roleNames = rolesSec && rolesSec.fields.length > 0
      ? rolesSec.fields.map((f) => f.name)
      : DEFAULT_ROLES.slice();
    const rolesFields = roleNames
      .map((name) => String(name || '').trim())
      .filter(Boolean)
      .map((name) => {
        const content = readRoleFile(name);
        // v1.0.3（老大反馈 4）：拆成「定位 + 详细记忆」字段 —— value = 详细记忆及其他内容，
        // desc = ## 定位 节全文（窗口以固定字段输入展示，结构字段不再裸露给用户手改）
        const { desc, rest } = parseRoleContent(content);
        return { name, value: rest, desc };
      });
    const mtime = (() => { try { return raw === null ? null : fs.statSync(file()).mtimeMs; } catch { return null; } })();
    const rolesStamp = rolesFields.map((r) => {
      try {
        const st = fs.statSync(roleFile(r.name));
        return `${r.name}:${st.mtimeMs}:${st.size}`;
      } catch {
        return `${r.name}:missing`;
      }
    }).join('|');
    return {
      exists: raw !== null,
      head: parsed.head,
      sections: parsed.sections.map((s) => (s.kind === 'roles' ? { ...s, fields: rolesFields } : s)),
      defaultFields: DEFAULT_FIELDS.slice(),
      defaultDshFields: DEFAULT_DSH_FIELDS.slice(),
      defaultRoles: DEFAULT_ROLES.slice(),
      file: file(),
      rolesDir: path.join(os.homedir(), '.dsh', ROLES_DIR), // v1.0.1（老大指令）：窗口左下角显示角色文件目录
      mtime,
      signature: `${String(mtime)}|${rolesStamp}`, // v1.0.2b：AGENTS.md + 角色文件 变更指纹
      corrupt: isCorrupt(), // v1.0.5（老大反馈 4）：解析异常标记 → 窗口提示一键恢复
    };
  }

  return {
    file, data, save, parse, ensureGuide,
    roleFile, roleFileTemplate, ensureRoleFiles, safeRoleFileName,
    readRoleFile, extractRoleDesc, ensureRoleTitle, syncRoleFiles, // v1.0.2：角色文件全文同步
    parseRoleContent, renderRoleContent, // v1.0.3：角色字段输入化（定位/详细记忆）
    writeBackup, restoreBackup, isCorrupt, backupFile, // v1.0.5：备份 / 一键恢复 / 损坏检测
    DEFAULT_FIELDS, DEFAULT_DSH_FIELDS, DEFAULT_ROLES, USER_SECTION, DSH_SECTION, ROLES_SECTION,
    GUIDE_FIELD, GUIDE_TEXT, FORMAT_TIDY_PROMPT,
    MAX_ROLE_NAME, // v1.0.3：角色名长度上限（30）
    ROLE_NOTE_FIELD, ROLE_NOTE_TEXT, // v1.0.5：DSH 角色区块「角色记忆」说明句
  };
}

module.exports = {
  createGlobalMemory, FILE_NAME, USER_SECTION, DSH_SECTION, ROLES_SECTION, LEGACY_SECTION, LEGACY_DSH_SECTION, LEGACY_ROLE_TITLE,
  GUIDE_FIELD, GUIDE_TEXT, FORMAT_TIDY_PROMPT, DEFAULT_FIELDS, DEFAULT_DSH_FIELDS, DEFAULT_ROLES, TEMPLATE,
  MAX_ROLE_NAME, // v1.0.3：角色名长度上限（30）
  ROLE_NOTE_FIELD, ROLE_NOTE_TEXT, BACKUP_NAME, // v1.0.5：角色记忆说明句 / 备份文件名
};
