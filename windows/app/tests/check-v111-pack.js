'use strict';
// v1.1.1 打包内容核对：新功能进包 + 代码与开发版一致 + 版本号
const fs = require('fs');
const path = require('path');
const app = 'dist/installer/win-unpacked/resources/app/';
const read = (p) => fs.readFileSync(app + p, 'utf8');

const main = read('main.js');
const menu = read('modules/menu.js');
const pet = read('modules/pet.js');
const ipc = read('modules/ipc.js');
const preload = read('preload.js');
const extLinks = read('modules/external-links.js');
const miscWin = read('modules/windows/misc-windows.js');
const marketHtml = read('renderer/plugin-market.html');
const nodeResolver = read('modules/node-resolver.js');
const dshRuntime = read('modules/dsh-runtime.js');
const serverLifecycle = read('modules/serverLifecycle.js');
const pkg = JSON.parse(read('package.json'));
const changelog = JSON.parse(read('CHANGELOG.json'));
const rootVersionJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));

const out = {
  'version 1.1.1': pkg.version === '1.1.1',
  // 新模块进包
  'help-doc.js in pkg': fs.existsSync(app + 'modules/help-doc.js'),
  'prompts-updater.js in pkg': fs.existsSync(app + 'modules/prompts-updater.js'),
  'plugin-market.js in pkg': fs.existsSync(app + 'modules/plugin-market.js'),
  'plugin-market.html in pkg': fs.existsSync(app + 'renderer/plugin-market.html'),
  'plugin-market.js renderer in pkg': fs.existsSync(app + 'renderer/plugin-market.js'),
  'help.html in pkg': fs.existsSync(app + 'renderer/help.html'),
  // 帮助文档远程下发
  'main wires helpDocApi': main.includes("const helpDocApi = createHelpDoc("),
  'menu has 帮助文档…': menu.includes("label: '帮助文档…'"),
  'whitelist raw.githubusercontent': extLinks.includes("'raw.githubusercontent.com'"),
  'whitelist cdn.jsdelivr.net': extLinks.includes("'cdn.jsdelivr.net'"),
  'whitelist help.html path check': extLinks.includes("pathname.endsWith('/help.html')"),
  // 提示词库独立升级
  'main wires promptsUpdaterApi': main.includes("const promptsUpdaterApi = createPromptsUpdater("),
  'ipc promptlib:data uses updater': ipc.includes('promptsUpdater.getData()'),
  'main start silent prompts check': main.includes('promptsUpdaterApi.checkUpdatesOnStart()'),
  // 插件市场
  'main wires pluginMarketApi': main.includes("const pluginMarketApi = createPluginMarket("),
  'pet menu has 💎 插件市场': pet.includes('data-action="pluginmarket">💎 插件市场</div>'),
  'pet menu handler pluginmarket': pet.includes("it.dataset.action === 'pluginmarket'"),
  'preload openPluginMarket': preload.includes('openPluginMarket:'),
  'preload plugin APIs': preload.includes('getPluginsByCategory') && preload.includes('copyPluginCommand'),
  'ipc plugin-market handlers': ipc.includes("'plugin-market:categories'") && ipc.includes("'plugin-market:get-plugins'"),
  'misc-windows openPluginMarketWindow': miscWin.includes('function openPluginMarketWindow()'),
  'main wires openPluginMarketWindow': main.includes('openPluginMarketWindow, // v1.1.1'),
  // 官方仓库 URL（Anil-matcha，非占位 XWJ-z）
  'plugin market URL Anil-matcha': read('modules/plugin-market.js').includes('Anil-matcha/awesome-dsh-plugin'),
  // v1.1.1 二轮（老大反馈 + Issue#1 + 26 方案七/八）：
  // 插件市场深色模式
  'plugin-market.html shared.css': marketHtml.includes('shared.css'),
  'plugin-market.html theme tokens': marketHtml.includes('var(--bg-surface)') && marketHtml.includes('var(--text-primary)') && marketHtml.includes('var(--text-tertiary)'),
  'plugin-market.html dark media query': marketHtml.includes('prefers-color-scheme: dark'),
  'plugin-market.html CSP': marketHtml.includes('Content-Security-Policy'),
  'plugin-market.html 安装须知 4 条+群号': marketHtml.includes('插件是别人写的程序') && marketHtml.includes('916607090') && marketHtml.includes('后果自负'),
  // Issue#1 randomUUID 修复（26 方案 A）
  'node-resolver minMajor 校验': nodeResolver.includes('resolveRunner(minMajor)') && nodeResolver.includes('major < minMajor') && nodeResolver.includes('过旧，兜底'),
  'dsh-runtime resolveRunner(20)': dshRuntime.includes('resolveRunner(20)'),
  'serverLifecycle resolveRunner(20)': serverLifecycle.includes('resolveRunner(20)'),
  // 加群引导（26 方案七）
  'main guideShown 默认值': main.includes('guideShown: false,'),
  'main 首启引导弹窗': main.includes('欢迎使用 DSH-Desktop！') && main.includes('加入群聊') && main.includes('916607090'),
  'menu 公告条点击直达联系我们': menu.includes('click: () => openContactWindow(),'),
  'pet 加群气泡词库': pet.includes("group: ['有问题？Q 群 916607090 找我呀～'"),
  'pet 低频混入(5%)': pet.includes('Math.random() < 0.05'),
  // release notes 固定钩子
  'version.json release 钩子(加群)': rootVersionJson.release_notes.includes('你的反馈决定下一个功能'),
  'version.json version=1.1.1': rootVersionJson.version === '1.1.1',
  // 变更记录
  'CHANGELOG 1.1.1': changelog.versions.some((x) => x.version === '1.1.1'),
  'CHANGELOG 1.1.1 加群钩子': changelog.versions.some((x) => x.version === '1.1.1' && x.notes.some((n) => n.includes('你的反馈决定下一个功能'))),
  // 开发版 == 打包版（关键文件一致）
  'main dev==packaged': main === fs.readFileSync('main.js', 'utf8'),
  'pet dev==packaged': pet === fs.readFileSync('modules/pet.js', 'utf8'),
  'menu dev==packaged': menu === fs.readFileSync('modules/menu.js', 'utf8'),
  'ipc dev==packaged': ipc === fs.readFileSync('modules/ipc.js', 'utf8'),
  'preload dev==packaged': preload === fs.readFileSync('preload.js', 'utf8'),
  'extLinks dev==packaged': extLinks === fs.readFileSync('modules/external-links.js', 'utf8'),
  'miscWin dev==packaged': miscWin === fs.readFileSync(path.join('modules', 'windows', 'misc-windows.js'), 'utf8'),
  'marketHtml dev==packaged': marketHtml === fs.readFileSync('renderer/plugin-market.html', 'utf8'),
  'nodeResolver dev==packaged': nodeResolver === fs.readFileSync('modules/node-resolver.js', 'utf8'),
  'dshRuntime dev==packaged': dshRuntime === fs.readFileSync('modules/dsh-runtime.js', 'utf8'),
  'serverLifecycle dev==packaged': serverLifecycle === fs.readFileSync('modules/serverLifecycle.js', 'utf8'),
};

let ok = true;
for (const [n, pass] of Object.entries(out)) {
  console.log((pass ? 'PASS' : 'FAIL'), n);
  if (!pass) ok = false;
}
console.log(ok ? 'ALL PASS' : 'HAS FAIL');
process.exit(ok ? 0 : 1);
