'use strict';

/**
 * DSH-Desktop — 提示词库远程更新模块（v2.0.4 重构：完全走服务器）
 *
 * 职责：提示词库独立远程更新（数据权威源 = DSH服务器，安装包零内置）。
 * 2.0.6 去重：逻辑收敛到公共工厂 remote-updater.js，本文件仅做参数化薄壳；
 * 唯一差异是 getData() 按 categories 返回，且带旧缓存迁移（旧 data 内嵌 categories 对象）。
 *
 * 依赖注入（deps）：
 *  - app / fs / path / appendLog / fetchJson / readShellConfig
 */

const { createRemoteUpdater } = require('./remote-updater');

function createPromptsUpdater(deps) {
  return createRemoteUpdater(deps, {
    cacheFileName: 'prompts-cache.json',
    apiKey: 'promptsUpdate',
    label: '提示词库',
    unit: '分类',
    dataField: 'categories',
    // 旧缓存迁移：旧格式 data 为对象（内嵌 categories 数组），新格式 data 直接为 categories 数组
    migrate: (data) => !!(data && !Array.isArray(data) && Array.isArray(data.categories)),
  });
}

module.exports = { createPromptsUpdater };
