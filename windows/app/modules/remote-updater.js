'use strict';

/**
 * DSH-Desktop — 远程数据源更新工厂（2.0.6 去重：合并提示词库/插件库/技能库三个升级模块）
 *
 * 职责：统一「从 DSH 服务器拉取远程列表数据并落本地缓存」的更新逻辑。三者共用同一套：
 *  - 版本检测：拉服务器 GET {apiUrl}/version（返回最新版本号）
 *  - 数据下载：拉服务器 GET {apiUrl}/data（返回完整数组）→ 存本地缓存
 *  - 无缓存（首装）：getData() 返回 { [dataField]: [], needsDownload: true }，
 *    界面提示「从服务器下载」；下载成功后落缓存，后续用缓存（离线可用）。
 *  - 无网络/失败：用已下载缓存（有则用），不再回退包内置。
 *
 * 差异通过 cfg 参数化（见各薄壳模块传入值）：
 *  - cacheFileName  缓存文件名（userData 下）
 *  - apiKey         config.json 中该库的接口配置键（<apiKey>.apiUrl）
 *  - label          日志文案用名称（插件库/提示词库/技能库）
 *  - unit           日志计数用单位（个插件/分类/个技能）
 *  - dataField      getData() 返回的数据字段名（data 或 categories）
 *  - migrate        可选：加载缓存时的旧格式迁移钩子，返回 true 表示需从 data.categories 取
 *
 * 依赖注入（deps）：
 *  - app / fs / path
 *  - appendLog
 *  - fetchJson      updater 模块导出（8s 超时 + 5MB 上限）
 *  - readShellConfig  读取 config.json（取 [apiKey].apiUrl）
 */

function createRemoteUpdater(deps, cfg) {
  const { app, fs, path, appendLog, fetchJson, readShellConfig } = deps;
  const { cacheFileName, apiKey, label, unit = '', dataField = 'data', migrate } = cfg;

  let cached = null; // { version, updated, data }

  function cacheFile() {
    return path.join(app.getPath('userData'), cacheFileName);
  }

  /** 从 config.json 读该库接口地址（单源）；无配置返回 null */
  function apiBase() {
    try {
      const cfgData = readShellConfig();
      const u = cfgData[apiKey] && cfgData[apiKey].apiUrl;
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

  /** 加载本地缓存（userData/{cacheFileName}） */
  function loadCache() {
    try {
      const file = cacheFile();
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        let data = parsed && parsed.data;
        // 旧格式迁移（如提示词库旧 data 为内嵌 categories 的对象）→ 取其 categories 数组
        const migrated = migrate ? migrate(data) : false;
        if (migrated) data = data.categories;
        // 校验 data 必须为数组，否则视为无缓存（需重新下载）
        if (parsed && parsed.version && Array.isArray(data)) {
          cached = { version: parsed.version, updated: parsed.updated || null, data };
          appendLog('info', `${label}缓存已加载：v${parsed.version}（${data.length} ${unit}）`);
          if (migrated) {
            saveCache(parsed.version, data, parsed.updated); // 迁移为新格式落盘，避免下次再走兼容分支
            appendLog('info', `${label}旧版缓存已迁移为新格式`);
          }
          return cached;
        }
      }
    } catch (err) {
      appendLog('warn', `加载${label}缓存失败：${err.message}`);
    }
    return null;
  }

  /** 保存缓存到 userData/{cacheFileName}（原子写入） */
  function saveCache(version, data, updated) {
    try {
      const file = cacheFile();
      const tempFile = file + '.tmp';
      const content = JSON.stringify({ version, updated: updated || null, data }, null, 2);
      fs.writeFileSync(tempFile, content, 'utf8');
      fs.renameSync(tempFile, file);
      cached = { version, updated: updated || null, data };
      appendLog('info', `${label}缓存已保存：v${version}（${data.length} ${unit}）`);
    } catch (err) {
      appendLog('error', `保存${label}缓存失败：${err.message}`);
    }
  }

  /** 获取库数据（仅缓存；无缓存 → 标记需要下载） */
  function getData() {
    if (cached && Array.isArray(cached.data)) {
      return { [dataField]: cached.data, needsDownload: false, version: cached.version };
    }
    return { [dataField]: [], needsDownload: true, version: null };
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

  /** 查询库更新信息（拉服务器版本号，不下载数据） */
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
      appendLog('warn', `${label}版本检测失败：${err.message}`);
    }
    return info;
  }

  /** 从服务器下载库数据并落缓存 */
  async function downloadData() {
    const url = dataUrl();
    if (!url) {
      appendLog('warn', `缺少 ${apiKey}.apiUrl 配置，无法下载${label}`);
      return { ok: false, reason: 'fetch-failed', version: null };
    }
    try {
      appendLog('info', `开始从服务器下载${label}数据…`);
      const payload = await fetchJson(url);
      if (!payload || !payload.ok || !Array.isArray(payload.data) || !payload.version) {
        appendLog('warn', `服务器返回${label}数据无效`);
        return { ok: false, reason: 'data-fetch-failed', version: null };
      }
      saveCache(payload.version, payload.data, payload.updated);
      return { ok: true, version: payload.version };
    } catch (err) {
      appendLog('error', `下载${label}失败：${err.message}`);
      return { ok: false, reason: 'fetch-failed', version: null };
    }
  }

  /** 检查库更新：有新版或尚无缓存 → 下载数据落缓存；无更新 → 保持缓存。 */
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
      appendLog('info', `开始检查${label}更新...`);
      const r = await forceUpdate();
      if (!r.ok) {
        appendLog('warn', `${label}检查失败：${r.reason}`);
      } else if (!r.updated) {
        appendLog('info', `${label}已是最新版本：v${r.info.latest}`);
      }
    } catch (err) {
      appendLog('error', `检查${label}更新失败：${err.message}`);
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

module.exports = { createRemoteUpdater };
