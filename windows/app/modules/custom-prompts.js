'use strict';

/**
 * DSH-Desktop — 自定义提示词模块（v0.9.5 T2）
 *
 * 职责：管理用户自建提示词（userData/custom-prompts.json）：
 *  - 文件不存在 → 空库 { categories: [], items: [] }
 *  - JSON 损坏 → 备份 .bak + 空库（不崩溃，不丢原文件）
 *  - 写盘原子化：先写 <file>.tmp 再 rename（防写一半损坏）
 *  - id 生成：Date.now() + 4 位随机后缀
 *  - 保存：有 id 更新（同名替换）、无 id 新增；cat 缺省「我的」
 *
 * 数据格式：
 * {
 *   "categories": ["我的工作", "我的学习"],
 *   "items": [
 *     { "id": "c1", "cat": "我的工作", "name": "周报生成",
 *       "content": "根据以下信息生成周报：[工作内容]…",
 *       "hint": "把 [工作内容] 换成你本周做的事", "created": "2026-08-17" }
 *   ]
 * }
 *
 * 依赖注入（deps）：
 *  - fs / path                  Node 模块
 *  - app                         Electron app（getPath('userData')）
 *  - appendLog                  日志模块
 */

function createCustomPrompts(deps) {
  const { fs, path, app, appendLog } = deps;

  const DEFAULT_CAT = '我的';

  function file() {
    return path.join(app.getPath('userData'), 'custom-prompts.json');
  }

  /** 空库 */
  function emptyLib() {
    return { categories: [], items: [] };
  }

  /**
   * 读库：不存在 → 空库；损坏 → 备份 .bak + 空库（不崩溃）。
   * @returns {{categories: string[], items: Array}}
   */
  function read() {
    const f = file();
    if (!fs.existsSync(f)) return emptyLib();
    try {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!data || !Array.isArray(data.items)) return emptyLib();
      // 容错脏数据：字段字符串化，缺省补默认值
      const items = data.items.map((it) => ({
        id: String(it.id || ''), cat: String(it.cat || DEFAULT_CAT),
        name: String(it.name || ''), content: String(it.content || ''),
        hint: String(it.hint || ''), created: String(it.created || ''),
      }));
      const categories = Array.isArray(data.categories)
        ? data.categories.map(String)
        : Array.from(new Set(items.map((i) => i.cat))).filter(Boolean);
      return { categories, items };
    } catch (err) {
      // 损坏：备份原文件（可手工恢复），返回空库继续使用
      try { fs.copyFileSync(f, `${f}.bak`); } catch { /* ignore */ }
      appendLog('warn', `自定义提示词文件损坏，已备份 ${f}.bak 并按空库处理：${err.message}`);
      return emptyLib();
    }
  }

  /** 原子写盘：先写 .tmp 再 rename */
  function write(lib) {
    const f = file();
    const tmp = `${f}.tmp`;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(lib, null, 2), 'utf8');
    fs.renameSync(tmp, f);
  }

  /** 生成 id：Date.now() + 4 位随机后缀 */
  function newId() {
    return `c${Date.now()}${Math.floor(Math.random() * 10000)}`;
  }

  /**
   * 保存条目：有 id → 更新（保持 created 不变）；无 id → 新增。
   * 校验：name / content 非空字符串；cat 缺省 DEFAULT_CAT。
   * @returns {{ok: boolean, item?: object, reason?: string}}
   */
  function save(item) {
    const name = String((item && item.name) || '').trim();
    const content = String((item && item.content) || '').trim();
    if (!name) return { ok: false, reason: 'empty-name' };
    if (!content) return { ok: false, reason: 'empty-content' };
    const lib = read();
    const cat = String((item && item.cat) || '').trim() || DEFAULT_CAT;
    const hint = String((item && item.hint) || '').trim();
    const today = new Date().toISOString().slice(0, 10);
    let savedItem;
    if (item && item.id && lib.items.some((it) => it.id === item.id)) {
      // 更新：保留 created
      lib.items = lib.items.map((it) => (it.id === item.id
        ? { id: it.id, cat, name, content, hint, created: it.created || today }
        : it));
      savedItem = lib.items.find((it) => it.id === item.id);
    } else {
      const entry = {
        id: newId(), cat, name, content, hint,
        created: (item && item.created) || today,
      };
      lib.items.push(entry);
      savedItem = entry;
    }
    // 维护分类表（新增分类自动记录）
    if (!lib.categories.includes(cat)) lib.categories = [...lib.categories, cat];
    write(lib);
    return { ok: true, item: savedItem };
  }

  /** 删除条目（按 id）；返回删除后的库 */
  function remove(id) {
    const lib = read();
    lib.items = lib.items.filter((it) => it.id !== id);
    write(lib);
    return lib;
  }

  return { read, save, remove, newId, DEFAULT_CAT, file };
}

module.exports = { createCustomPrompts };
