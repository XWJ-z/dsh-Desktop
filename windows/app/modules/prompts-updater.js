'use strict';

/**
 * DSH-Desktop — 提示词库远程更新模块（v2.0.4 重构：完全走服务器）
 *
 * 职责：提示词库独立远程更新（数据权威源 = DSH服务器，安装包零内置）：
 *  - 版本检测：拉服务器 GET {apiUrl}/version（返回最新版本号）
 *  - 数据下载：拉服务器 GET {apiUrl}/data（返回完整 categories 数组）→ 存本地缓存
 *  - 首次打开（无缓存）：getData() 返回 { categories: [], needsDownload: true }，
 *    界面提示「从服务器下载」；下载成功后落缓存，后续用缓存。
 *  - 无网络/失败：用已下载缓存（有则用；无则仍标 needsDownload 提示下载，不再回退包内置）。
 *
 * 依赖注入（deps）：
 *  - app / fs / path
 *  - appendLog
 *  - fetchJson      updater 模块导出（8s 超时 + 5MB 上限）
 *  - readShellConfig  读取 config.json（取 promptsUpdate.apiUrl）
 */

function createPromptsUpdater(deps) {
  const { app, fs, path, appendLog, fetchJson, readShellConfig } = deps;

  let cached = null; // { version, updated, data }

  function cacheFile() {
    return path.join(app.getPath('userData'), 'prompts-cache.json');
  }

  /** 从 config.json 读提示词库接口地址（单源）；无配置返回 null */
  function apiBase() {
    try {
      const cfg = readShellConfig();
      const u = cfg.promptsUpdate && cfg.promptsUpdate.apiUrl;
      return u ? String(u) : null;
    } catch {
      return null;
    }
  }

  /** 版本检测接口地址 */
  function versionUrl() {
    const base = apiBase();
    return base ? `${base}/version` : null;
  }

  /** 数据下载接口地址 */
  function dataUrl() {
    const base = apiBase();
    return base ? `${base}/data` : null;
  }

  /**
   * 加载本地缓存（userData/prompts-cache.json）
   * @returns {{ version: number|string, updated?: string, data: object } | null}
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
   * @param {number|string} version
   * @param {string} [updated]
   * @param {object} data categories 数组（{ id,name,icon,subs }）
   */
  function saveCache(version, data, updated) {
    try {
      const file = cacheFile();
      const tempFile = file + '.tmp';
      const content = JSON.stringify({ version, updated: updated || null, data }, null, 2);

      // 原子写入：先写临时文件，再重命名
      fs.writeFileSync(tempFile, content, 'utf8');
      fs.renameSync(tempFile, file);

      cached = { version, updated: updated || null, data };
      appendLog('info', `提示词库缓存已保存：v${version}`);
    } catch (err) {
      appendLog('error', `保存提示词库缓存失败：${err.message}`);
    }
  }

  /**
   * 获取提示词库数据（仅缓存；无缓存 → 标记需要下载）
   * @returns {{ categories: object[], needsDownload: boolean, version: number|string|null }}
   */
  function getData() {
    if (cached && cached.data) {
      return { categories: cached.data, needsDownload: false, version: cached.version };
    }
    // 无缓存：提示需从服务器下载（安装包零内置，不再回退包内置）
    return { categories: [], needsDownload: true, version: null };
  }

  /**
   * 版本比较（支持数字或日期字符串 YYYY-MM-DD）
   * @param {number|string} remote
   * @param {number|string} current
   * @returns {boolean} remote > current
   */
  function isNewer(remote, current) {
    if (typeof remote === 'number' && typeof current === 'number') return remote > current;
    return String(remote).localeCompare(String(current)) > 0;
  }

  /**
   * 当前有效版本：缓存版本
   * @returns {number|string|null}
   */
  function currentVersion() {
    return cached && cached.version ? cached.version : null;
  }

  /**
   * 查询提示词库更新信息（拉服务器版本号，不下载数据）
   * @returns {Promise<{ok:boolean, current:number|string|null, latest:number|string|null, updated:string|null, hasUpdate:boolean, needsDownload:boolean}>}
   */
  async function queryInfo() {
    const info = {
      ok: false,
      current: currentVersion(),
      latest: null,
      updated: null,
      hasUpdate: false,
      needsDownload: !cached || !cached.data,
    };
    const url = versionUrl();
    if (!url) return info;
    try {
      const versionInfo = await fetchJson(url);
      if (versionInfo && versionInfo.ok && versionInfo.version) {
        info.latest = versionInfo.version;
        info.updated = versionInfo.updated || null;
        // 无缓存 → 视为需要下载（hasUpdate=true，无论如何拉一次数据）
        info.hasUpdate = info.needsDownload || isNewer(versionInfo.version, info.current);
        info.ok = true;
      }
    } catch (err) {
      appendLog('warn', `提示词库版本检测失败：${err.message}`);
    }
    return info;
  }

  /**
   * 从服务器下载提示词库数据并落缓存
   * @returns {Promise<{ok:boolean, reason?:string, version:number|string|null}>}
   */
  async function downloadData() {
    const url = dataUrl();
    if (!url) {
      appendLog('warn', '缺少 promptsUpdate.apiUrl 配置，无法下载提示词库');
      return { ok: false, reason: 'fetch-failed', version: null };
    }
    try {
      appendLog('info', '开始从服务器下载提示词库数据…');
      const payload = await fetchJson(url);
      if (!payload || !payload.ok || !Array.isArray(payload.data) || !payload.version) {
        appendLog('warn', '服务器返回提示词库数据无效');
        return { ok: false, reason: 'data-fetch-failed', version: null };
      }
      saveCache(payload.version, payload.data, payload.updated);
      return { ok: true, version: payload.version };
    } catch (err) {
      appendLog('error', `下载提示词库失败：${err.message}`);
      return { ok: false, reason: 'fetch-failed', version: null };
    }
  }

  /**
   * 检查提示词库更新：有新版或尚无缓存 → 下载数据落缓存；无更新 → 保持缓存。
   * @returns {Promise<{ok:boolean, reason?:string, updated:boolean, info:object}>}
   */
  async function forceUpdate() {
    const info = await queryInfo();
    if (!info.ok) return { ok: false, reason: 'fetch-failed', updated: false, info };
    if (!info.hasUpdate) return { ok: true, updated: false, info };
    const dl = await downloadData();
    if (!dl.ok) return { ok: false, reason: dl.reason || 'data-fetch-failed', updated: false, info };
    return { ok: true, updated: true, info };
  }

  /**
   * 启动时静默检查更新（有缓存时静默更新；无缓存不打扰，由界面提示下载）
   */
  async function checkUpdatesOnStart() {
    // 无缓存（首装）不静默拉，让「首次打开提示词库」时由界面触发下载
    if (!cached || !cached.data) return;
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
    downloadData,
  };
}

module.exports = { createPromptsUpdater };
