'use strict';

/**
 * DSH-Desktop — 远程下发源 URL 集中定义（v1.1.3 重构）
 *
 * 用途：所有「改仓库 push 即生效」的远程文件三源 URL 集中在此，
 * 各模块不再各自硬编码（曾散落于 main.js / notice.js / prompts-updater.js / help-doc.js 共 5 处）。
 * 以后若要调整 CDN、仓库名或文件路径，只改这里一处。
 *
 * 结构：每个文件 = 三源数组（jsDelivr / GitHub API / raw.githubusercontent），
 * 顺序即并发拉取顺序；GitHub API 源带 Accept raw+json 直接返回文件原文（无 CDN 缓存，永远最新）。
 *
 * ⚠️ 兼容性红线：路径一旦发布即协议 —— 已发布老版本客户端硬编码根目录路径，
 * 请勿移动仓库根目录下的 version.json / notice.json / prompts.json / prompts.version.json / help.html。
 */

const REPO = 'XWJ-z/dsh-Desktop';

/** GitHub API 源（Accept raw+json 直接返回原文） */
function ghApiSource(file, ref) {
  return {
    name: 'GitHub API',
    url: `https://api.github.com/repos/${REPO}/contents/${file}?ref=${ref}`,
    headers: { 'User-Agent': 'DSH-Desktop', Accept: 'application/vnd.github.raw+json' },
  };
}

/** 单个远程文件的三源 URL 数组 */
function buildSources(file, ref = 'main') {
  return [
    { name: 'jsDelivr', url: `https://cdn.jsdelivr.net/gh/${REPO}@${ref}/${file}` },
    ghApiSource(file, ref),
    { name: 'raw.githubusercontent', url: `https://raw.githubusercontent.com/${REPO}/${ref}/${file}` },
  ];
}

module.exports = {
  REPO,
  buildSources,
  /** 壳自动更新版本清单 */
  VERSION_JSON_URLS: buildSources('version.json'),
  /** 远程公告源（公告条 marquee + 公告窗口 items） */
  NOTICE_URLS: buildSources('notice.json'),
  /** 提示词库版本标记（先拉它比对，版本大于缓存才拉 prompts.json） */
  PROMPTS_VERSION_URLS: buildSources('prompts.version.json'),
  /** 提示词库数据 */
  PROMPTS_DATA_URLS: buildSources('prompts.json'),
  /** 帮助文档（应用内窗口 + 后台静默同步） */
  HELP_DOC_URLS: buildSources('help.html'),
  /** 插件中文描述（内置随包 + 远程可更新，push 即生效） */
  PLUGIN_DESC_URLS: buildSources('plugin-desc-zh.json'),
};
