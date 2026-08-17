'use strict';

/**
 * check-v097.js — v0.9.7 功能自动验证（不启动 Electron）
 *
 * 覆盖（老大反馈三项）：
 *  1. 公告条内容显示不全 → menu.js 截断收紧 30 字符 + 公告条可点击打开公告窗口
 *     + 公告窗口顶部完整 marquee 横幅（ipc notice:data 附带 marquee）
 *  2. 公告要重启才刷新 → main.js 10 分钟定时自动刷新 + notice.js 版本未变静默
 *  3. 内置更新日志与 GitHub 不一致 → CHANGELOG.json 0.9.6 改为 version.json
 *     release_notes 12 条（与 GitHub Release body 同源）+ 新增 0.9.7 条目
 *
 * v0.9.11 追加（外审 zx(9) 全量整改 10 项）：
 *  8. updater.js 信任模型（P1-1 多数一致 + 内置 hash、P1-2 integrity、P3-5 https）
 *  9. dsh-runtime.js 固定版本安装 + 安装记录核对（P1-2）
 * 10. external-links.js / ipc.js / main-window.js 外部链接白名单（P2-2）
 * 11. main.js 外观轮询仅窗口可见时执行（P2-1）
 * 12. backup.js 解压总量/条目限制（P3-1）
 * 13. custom-prompts.js / promptlib.js 长度上限（P3-2）
 * 14. changelog.js 版本比较收敛共享模块（P3-3）
 * 15. menu.js F12 生产禁用 / installer.js 签名配置就绪（P3-4 / P2-3）
 * 16. 全局记忆（v0.9.12 老大指令）：宠物菜单入口 / preload IPC / 首次自动建立行为
 *
 * 用法：node tests/check-v097.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

const APP = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

// ---------------------------------------------------------------------------
// 1. menu.js —— 公告条截断 30 + 可点击
// ---------------------------------------------------------------------------
function testMenu() {
  console.log('[1] menu.js 公告条');
  const src = read('modules/menu.js');
  ok(src.includes('t.length > 30'), 'truncateMarquee 截断阈值 = 30 字符');
  ok(src.includes('${t.slice(0, 27)}…'), '截断保留前 27 字符 + …');
  ok(!src.includes('t.length > 40'), '旧的 40 字符截断已移除');
  ok(src.includes('label: \'📢 \' + truncateMarquee(getMarquee())'), '公告条 label 保留');
  ok(src.includes('click: () => openNoticeWindow()'), '公告条可点击 → 打开公告窗口');
  ok(!src.includes('enabled: false, // 纯文字展示'), '公告条不再禁用（纯文字态移除）');
  // v0.9.8（老大指令）：公告菜单并入帮助菜单
  ok(!src.includes('label: `公告${'), '独立「公告」一级菜单已移除（并入帮助）');
  ok(src.includes('查看公告${'), '帮助菜单含「查看公告（新）」子项');
}

// ---------------------------------------------------------------------------
// 2. notice.js —— 版本未变静默（定时轮询不刷日志）
// ---------------------------------------------------------------------------
function testNoticeQuiet() {
  console.log('[2] notice.js 静默逻辑');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v097-nt-'));
  const fakeApp = { getPath: () => tmp };
  const { createNoticeModule } = require('../modules/notice');

  // mock 三源：每轮 fetchLatest 内 3 个源并发调用 fetchJson，同轮返回相同版本
  // （3 轮：v2 → v2 → v3；第 2 轮验证同版本静默，第 3 轮验证版本升级记日志）
  const versionsPerCall = [2, 2, 2, 2, 2, 2, 3, 3, 3];
  const logs = [];
  const mk = (v, m) => ({ version: v, updated: '2026-08-17', marquee: m, items: [] });
  let call = 0;
  const api = createNoticeModule({
    app: fakeApp, fs, path,
    appendLog: (lvl, msg) => logs.push(`${lvl}:${msg}`),
    fetchJson: async () => {
      const v = versionsPerCall[Math.min(call, versionsPerCall.length - 1)];
      call++;
      return mk(v, `第 ${v} 版公告`);
    },
  });
  api.loadCache();

  return (async () => {
    await api.fetchLatest();                 // 首次 → 记日志
    const firstLogs = logs.length;
    ok(api.getMarquee() === '第 2 版公告', '首次拉取后 marquee 更新');
    ok(firstLogs === 1 && /公告拉取/.test(logs[0]), '首次拉取记 1 条日志');

    await api.fetchLatest();                 // 同版本轮询 → 静默
    ok(logs.length === firstLogs, '同版本二次拉取不刷日志（静默）');

    await api.fetchLatest();                 // 版本升级 → 记日志
    ok(api.getMarquee() === '第 3 版公告', '版本升级后 marquee 更新');
    ok(logs.length === firstLogs + 1 && /公告拉取/.test(logs[firstLogs]), '版本变化再记 1 条日志');

    fs.rmSync(tmp, { recursive: true, force: true });
  })();
}

// ---------------------------------------------------------------------------
// 3. main.js —— 10 分钟定时自动刷新
// ---------------------------------------------------------------------------
function testMain() {
  console.log('[3] main.js 公告定时刷新');
  const src = read('main.js');
  ok(src.includes('const NOTICE_REFRESH_MS = 10 * 60 * 1000'), '定时间隔 10 分钟');
  ok(src.includes('function startNoticeAutoRefresh()'), 'startNoticeAutoRefresh 已定义');
  ok(src.includes('noticeApi.fetchLatest()'), '定时器内拉取公告');
  ok(src.includes('.then(() => refreshMenusRef())'), '拉取后刷新菜单（公告条即时更新）');
  ok(src.includes('startNoticeAutoRefresh();'), '启动流程调用 startNoticeAutoRefresh');
  ok(src.includes('clearInterval(noticeRefreshTimer)'), '退出时清理定时器');
  // v0.9.9（老大反馈：壳延迟大）：反向同步轮询 2.5s → 400ms
  ok(src.includes('}, 400);'), '外观反向同步轮询 = 400ms（壳跟随 DSH 面板延迟 ≤0.4s）');
  ok(!src.includes('}, 2500);'), '旧的 2500ms 轮询已移除');
  ok(src.includes('setTimeout(() => r(wasOpen), 400)'), '同步 DSH 面板打开等待 400ms');
  ok(src.includes('}, 300);'), '同步后面板关闭等待 300ms');
  ok(src.includes('nativeTheme, // v0.9.9'), '窗口模块注入 nativeTheme（背景跟随外观）');
}

// ---------------------------------------------------------------------------
// 4. ipc.js / notice.html / notice.js —— 公告窗口完整 marquee 横幅
// ---------------------------------------------------------------------------
function testNoticeWindow() {
  console.log('[4] 公告窗口完整 marquee');
  const ipcSrc = read('modules/ipc.js');
  ok(ipcSrc.includes('marquee: noticeApi.getMarquee()'), 'notice:data 附带完整 marquee');
  const html = read('renderer/notice.html');
  ok(html.includes('id="marquee"'), '公告窗口有 marquee 横幅容器');
  const js = read('renderer/notice.js');
  ok(js.includes('data.marquee'), '公告窗口读取 marquee 字段');
  ok(js.includes('最新公告'), '横幅标签「最新公告」');
}

// ---------------------------------------------------------------------------
// 5. CHANGELOG.json —— 0.9.6 与 GitHub Release 一致 + 0.9.7 条目
// ---------------------------------------------------------------------------
function testChangelog() {
  console.log('[5] CHANGELOG.json 与 GitHub 一致');
  const cl = JSON.parse(fs.readFileSync(path.join(APP, 'CHANGELOG.json'), 'utf8'));
  const vj = JSON.parse(fs.readFileSync(path.join(APP, '..', '..', 'version.json'), 'utf8'));
  ok(Array.isArray(cl.versions), 'versions 是数组');

  const v097 = cl.versions.find((v) => v.version === '0.9.7');
  ok(!!v097 && Array.isArray(v097.notes) && v097.notes.length === 3, '0.9.7 条目存在（3 条）');

  // v0.9.9（老大指令）：released 标记 —— 已发布 12 版，内部版本 false
  const releasedCount = cl.versions.filter((v) => v.released === true).length;
  ok(releasedCount === 12, `released=true 共 12 个已发布版本（实际 ${releasedCount}）`);
  ok(cl.versions.find((v) => v.version === '0.9.6').released === true, '0.9.6 released=true');
  ok(cl.versions.find((v) => v.version === '0.8.30').released === true, '0.8.30 released=true');
  ok(cl.versions.find((v) => v.version === '0.9.8').released === false, '0.9.8（内部）released=false');
  ok(cl.versions.find((v) => v.version === '0.9.9').released === false, '0.9.9（内部）released=false');

  // v0.9.9：更新日志窗口只渲染 released 版本 + 内部版提示
  const cljs = read('renderer/changelog.js');
  ok(cljs.includes('filter((v) => v.released !== false)'), 'changelog.js 过滤 released 版本');
  ok(cljs.includes('current-tip'), 'changelog.js 读取 current-tip（内部测试版提示）');
  ok(cljs.includes('内部测试版'), 'changelog.js 含内部测试版文案');
  const clhtml = read('renderer/changelog.html');
  ok(clhtml.includes('id="current-tip"'), 'changelog.html 有 current-tip 容器');

  // v0.9.9：壳弹窗跟随外观 —— shared.css 浅色主题
  const css = read('renderer/shared.css');
  ok(css.includes('@media (prefers-color-scheme: light)'), 'shared.css 浅色主题 media query');
  ok(css.includes('--bg-input: #f2f4f7'), 'shared.css 浅色 --bg-input');

  // v0.9.6 条目 = version.json release_notes（GitHub Release body 同源）
  const v096 = cl.versions.find((v) => v.version === '0.9.6');
  const expected = vj.release_notes.split('\n').filter(Boolean);
  ok(!!v096 && Array.isArray(v096.notes) && v096.notes.length === expected.length,
    `0.9.6 条目 ${v096 ? v096.notes.length : 0} 条 = version.json ${expected.length} 条`);
  if (v096 && expected.length === v096.notes.length) {
    let same = true;
    for (let i = 0; i < expected.length; i++) {
      if (v096.notes[i] !== expected[i]) { same = false; console.error(`    ✗ 第 ${i + 1} 条不一致：\n      CL: ${v096.notes[i]}\n      VJ: ${expected[i]}`); }
    }
    ok(same, '0.9.6 条目与 version.json release_notes 逐条一致');
  }
  // 开发视角技术细节已从 CHANGELOG 移除（移入开发日志）
  const all = JSON.stringify(cl);
  ok(!all.includes('builder-debug.yml'), '开发视角技术细节（builder-debug.yml）已移除');
  ok(!all.includes('MUI_PAGE_CUSTOMFUNCTION_SHOW'), '开发视角技术细节（NSIS 宏）已移除');
}

// ---------------------------------------------------------------------------
// 6. pet.js —— 间歇性功能提示（v0.9.10）
// ---------------------------------------------------------------------------
function testPet() {
  console.log('[6] pet.js 间歇性功能提示');
  const src = read('modules/pet.js');
  ok(src.includes('tips: ['), '功能引导词库 tips 已定义');
  ok(src.includes('\'把文件直接拖进窗口，发送消息我就能帮你分析～\''), 'tips 含拖文件引导');
  ok(src.includes('\'悬停点「提示词库」，101 条模板直接套用～\''), 'tips 含提示词库引导');
  ok(src.includes('\'有问题进 QQ 群 916607090，随时来找我玩～\''), 'tips 含 QQ 群引导');
  ok(src.includes('300_000'), '间歇提示间隔 5 分钟');
  ok(src.includes('30_000'), '首次提示延迟 30s');
  ok(src.includes('visibilityState !== \'visible\''), '页面隐藏时跳过提示');
  ok(src.includes('bubble.style.display === \'block\''), '已有气泡时跳过（不覆盖）');
  ok(src.includes('_tipCleanup'), '重建时清理提示定时器');
  ok(src.includes('const say = (arr, ms) =>'), 'say 支持自定义时长参数');
  ok(src.includes('ms || 2200'), 'say 默认时长 2200ms');
  ok(src.includes('把文件拖进来，我帮你放进工作区～'), '点击文案库扩充功能引导');
}

// ---------------------------------------------------------------------------
// 8. updater.js —— P1-1 多数一致 + 内置 hash / P1-2 integrity / P3-5 https
// ---------------------------------------------------------------------------
function testUpdaterTrust() {
  console.log('[8] updater.js 信任模型（P1-1/P1-2/P3-5）');
  const src = read('modules/updater.js');
  // P3-3：版本比较收敛到共享模块
  ok(!/function compareSemver/.test(src), 'updater.js 不再内部实现 compareSemver（收敛共享模块）');
  ok(src.includes('require(\'./semver\')'), 'updater.js require 共享 semver.js');
  ok(src.includes('require(\'./shell-hashes\')'), 'updater.js require 内置 hash 台账');
  // P1-1：多数一致
  ok(src.includes('sourcesAgree'), 'fetchLatestShellVersion 返回 sourcesAgree 字段');
  ok(src.includes('group.length >= 2'), '多数一致判定：≥2 源同版本');
  ok(src.includes('new Set(group.map((r) => r.hash).filter(Boolean)).size <= 1'), '多数一致判定：组内 hash 去重唯一');
  ok(src.includes('\'sources-disagree\''), '源不一致 → 拒绝自动下载（reason=sources-disagree）');
  ok(src.includes('verifyKnownHash(info.version, info.hash)'), 'doShellDownload 核对壳内置期望 hash');
  // P1-2：integrity
  ok(src.includes('function fetchLatestDshInfo()'), 'fetchLatestDshInfo 已定义（版本+integrity）');
  ok(src.includes('dist.integrity'), '从 registry dist.integrity 取 sha512');
  ok(src.includes('updateDshVersion(latest, info.integrity)'), 'upgradeDshVersion 连同 integrity 落盘');
  // P3-5：https 强制
  ok(src.includes('/^https:\\/\\//i.test(String(u))'), '下载 URL 过滤强制 https');
  ok(src.includes('/^https:\\/\\//i.test(res.headers.location)'), '重定向目标强制 https');
}

// ---------------------------------------------------------------------------
// 9. dsh-runtime.js —— P1-2 固定版本安装 + 安装记录核对
// ---------------------------------------------------------------------------
function testRuntimePin() {
  console.log('[9] dsh-runtime.js 固定版本安装（P1-2）');
  const src = read('modules/dsh-runtime.js');
  ok(src.includes('fetchLatestDshInfo'), 'deps 注入 fetchLatestDshInfo（晚绑定）');
  ok(src.includes('cfg.dshPackage}@${info.version}'), 'latest 解析为精确版本再安装');
  ok(src.includes('targetIntegrity'), '记录目标 integrity');
  ok(src.includes('\'.installed.json\''), '安装记录文件 .installed.json');
  ok(src.includes('function verifyInstallRecord()'), 'verifyInstallRecord 已定义');
  ok(src.includes('安装记录异常'), '版本不一致启动告警文案');
  ok(src.includes('updateDshVersion(newVersion, integrity)'), 'updateDshVersion 接收 integrity');
}

// ---------------------------------------------------------------------------
// 10. external-links.js / ipc.js / main-window.js —— P2-2 外部链接白名单
// ---------------------------------------------------------------------------
function testExternalWhitelist() {
  console.log('[10] 外部链接白名单（P2-2）');
  const { ALLOWED_EXTERNAL_HOSTS, isAllowedExternalUrl } = require('../modules/external-links');
  ok(ALLOWED_EXTERNAL_HOSTS.includes('github.com'), '白名单含 github.com');
  ok(ALLOWED_EXTERNAL_HOSTS.includes('deepseek.com'), '白名单含 deepseek.com');
  ok(ALLOWED_EXTERNAL_HOSTS.includes('qq.com'), '白名单含 qq.com');
  ok(ALLOWED_EXTERNAL_HOSTS.includes('127.0.0.1'), '白名单含 127.0.0.1（宠物「网页打开」本地回环）');
  ok(isAllowedExternalUrl('https://github.com/XWJ-z/dsh-Desktop'), 'github.com 放行');
  ok(isAllowedExternalUrl('https://www.deepseek.com/'), 'www.deepseek.com 子域放行');
  ok(isAllowedExternalUrl('http://127.0.0.1:3080'), '本地回环放行');
  ok(!isAllowedExternalUrl('https://evil.example.com/'), '陌生域名拒绝');
  ok(!isAllowedExternalUrl('https://github.com.evil.com/'), '伪装子域拒绝');
  ok(!isAllowedExternalUrl('ftp://github.com/'), '非 http(s) 协议拒绝');
  const ipcSrc = read('modules/ipc.js');
  ok(ipcSrc.includes('isAllowedExternalUrl(url)'), 'ipc.js app:open-external 过白名单');
  const mwSrc = read('modules/windows/main-window.js');
  ok(mwSrc.includes('isAllowedExternalUrl(url)'), 'main-window.js setWindowOpenHandler 过白名单');
}

// ---------------------------------------------------------------------------
// 11. main.js —— P2-1 外观轮询仅窗口可见时执行
// ---------------------------------------------------------------------------
function testThemeWatchVisible() {
  console.log('[11] main.js 外观轮询可见性（P2-1）');
  const src = read('main.js');
  ok(src.includes('!mw.isVisible()'), '轮询回调检查窗口可见（隐藏/最小化跳过）');
  ok(src.includes('}, 400);'), '仍保留 400ms 快跟随（老大指令）');
}

// ---------------------------------------------------------------------------
// 12. backup.js —— P3-1 解压总量/条目限制
// ---------------------------------------------------------------------------
function testRestoreLimit() {
  console.log('[12] backup.js 解压限制（P3-1）');
  const src = read('modules/backup.js');
  ok(src.includes('MAX_RESTORE_BYTES'), '解压总量上限定义');
  ok(src.includes('MAX_RESTORE_ENTRIES'), '条目数上限定义');
  ok(src.includes('restoreBytes > MAX_RESTORE_BYTES'), '解压超限中止判定（字节）');
  ok(src.includes('restoreEntries > MAX_RESTORE_ENTRIES'), '解压超限中止判定（条目）');
  ok(src.includes('防解压炸弹'), '超限提示文案');
}

// ---------------------------------------------------------------------------
// 13. custom-prompts.js / promptlib.js —— P3-2 长度上限
// ---------------------------------------------------------------------------
function testPromptLength() {
  console.log('[13] 自定义提示词长度上限（P3-2）');
  const src = read('modules/custom-prompts.js');
  ok(src.includes('MAX_NAME_LEN = 100'), '名称上限 100 字符');
  ok(src.includes('MAX_CONTENT_LEN = 50 * 1024'), '内容上限 50KB');
  ok(src.includes('\'name-too-long\''), '超长名称拒绝（name-too-long）');
  ok(src.includes('\'content-too-long\''), '超长内容拒绝（content-too-long）');
  const pjs = read('renderer/promptlib.js');
  ok(pjs.includes('name-too-long'), '前端映射超长名称提示');
  ok(pjs.includes('content-too-long'), '前端映射超长内容提示');
}

// ---------------------------------------------------------------------------
// 14. changelog.js / ipc.js —— P3-3 版本比较收敛共享模块
// ---------------------------------------------------------------------------
function testSemverUnify() {
  console.log('[14] 版本比较收敛（P3-3）');
  const cljs = read('renderer/changelog.js');
  ok(!cljs.includes('function compareVersion'), 'changelog.js 不再自行实现 compareVersion');
  ok(!cljs.includes('compareVersion('), 'changelog.js 不再调用本地比较（排序移主进程）');
  const ipcSrc = read('modules/ipc.js');
  ok(ipcSrc.includes('compareSemver(b.version, a.version)'), 'ipc.js changelog:data 主进程按 compareSemver 排序');
  const semver = require('../modules/semver');
  ok(semver.compareSemver('0.9.6', '0.9.11') === -1, '共享 compareSemver 基本比较');
  ok(semver.compareSemver('0.9.11-rc.1', '0.9.11') === -1, '共享 compareSemver 预发布 < 正式版');
  ok(semver.compareSemver('0.9.11-rc.10', '0.9.11-rc.9') === 1, '共享 compareSemver rc.10 > rc.9');
}

// ---------------------------------------------------------------------------
// 15. menu.js / electron-builder.yml / installer.js —— P3-4 / P2-3
// ---------------------------------------------------------------------------
function testDevtoolsAndSigning() {
  console.log('[15] F12 生产禁用 + 签名配置就绪（P3-4/P2-3）');
  const menuSrc = read('modules/menu.js');
  ok(menuSrc.includes('!app.isPackaged'), 'menu.js F12 按 app.isPackaged 条件（生产隐藏）');
  const yml = read('electron-builder.yml');
  ok(!yml.includes('azureSignOptions:'), 'electron-builder.yml 不再内联签名配置（避免无证书构建报错）');
  const inst = read('scripts/installer.js');
  ok(inst.includes('function signingArgs()'), 'installer.js signingArgs 已定义');
  ok(inst.includes('AZURE_TS_CERT_PROFILE'), '签名凭据检查 AZURE_TS_CERT_PROFILE');
  ok(inst.includes('azureSignOptions'), 'installer.js 生成 azureSignOptions 配置');
}

// ---------------------------------------------------------------------------
// 16. global-memory —— v0.9.12 全局记忆（AGENTS.md + 图形化编辑）
// ---------------------------------------------------------------------------
function testGlobalMemory() {
  console.log('[16] 全局记忆（v0.9.12）');
  const petSrc = read('modules/pet.js');
  ok(petSrc.includes('data-action="memory"'), '宠物菜单含 memory 菜单项');
  ok(petSrc.includes('🧠 全局记忆'), '菜单文案「🧠 全局记忆」');
  ok(petSrc.indexOf('🧠 全局记忆') < petSrc.indexOf('💡 提示词库'), '全局记忆排在提示词库前面');
  ok(petSrc.includes('openGlobalMemory'), '宠物点击调用 openGlobalMemory');
  const pre = read('preload.js');
  ok(pre.includes('openGlobalMemory'), 'preload 暴露 openGlobalMemory（打开编辑窗口）');
  ok(pre.includes('getGlobalMemory'), 'preload 暴露 getGlobalMemory（读表单）');
  ok(pre.includes('saveGlobalMemory'), 'preload 暴露 saveGlobalMemory（区块级保存）');
  ok(pre.includes('\'memory:open-window\''), 'preload memory:open-window（打开窗口）');
  const ipcSrc = read('modules/ipc.js');
  ok(ipcSrc.includes('\'memory:data\''), 'ipc 注册 memory:data');
  ok(ipcSrc.includes('\'memory:save\''), 'ipc 注册 memory:save');
  ok(ipcSrc.includes('openGlobalMemoryWindow'), 'ipc 注入 openGlobalMemoryWindow');
  const gms = read('modules/global-memory.js');
  ok(gms.includes('\'AGENTS.md\''), '记忆文件 = AGENTS.md');
  ok(gms.includes('os.homedir(), \'.dsh\''), '路径 ~/.dsh/AGENTS.md（DSH 自动读取）');
  ok(gms.includes('基础设定（DSH-Desktop 图形化编辑）'), '基础设定区块标题');
  ok(gms.includes('DEFAULT_FIELDS'), '内置默认字段 DEFAULT_FIELDS');
  ok(gms.includes('function parse('), 'parse 区块化解析（自动识别 ## 标题）');
  ok(gms.includes('kind: \'long\''), '其他 ## 区块识别为长文本（kind=long）');
  ok(gms.includes('kind: \'fields\''), '基础设定识别为字段列表（kind=fields）');
  ok(gms.includes('renderLong'), '长文本区块渲染');
  ok(gms.includes('你的称呼'), '默认字段含你的称呼（用户视角）');
  const rjs0 = read('renderer/global-memory.js');
  ok(rjs0.includes('renderCats'), '窗口左侧类别列表（renderCats）');
  ok(rjs0.includes('renderRight'), '窗口右侧内容区（renderRight）');
  ok(rjs0.includes('btn-add-field'), '窗口有「＋ 添加字段」按钮逻辑');
  ok(rjs0.includes('btn-add-sec') || rjs0.includes('addSection'), '窗口有「＋ 添加区块」逻辑（界面内新建）');
  ok(!/window\.prompt\(/.test(rjs0), '不使用 window.prompt（沙箱渲染进程禁用，改界面内输入）');
  ok(rjs0.includes('sec-title'), '区块标题可修改（标题输入框）');
  ok(rjs0.includes('sec-body'), '区块内容长文本 textarea');
  ok(rjs0.includes('sections'), '窗口维护区块列表（自动识别）');
  ok(rjs0.includes('collectPayload'), '保存收集字段+区块');
  ok(rjs0.includes('saveGlobalMemory'), '保存调 saveGlobalMemory');
  ok(rjs0.includes('getGlobalMemory'), '读取调 getGlobalMemory');
  const ipcSrc2 = read('modules/ipc.js');
  ok(ipcSrc2.includes('将覆盖已有全局记忆内容'), 'ipc 保存有覆盖确认弹窗');
  ok(ipcSrc2.includes('\'cancelled\''), '取消返回 cancelled（不写盘）');
  ok(ipcSrc2.includes('defaultId: 0'), '确认弹窗默认选中「保存」（防误按取消）');
  ok(ipcSrc2.includes('shell, dialog, path, fs'), 'ipc 解构含 dialog（修复：之前漏解构 dialog 导致保存异常卡死）');
  ok(ipcSrc2.includes('appendLog'), 'ipc 解构含 appendLog（异常记录）');
  ok(ipcSrc2.includes('catch (err)') && ipcSrc2.includes('保存全局记忆异常'), 'memory:save handler try/catch（绝不 reject 卡死前端）');
  const rjs1 = read('renderer/global-memory.js');
  ok(rjs1.includes('try {\n      res = await dsh.saveGlobalMemory') || /try\s*\{\s*res = await dsh\.saveGlobalMemory/.test(rjs1), '前端保存 await 有 try/catch（按钮不卡「保存中」）');
  const mw = read('modules/windows/misc-windows.js');
  ok(mw.includes('openGlobalMemoryWindow'), 'misc-windows 有全局记忆窗口');
  ok(mw.includes('\'global-memory.html\''), '窗口加载 global-memory.html');
  ok(mw.includes('autoHideMenuBar: true'), '弹窗不显示菜单栏（autoHideMenuBar）');
  ok(mw.includes('width: 760'), '全局记忆窗口默认加宽（760）');
  const aw = read('modules/windows/about-window.js');
  ok(aw.includes('autoHideMenuBar: true'), '更新/联系/关于窗口不显示菜单栏');
  const lw = read('modules/windows/loading-window.js');
  ok(lw.includes('autoHideMenuBar: true'), '加载窗口不显示菜单栏');
  const html0 = read('renderer/global-memory.html');
  ok(html0.includes('id="cats"') && html0.includes('id="right-body"'), '左右分栏布局（左类别 / 右内容）');
  ok(html0.includes('参考提示词库') || html0.includes('左边'), '布局说明');
  ok(html0.includes('自动识别'), '窗口说明自动识别 ## 区块');
  const bkSrc = read('modules/backup.js');
  ok(bkSrc.includes('AGENTS.md'), 'backup 显式记录全局记忆 AGENTS.md');
  ok(bkSrc.includes('fs.promises.cp(dshHome'), 'backup 整目录复制 ~/.dsh（含 AGENTS.md）');
  ok(!bkSrc.includes('global-memory.md'), 'backup 不单独处理 global-memory.md（AGENTS.md 在 ~/.dsh 整目录内）');
}

// ---------------------------------------------------------------------------
// 16.5 global-memory 行为测试（首次创建 / 自动识别 ## 区块 / 长文本保留格式 /
//      字段增删持久化 / 空名过滤 / 无区块文件）
// ---------------------------------------------------------------------------
async function testGlobalMemoryBehavior() {
  console.log('[16.5] global-memory 行为');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v0912-mem-'));
  const { createGlobalMemory } = require('../modules/global-memory');
  const api = createGlobalMemory({
    fs, path,
    os: { homedir: () => tmp },
    appendLog: () => {},
  });
  const target = path.join(tmp, '.dsh', 'AGENTS.md');
  // 1) 首次：data 返回 exists=false + 默认字段；save 自动创建模板
  const d0 = api.data();
  ok(d0.exists === false, '首次 data.exists=false');
  ok(Array.isArray(d0.defaultFields) && d0.defaultFields.includes('你的称呼'), 'data 带默认字段');
  const r1 = api.save({ fields: [{ name: '你的称呼', value: '小六' }], sections: [] });
  ok(r1.ok === true && fs.existsSync(target), 'save 自动创建 AGENTS.md');
  const raw1 = fs.readFileSync(target, 'utf8');
  ok(raw1.includes('# AGENTS.md（全局记忆）'), '模板头部正确');
  ok(raw1.includes('- 你的称呼：小六'), '基础设定字段写入');
  ok(raw1.includes('## 其他记忆'), '模板含其他记忆区');
  // 2) 自动识别：模拟老大式多区块 AGENTS.md（含列表/代码块/空行），parse 全识别
  const rich = `# AGENTS.md（全局记忆）

## 身份与称呼

- 我的姓名：**小六**
- 对用户的称呼：**老大**

## 项目通用约定（老大指令）

- **开发日志必写**：每次开发后必须写开发日志。

\`\`\`powershell
# 1. git PATH
$env:PATH = "..."
\`\`\`

## 全局记忆指令

涉及 **stm32** 项目，必须先读取 .DSH/AGENTS.md 文件。
`;
  fs.writeFileSync(target, rich, 'utf8');
  const d2 = api.data();
  ok(d2.exists === true && d2.hasBasic === false, '识别：无基础设定区块（hasBasic=false）');
  ok(Array.isArray(d2.sections) && d2.sections.length === 3, `自动识别 3 个 ## 区块（实际 ${d2.sections.length}）`);
  const secTitles = d2.sections.map((s) => s.title);
  ok(secTitles.includes('身份与称呼') && secTitles.includes('项目通用约定（老大指令）') && secTitles.includes('全局记忆指令'),
    '识别出 身份与称呼 / 项目通用约定 / 全局记忆指令');
  ok(d2.sections.every((s) => s.kind === 'long'), '非基础设定区块均为长文本模式');
  const sec1 = d2.sections.find((s) => s.title === '身份与称呼');
  ok(Array.isArray(sec1.body) && sec1.body.join('\n').includes('我的姓名：**小六**'), '区块 body 保留原内容');
  const sec2 = d2.sections.find((s) => s.title === '项目通用约定（老大指令）');
  ok(sec2.body.join('\n').includes('```powershell') && sec2.body.join('\n').includes('$env:PATH'), '代码块原样识别保留');
  // 3) 保存不破坏：只改基础设定字段，其他区块原样（格式/空行/代码块不变）
  const r2 = api.save({
    fields: [{ name: '你的称呼', value: '小六' }, { name: '我的微信号', value: 'wx-12345' }],
    sections: d2.sections.map((s) => ({ title: s.title, body: s.body.join('\n') })),
  });
  ok(r2.ok === true, '保存成功');
  const raw2 = fs.readFileSync(target, 'utf8');
  ok(raw2.includes('- 你的称呼：小六') && raw2.includes('- 我的微信号：wx-12345'), '基础设定字段写入');
  ok(raw2.includes('## 身份与称呼') && raw2.includes('我的姓名：**小六**'), '其他区块标题与内容保留');
  ok(raw2.includes('```powershell') && raw2.includes('$env:PATH = "..."'), '代码块原样保留（不破坏格式）');
  ok(raw2.includes('## 全局记忆指令'), '第三个区块保留');
  ok(raw2.indexOf('## 身份与称呼') > raw2.indexOf('## 基础设定（DSH-Desktop 图形化编辑）'), '基础设定插在头部之后、其他区块之前');
  // 4) 区块内容编辑：改长文本保存 → 文件更新
  const r3 = api.save({
    fields: [{ name: '你的称呼', value: '小六' }],
    sections: d2.sections.map((s) => (s.title === '身份与称呼' ? { title: s.title, body: '- 我的姓名：**小六**（已更新）' } : { title: s.title, body: s.body.join('\n') })),
  });
  ok(r3.ok === true, '长文本编辑保存成功');
  ok(fs.readFileSync(target, 'utf8').includes('- 我的姓名：**小六**（已更新）'), '长文本区块内容更新生效');
  // 4.5) 标题修改（v0.9.12 修复：按序覆盖，旧标题消失 / 新标题生效 / 无重复副本）
  const r3b = api.save({
    fields: [{ name: '你的称呼', value: '小六' }],
    sections: d2.sections.map((s) => (s.title === '身份与称呼' ? { title: '身份与称呼（改）', body: '- 我的姓名：**小六**' } : { title: s.title, body: s.body.join('\n') })),
  });
  ok(r3b.ok === true, '标题修改保存成功');
  const raw3b = fs.readFileSync(target, 'utf8');
  ok(raw3b.includes('## 身份与称呼（改）'), '新标题生效');
  ok(!raw3b.includes('## 身份与称呼\n') && !raw3b.includes('## 身份与称呼（改）\n\n## 身份与称呼（改）'), '旧标题消失且无重复副本');
  ok((raw3b.match(/## 身份与称呼/g) || []).length === 1, '身份与称呼相关区块仅 1 个');
  // 5) 空字段名行过滤
  const r4 = api.save({ fields: [{ name: '', value: '空名行' }, { name: '你的称呼', value: '李四' }], sections: [] });
  ok(r4.ok === true && !fs.readFileSync(target, 'utf8').includes('- ：空名行'), '空字段名行被过滤');
  // 6) 无 ## 区块的文件 → sections 为空
  fs.writeFileSync(target, '只有一行没有区块标题\n', 'utf8');
  const d5 = api.data();
  ok(d5.sections.length === 0 && d5.head.includes('只有一行'), '无 ## 区块 → sections 空（内容归头部）');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 7. package.json 版本
// ---------------------------------------------------------------------------
function testVersion() {
  console.log('[7] package.json 版本');
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  ok(pkg.version === '0.9.12', `version = 0.9.12（实际 ${pkg.version}）`);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  testMenu();
  await testNoticeQuiet();
  testMain();
  testNoticeWindow();
  testChangelog();
  testPet();
  testVersion();
  testUpdaterTrust();
  testRuntimePin();
  testExternalWhitelist();
  testThemeWatchVisible();
  testRestoreLimit();
  testPromptLength();
  testSemverUnify();
  testDevtoolsAndSigning();
  testGlobalMemory();
  await testGlobalMemoryBehavior();
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
