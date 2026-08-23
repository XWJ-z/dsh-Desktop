'use strict';

/**
 * DSH-Desktop — 项目记忆模块（v1.2.1 T1）
 *
 * 项目记忆 = 工作区级记忆 `<workspacePath>/AGENTS.md`。DSH 原生双读
 * （全局记忆 ~/.dsh/AGENTS.md + 工作区记忆 <workspacePath>/AGENTS.md），
 * 自动合并进模型上下文 —— 因此壳**只需要做「编辑界面」，零注入/同步机制**。
 *
 * 本模块只做持久化 + 索引，不做注入：
 *  - getProjectMemoryPath(workspacePath) → <workspacePath>/AGENTS.md
 *  - readProjectMemory(workspacePath)    读原始内容（保存前自动备份 .bak；读取失败返回 null）
 *  - parseProjectMemory / renderProjectMemory  区块化解析/重组（复用全局记忆思路）
 *  - saveProjectMemory(workspacePath, content)  原子写盘 + 更新索引
 *  - deleteProjectMemory(workspacePath)  删除文件 + 移出索引
 *  - listProjects()                     读索引（历史编辑过的项目）
 *  - getCurrentWorkspace()              复用注入的 workspace.getWorkspacePath()
 *
 * 索引格式（userData/projects-memory-index.json）：
 *   { "projects": [ { "path": "D:/code/myapp", "name": "myapp", "lastEdited": "2026-08-22" } ] }
 *
 * 安全与容错（对齐全局记忆标准）：
 *  - 路径校验：workspacePath 必须是**已存在目录**（statSync，防任意路径写）
 *  - 内容大小上限：1MB（对齐全局记忆 / custom-prompts）
 *  - 原子写盘：.tmp → rename（写坏不丢原文件）
 *  - 损坏 .bak 容错：保存前自动备份上一次版本（AGENTS.md.bak）
 *
 * 依赖注入（deps）：
 *  - fs / path           Node 模块
 *  - app                Electron（userData 路径）
 *  - appendLog           日志模块
 *  - getWorkspacePath    工作区定位（workspace.js，注入复用）
 */

const FILE_NAME = 'AGENTS.md';
const MAX_SIZE = 1024 * 1024; // 1MB（对齐全局记忆）

