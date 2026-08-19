'use strict';

/**
 * DSH-Desktop — 帮助文档模块（v1.1.1）
 *
 * 职责：帮助文档远程下发 + 本地兜底：
 *  - 三源并发拉取 help.html（jsDelivr / api.github.com / raw.githubusercontent）
 *  - 取可达源打开系统浏览器
 *  - 拉取失败 → 打开本地内置 help.html 兜底
 *  - 本地内置 help.html 随包分发（renderer/help.html）
 *
 * 依赖注入（deps）：
 *  - shell / app / path / fs
 *  - net            Electron net 模块（Chromium 网络栈/系统 CA，探测可达性）
 *  - appendLog
 *  - isAllowedExternalUrl   external-links 模块（URL 白名单校验）
 */

const HELP_DOC_URLS = [
  {
    name: 'jsDelivr',
    url: 'https://cdn.jsdelivr.net/gh/XWJ-z/dsh-Desktop@main/help.html',
  },
  {
    name: 'GitHub API',
    url: 'https://api.github.com/repos/XWJ-z/dsh-Desktop/contents/help.html?ref=main',
    headers: { 'User-Agent': 'DSH-Desktop', Accept: 'application/vnd.github.raw+json' },
  },
  {
    name: 'raw.githubusercontent',
    url: 'https://raw.githubusercontent.com/XWJ-z/dsh-Desktop/main/help.html',
  },
];

function createHelpDoc(deps) {
  const { shell, app, path, fs, net, appendLog, isAllowedExternalUrl } = deps;

  /**
   * 尝试从 URL 列表中找到可达的 URL
   * @param {Array<{name: string, url: string, headers?: object}>} urls
   * @returns {Promise<string|null>} 可达的 URL 或 null
   */
  async function pickReachable(urls) {
    const TIMEOUT_MS = 8000;

    // 三源并发（Electron net 探测，Chromium 网络栈 + 系统 CA + 自动跟随重定向 ——
    // Node https 在此环境 TLS 失败且 jsDelivr @main 会 301）
    // 取第一个「可达且白名单允许」的（api.github.com 返回 JSON 且不在 openExternal
    // 白名单 —— 仅作探测，不作为浏览器打开目标）
    const results = await Promise.allSettled(
      urls.map(async (source) => {
        try {
          const reachable = await new Promise((resolve) => {
            let req;
            const timer = setTimeout(() => {
              try {
                req.abort();
              } catch {
                /* ignore */
              }
              resolve(false);
            }, TIMEOUT_MS);
            try {
              req = net.request({ url: source.url, method: 'HEAD' });
              Object.keys(source.headers || {}).forEach((k) => req.setHeader(k, source.headers[k]));
              req.on('response', (res) => {
                clearTimeout(timer);
                resolve(res.statusCode >= 200 && res.statusCode < 400);
              });
              req.on('error', () => {
                clearTimeout(timer);
                resolve(false);
              });
              req.end();
            } catch {
              clearTimeout(timer);
              resolve(false);
            }
          });
          if (reachable && isAllowedExternalUrl(source.url)) {
            return { name: source.name, url: source.url };
          }
          return null;
        } catch {
          return null;
        }
      }),
    );

    // 返回第一个成功的
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        return result.value.url;
      }
    }
    return null;
  }

  /**
   * 打开帮助文档
   * 1. 尝试系统浏览器打开远程 help.html
   * 2. 打不开 → 打开本地内置副本兜底
   * 3. 提示用户检查网络
   */
  async function openHelpDoc() {
    try {
      appendLog('info', '尝试打开帮助文档...');

      // ① 尝试系统浏览器打开远程
      const url = await pickReachable(HELP_DOC_URLS);

      if (url) {
        // URL 白名单校验（仅放行 help.html 路径）
        if (isAllowedExternalUrl(url)) {
          shell.openExternal(url);
          appendLog('info', `帮助文档已打开：${url}`);
          return;
        } else {
          appendLog('warn', `URL 不在白名单内：${url}`);
        }
      }

      // ② 兜底：打开本地内置 help.html
      const localPath = path.join(app.getAppPath(), 'renderer', 'help.html');
      if (fs.existsSync(localPath)) {
        shell.openPath(localPath);
        appendLog('info', '帮助文档已打开（本地兜底版本）');
      } else {
        // 如果本地也没有，尝试主目录下的 help.html
        const rootPath = path.join(app.getAppPath(), 'help.html');
        if (fs.existsSync(rootPath)) {
          shell.openPath(rootPath);
          appendLog('info', '帮助文档已打开（根目录版本）');
        } else {
          appendLog('error', '本地帮助文档文件不存在');
        }
      }
    } catch (err) {
      appendLog('error', `打开帮助文档失败：${err.message}`);
    }
  }

  return { openHelpDoc };
}

module.exports = { createHelpDoc };
