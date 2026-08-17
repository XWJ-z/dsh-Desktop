'use strict';

/**
 * DSH-Desktop — 语义化版本比较共享模块（外审 zx(9) 2026-08-17 P3-3）
 *
 * 收敛主进程与渲染进程重复的版本比较实现：
 *  - 主进程（updater.js / ipc.js changelog 排序）统一 require 本模块；
 *  - 渲染进程（renderer/changelog.js）不再自行实现比较，改由主进程
 *    changelog:data 按本模块语义排序后返回（删除 changelog.js 内忽略
 *    `-rc` 预发布号的 compareVersion）。
 *
 * 语义（semver 2.0 子集）：
 *  - 主版本号 x.y.z 数字比较；
 *  - 预发布号按点分段比较，数字段数值比较、字母段字典序，段多者大；
 *  - 无预发布号（正式版）> 有预发布号；
 *  - 任一版本不是合法 semver（如 "latest"）→ 返回 0（无法比较，不误报）。
 * 返回 1 / 0 / -1。
 */

/** 语义化版本比较（a vs b）：a > b → 1；a < b → -1；相等/无法比较 → 0 */
function compareSemver(a, b) {
  const sa = String(a), sb = String(b);
  if (!/^\d+\.\d+\.\d+/.test(sa) || !/^\d+\.\d+\.\d+/.test(sb)) return 0; // 非 semver 无法比较
  const va = sa.split('-')[0].split('.').map(Number), vb = sb.split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = va[i] || 0, y = vb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  // 预发布号取首个 '-' 之后的全段（split 会切开 rc.6-alpha 这类复合号，故用 indexOf）
  const ra = sa.includes('-') ? sa.slice(sa.indexOf('-') + 1) : '';
  const rb = sb.includes('-') ? sb.slice(sb.indexOf('-') + 1) : '';
  if (ra === '' && rb === '') return 0;
  if (ra === '') return 1;                     // 正式版 > 预发布
  if (rb === '') return -1;
  const fa = ra.split('.'), fb = rb.split('.');
  for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
    const xa = fa[i], xb = fb[i];
    if (xa === undefined) return -1;           // 段少者小
    if (xb === undefined) return 1;
    const na = /^\d+$/.test(xa) ? Number(xa) : null;
    const nb = /^\d+$/.test(xb) ? Number(xb) : null;
    if (na !== null && nb !== null) {
      if (na !== nb) return na > nb ? 1 : -1;  // 数字段数值比较（rc.10 > rc.9）
    } else if (xa !== xb) {
      return xa > xb ? 1 : -1;                 // 字母段字典序
    }
  }
  return 0;
}

module.exports = { compareSemver };
