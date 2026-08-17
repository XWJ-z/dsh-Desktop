'use strict';

/**
 * Playwright 配置（T7 严格测试门禁，Windows 真机跑）
 *
 * 前置条件（真机）：
 *  1. 已安装/构建 DSH-Desktop（默认用 dist/installer/win-unpacked/DSH-Desktop.exe，
 *     可用环境变量 DSH_E2E_EXE 指定其它路径；无打包产物时自动回退开发模式 electron .）
 *  2. DSH 已正常使用过（dshenv 已安装、至少有一个会话 —— 提示词库注入/拖文件注入
 *     需要主界面输入框存在）
 *  3. ⚠ 建议在专用测试机/临时测试工作区运行：用例 T5 会把文件复制进「当前 DSH 工作区」
 *
 * 运行：npm run test:e2e
 */

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  // 首次启动可能包含 DSH 运行时安装/下载，放宽到 5 分钟
  timeout: 300_000,
  expect: { timeout: 20_000 },
  // 单实例锁 + 全局快捷键冲突：必须串行
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
