'use strict';

/**
 * DSH-Desktop — 壳（DSH-Desktop）已发布版本 SHA256 内置台账（外审 zx(9) 2026-08-17 P1-1）
 *
 * 信任模型加固：version.json 的 hash 与下载 URL 同源（同一 GitHub repo 三镜像），
 * 单靠 SHA256 校验无法防「作者账号被盗 / repo 被攻破 / CDN 投毒」场景。本台账把
 * 已发布版本的安装包 hash 硬编码进壳（随壳分发），下载前核对：
 *  - 目标版本在台账内 → version.json 下发的 hash 必须与台账一致，否则拒绝更新
 *    （防「旧版本重放投毒」：攻击者把 version.json 改回旧版 + 恶意 hash + 恶意 URL）；
 *  - 目标版本不在台账内（比壳新）→ 台账滞后于发布，交由三源多数一致兜底
 *    （见 updater.js fetchLatestShellVersion 的 sourcesAgree）。
 *
 * 发布流程约定：每次发布新版本后，必须把新版本安装包实测 SHA256 追加进本台账
 * （与 version.json 的 hash 保持一致），随下一次壳版本一起分发。
 */

/** 已发布版本 → 安装包 SHA256（hex，小写）。发布时追加新版本。 */
const KNOWN_SHELL_HASHES = Object.freeze({
  '0.9.6': '23b984d4e57e0d6b506cae48ba82d6aeae041fd7cfad5580a6b7bf170c6fe910',
  // v1.0.2（老大指令 2026-08-17）：台账补齐 1.0.1 实测 hash（S12 外审 zx29 遗留，随本次壳一起分发）
  '1.0.1': '07b376bb6a9d59068c1b048a5fdcbc7d6c6d122894f71a6cdfe03705ba0e92da',
  // v1.0.3：台账补齐 1.0.2 实测 hash（发布流程约定：随下一次壳版本一起分发）
  '1.0.2': '47f7098ddacea3c9dd2dd295232d40f66c710a3574b02f94fc68786cb49d2dd7',
  // v1.0.5：台账补齐 1.0.3 实测 hash（发布流程约定：随下一次壳版本一起分发，S12）
  '1.0.3': '969c008a3d22924e5406ec154b9b824b01b17ed0ebcbe28739c70bb1abc6fd50',
});

/**
 * 校验目标版本的 hash 是否与壳内置台账一致。
 * @param {string} version 目标版本（如 '0.9.6'）
 * @param {string} hash    version.json 下发的 hash（hex 小写）
 * @returns {{ ok: true } | { ok: false, reason: string }}
 *  - version 在台账内且 hash 一致 → ok
 *  - version 在台账内但 hash 不符 → 拒绝（疑似投毒）
 *  - version 不在台账内 → ok（台账滞后，交给多数一致兜底）
 */
function verifyKnownHash(version, hash) {
  const v = String(version || '');
  const h = String(hash || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(KNOWN_SHELL_HASHES, v)) {
    return { ok: true, reason: 'unknown-version' };
  }
  if (KNOWN_SHELL_HASHES[v] !== h) {
    return {
      ok: false,
      reason: 'hash-mismatch',
      message: `v${v} 的安装包 hash（${h || '空'}）与壳内置台账（${KNOWN_SHELL_HASHES[v]}）不一致，已阻止更新`,
    };
  }
  return { ok: true, reason: 'ok' };
}

module.exports = { KNOWN_SHELL_HASHES, verifyKnownHash };
