'use strict';

/**
 * DSH-Desktop — 技能库市场远程更新模块（v2.0.5 重构：完全走服务器）
 *
 * 职责：技能市场列表独立远程更新（数据权威源 = DSH服务器，安装包零内置）。
 * 2.0.6 去重：逻辑收敛到公共工厂 remote-updater.js，本文件仅做参数化薄壳。
 *
 * 注意：技能「安装」仍从各自来源仓库 GitHub raw 拉 SKILL.md（见 skill-library.js
 * installFromMarket），本模块只负责市场列表的版本检测与数据缓存。
 *
 * 依赖注入（deps）：
 *  - app / fs / path / appendLog / fetchJson / readShellConfig
 */

const { createRemoteUpdater } = require('./remote-updater');

function createSkillsUpdater(deps) {
  return createRemoteUpdater(deps, {
    cacheFileName: 'skills-market-cache.json',
    apiKey: 'skillsUpdate',
    label: '技能库',
    unit: '个技能',
    dataField: 'data',
  });
}

module.exports = { createSkillsUpdater };
