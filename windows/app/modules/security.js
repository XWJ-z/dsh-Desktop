'use strict';

/**
 * DSH-Desktop — 安全基线模块（v0.8.30 R1：审查报告 v24.0 —— secureWebPreferences
 * 从 about-window/misc-windows 两处重复定义抽为公共模块）
 *
 * 职责：
 *  - secureWebPreferences：安全基线 webPreferences（所有新窗口统一使用）
 *
 * 依赖注入（deps）：
 *  - app / path
 */

function createSecurityModule(deps) {
  const { app, path } = deps;

  /** 安全基线 webPreferences（新窗口统一使用） */
  function secureWebPreferences() {
    return {
      preload: path.join(app.getAppPath(), 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    };
  }

  return { secureWebPreferences };
}

module.exports = { createSecurityModule };
