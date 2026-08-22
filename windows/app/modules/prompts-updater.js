'use strict';

/**
 * DSH-Desktop — 提示词库远程更新模块（v1.1.1）
 *
 * 职责：提示词库独立远程更新：
 *  - 三源并发拉取 prompts.version.json（jsDelivr / api.github.com / raw.githubusercontent）
 *  - 版本号 > 缓存版本 → 拉取 prompts.json → 原子写缓存
 *  - 无网络/失败 → 用缓存；无缓存 → 用包内置 prompts.json（兜底）
 *  - 缓存文件：userData/prompts-cache.json
 *
 * 依赖注入（deps）：
 *  - app / fs / path
 *  - appendLog
 *  - fetchJson      updater 模块导出（8s 超时 + 5MB 上限）
 */

// v1.1.3 重构：三源 URL 集中到 remote-sources.js
const { PROMPTS_VERSION_URLS, PROMPTS_DATA_URLS } = require('./remote-sources');

const MAX_PROMPTS_SIZE = 1024 * 1024; // 1MB 上限

function createPromptsUpdater(deps) {
  const { app, fs, path, appendLog, fetchJson } = deps;

  let cached = null; // { version, data }

  function cacheFile() {
    return path.join(app.getPath('userData'), 'prompts-cache.json');
  }

  /**
   * 加载本地缓存（userData/prompts-cache.json）
   * @returns {{ version: number, data: object } | null}
   */
  function loadCache() {
    try {
      const file = cacheFile();
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.version && parsed.data) {
          cached = parsed;
          appendLog('info', `提示词库缓存已加载：v${parsed.version}`);
          return cached;
        }
      }
    } catch (err) {
      appendLog('warn', `加载提示词库缓存失败：${err.message}`);
    }
    return null;
  }

  /**
   * 保存缓存到 userData/prompts-cache.json（原子写入）
   * @param {number} version
   * @param {object} data
   */
  function saveCache(version, data) {
    try {
      const file = cacheFile();
      const tempFile = file + '.tmp';
      const content = JSON.stringify({ version, data }, null, 2);

      // 原子写入：先写临时文件，再重命名
      fs.writeFileSync(tempFile, content, 'utf8');
      fs.renameSync(tempFile, file);

      cached = { version, data };
      appendLog('info', `提示词库缓存已保存：v${version}`);
    } catch (err) {
      appendLog('error', `保存提示词库缓存失败：${err.message}`);
    }
  }

  /**
   * 获取包内置的 prompts.json（兜底）
   * @returns {object | null}
   */
  function getBuiltinPrompts() {
    try {
      return require(path.join(app.getAppPath(), 'prompts.json')) || null;
    } catch {
      return null;
    }
  }

  /**
   * 获取提示词库数据（优先级：缓存 > 包内置）
   * @returns {object}
   */
  function getData() {
    // ① 缓存文件存在且解析成功 → 返回缓存
    if (cached && cached.data) {
      return cached.data;
    }
    // ② 否则 → 返回包内置 prompts.json
    return getBuiltinPrompts() || { categories: [] };
  }

  /**
   * 从 URL 列表中拉取数据（三源并发，取第一个成功的）
   * @param {Array<{name: string, url: string, headers?: object}>} urls
   * @returns {Promise<any|null>}
   */
  async function fetchFromUrls(urls) {
    const TIMEOUT_MS = 8000;

    const results = await Promise.allSettled(
      urls.map(async (source) => {
        try {
          // fetchJson(url, timeoutMs, headers, maxBytes) —— 位置参数（见 updater.js）
          const data = await fetchJson(source.url, TIMEOUT_MS, source.headers || {}, MAX_PROMPTS_SIZE);
          return { name: source.name, data };
        } catch {
          return null;
        }
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        return result.value.data;
      }
    }
    return null;
  }

  /**
   * 获取当前有效版本：缓存版本；无缓存时取包内置 prompts.json 的 version 字段
   * @returns {number}
   */
  function currentVersion() {
    if (cached && cached.version) return cached.version;
    const builtin = getBuiltinPrompts();
    return builtin && builtin.version ? builtin.version : 0;
  }

  /**
   * 版本比较（v1.1.1 改日期命名）：支持数字或日期字符串（YYYY-MM-DD 可直接字符串比较）
   * @param {number|string} remote
   * @param {number|string} current
   * @returns {boolean} remote > current
   */
  function isNewer(remote, current) {
    if (typeof remote === 'number' && typeof current === 'number') return remote > current;
    return String(remote).localeCompare(String(current)) > 0;
  }

  /**
   * 查询提示词库更新信息（仅拉远程版本号，不下载数据）
   * @returns {Promise<{ok:boolean, current:number|string, latest:number|string|null, updated:string|null, hasUpdate:boolean}>}
   */
  async function queryInfo() {
    const info = { ok: false, current: currentVersion(), latest: null, updated: null, hasUpdate: false };
    const versionInfo = await fetchFromUrls(PROMPTS_VERSION_URLS);
    if (versionInfo && versionInfo.version) {
      info.latest = versionInfo.version;
      info.updated = versionInfo.updated || null;
      info.hasUpdate = isNewer(versionInfo.version, info.current);
      info.ok = true;
    }
    return info;
  }

  /**
   * 立即检查并更新提示词库（拉新数据落缓存）
   * @returns {Promise<{ok:boolean, reason?:string, updated:boolean, info:object}>}
   */
  async function forceUpdate() {
    const info = await queryInfo();
    if (!info.ok) return { ok: false, reason: 'fetch-failed', updated: false, info };
    if (!info.hasUpdate) return { ok: true, updated: false, info };

    appendLog('info', `发现提示词库新版本：v${info.current} → v${info.latest}，立即更新`);
    const newData = await fetchFromUrls(PROMPTS_DATA_URLS);
    if (!newData || !newData.categories) {
      return { ok: false, reason: 'data-fetch-failed', updated: false, info };
    }
    saveCache(info.latest, newData);
    return { ok: true, updated: true, info };
  }

  /**
   * 检查并更新提示词库（启动时静默调用）
   */
  async function checkUpdatesOnStart() {
    try {
      appendLog('info', '开始检查提示词库更新...');
      const r = await forceUpdate();
      if (!r.ok) {
        appendLog('warn', `提示词库检查失败：${r.reason}`);
      } else if (!r.updated) {
        appendLog('info', `提示词库已是最新版本：v${r.info.latest}`);
      }
    } catch (err) {
      appendLog('error', `检查提示词库更新失败：${err.message}`);
    }
  }

  return {
    loadCache,
    getData,
    checkUpdatesOnStart,
    getVersion: currentVersion, // 兼容旧调用（取当前有效版本）
    queryInfo,
    forceUpdate,
  };
}

module.exports = { createPromptsUpdater };
