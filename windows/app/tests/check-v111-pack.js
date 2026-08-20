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
const mainWin = read('modules/windows/main-window.js'); // v1.1.2：setWindowOpenHandler 禁本地回环
const miscWin = read('modules/windows/misc-windows.js');
const marketHtml = read('renderer/plugin-market.html');
const marketJs = read('renderer/plugin-market.js');
const loadingHtml = read('renderer/loading.html');
const loadingJs = read('renderer/loading.js');
const helpDoc = read('modules/help-doc.js');
const nodeResolver = read('modules/node-resolver.js');
const dshRuntime = read('modules/dsh-runtime.js');
const serverLifecycle = read('modules/serverLifecycle.js');
const updater = read('modules/updater.js'); // v1.1.3：版本检查改用 Electron net
const pkg = JSON.parse(read('package.json'));
const changelog = JSON.parse(read('CHANGELOG.json'));
const rootVersionJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));

const out = {
  'version 1.1.3': pkg.version === '1.1.3',
  // v1.1.3：自动更新修复 —— updater.fetchJson 改用 Electron net（真机 TLS 证书问题）
  'updater fetchJson 用 net': updater.includes('net.request(url)') && updater.includes('req.setHeader'),
  'updater 注入 net 依赖': updater.includes('net, // v1.1.3'),
  'main 注入 net: electronNet': main.includes('net: electronNet, // v1.1.3'),
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
  // v1.1.1 三轮（老大反馈）：确认弹窗免责声明红色加粗 + 去掉手机App类比 + 刷新按钮
  'plugin-market.html 免责声明红色加粗': marketHtml.includes('.modal-box .modal-disclaimer') && marketHtml.includes('color: #c62828') && marketHtml.includes('font-weight: 700'),
  'plugin-market.html 安装前须知(无类比)': marketHtml.includes('安装前须知：') && !marketHtml.includes('像装手机 App 一样想清楚'),
  'plugin-market.html 刷新按钮': marketHtml.includes('id="refreshBtn"'),
  'plugin-market.js 刷新逻辑': marketJs.includes('refreshPlugins') && marketJs.includes('正在刷新插件列表'),
  'preload refreshPlugins': preload.includes('refreshPlugins: () => ipcRenderer.invoke(\'plugin-market:refresh\')'),
  'ipc plugin-market:refresh': ipc.includes("'plugin-market:refresh'") && ipc.includes('pluginMarket.refreshPlugins()'),
  // 帮助文档：应用内窗口 + 本地优先 + 后台静默远程同步（v1.1.1 三轮，老大反馈）
  'help-doc 应用内窗口': helpDoc.includes('openHelpDocWindow') && helpDoc.includes('syncRemoteHelpDoc') && helpDoc.includes('cacheHtmlPath'),
  'help-doc 本地优先(缓存>包内置)': helpDoc.includes("fs.existsSync(cacheHtmlPath()) ? cacheHtmlPath() : bundledHtmlPath()"),
  'misc-windows openHelpDocWindow': miscWin.includes('function openHelpDocWindow(') && miscWin.includes("title: '帮助文档'"),
  'main 晚绑定 openHelpDocWindowRef': main.includes('openHelpDocWindowRef') && main.includes('openHelpDocWindowRef = openHelpDocWindow;'),
  'main helpDocWin 状态': main.includes('let helpDocWin = null;'),
  // Issue#1 randomUUID 修复（26 方案 A）
  'node-resolver minMajor 校验': nodeResolver.includes('resolveRunner(minMajor)') && nodeResolver.includes('major < minMajor') && nodeResolver.includes('过旧，兜底'),
  'dsh-runtime resolveRunner(20)': dshRuntime.includes('resolveRunner(20)'),
  'dsh-runtime npm 堆上限 4GB': dshRuntime.includes("NODE_OPTIONS: '--max-old-space-size=4096'"),
  'dsh-runtime OOM 准确提示': dshRuntime.includes('内存不足（npm 内存溢出）'),
  'dsh-runtime 多源切换 npmjs': dshRuntime.includes('REGISTRY_FALLBACKS') && dshRuntime.includes('https://registry.npmjs.org'),
  'dsh-runtime 自动重试': dshRuntime.includes('自动重试：切换源') && dshRuntime.includes('尝试 ${attempt + 1}/${registries.length}'),
  'dsh-runtime 重试失败提示': dshRuntime.includes('自动重试后仍失败'),
  'dsh-runtime 下载并发 32': dshRuntime.includes('--maxsockets=32'),
  // 首次安装体验（老大反馈）：启动页 30~40 分钟提示 + 等待计时
  'loading.html 30~40 分钟提示': loadingHtml.includes('30~40 分钟') && loadingHtml.includes('请耐心等待'),
  'loading.js 等待计时': loadingJs.includes('fmtWait') && loadingJs.includes('已等待') && loadingJs.includes('MB 数暂时不动属正常'),
  'main npm 安装超时 40 分钟': main.includes('NPM_INSTALL_TIMEOUT_MS = 2_400_000'),
  'serverLifecycle resolveRunner(20)': serverLifecycle.includes('resolveRunner(20)'),
  // 加群引导（26 方案七）
  'main guideShown 默认值': main.includes('guideShown: false,'),
  'main 首启引导弹窗': main.includes('欢迎使用 DSH-Desktop！') && main.includes('加入群聊') && main.includes('916607090'),
  // v1.1.2（老大反馈）：公告条点击跳转公告窗口（不再直达二维码）
  'menu 公告条点击跳转公告': menu.includes('click: () => openNoticeWindow(),') && !menu.includes('click: () => openContactWindow(),'),
  'pet 加群气泡词库': pet.includes("group: ['有问题？Q 群 916607090 找我呀～'"),
  'pet 低频混入(5%)': pet.includes('Math.random() < 0.05'),
  // v1.1.2（老大反馈）：启动界面（loading）显示「打开帮助文档」按钮
  'loading.html 帮助文档按钮': loadingHtml.includes('id="help-btn"') && loadingHtml.includes('打开帮助文档'),
  'loading.js 帮助按钮绑定': loadingJs.includes("getElementById('help-btn')") && loadingJs.includes('openHelpDoc'),
  // v1.1.2（老大反馈）：问题1 —— setWindowOpenHandler 不放行本地回环，
  // 防止 DSH 页面内指向 127.0.0.1:<port> 的链接自动打开系统浏览器
  'extLinks allowLoopback 参数': extLinks.includes('allowLoopback') && extLinks.includes("host === '127.0.0.1' || host === 'localhost'"),
  'main-window setWindowOpenHandler 禁本地回环': mainWin.includes('isAllowedExternalUrl(url, false)') && mainWin.includes('allowLoopback=true') ,
  // release notes 固定钩子
  'version.json release 钩子(加群)': rootVersionJson.release_notes.includes('你的反馈决定下一个功能'),
  'version.json version=1.1.3': rootVersionJson.version === '1.1.3',
  // 变更记录
  'CHANGELOG 1.1.3': changelog.versions.some((x) => x.version === '1.1.3'),
  'CHANGELOG 1.1.3 加群钩子': changelog.versions.some((x) => x.version === '1.1.3' && x.notes.some((n) => n.includes('你的反馈决定下一个功能'))),
  // v1.1.3（老大指令）：1.1.1 未发布、1.1.2 删除，更新内容全部合并到 1.1.3
  'CHANGELOG 无 1.1.1/1.1.2 条目': !changelog.versions.some((x) => ['1.1.1', '1.1.2'].includes(x.version)),
  'CHANGELOG 1.1.3 含合并内容': ['帮助文档远程下发', '提示词库', '插件市场', '启动后自动打开浏览器', '打开帮助文档', '自动更新'].every((k) =>
    changelog.versions.some((x) => x.version === '1.1.3' && x.notes.some((n) => n.includes(k)))),
  // 开发版 == 打包版（关键文件一致）
  'main dev==packaged': main === fs.readFileSync('main.js', 'utf8'),
  'pet dev==packaged': pet === fs.readFileSync('modules/pet.js', 'utf8'),
  'menu dev==packaged': menu === fs.readFileSync('modules/menu.js', 'utf8'),
  'ipc dev==packaged': ipc === fs.readFileSync('modules/ipc.js', 'utf8'),
  'preload dev==packaged': preload === fs.readFileSync('preload.js', 'utf8'),
  'extLinks dev==packaged': extLinks === fs.readFileSync('modules/external-links.js', 'utf8'),
  'mainWin dev==packaged': mainWin === fs.readFileSync(path.join('modules', 'windows', 'main-window.js'), 'utf8'),
  'miscWin dev==packaged': miscWin === fs.readFileSync(path.join('modules', 'windows', 'misc-windows.js'), 'utf8'),
  'marketHtml dev==packaged': marketHtml === fs.readFileSync('renderer/plugin-market.html', 'utf8'),
  'marketJs dev==packaged': marketJs === fs.readFileSync('renderer/plugin-market.js', 'utf8'),
  'loadingHtml dev==packaged': loadingHtml === fs.readFileSync('renderer/loading.html', 'utf8'),
  'loadingJs dev==packaged': loadingJs === fs.readFileSync('renderer/loading.js', 'utf8'),
  'helpDoc dev==packaged': helpDoc === fs.readFileSync('modules/help-doc.js', 'utf8'),
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
