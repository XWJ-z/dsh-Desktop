'use strict';

/**
 * DSH-Desktop — 技能库模块（v1.2.1 T4）
 *
 * 职责：
 *  - listInstalled()：扫描 DSH 技能目录（对齐官方扫描顺序），读取 SKILL.md frontmatter
 *    → [{ name, desc, whenToUse, level: 'user'|'project', path }]
 *  - saveSkill({ name, description, whenToUse, body })：写 ~/.dsh/skills/<name>/SKILL.md（原子 + 大小上限）
 *  - deleteSkill(name)：删目录（kebab-case 校验）
 *  - 技能市场：列表走DSH服务器（skills-updater.js 版本检测 + 数据下载 + 本地缓存，安装包零内置）
 *    → 安装 = 按条目从来源仓库 GitHub raw 拉 SKILL.md 写本地。
 *    技能条目含 install_req（安装要求）：纯文本直接可用 / 需配套资源仅拉正文（前端展示，
 *    复制安装指令）。市场列表为多来源精选（Anthropic 官方 anthropics/skills 等）。
 *
 * 技能 = 纯文本指令（YAML + Markdown），本地写入无代码执行风险；但内容会注入模型上下文，
 * 安装时提示来源（前端展示安全提示常驻）。
 *
 * 目录扫描顺序（对齐 DSH 官方；dedup 按 name，先扫描者优先 = 项目级覆盖用户级）：
 *   项目 <工作区>/.dsh/skills → 项目 <工作区>/.agents/skills → 用户 ~/.dsh/skills → 用户 ~/.agents/skills
 *   （未定位工作区时仅扫用户级，不报错）
 *
 * 依赖注入（deps）：
 *  - app / fs / os / path
 *  - net              Electron net（Chromium 网络栈/系统 CA，从市场安装拉 SKILL.md 用）
 *  - appendLog
 *  - getWorkspacePath  工作区定位（workspace.js，注入复用；可为 async）
 *  - skillsUpdater     技能市场服务器更新模块（getData / downloadData）
 */

const { createNetCommon } = require('./net-common'); // 2.0.1 去重：统一 Electron net 拉取

const NAME_RE = /^[a-z0-9-]+$/; // 名称 kebab-case
const MAX_SKILL_SIZE = 500 * 1024; // 技能正文上限（500KB，方案待定取此值）
// M5（代码审查 2026-09-07）：技能市场安装的来源 owner 白名单 —— 任意 owner/repo 都能装会放大
// prompt injection 攻击面（技能内容会注入模型上下文）。仅放行受信生态 owner（按需扩展）；
// 安装统一走指定分支 main（下方 URL 已固定，天然满足 branch 限制）。
const TRUSTED_SKILL_OWNERS = new Set(['anthropics', 'deepseek-ai', 'microsoft', 'google', 'openai']);

