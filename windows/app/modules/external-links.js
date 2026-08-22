'use strict';

/**
 * DSH-Desktop — 外部链接白名单（外审 zx(9) 2026-08-17 P2-2）
 *
 * app:open-external / setWindowOpenHandler 等「打开外部浏览器」入口统一经
 * isAllowedExternalUrl 校验：仅放行白名单域名（精确匹配或子域），其余一律拒绝。
 * 当前全部调用点均为硬编码可信链接（GitHub 仓库 / DeepSeek 官网 / QQ 群），
 * 白名单与之一一对应；渲染进程（DSH 页面注入）即使被塞入恶意链接也打不开钓鱼站。
 */

/** 允许打开外部浏览器的域名（主机名精确匹配或其后缀 `.域名` 匹配） */
const ALLOWED_EXTERNAL_HOSTS = Object.freeze([
  'github.com', // 项目仓库 / Releases 下载页
  'deepseek.com', // DeepSeek 官网
  'qq.com', // QQ 群链接（群号 916607090）
  'raw.githubusercontent.com', // v1.1.1：帮助文档远程下发（仅限 help.html 路径）
  'cdn.jsdelivr.net', // v1.1.1：帮助文档远程下发（仅限 help.html 路径）
  // 本地回环：宠物菜单「网页打开」打开壳自身承载的 DSH GUI（getWebUrl，
  // http://127.0.0.1:<port>）—— 非外部站点，属产品功能，必须放行
  '127.0.0.1',
  'localhost',
]);

/**
 * 判断 URL 是否可安全打开（https/http + 域名在白名单内）。
 * 非字符串 / 非 http(s) / 域名不在白名单 → false。
 * v1.1.1：raw.githubusercontent.com 和 cdn.jsdelivr.net 仅允许 help.html 路径。
 * v1.1.2（用户反馈：启动后自动打开系统浏览器）：新增 allowLoopback 参数 ——
 * 本地回环（127.0.0.1/localhost，宠物「网页打开」用）只在**显式用户操作**
 * （app:open-external IPC）时放行；setWindowOpenHandler（页面 window.open /
 * target=_blank 链接，可能被 DSH 页面内容自动触发）一律拒绝本地回环，
 * 防止「DSH 页面内任何指向 http://127.0.0.1:<port> 的链接被点击/自动触发
 * → 系统默认浏览器弹出」。
 * @param {string} url
 * @param {boolean} allowLoopback 是否放行本地回环（默认 true）
 * @returns {boolean}
 */
function isAllowedExternalUrl(url, allowLoopback = true) {
  if (typeof url !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();

  // v1.1.2：本地回环仅在显式用户操作时放行（setWindowOpenHandler 传 false）
  if (host === '127.0.0.1' || host === 'localhost' || host === '[::1]') {
    return !!allowLoopback;
  }

  // 检查域名是否在白名单
  const hostAllowed = ALLOWED_EXTERNAL_HOSTS.some((allowed) => {
    const a = allowed.toLowerCase();
    return host === a || host.endsWith('.' + a);
  });

  if (!hostAllowed) return false;

  // v1.1.1：raw.githubusercontent.com 和 cdn.jsdelivr.net 仅允许 help.html 路径
  if (host === 'raw.githubusercontent.com' || host === 'cdn.jsdelivr.net') {
    const pathname = parsed.pathname.toLowerCase();
    // 只允许 help.html 路径（精确匹配或以 /help.html 结尾）
    return pathname === '/xwj-z/dsh-desktop/main/help.html' || pathname.endsWith('/help.html');
  }

  return true;
}

module.exports = { ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl };
