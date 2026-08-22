'use strict';

/**
 * DSH-Desktop — 公告模块（v0.9.5 T3）
 *
 * 职责：独立公告源（仓库根 notice.json）三源并发拉取 + 本地缓存：
 *  - 三源：jsDelivr / api.github.com( raw ) / raw.githubusercontent
 *  - 取 schema 版本号（version 字段）最高者（与 version.json 三源同逻辑）
 *  - 拉取失败 → 保留上次缓存（菜单公告条不闪没）
 *  - 缓存落 userData/notice-cache.json（重启不丢）
 *  - 菜单栏公告条 marquee / 公告窗口 items 均来自本模块
 *  - v0.9.7：定时轮询（main.js 10 分钟）—— 版本未变静默（不刷日志），变化才记录
 *
 * notice.json 结构：
 * {
 *   "version": 1,
 *   "updated": "2026-08-17",
 *   "marquee": "v0.9.5 增加…",          // 菜单栏最右端纯文字
 *   "items": [ { "id", "title", "date", "content" } ]  // 公告窗口列表
 * }
 *
 * 依赖注入（deps）：
 *  - app / fs / path
 *  - appendLog
 *  - fetchJson      updater 模块导出（8s 超时 + 5MB 上限）
 */

// v1.1.3 重构：三源 URL 集中到 remote-sources.js
const { NOTICE_URLS } = require('./remote-sources');

const DEFAULT_MARQUEE = '欢迎加入 QQ 群 916607090';

function createNoticeModule(deps) {
  const { app, fs, path, appendLog, fetchJson } = deps;

  let cached = null; // { version, updated, marquee, items }
  // v0.9.7：定时轮询时版本未变不刷日志（避免每 10 分钟一条噪音）；null = 尚未成功拉取过
  let lastFetchedVersion = null;

  function cacheFile() {
    return path.join(app.getPath('userData'), 'notice-cache.json');
  }

  /** 解析单个源响应（容错脏数据）；无效返回 null */
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

  /** 启动时读缓存（同步；损坏/不存在 → null，不报错） */
  function loadCache() {
    try {
      if (fs.existsSync(cacheFile())) {
        cached = parse(JSON.parse(fs.readFileSync(cacheFile(), 'utf8')));
      }
    } catch { cached = null; }
    return cached;
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

  /** 三源并发拉取，取 schema 版本号最高者；全部失败返回 null（保留缓存） */
  async function fetchLatest() {
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
    // v0.9.7：仅版本变化（或首次成功）记日志；定时轮询拉到相同版本静默
    if (best.version !== lastFetchedVersion) {
      const detail = NOTICE_URLS.map((s, i) => `${s.name}=${results[i] ? results[i].version : '×'}`).join(', ');
      appendLog('info', `公告拉取：${valid.length}/${NOTICE_URLS.length} 源可达（${detail}），取 v${best.version}`);
      lastFetchedVersion = best.version;
    }
    return best;
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
