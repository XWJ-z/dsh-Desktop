'use strict';

/**
 * DSH-Desktop — 工作区定位模块（v0.9 T1）
 *
 * 目的：确定「当前 DSH 工作区」的绝对路径（拖文件复制进工作区的目标目录）。
 * DSH agent 只能读写「选中的工作区」文件，所以必须先知道它在哪里。
 *
 * 实证结论（2026-08-17，真机 DSH web 源码 + ~/.dsh 存储勘察）：
 *  - DSH 前端把「当前会话 id」持久化在页面 localStorage 的 `dsh.sessions.current`
 *    （dsh-client-runtime 源码：`createSnapshotStore({}, { persist: { name:
 *    "dsh.sessions.current" } })`，值为 JSON `{ "sessionId": "session-xxx" }`）。
 *  - DSH 主进程把「会话 → 工作目录」索引持久化在 `~/.dsh/storages/session_projcache.json`
 *    （`tables.sessions[<sessionId>].identity.cwd`），会话的 cwd 即其所属工作区。
 *  - 因此「当前工作区」= 当前会话的 cwd（与 DSH 前端自己的推导一致：
 *    `workspaces.find((w) => w.sessionIds.includes(current))`）。
 *  - 工作区注册表 `~/.dsh/storages/workspace.json` 只有显示顺序，不含"当前"概念，
 *    仅作无会话记录时的兜底。
 *
 * 定位策略（多级兜底）：
 *  ① 页面 localStorage 当前会话 → projcache 的 cwd（UI 真实状态，首选）
 *  ② projcache 中最近活跃会话（lastPromptAt 最大）的 cwd（localStorage 不可读时）
 *  ③ 仅注册一个工作区时直接用它的 path（全新环境无会话记录时）
 *
 * DSH home 解析：`$DSH_HOME`（非空）→ `~/.dsh`（与 dsh-home-paths 包一致）。
 *
 * 依赖注入（deps）：
 *  - fs / os / path       Node 模块
 *  - appendLog            日志模块
 */

function createWorkspaceLocator(deps) {
  const { fs, os, path, appendLog } = deps;

  /** DSH home 根目录（$DSH_HOME 非空优先，否则 ~/.dsh） */
  function dshHome() {
    const env = process.env.DSH_HOME;
    if (env && env.trim().length > 0) return path.resolve(env.trim());
    return path.join(os.homedir(), '.dsh');
  }

  /** DSH 存储目录（storages） */
  function storagesDir() {
    return path.join(dshHome(), 'storages');
  }

  /** 读 session_projcache.json（会话 → cwd 索引；缺失/损坏返回 null） */
  function readSessionProjCache() {
    try {
      const raw = fs.readFileSync(path.join(storagesDir(), 'session_projcache.json'), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** 读 workspace.json（工作区注册表；缺失/损坏返回 null） */
  function readWorkspaceRegistry() {
    try {
      const raw = fs.readFileSync(path.join(storagesDir(), 'workspace.json'), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** 从主窗口页面 localStorage 读当前会话 id（途径 A：UI 真实状态；读不到返回 null） */
  async function currentSessionIdFromPage(win) {
    if (!win || win.isDestroyed()) return null;
    try {
      const raw = await win.webContents.executeJavaScript(`
        (() => {
          try { return localStorage.getItem('dsh.sessions.current'); } catch { return null; }
        })()
      `);
      if (typeof raw !== 'string' || !raw) return null;
      const parsed = JSON.parse(raw);
      const sid = parsed && typeof parsed.sessionId === 'string' ? parsed.sessionId : '';
      return sid || null;
    } catch {
      return null;
    }
  }

  /** 会话 id → 工作区路径（projcache identity.cwd；目录必须存在才认可） */
  function workspacePathOfSession(cache, sessionId) {
    if (!cache || !sessionId) return null;
    const rec = cache.tables && cache.tables.sessions && cache.tables.sessions[sessionId];
    const cwd = rec && rec.identity && rec.identity.cwd;
    if (!cwd) return null;
    try {
      if (!fs.statSync(cwd).isDirectory()) return null;
    } catch {
      return null;
    }
    return cwd;
  }

  /** projcache 中最近活跃会话（lastPromptAt 最大，无则按 stats seq）的工作区路径 */
  function mostRecentWorkspacePath(cache) {
    if (!cache || !cache.tables || !cache.tables.sessions) return null;
    let best = null;
    let bestAt = -1;
    for (const rec of Object.values(cache.tables.sessions)) {
      const cwd = rec.identity && rec.identity.cwd;
      if (!cwd) continue;
      let at = -1;
      const meta = rec.rows && rec.rows.sessionListMetadata && rec.rows.sessionListMetadata.val;
      if (meta && typeof meta.lastPromptAt === 'number') at = meta.lastPromptAt;
      else {
        const stats = rec.rows && rec.rows.sessionStats && rec.rows.sessionStats.val;
        if (stats && typeof stats.seq === 'number') at = stats.seq;
      }
      if (at > bestAt) { bestAt = at; best = cwd; }
    }
    if (!best) return null;
    try {
      if (!fs.statSync(best).isDirectory()) return null;
    } catch {
      return null;
    }
    return best;
  }

  /** 仅注册一个工作区时直接用它的 path（无会话记录兜底） */
  function singleWorkspacePath() {
    const reg = readWorkspaceRegistry();
    if (!reg || !reg.tables || !reg.tables.workspaces) return null;
    const entries = Object.entries(reg.tables.workspaces);
    if (entries.length !== 1) return null;
    const p = entries[0][1] && entries[0][1].path;
    if (!p) return null;
    try {
      if (!fs.statSync(p).isDirectory()) return null;
    } catch {
      return null;
    }
    return p;
  }

  /**
   * 定位当前工作区绝对路径（三档兜底，见文件头说明）。
   * @param win 主窗口（用于读页面 localStorage；可为 null/已销毁）
   * @returns {Promise<string|null>} 工作区绝对路径；无法确定返回 null
   */
  async function getWorkspacePath(win) {
    const cache = readSessionProjCache();
    const sid = await currentSessionIdFromPage(win);
    if (sid) {
      const p = workspacePathOfSession(cache, sid);
      if (p) {
        appendLog('info', `工作区定位（当前会话 ${sid}）：${p}`);
        return p;
      }
    }
    const recent = mostRecentWorkspacePath(cache);
    if (recent) {
      appendLog('info', `工作区定位（最近活跃会话）：${recent}`);
      return recent;
    }
    const single = singleWorkspacePath();
    if (single) {
      appendLog('info', `工作区定位（唯一注册工作区）：${single}`);
      return single;
    }
    appendLog('warn', '工作区定位失败：无法确定当前 DSH 工作区（请先在 DSH 里选择工作区）');
    return null;
  }

  return {
    dshHome,
    storagesDir,
    readSessionProjCache,
    readWorkspaceRegistry,
    currentSessionIdFromPage,
    workspacePathOfSession,
    mostRecentWorkspacePath,
    singleWorkspacePath,
    getWorkspacePath,
  };
}

module.exports = { createWorkspaceLocator };
