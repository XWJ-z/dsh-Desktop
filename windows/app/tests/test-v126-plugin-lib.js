'use strict';
/** 单测 plugin-market 模块新增：自建插件存取 + `dsh plugin list --json` 输出解析 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPluginMarket } = require('../modules/plugin-market');

let pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.error('  ✗ ' + n); } }

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-plm-'));
const userData = path.join(home, 'userData');
const pm = createPluginMarket({
  app: { getPath: () => userData, getAppPath: () => path.join(home, 'app') },
  fs, os, path, shell: {}, clipboard: { writeText: () => {} },
  net: { request: () => { throw new Error('no net'); } },
  appendLog: () => {},
  isAllowedExternalUrl: () => false,
  spawnSync: require('node:child_process').spawnSync,
});

async function run() {
  // ① 自建插件存取
  console.log('[自建插件] 保存/列举/删除');
  let r = pm.saveBuiltPlugin({ name: 'dsh-my-tool', description: '增强侧边栏', command: 'dsh plugin --profile web add dsh-my-tool', hint: '测试' });
  ok(r.ok === true, '保存成功');
  let list = pm.listBuiltPlugins();
  ok(list.length === 1 && list[0].name === 'dsh-my-tool', '可列出自建插件');
  ok(list[0].command.includes('dsh plugin'), '保留了安装命令');
  ok(pm.saveBuiltPlugin({ name: '' }).ok === false, '空名称拒绝');
  // 覆盖更新
  pm.saveBuiltPlugin({ name: 'dsh-my-tool', description: 'v2' });
  ok(pm.listBuiltPlugins().length === 1 && pm.listBuiltPlugins()[0].description === 'v2', '同名校准更新');
  ok(pm.deleteBuiltPlugin('dsh-my-tool').ok === true && pm.listBuiltPlugins().length === 0, '删除后为空');

  // ② 解析 dsh plugin list --json
  console.log('[解析] dsh plugin list 输出');
  const noPlugin = JSON.stringify([{ name: 'dsh-profile-web', path: 'C:\\x\\profiles\\web', private: true }]);
  ok(pm.parsePluginOutput(noPlugin).length === 0, '仅根项目 → 空');
  const withPlugins = JSON.stringify([
    { name: 'dsh-profile-web', path: 'C:\\x\\profiles\\web', private: true },
    { name: 'some-plugin', path: 'C:\\x\\node_modules\\some-plugin', version: '1.0.0' },
  ]);
  const names = pm.parsePluginOutput(withPlugins);
  ok(names.includes('some-plugin') && !names.includes('dsh-profile-web'), '列出社区插件、排除根项目');
  const nested = JSON.stringify([{ name: 'dsh-profile-web', dependencies: { 'dsh-better-sidebar': '1.0.0', '@deepseek-ai/dsh-web-app': '2.0.0' } }]);
  const n2 = pm.parsePluginOutput(nested);
  ok(n2.includes('dsh-better-sidebar') && !n2.includes('@deepseek-ai/dsh-web-app'), '有依赖时列出、排除运行时@deepseek-ai内件');

  console.log(`\n${pass} 通过, ${fail} 失败`);
  fs.rmSync(home, { recursive: true, force: true });
  process.exit(fail === 0 ? 0 : 1);
}
run().catch((e) => { console.error('抛错', e); process.exit(1); });
