'use strict';

/**
 * DSH-Desktop — Node 运行时解析模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：解析运行 DSH 服务的 Node 运行时（内置 Node / 系统 Node / Electron-as-Node 兜底）。
 *
 * 依赖注入（deps）：
 *  - app            Electron app（app.isPackaged / app.getAppPath）
 *  - fs / path      Node 模块
 *  - execFileSync   node:child_process
 */

function createNodeResolver(deps) {
  const { app, fs, path, execFileSync } = deps;

  function findSystemNode() {
    const candidates = [
      process.env.SYSTEM_NODE,
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) return candidate;
    }
    try {
      const out = execFileSync('where.exe', ['node'], { encoding: 'utf8', windowsHide: true });
      const first = out.split(/\r?\n/).map((line) => line.trim())
        .find((line) => line.toLowerCase().endsWith('node.exe'));
      if (first && fs.existsSync(first)) return first;
    } catch { /* ignore */ }
    return null;
  }

  /** 内置 Node 运行时路径（resources/node/node.exe），不存在返回 null */
  function bundledNode() {
    const exe = path.join(app.getAppPath(), '..', 'node', 'node.exe');
    return fs.existsSync(exe) ? exe : null;
  }

  /**
   * 解析运行 DSH 的 Node 运行时。
   *
   * 优先级（审查 H3：原生模块按 Node ABI 编译，须用真实 Node 运行）：
   *  1. 打包模式：内置 Node（resources/node/node.exe）——真实 Node，ABI 完全匹配；
   *  2. 开发模式：系统 Node（可带最低主版本约束，见 minMajor）；
   *  3. 兜底：Electron-as-Node（ELECTRON_RUN_AS_NODE），此时 DSH 原生模块可能
   *     ABI 不兼容（目录选择器/图片处理等受限），仅作最后手段。
   *
   * v1.1.1（Issue #1 修复，26 方案 A）：
   *  - @param {number} [minMajor] 最低主版本号（如 20 = 内置 npm 12 需 Node ≥20，
   *    否则其内部 crypto.randomUUID() 不存在报错）
   *  - 系统 Node 低于 minMajor → 跳过，回落 Electron-as-Node（Electron 43 内置
   *    Node 恒新，randomUUID 必有）
   *  - 打包模式不受影响：内置 Node 24 恒满足（minMajor 仅对开发模式生效）
   */
  function resolveRunner(minMajor) {
    if (app.isPackaged) {
      const bundled = bundledNode();
      if (bundled) {
        return { execPath: bundled, env: {}, label: `内置 Node (${bundled})` };
      }
      return { execPath: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, label: 'Electron 自带 Node（打包兜底）' };
    }
    const sysNode = findSystemNode();
    if (sysNode) {
      if (minMajor) {
        try {
          const ver = execFileSync(sysNode, ['--version'], { encoding: 'utf8' }).trim(); // v16.20.0
          const major = parseInt(ver.replace(/^v/, ''), 10);
          if (major < minMajor) {
            // Issue #1 修复：系统 Node 过旧（npm 12 需 ≥20.17，否则 randomUUID 报错）
            // → 回落 Electron-as-Node（内置 Node 版本随 Electron 走，恒新）
            return {
              execPath: process.execPath,
              env: { ELECTRON_RUN_AS_NODE: '1' },
              label: `Electron 自带 Node（系统 Node ${ver} 过旧，兜底）`,
            };
          }
        } catch {
          /* 版本读取失败按可用处理 */
        }
      }
      return { execPath: sysNode, env: {}, label: `系统 Node (${sysNode})` };
    }
    return { execPath: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' }, label: 'Electron 自带 Node（开发降级）' };
  }

  return { findSystemNode, bundledNode, resolveRunner };
}

module.exports = { createNodeResolver };