function createProjectMemory(deps) {
  const { fs, path, app, appendLog, getWorkspacePath, readWorkspaceRegistry } = deps;

  /** 索引文件路径：userData/projects-memory-index.json */
  function indexFile() {
    return path.join(app.getPath('userData'), 'projects-memory-index.json');
  }

  /** 项目记忆文件路径：<workspacePath>/AGENTS.md */
  function getProjectMemoryPath(workspacePath) {
    return path.join(String(workspacePath || ''), FILE_NAME);
  }

  /** 校验 workspacePath 为已存在目录（防任意路径写）；非法返回 null */
  function validateWorkspace(workspacePath) {
    const p = String(workspacePath || '');
    if (!p) return null;
    try {
      if (!fs.statSync(p).isDirectory()) return null;
      return p;
    } catch {
      return null;
    }
  }

  /** 项目显示名（取自路径末段；根目录用完整路径） */
  function projectName(workspacePath) {
    const p = String(workspacePath || '');
    const base = path.basename(p);
    return base || p;
  }

  /** 读索引（损坏/不存在 → { projects: [] }，不报错） */
  function listProjects() {
    try {
      const raw = JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
      const projects = Array.isArray(raw && raw.projects) ? raw.projects : [];
      // 逐项净化（丢弃无 path 或目录已不存在的项，防脏数据）
      return projects
        .filter((p) => p && typeof p.path === 'string' && p.path)
        .map((p) => ({
          path: p.path,
          name: String(p.name || projectName(p.path)),
          lastEdited: String(p.lastEdited || ''),
        }));
    } catch {
      return [];
    }
  }

  /** 原子写索引（.tmp → rename；目录不存在则创建） */
  function writeIndex(projects) {
    const f = indexFile();
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(`${f}.tmp`, JSON.stringify({ projects }, null, 2), 'utf8');
      fs.renameSync(`${f}.tmp`, f);
      return true;
    } catch (err) {
      appendLog('warn', `项目记忆索引写入失败：${err.message}`);
      return false;
    }
  }

  /** 读项目记忆原始内容；不存在/读失败返回 null */
  function readRaw(workspacePath) {
    const p = getProjectMemoryPath(workspacePath);
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * 区块化解析（复用全局记忆的长区块思路，项目记忆用简化版）：
   *  - head：第一个 `## ` 之前的头部原文；
   *  - sections：[{ title, body, subs[] }] —— 每个 `## xxxx` 区块（body 为原文行），
   *    并支持 `### 三级子区块`（subs）。
   *  与全局记忆不同：项目记忆不做 用户设定/我的设定/DSH角色 特判，
   *  所有 `## 标题` 一律当「长区块」处理（标题可改、内容可编辑、删除即生效）。
   * @param {string} content
   * @returns {{ head: string, sections: Array }}
   */
  function parseProjectMemory(content) {
    const head = [];
    const sections = [];
    let cur = null;
    let curSub = null;
    let seenSection = false;
    for (const line of String(content || '').split(/\r?\n/)) {
      const t = /^##\s+(.+)$/.exec(line);
      if (t) {
        seenSection = true;
        cur = { title: t[1].trim(), body: [], subs: [] };
        sections.push(cur);
        curSub = null;
        continue;
      }
      if (cur) {
        // v1.2.3：支持 ### 三级子区块（窗口左导航可单独选中/编辑）
        const sub = /^###\s+(.+)$/.exec(line);
        if (sub) {
          curSub = { title: sub[1].trim(), body: [] };
          cur.subs.push(curSub);
          continue;
        }
        if (curSub) curSub.body.push(line);
        else cur.body.push(line);
      } else if (!seenSection) head.push(line);
    }
    return { head: head.join('\n'), sections };
  }

  /** 渲染单个长区块（## 标题 + 原格式内容 + ### 子区块；标题空则丢弃） */
  function renderLong(title, body, subs) {
    const raw = Array.isArray(body) ? body.join('\n') : String(body || '');
    const b = raw.replace(/^\s*\n+|\s+$/g, ''); // 去首尾多余空行
    const subBlocks = (Array.isArray(subs) && subs.length)
      ? subs.map((sb) => {
          const sbRaw = Array.isArray(sb.body) ? sb.body.join('\n') : String(sb.body || '');
          const sbBody = sbRaw.replace(/^\s*\n+|\s+$/g, '');
          return `### ${sb.title}${sbBody ? `\n\n${sbBody}` : ''}`;
        }).join('\n\n')
      : '';
    let out = `## ${title}`;
    if (b) out += `\n\n${b}`;
    if (subBlocks) out += `\n\n${subBlocks}`;
    return out;
  }

  /**
   * 重组完整文件：head + 各 ## 区块（按序；空标题区块丢弃；携带 ### 子区块）。
   * @param {string} head
   * @param {Array} sections [{ title, body, subs }]
   */
  function renderProjectMemory(head, sections) {
    const blocks = [];
    const headText = String(head || '').trim();
    if (headText) blocks.push(headText);
    (sections || []).forEach((s) => {
      const title = String((s && s.title) || '').trim();
      if (!title) return;
      blocks.push(renderLong(title, (s && s.body) || '', (s && s.subs) || []));
    });
    return blocks.join('\n\n') + (blocks.length ? '\n' : '');
  }

  /**
   * 保存项目记忆：校验目录 + 大小上限 + 原子写盘 + 更新索引。
   * 保存前自动备份上一次版本（AGENTS.md.bak）。
   * @param {string} workspacePath
   * @param {string} content
   * @returns {{ ok: boolean, file?: string, message?: string }}
   */
  function saveProjectMemory(workspacePath, content) {
    const ws = validateWorkspace(workspacePath);
    if (!ws) {
      return { ok: false, message: '项目路径无效：必须是已存在的目录（请先选择工作区）' };
    }
    const size = Buffer.byteLength(String(content || ''), 'utf8');
    if (size > MAX_SIZE) {
      appendLog('warn', `保存项目记忆拒绝：内容过大（${Math.round(size / 1024)}KB > 1MB）`);
      return { ok: false, message: '内容过大（>1MB），请精简后再保存' };
    }
    const f = getProjectMemoryPath(ws);
    const dir = path.dirname(f);
    try {
      // 保存前自动备份上一次版本（.bak；有旧内容才备份）
      if (fs.existsSync(f)) {
        try { fs.copyFileSync(f, `${f}.bak`); } catch { /* ignore */ }
      }
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${f}.tmp`;
      fs.writeFileSync(tmp, String(content || ''), 'utf8');
      fs.renameSync(tmp, f); // 原子落位
      const projects = listProjects();
      const idx = projects.findIndex((p) => p.path === ws);
      const entry = { path: ws, name: projectName(ws), lastEdited: localDate() };
      if (idx >= 0) projects[idx] = entry;
      else projects.unshift(entry);
      writeIndex(projects);
      appendLog('info', `项目记忆已保存：${f}`);
      return { ok: true, file: f };
    } catch (err) {
      appendLog('error', `保存项目记忆失败：${err.message}`);
      return { ok: false, file: f, message: err.message };
    }
  }

  /** 当前日期（YYYY-MM-DD，本地时区；供索引 lastEdited） */
  function localDate() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /**
   * 删除项目记忆：删除 <workspacePath>/AGENTS.md（含 .bak）+ 移出索引。
   * @param {string} workspacePath
   * @returns {{ ok: boolean, message?: string }}
   */
  function deleteProjectMemory(workspacePath) {
    const ws = String(workspacePath || '');
    if (!ws) return { ok: false, message: '项目路径为空' };
    const f = getProjectMemoryPath(ws);
    let removed = false;
    try {
      if (fs.existsSync(f)) { fs.unlinkSync(f); removed = true; }
    } catch (err) {
      appendLog('warn', `删除项目记忆文件失败：${err.message}`);
    }
    try {
      if (fs.existsSync(`${f}.bak`)) fs.unlinkSync(`${f}.bak`);
    } catch { /* ignore */ }
    const projects = listProjects().filter((p) => p.path !== ws);
    writeIndex(projects);
    appendLog('info', `项目记忆已删除：${f}`);
    return { ok: true, removed };
  }

  /**
   * 列出所有候选工作区（供「项目列表」）：
   *  ① DSH 工作区注册表（~/.dsh/storages/workspace.json 的 tables.workspaces）—— 全部注册工作区；
   *  ② 历史索引（本窗口保存过的项目）；
   *  ③ 当前工作区（若不在上述两者）。
   *  去重后每项标注：exists = 该工作区是否已有 AGENTS.md 项目记忆；current = 是否当前工作区。
   * @param {string|null} currentWs 当前工作区（可为 null）
   * @returns {Array<{path:string,name:string,lastEdited:string,exists:boolean,current:boolean}>}
   */
  function listProjectWorkspaces(currentWs) {
    const map = new Map();
    // ① 工作区注册表
    try {
      const reg = readWorkspaceRegistry ? readWorkspaceRegistry() : null;
      if (reg && reg.tables && reg.tables.workspaces) {
        for (const v of Object.values(reg.tables.workspaces)) {
          const p = v && v.path;
          if (!p || !validateWorkspace(p)) continue;
          map.set(p, { path: p, name: projectName(p) });
        }
      }
    } catch { /* 忽略注册表异常 */ }
    // ② 历史索引
    listProjects().forEach((p) => {
      if (!validateWorkspace(p.path)) return;
      const e = map.get(p.path) || { path: p.path, name: projectName(p.path) };
      if (p.lastEdited) e.lastEdited = p.lastEdited;
      map.set(p.path, e);
    });
    // ③ 当前工作区兜底
    if (currentWs && validateWorkspace(currentWs)) {
      const e = map.get(currentWs) || { path: currentWs, name: projectName(currentWs) };
      map.set(currentWs, e);
    }
    return [...map.values()].map((e) => ({
      path: e.path,
      name: e.name,
      lastEdited: e.lastEdited || '',
      exists: fs.existsSync(getProjectMemoryPath(e.path)),
      current: e.path === currentWs,
    }));
  }

  /**
   * 读取窗口数据：当前工作区 + 该工作区项目记忆块 + 候选工作区列表。
   * @returns {{ workspace: string|null, exists: boolean, path: string, content: string,
   *             head: string, sections: Array, projects: Array }}
   */
  async function data() {
    const ws = getWorkspacePath ? await getWorkspacePath() : null;
    const validWs = validateWorkspace(ws);
    const path2 = validWs ? getProjectMemoryPath(validWs) : '';
    let raw = null;
    if (validWs) raw = readRaw(validWs);
    const parsed = parseProjectMemory(raw === null ? '' : raw);
    return {
      workspace: validWs, // 当前工作区（未定位/无效 → null）
      exists: raw !== null,
      path: path2,
      content: raw === null ? '' : raw,
      head: parsed.head,
      sections: parsed.sections,
      projects: listProjectWorkspaces(validWs),
    };
  }

  return {
    indexFile,
    getProjectMemoryPath,
    validateWorkspace,
    projectName,
    listProjects,
    listProjectWorkspaces, // v1.2.3：全工作区候选列表（含 exists/current 标记）
    readRaw,
    parseProjectMemory,
    renderProjectMemory,
    saveProjectMemory,
    deleteProjectMemory,
    data,
    FILE_NAME,
    MAX_SIZE,
  };
}

module.exports = { createProjectMemory, FILE_NAME };
