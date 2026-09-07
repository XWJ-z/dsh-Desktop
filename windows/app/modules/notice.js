'use strict';

/**
 * DSH-Desktop — 公告模块（v0.9.5 T3；v2.0.6 公告改走DSH服务器）
 *
 * 职责：公告源（服务器 + GitHub 三源兜底）+ 本地缓存：
 *  - 优先从服务器拉取（config.json 的 noticeUpdate.apiUrl → GET /data）
 *  - 服务器不可达/无效 → 回退 GitHub 三源（notice.json：jsDelivr/api.github/raw）
 *  - 取 schema 版本号（version 字段）最高者
 *  - 拉取失败 → 保留上次缓存（菜单公告条不闪没）
 *  - 缓存落 userData/notice-cache.json（重启不丢）
 *  - 菜单栏公告条 marquee / 公告窗口 items 均来自本模块
 *  - v0.9.7：定时轮询（main.js 10 分钟）—— 版本未变静默（不刷日志），变化才记录
 *
 * 公告结构：{ version, updated, marquee, items: [{id,title,date,content}] }
 *
 * 依赖注入（deps）：
 *  - app / fs / path
 *  - appendLog
 *  - fetchJson      updater 模块导出（8s 超时 + 5MB 上限）
 *  - readShellConfig  读取 config.json（取 noticeUpdate.apiUrl）
 */

// v1.1.3 重构：三源 URL 集中到 remote-sources.js（仅作服务器失败时的兜底）
const { NOTICE_URLS } = require('./remote-sources');

const DEFAULT_MARQUEE = '欢迎加入 QQ 群 916607090';

function createNoticeModule(deps) {
  const { app, fs, path, appendLog, fetchJson, readShellConfig } = deps;

  let cached = null; // { version, updated, marquee, items }
  // v0.9.7：定时轮询时版本未变不刷日志（避免每 10 分钟一条噪音）；null = 尚未成功拉取过
  let lastFetchedVersion = null;

  function cacheFile() {
    return path.join(app.getPath('userData'), 'notice-cache.json');
  }

  /** 从 config.json 读公告接口地址（单源）；无配置返回 null */
  function apiBase() {
    try {
      const cfg = readShellConfig();
      const u = cfg.noticeUpdate && cfg.noticeUpdate.apiUrl;
      return u ? String(u) : null;
    } catch {
      return null;
    }
  }

  function dataUrl() {
    const b = apiBase();
    return b ? `${b}/data` : null;
  }

  /** 解析单个 GitHub 源响应（容错脏数据）；无效返回 null */
  function parse(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
      version: Number(raw.version) || 0,
      updated: String(raw.updated || ''),
      marquee: String(raw.marquee || ''),
      items: Array.isArray(raw.items)
        ? raw.items.map((n) => ({
          id: String(n.id || ''), title: String(n.title || ''),
          date: String(n.date || ''), content: String(n.content || ''),
        }))
        : [],
    };
  }

  /** 解析服务器 /data 响应（{ ok, version, updated, marquee, data[] }）；无效返回 null */
  function parseServer(raw) {
    if (!raw || !raw.ok || !Array.isArray(raw.data)) return null;
    return {
      version: Number(raw.version) || 0,
      updated: String(raw.updated || ''),
      marquee: String(raw.marquee || ''),
      items: raw.data.map((n) => ({
        id: String(n.id || ''), title: String(n.title || ''),
        date: String(n.date || ''), content: String(n.content || ''),
      })),
    };
  }

  /** 落缓存 + 记录（仅版本变化或首次成功记日志） */
  function apply(notice) {
    cached = notice;
    writeCache(notice);
    if (notice.version !== lastFetchedVersion) {
      appendLog('info', `公告已更新：v${notice.version}`);
      lastFetchedVersion = notice.version;
    }
    return notice;
  }

  /** 写缓存（原子：先 .tmp 再 rename） */
  function writeCache(notice) {
    try {
      const f = cacheFile();
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(`${f}.tmp`, JSON.stringify(notice, null, 2), 'utf8');
      fs.renameSync(`${f}.tmp`, f);
    } catch (err) {
      appendLog('warn', `公告缓存写入失败：${err.message}`);
    }
  }

  /** 从服务器拉取（优先）；失败/无效返回 null */
  async function fetchServer() {
    const url = dataUrl();
    if (!url) return null;
    try {
      const payload = await fetchJson(url);
      const n = parseServer(payload);
      if (n && n.version > 0) return apply(n);
      appendLog('warn', '服务器公告数据无效，回退 GitHub 三源');
    } catch (err) {
      appendLog('warn', `服务器公告拉取失败：${err.message}，回退 GitHub 三源`);
    }
    return null;
  }

  /** GitHub 三源并发拉取（兜底），取 schema 版本号最高者；全部失败返回 null */
  async function fetchGithub() {
    const results = await Promise.all(NOTICE_URLS.map((s) =>
      fetchJson(s.url, 8000, s.headers || {}).then(parse)));
    const valid = results.filter((r) => r !== null);
    if (valid.length === 0) {
      appendLog('warn', `公告拉取失败：${NOTICE_URLS.length}/${NOTICE_URLS.length} 源不可达（沿用缓存）`);
      return null;
    }
    valid.sort((a, b) => (a.version > b.version ? -1 : a.version < b.version ? 1 : 0));
    const best = valid[0];
    cached = best;
    writeCache(best);
    if (best.version !== lastFetchedVersion) {
      const detail = NOTICE_URLS.map((s, i) => `${s.name}=${results[i] ? results[i].version : '×'}`).join(', ');
      appendLog('info', `公告拉取：${valid.length}/${NOTICE_URLS.length} 源可达（${detail}），取 v${best.version}`);
      lastFetchedVersion = best.version;
    }
    return best;
  }

  /** 拉取公告：服务器优先，失败回退 GitHub 三源 */
  async function fetchLatest() {
    const server = await fetchServer();
    if (server) return server;
    return fetchGithub();
  }

  /** 启动时读缓存（同步；损坏/不存在 → null，不报错） */
  function loadCache() {
    try {
      if (fs.existsSync(cacheFile())) {
        cached = parse(JSON.parse(fs.readFileSync(cacheFile(), 'utf8')));
      }
    } catch { cached = null; }
    return cached;
  }

  /** 当前公告列表（缓存/已拉取） */
  function getNotices() {
    return (cached && cached.items) || [];
  }

  /** 当前菜单公告条文案（缓存/已拉取；空 → 默认） */
  function getMarquee() {
    return (cached && cached.marquee) || DEFAULT_MARQUEE;
  }

  return { loadCache, fetchLatest, getNotices, getMarquee, NOTICE_URLS };
}

module.exports = { createNoticeModule };
