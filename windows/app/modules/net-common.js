'use strict';

/**
 * DSH-Desktop — 公共网络模块（2.0.1 去重）
 *
 * 统一 Electron net.request 封装（Chromium 网络栈 + 系统 CA + 自动跟随重定向）：
 *  - fetchText(url, ...) → 返回响应文本（UTF-8），失败/超时/非 2xx/超量返回 null
 *  - fetchJson(url, ...) → 返回解析后的 JSON，失败/超时/非 2xx/超量/解析失败返回 null
 *
 * 背景：v1.1.6 起各模块（plugin-market / skill-library / updater）各复制了一份同款
 * net.request 逻辑（Node https.get 在真机 TLS 验证失败，net 是唯一可靠拉取通道）。
 * 2.0.1 重构抽取为公共依赖注入模块，消除重复。
 *
 * 依赖注入（deps）：
 *  - net   Electron net 模块（Chromium 网络栈/系统 CA）
 */

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function createNetCommon(deps) {
  const { net } = deps;

  /**
   * 底层请求核心：发起 net.request，收集响应体（UTF-8）。
   * 满足任一终止条件（超时/非 2xx/体积超量/网络错误/流错误）→ resolve(null)；
   * 成功 → resolve(响应文本)。
   * @param {string} url
   * @param {number} timeoutMs
   * @param {object} headers
   * @param {number} maxBytes
   * @returns {Promise<string|null>}
   */
  function request(url, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, maxBytes = DEFAULT_MAX_BYTES) {
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
          res.setEncoding('utf8'); // P2-1 v1.1.6：跨 chunk 不拆断 UTF-8，中文无乱码
          let body = '';
          let aborted = false;
          const finish = (v) => {
            if (aborted) return;
            aborted = true;
            clearTimeout(timer);
            resolve(v);
          };
          res.on('data', (c) => {
            if (aborted) return;
            body += c;
            if (body.length > maxBytes) {
              aborted = true;
              try {
                req.abort();
              } catch {
                /* ignore */
              }
              clearTimeout(timer);
              resolve(null);
            }
          });
          res.on('end', () => {
            if (!aborted) finish(body);
          });
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

  /**
   * GET 并返回响应文本；失败/超时/非 2xx/超量返回 null。
   * @param {string} url
   * @param {number} timeoutMs
   * @param {object} headers
   * @param {number} maxBytes
   * @returns {Promise<string|null>}
   */
  function fetchText(url, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, maxBytes = DEFAULT_MAX_BYTES) {
    return request(url, timeoutMs, headers, maxBytes);
  }

  /**
   * GET 并解析 JSON；失败/超时/非 2xx/超量/解析失败返回 null。
   * @param {string} url
   * @param {number} timeoutMs
   * @param {object} headers
   * @param {number} maxBytes
   * @returns {Promise<object|null>}
   */
  function fetchJson(url, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}, maxBytes = DEFAULT_MAX_BYTES) {
    return request(url, timeoutMs, headers, maxBytes).then((text) => {
      if (text == null) return null;
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    });
  }

  return { fetchText, fetchJson, request };
}

// 导出校验（供外部按签名核对/复用）
module.exports = { createNetCommon, DEFAULT_TIMEOUT_MS, DEFAULT_MAX_BYTES };