function createSkillLibrary(deps) {
  const { fs, os, path, net, appendLog, getWorkspacePath, skillsUpdater } = deps;
  // 2.0.1 去重：fetchText 改用公共 net-common 实现（原先此模块内联了一份同款逻辑；
  // 现仅「从市场安装技能」拉 SKILL.md 用 —— 市场列表走 skills-updater）
  const { fetchText } = createNetCommon({ net });

  /** DSH home 根目录（$DSH_HOME 非空优先，否则 ~/.dsh） */
  function dshHome() {
    const env = process.env.DSH_HOME;
    if (env && env.trim().length > 0) return path.resolve(env.trim());
    return path.join(os.homedir(), '.dsh');
  }

  function userSkillDir() {
    return path.join(dshHome(), 'skills');
  }

  /** 技能名严格校验：必须是 kebab-case（^[a-z0-9-]+$）通过，否则返回 ''（含路径穿越防护） */
  function safeName(name) {
    const n = String(name || '').trim().toLowerCase();
    return NAME_RE.test(n) ? n : '';
  }

  /** 从 SKILL.md 解析 frontmatter（极简 YAML key: value + 缩进续行）；无 frontmatter 返回 {} */
  function parseFrontmatter(content) {
    const c = String(content || '');
    const m = /^\uFEFF?\s*---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(c);
    if (!m) return {};
    const fm = {};
    let lastKey = null;
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
      if (kv) {
        lastKey = kv[1];
        let v = kv[2].trim();
        const q = /^["'`](.*)["'`]$/.exec(v);
        if (q) v = q[1];
        fm[lastKey] = v;
      } else if (line.trim() && lastKey && /^\s+\S/.test(line)) {
        // 缩进续行（如 description: |-\n   多行）→ 拼接到 lastKey
        const extra = line.trim();
        if (fm[lastKey]) fm[lastKey] += '\n' + extra;
        else fm[lastKey] = extra;
      }
    }
    return fm;
  }

  /** 读取单个技能的元信息；frontmatter 缺 name/description 或名称非法 → 跳过（警告不崩） */
  function readSkillMeta(file, fallbackName) {
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
    const fm = parseFrontmatter(raw);
    let name = String(fm.name || fallbackName || '').trim().toLowerCase();
    if (!name || !NAME_RE.test(name)) {
      appendLog('warn', `技能跳过（名称缺失或非法，应为 kebab-case）：${file}`);
      return null;
    }
    const body = raw.replace(/^\s*---\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/, '');
    return {
      name,
      desc: String(fm.description || '').trim(),
      whenToUse: String(fm.whenToUse || '').trim(),
      path: file,
      body: body.trim(),
      size: Buffer.byteLength(raw, 'utf8'),
    };
  }

  /** 扫描单个技能目录（子目录含 SKILL.md + 直接 *.md） */
  function scanDir(dir, level) {
    const out = [];
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        if (e.isDirectory()) {
          let f = path.join(full, 'SKILL.md');
          if (!fs.existsSync(f)) {
            const alt = path.join(full, `${e.name}.md`);
            if (fs.existsSync(alt)) f = alt;
            else continue;
          }
          const meta = readSkillMeta(f, e.name);
          if (meta) out.push({ ...meta, name: meta.name, level });
        } else if (e.isFile() && /\.md$/i.test(e.name)) {
          const base = e.name.slice(0, -3);
          const meta = readSkillMeta(full, base);
          if (meta) out.push({ ...meta, name: meta.name, level });
        }
      } catch {
        /* 单个目录读取失败跳过，不崩 */
      }
    }
    return out;
  }

  /** 待扫描目录（项目级优先；dedup 后项目覆盖用户） */
  async function scanDirs() {
    const dirs = [
      { dir: userSkillDir(), level: 'user' },
      { dir: path.join(os.homedir(), '.agents', 'skills'), level: 'user' },
    ];
    try {
      const ws = getWorkspacePath ? await getWorkspacePath() : null;
      if (ws) {
        dirs.unshift({ dir: path.join(ws, '.agents', 'skills'), level: 'project' });
        dirs.unshift({ dir: path.join(ws, '.dsh', 'skills'), level: 'project' });
      }
    } catch { /* 未定位工作区 → 仅用户级 */ }
    return dirs;
  }

  /** 扫描全部已装技能（dedup by name，项目优先）；未定位工作区仅用户级 */
  async function listInstalled() {
    const byName = new Map();
    for (const { dir, level } of await scanDirs()) {
      for (const s of scanDir(dir, level)) {
        if (!byName.has(s.name)) byName.set(s.name, s);
      }
    }
    return Array.from(byName.values());
  }

  /** 组装 SKILL.md 内容（frontmatter + 正文） */
  function renderSkill({ name, description, whenToUse, body }) {
    const fm = ['---', `name: ${String(name || '').trim()}`];
    if (description) {
      // 多行描述用 |- 块标量，避免 YAML 换行解析歧义
      const d = String(description);
      if (d.includes('\n')) {
        fm.push('description: >-');
        d.split(/\r?\n/).forEach((l) => fm.push(`  ${l}`));
      } else fm.push(`description: ${d}`);
    }
    if (whenToUse) fm.push(`whenToUse: ${String(whenToUse).trim()}`);
    fm.push('---');
    const head = fm.join('\n');
    const b = String(body || '').replace(/^\s*\n+|\s+$/g, '');
    return head + '\n' + (b ? '\n' + b + '\n' : '\n');
  }

  /**
   * 保存技能：写 ~/.dsh/skills/<name>/SKILL.md（原子，大小上限，kebab-case 校验）。
   * @param {{ name: string, description?: string, whenToUse?: string, body?: string }} payload
   * @returns {{ ok: boolean, message?: string, path?: string }}
   */
  function saveSkill(payload) {
    const p = payload || {};
    const name = safeName(p.name);
    if (!name) return { ok: false, message: '技能名称必须是小写 kebab-case（a-z、数字、连字符）' };
    const body = String(p.body || '');
    if (body.trim() === '') return { ok: false, message: '技能正文不能为空' };
    if (Buffer.byteLength(body, 'utf8') > MAX_SKILL_SIZE) {
      return { ok: false, message: `技能正文过大（>${Math.round(MAX_SKILL_SIZE / 1024)}KB），请精简` };
    }
    const dir = path.join(userSkillDir(), name);
    const f = path.join(dir, 'SKILL.md');
    const content = renderSkill({ name, description: String(p.description || ''), whenToUse: String(p.whenToUse || ''), body });
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${f}.tmp`;
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, f);
      appendLog('info', `技能已保存：${f}`);
      return { ok: true, path: f };
    } catch (err) {
      appendLog('error', `保存技能失败：${err.message}`);
      return { ok: false, message: err.message };
    }
  }

  /**
   * 读取技能正文（查看详情）：按 name 在用户级目录读 SKILL.md 全文。
   * @param {string} name
   * @returns {{ ok: boolean, name?: string, content?: string, path?: string }}
   */
  function readSkill(name) {
    const n = safeName(name);
    if (!n) return { ok: false, message: '技能名非法' };
    const f = path.join(userSkillDir(), n, 'SKILL.md');
    try {
      return { ok: true, name: n, content: fs.readFileSync(f, 'utf8'), path: f };
    } catch {
      return { ok: false, message: '未找到该技能文件' };
    }
  }

  /**
   * 删除技能（用户级目录，kebab-case 校验，防任意路径删除）。
   * @param {string} name
   */
  function deleteSkill(name) {
    const n = safeName(name);
    if (!n) return { ok: false, message: '技能名非法' };
    const dir = path.join(userSkillDir(), n);
    try {
      // 仅允许删除用户级技能目录（不在白名单路径之外）
      if (path.dirname(dir) !== userSkillDir()) return { ok: false, message: '拒绝删除非用户级技能' };
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      appendLog('info', `技能已删除：${dir}`);
      return { ok: true };
    } catch (err) {
      appendLog('error', `删除技能失败：${err.message}`);
      return { ok: false, message: err.message };
    }
  }

  // ── 技能市场（v2.0.5：市场列表完全走 DSH 服务器，安装包零内置）──
  /**
   * 确保已下载市场列表：无缓存（首装）时自动从服务器下载一次；失败返回 `[]`。
   * @returns {Promise<Array>} 技能数组
   */
  async function ensureMarketData() {
    const g = skillsUpdater.getData();
    if (!g.needsDownload) return g.data;
    appendLog('info', '技能库无缓存，自动从服务器下载…');
    const r = await skillsUpdater.downloadData();
    if (!r.ok) {
      appendLog('warn', '技能库自动下载失败，请检查网络后点刷新重试');
      return [];
    }
    return skillsUpdater.getData().data;
  }

  /** 获取技能市场列表（缓存新鲜则用缓存，否则自动下载） */
  async function getMarketList() {
    return await ensureMarketData();
  }

  /** 刷新市场列表（强制从服务器重新下载 + 落缓存） */
  async function refreshMarketList() {
    const r = await skillsUpdater.downloadData();
    return !!(r && r.ok);
  }

  /**
   * 从市场安装技能：按技能条目（repo + file）GitHub raw 拉 SKILL.md → 写 ~/.dsh/skills/<name>/SKILL.md。
   * @param {{ name, repo, file }} skill
   * @returns {{ ok: boolean, message?: string, path?: string }}
   */
  async function installFromMarket(skill) {
    const s = skill || {};
    const name = safeName(s.name);
    if (!name) return { ok: false, message: '技能名非法（kebab-case）' };
    const rf = String(s.repo || '').replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');
    if (!rf || !/^[\w.-]+\/[\w.-]+$/.test(rf)) return { ok: false, message: '技能来源仓库非法' };
    // M5（代码审查 2026-09-07）：来源 owner 白名单（防受攻陷的服务器下发任意 repo 安装恶意技能）
    const owner = rf.split('/')[0];
    if (!TRUSTED_SKILL_OWNERS.has(owner)) {
      appendLog('warn', `技能安装拒绝：来源 owner「${owner}」不在受信白名单内（${rf}）`);
      return { ok: false, message: `技能来源 owner「${owner}」不受信任，已拒绝安装（白名单见维护者配置）` };
    }
    const file = String(s.file || '');
    if (!file || /\.\./.test(file)) return { ok: false, message: '技能文件路径非法' };
    const url = `https://raw.githubusercontent.com/${rf}/main/${file}`;
    const content = await fetchText(url, 12000);
    if (!content) return { ok: false, message: '拉取技能失败（网络/404）' };
    const fm = parseFrontmatter(content);
    const fmName = String(fm.name || name).trim().toLowerCase();
    if (fmName && !NAME_RE.test(fmName)) return { ok: false, message: '技能 frontmatter name 非法' };
    if (Buffer.byteLength(content, 'utf8') > MAX_SKILL_SIZE) return { ok: false, message: '技能内容过大（>500KB）' };
    const dir = path.join(userSkillDir(), name);
    const f = path.join(dir, 'SKILL.md');
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${f}.tmp`;
      fs.writeFileSync(tmp, content, 'utf8');
      fs.renameSync(tmp, f);
      appendLog('info', `技能已从市场安装：${f}（来源 ${rf}）`);
      return { ok: true, path: f };
    } catch (err) {
      appendLog('error', `安装技能失败：${err.message}`);
      return { ok: false, message: err.message };
    }
  }

  return {
    dshHome,
    userSkillDir,
    safeName,
    parseFrontmatter,
    renderSkill,
    listInstalled,
    saveSkill,
    readSkill,
    deleteSkill,
    getMarketList,
    refreshMarketList,
    installFromMarket,
    NAME_RE,
    MAX_SKILL_SIZE,
  };
}

module.exports = { createSkillLibrary, NAME_RE };
