'use strict';

/**
 * memory-common.js — 记忆窗口公共脚本（2.0.1 去重）
 *
 * 提供记忆区块的「中文数字编号」辅助函数。原先 global-memory.js 与 memory-project.js
 * 各自复制一份（cnNum / cnToNum / numFromTitle / nextSubNum），抽取为公共 IIFE，
 * 挂到 window.__memoryNums，由两个记忆脚本以 window 引用复用。
 *
 * 注意：本脚本必须由 global-memory.html 在 global-memory.js / memory-project.js 之前加载。
 */

(function () {
  const CN_NUMS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  /** 1..99 → 中文数字（一…九 / 十 / 十一… / 二十… / 九十九） */
  function cnNum(n) {
    const x = Math.floor(Number(n) || 0);
    if (x <= 0) return String(x);
    if (x < 10) return CN_NUMS[x];
    const tens = Math.floor(x / 10);
    const ones = x % 10;
    if (x < 20) return '十' + (ones ? CN_NUMS[ones] : '');
    return CN_NUMS[tens] + '十' + (ones ? CN_NUMS[ones] : '');
  }
  /** 中文数字（一…九 / 十 / 十一… / 二十…）→ 整数；不认识返回 null */
  function cnToNum(s) {
    const str = String(s || '').trim();
    if (!str) return null;
    if (str.length === 1) { const i = CN_NUMS.indexOf(str); return i >= 0 ? i : null; }
    if (str === '十') return 10;
    const shi = str.indexOf('十');
    if (shi === -1) return null;
    const tens = shi === 0 ? 1 : CN_NUMS.indexOf(str[shi - 1]);
    if (tens <= 0) return null;
    let val = tens * 10;
    const tail = str.slice(shi + 1);
    if (tail) { const o = CN_NUMS.indexOf(tail); if (o < 0) return null; val += o; }
    return val;
  }
  /** 从标题开头提取序号（中文 一… 或 数字 1…）；无序号返回 null */
  function numFromTitle(title) {
    const t = String(title || '').trim();
    const c = /^([零一二三四五六七八九十]+)/.exec(t);
    if (c) { const v = cnToNum(c[1]); if (v != null) return v; }
    const a = /^(\d+)/.exec(t);
    if (a) return parseInt(a[1], 10);
    return null;
  }
  /** 计算下一个子区块序号（沿用现有「n.m 标题」规律，如 4.3 → 4.4）；无规律返回 null */
  function nextSubNum(subs) {
    let maxM = 0, sectionN = null;
    (Array.isArray(subs) ? subs : []).forEach((sb) => {
      const m = /^(\d+)[.、](\d+)\b/.exec(String(sb.title || '').trim());
      if (m) { const n = parseInt(m[1], 10); const mm = parseInt(m[2], 10); if (mm > maxM) { maxM = mm; sectionN = n; } }
    });
    return sectionN === null ? null : `${sectionN}.${maxM + 1}`;
  }

  if (typeof window !== 'undefined') {
    window.__memoryNums = { cnNum, cnToNum, numFromTitle, nextSubNum };
  }
})();
