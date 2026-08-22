'use strict';

/**
 * DSH-Desktop — 帮助文档模块（v1.1.1 → v1.1.1 二轮改造，用户反馈）
 *
 * 职责：帮助文档 = 应用内窗口 + 本地优先 + 后台静默远程同步：
 *  - 打开：加载本地帮助文档（用户数据缓存 > 包内置 renderer/help.html）—— 离线可用
 *  - 后台：三源并发拉取远程 help.html（jsDelivr / api.github.com / raw.githubusercontent），
 *    内容与当前本地版本不同 → 写入用户数据缓存，下次打开即最新（改仓库 push 即生效）
 *  - 远程全部失败 → 保持本地版本（缓存或包内置），不打断用户
 *
 * 依赖注入（deps）：
 *  - app / path / fs
 *  - net            Electron net 模块（Chromium 网络栈/系统 CA，拉取远程）
 *  - appendLog
 *  - openHelpDocWindow   打开帮助文档窗口回调（misc-windows 模块，晚绑定注入）
 */

// v1.1.3 重构：三源 URL 集中到 remote-sources.js
const { HELP_DOC_URLS } = require('./remote-sources');

function createHelpDoc(deps) {
  const { app, path, fs, net, appendLog, openHelpDocWindow } = deps;

  function cacheDir() {
    return path.join(app.getPath('userData'), 'help-doc');
  }
  function cacheHtmlPath() {
    return path.join(cacheDir(), 'help.html');
  }
  function cacheMetaPath() {
    return path.join(cacheDir(), 'version.json');
  }
  function bundledHtmlPath() {
    return path.join(app.getAppPath(), 'renderer', 'help.html');
  }

  /**
   * GET 并返回响应文本（Electron net.request —— Chromium 网络栈 + 系统 CA +
   * 自动跟随重定向；Node https 在此环境 TLS 验证失败且 jsDelivr @main 会 301）
   * @param {string} url
   * @param {number} timeoutMs
   * @param {object} headers
   * @returns {Promise<string|null>}
   */
  function fetchText(url, timeoutMs = 8000, headers = {}) {
    return new Promise((resolve) => {
      let req;
      try {
        req = net.request(url);
        Object.keys(headers || {}).forEach((k) => req.setHeader(k, headers[k]));
        if (!headers || !headers['User-Agent']) req.setHeader('User-Agent', 'DSH-Desktop');
        const timer = setTimeout(() => {
          try {
            req.abort();
          } catch {
            /* ignore */
          }
          resolve(null);
        }, timeoutMs);
        req.on('response', (res) => {
          const code = res.statusCode;
          if (code < 200 || code >= 300) {
            clearTimeout(timer);
            resolve(null);
            return;
          }
          let body = '';
          let done = false;
          const finish = (v) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(v);
          };
          res.on('data', (c) => {
            if (!done) body += c;
          });
          res.on('end', () => finish(body));
          res.on('error', () => finish(null));
        });
        req.on('error', () => {
          clearTimeout(timer);
          resolve(null);
        });
        req.end();
      } catch {
        resolve(null);
      }
    });
  }

  /** 三源并发取最快成功（Promise.any，不等慢源）；全部失败返回 null */
  async function fetchRemoteHelp() {
    try {
      return await Promise.any(
        HELP_DOC_URLS.map(async (source) => {
          const t = await fetchText(source.url, 8000, source.headers || {});
          if (!t) throw new Error('fetch fail');
          return t;
        }),
      );
    } catch {
      return null;
    }
  }

  /**
   * 打开帮助文档：应用内窗口加载本地版本（缓存 > 包内置），
   * 后台静默同步远程（不阻塞窗口，失败静默下次再试）。
   */
  async function openHelpDoc() {
    try {
      appendLog('info', '打开帮助文档窗口…');
      const htmlPath = fs.existsSync(cacheHtmlPath()) ? cacheHtmlPath() : bundledHtmlPath();
      appendLog('info', `帮助文档本地版本：${fs.existsSync(cacheHtmlPath()) ? '用户缓存' : '包内置'}`);
      openHelpDocWindow(htmlPath);
      // 后台静默同步远程（失败不影响本次打开）
      syncRemoteHelpDoc().catch(() => {
        /* ignore */
      });
    } catch (err) {
      appendLog('error', `打开帮助文档失败：${err.message}`);
    }
  }

  /**
   * 静默同步远程 help.html：内容与当前本地版本（缓存 > 包内置）不同
   * → 写入用户数据缓存（下次打开即最新，push 即生效）
   * @returns {Promise<{updated: boolean, reason?: string}>}
   */
  async function syncRemoteHelpDoc() {
    appendLog('info', '检查帮助文档远程更新…');
    const remote = await fetchRemoteHelp();
    if (!remote) {
      appendLog('info', '帮助文档远程检查跳过（网络不可达），保持本地版本');
      return { updated: false, reason: 'network' };
    }
    try {
      const bundled = fs.existsSync(bundledHtmlPath()) ? fs.readFileSync(bundledHtmlPath(), 'utf8') : '';
      const cached = fs.existsSync(cacheHtmlPath()) ? fs.readFileSync(cacheHtmlPath(), 'utf8') : null;
      const current = cached !== null ? cached : bundled;
      if (current === remote) {
        appendLog('info', '帮助文档已是最新（与远程一致）');
        return { updated: false };
      }
      fs.mkdirSync(cacheDir(), { recursive: true });
      fs.writeFileSync(cacheHtmlPath(), remote, 'utf8');
      fs.writeFileSync(
        cacheMetaPath(),
        JSON.stringify({ updated: new Date().toISOString() }, null, 2),
        'utf8',
      );
      appendLog('info', '帮助文档远程更新已同步（下次打开生效）');
      return { updated: true };
    } catch (err) {
      appendLog('warn', `帮助文档同步写缓存失败：${err.message}`);
      return { updated: false, reason: 'write-fail' };
    }
  }

  return { openHelpDoc, syncRemoteHelpDoc, bundledHtmlPath, cacheHtmlPath, cacheMetaPath };
}

module.exports = { createHelpDoc };
