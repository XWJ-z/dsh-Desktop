'use strict';

/**
 * DSH-Desktop — 记忆渲染公共工具（2.0.1 去重）
 *
 * 统一「长文本区块」渲染逻辑：global-memory.js 与 project-memory.js 此前各复制了一份
 * 相同的 renderLong（## 标题 + 原格式内容 + ### 子区块），抽取为公共纯函数。
 *
 * 纯函数，无模块依赖，直接 require 使用。
 */

/**
 * 渲染长文本区块（## 标题 + 原格式内容 + ### 三级子区块；标题空则返回空串）。
 * @param {string} title
 * @param {string|string[]} body
 * @param {Array<{title: string, body: string|string[]}>} subs
 * @returns {string}
 */
function renderLongSection(title, body, subs) {
  // 防御：body 可能是数组（解析产物）或字符串（窗口提交），统一为字符串
  const raw = Array.isArray(body) ? body.join('\n') : String(body || '');
  const b = raw.replace(/^\s*\n+|\s+$/g, ''); // 去首尾多余空行
  const subBlocks = (Array.isArray(subs) && subs.length)
    ? subs.map((sb) => {
        const sbRaw = Array.isArray(sb.body) ? sb.body.join('\n') : String(sb.body || '');
        const sbBody = sbRaw.replace(/^\s*\n+|\s+$/g, '');
        return `### ${sb.title}${sbBody ? `\n\n${sbBody}` : ''}`;
      }).join('\n\n')
    : '';
  let out = `## ${title}`;
  if (b) out += `\n\n${b}`;
  if (subBlocks) out += `\n\n${subBlocks}`;
  return out;
}

module.exports = { renderLongSection };
