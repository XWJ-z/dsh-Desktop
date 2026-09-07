'use strict';

/**
 * DSH-Desktop — 插件库远程更新模块（v2.0.5 重构：完全走服务器）
 *
 * 职责：插件市场列表独立远程更新（数据权威源 = DSH服务器，安装包零内置）。
 * 2.0.6 去重：逻辑收敛到公共工厂 remote-updater.js，本文件仅做参数化薄壳。
 *
 * 依赖注入（deps）：
 *  - app / fs / path / appendLog / fetchJson / readShellConfig
 */

const { createRemoteUpdater } = require('./remote-updater');

function createPluginsUpdater(deps) {
  return createRemoteUpdater(deps, {
    cacheFileName: 'plugins-cache.json',
    apiKey: 'pluginsUpdate',
    label: '插件库',
    unit: '个插件',
    dataField: 'data',
  });
}

module.exports = { createPluginsUpdater };
