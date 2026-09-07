'use strict';

/**
 * DSH-Desktop — 插件库远程更新模块（v2.0.5 重构：完全走服务器）
 *
 * 职责：插件市场列表独立远程更新（数据权威源 = DSH服务器，安装包零内置）：
 *  - 版本检测：拉服务器 GET {apiUrl}/version（返回最新版本号）
 *  - 数据下载：拉服务器 GET {apiUrl}/data（返回完整插件数组）→ 存本地缓存
 *  - 无缓存（首装）：getData() 返回 { data: [], needsDownload: true }，
 *    界面提示「从服务器下载」；下载成功后落缓存，后续用缓存（离线可用）。
 *  - 无网络/失败：用已下载缓存（有则用），不再回退包内置。
 *
 * 依赖注入（deps）：
 *  - app / fs / path
 *  - appendLog
 *  - fetchJson      updater 模块导出（8s 超时 + 5MB 上限）
 *  - readShellConfig  读取 config.json（取 pluginsUpdate.apiUrl）
 */

function createPluginsUpdater(deps) {
  const { app, fs, path, appendLog, fetchJson, readShellConfig } = deps;

  let cached = null; // { version, updated, data }

  function cacheFile() {
    return path.join(app.getPath('userData'), 'plugins-cache.json');
  }

  /** 从 config.json 读插件库接口地址（单源）；无配置返回 null */
  function apiBase() {
    try {
      const cfg = readShellConfig();
      const u = cfg.pluginsUpdate && cfg.pluginsUpdate.apiUrl;
      return u ? String(u) : null;
    } catch {
      return null;
    }
  }

  function versionUrl() {
    const base = apiBase();
    return base ? `${base}/version` : null;
  }

  function dataUrl() {
    const base = apiBase();
    return base ? `${base}/data` : null;
  }

  /** 加载本地缓存（userData/plugins-cache.json） */
  function loadCache() {
    try {
      const file = cacheFile();
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        // 校验 data 必须为插件数组，否则视为无缓存（需重新下载）
        if (parsed && parsed.version && Array.isArray(parsed.data)) {
          cached = parsed;
          appendLog('info', `插件库缓存已加载：v${parsed.version}（${parsed.data.length} 个插件）`);
          return cached;
        }
      }
    } catch (err) {
      appendLog('warn', `加载插件库缓存失败：${err.message}`);
    }
    return null;
  }

  /** 保存缓存到 userData/plugins-cache.json（原子写入） */
  function saveCache(version, data, updated) {
    try {
      const file = cacheFile();
      const tempFile = file + '.tmp';
      const content = JSON.stringify({ version, updated: updated || null, data }, null, 2);
      fs.writeFileSync(tempFile, content, 'utf8');
      fs.renameSync(tempFile, file);
      cached = { version, updated: updated || null, data };
      appendLog('info', `插件库缓存已保存：v${version}（${data.length} 个插件）`);
    } catch (err) {
      appendLog('error', `保存插件库缓存失败：${err.message}`);
    }
  }

  /** 获取插件库数据（仅缓存；无缓存 → 标记需要下载） */
  function getData() {
    if (cached && Array.isArray(cached.data)) {
      return { data: cached.data, needsDownload: false, version: cached.version };
    }
    return { data: [], needsDownload: true, version: null };
  }

  /** 版本比较（支持数字或日期字符串 YYYY-MM-DD） */
  function isNewer(remote, current) {
    if (typeof remote === 'number' && typeof current === 'number') return remote > current;
    return String(remote).localeCompare(String(current)) > 0;
  }

  /** 当前有效版本：缓存版本 */
  function currentVersion() {
    return cached && cached.version ? cached.version : null;
  }

  /** 查询插件库更新信息（拉服务器版本号，不下载数据） */
  async function queryInfo() {
    const info = {
      ok: false,
      current: currentVersion(),
      latest: null,
      updated: null,
      hasUpdate: false,
      needsDownload: !cached || !Array.isArray(cached.data),
    };
    const url = versionUrl();
    if (!url) return info;
    try {
      const versionInfo = await fetchJson(url);
      if (versionInfo && versionInfo.ok && versionInfo.version) {
        info.latest = versionInfo.version;
        info.updated = versionInfo.updated || null;
        info.hasUpdate = info.needsDownload || isNewer(versionInfo.version, info.current);
        info.ok = true;
      }
    } catch (err) {
      appendLog('warn', `插件库版本检测失败：${err.message}`);
    }
    return info;
  }

  /** 从服务器下载插件库数据并落缓存 */
  async function downloadData() {
    const url = dataUrl();
    if (!url) {
      appendLog('warn', '缺少 pluginsUpdate.apiUrl 配置，无法下载插件库');
      return { ok: false, reason: 'fetch-failed', version: null };
    }
    try {
      appendLog('info', '开始从服务器下载插件库数据…');
      const payload = await fetchJson(url);
      if (!payload || !payload.ok || !Array.isArray(payload.data) || !payload.version) {
        appendLog('warn', '服务器返回插件库数据无效');
        return { ok: false, reason: 'data-fetch-failed', version: null };
      }
      saveCache(payload.version, payload.data, payload.updated);
      return { ok: true, version: payload.version };
    } catch (err) {
      appendLog('error', `下载插件库失败：${err.message}`);
      return { ok: false, reason: 'fetch-failed', version: null };
    }
  }

  /** 检查插件库更新：有新版或尚无缓存 → 下载数据落缓存；无更新 → 保持缓存。 */
  async function forceUpdate() {
    const info = await queryInfo();
    if (!info.ok) return { ok: false, reason: 'fetch-failed', updated: false, info };
    if (!info.hasUpdate) return { ok: true, updated: false, info };
    const dl = await downloadData();
    if (!dl.ok) return { ok: false, reason: dl.reason || 'data-fetch-failed', updated: false, info };
    return { ok: true, updated: true, info };
  }

  /** 启动时静默检查更新（有缓存时静默更新；无缓存不打扰，由界面提示下载） */
  async function checkUpdatesOnStart() {
    if (!cached || !Array.isArray(cached.data)) return;
    try {
      appendLog('info', '开始检查插件库更新...');
      const r = await forceUpdate();
      if (!r.ok) {
        appendLog('warn', `插件库检查失败：${r.reason}`);
      } else if (!r.updated) {
        appendLog('info', `插件库已是最新版本：v${r.info.latest}`);
      }
    } catch (err) {
      appendLog('error', `检查插件库更新失败：${err.message}`);
    }
  }

  return {
    loadCache,
    getData,
    checkUpdatesOnStart,
    getVersion: currentVersion,
    queryInfo,
    forceUpdate,
    downloadData,
  };
}

module.exports = { createPluginsUpdater };
