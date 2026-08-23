'use strict';

/**
 * check-v097.js — v0.9.7 功能自动验证（不启动 Electron）
 *
 * 覆盖（用户反馈三项）：
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
 * 16. 全局记忆（v0.9.12 用户指令）：宠物菜单入口 / preload IPC / 首次自动建立行为
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
  // v0.9.8（用户指令）：公告菜单并入帮助菜单
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
  // v0.9.9（用户反馈：壳延迟大）：反向同步轮询 2.5s → 400ms
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

  // v0.9.9（用户指令）：released 标记 —— 已发布 16 版（v1.0.5 发布），内部版本 false
  const releasedCount = cl.versions.filter((v) => v.released === true).length;
  ok(releasedCount === 16, `released=true 共 16 个已发布版本（含 1.0.5，实际 ${releasedCount}）`);
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

  // v0.9.6 条目固定 12 条（与 GitHub Release body 同源；v1.0.1 起 version.json 跟踪 1.0.1，
  // 不再交叉引用 0.9.6 —— 外审终审 v28.0 P2-1 修复）
  const v096 = cl.versions.find((v) => v.version === '0.9.6');
  ok(!!v096 && Array.isArray(v096.notes) && v096.notes.length === 12,
    `0.9.6 条目 12 条（实际 ${v096 ? v096.notes.length : 0}）`);
  // v1.0.5（待发布）：version.json 三处一致（hash 打包后实测）+ CHANGELOG 1.0.5 条目
  ok(vj.version === '1.0.5', `version.json version = 1.0.5（实际 ${vj.version}）`);
  ok(vj.hash && /^[0-9a-f]{64}$/.test(vj.hash), 'version.json hash 为 64 位 SHA256');
  ok(Array.isArray(vj.download_urls) && vj.download_urls.length >= 1 && vj.download_urls.every((u) => u.includes('v1.0.5')), 'version.json download_urls 指向 v1.0.5 资产');
  const v105 = cl.versions.find((v) => v.version === '1.0.5');
  ok(!!v105 && Array.isArray(v105.notes) && v105.notes.length >= 1, 'CHANGELOG 1.0.5 条目存在（待发布 released:false）');
  const v103 = cl.versions.find((v) => v.version === '1.0.3');
  ok(!!v103 && Array.isArray(v103.notes) && v103.notes.length >= 1 && v103.released === true,
    'CHANGELOG 1.0.3 条目存在（released:true，已发布）');
  const v102b = cl.versions.find((v) => v.version === '1.0.2');
  ok(!!v102b && v102b.released === true, 'CHANGELOG 1.0.2 released=true（已发布）');
  const v101b = cl.versions.find((v) => v.version === '1.0.1');
  ok(!!v101b && v101b.released === true, 'CHANGELOG 1.0.1 released=true（已发布）');
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
  // v0.9.13（用户反馈：实机点击宠物眼睛跑到头顶眨眼）：眨眼改几何闭眼 + 时序防护
  ok(src.includes('const setWink = (on) =>'), '眨眼改几何闭眼（setWink，瞳孔 ry 缩小）');
  ok(src.includes('pupil.setAttribute(\'ry\''), '几何闭眼改 SVG 属性（圆心固定，无 transform 位移）');
  ok(src.includes('pet.classList.contains(\'happy\')'), 'happy（点击/彩蛋）期间不眨眼（防表情竞争）');
  ok(src.includes('pet.matches(\':hover\')'), '表情结束后鼠标悬停恢复抬头（防眼睛突兀）');
  // v0.9.13（用户反馈：句子太长）：气泡自动换行
  ok(src.includes('white-space:normal') && src.includes('word-break:keep-all'), '气泡自动换行（keep-all，不字级乱断）');
  ok(src.includes('max-width:120px'), '气泡固定像素宽 120px（横排约 8 字/行，防 em 计算异常竖排）');
  ok(!src.includes('overflow-wrap:anywhere;'), '不再用 overflow-wrap:anywhere（曾致一个字就换行的竖排）');
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
  ok(src.includes('}, 400);'), '仍保留 400ms 快跟随（用户指令）');
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
  ok(gms.includes('用户设定') && gms.includes('我的设定') && gms.includes('DSH 角色'), '三个独立顶层区块：用户设定 / 我的设定 / DSH 角色（DSH 视角）');
  ok(gms.includes('LEGACY_DSH_SECTION'), '兼容旧「DSH 设定」区块（迁移为「我的设定」）');
  ok(gms.includes('kind: \'roles\''), 'DSH 角色独立 kind（与用户/我的设定同级）');
  ok(gms.includes('ROLES_DIR') && gms.includes('roleFile'), '角色文件目录 ~/.dsh/roles/（AGENTS.md 只记定位+文件名）');
  ok(gms.includes('ensureRoleFiles'), '保存时自动建立角色文件');
  ok(gms.includes('DEFAULT_ROLES') && gms.includes('\'角色 3\''), '内置默认角色 1/2/3');
  ok(gms.includes('LEGACY_SECTION'), '兼容旧「基础设定」容器（迁移为独立区块）');
  ok(gms.includes('LEGACY_ROLE_TITLE'), '兼容旧「角色设定」子组（归入 DSH 设定）');
  ok(gms.includes('kind: \'users\'') && gms.includes('kind: \'dsh\''), '用户/我的设定各自独立 kind');
  ok(gms.includes('\'用户的称呼\'') && gms.includes('\'当前项目\''), '用户设定字段：用户的称呼/当前项目（DSH 视角）');
  ok(gms.includes('\'我的名字\'') && gms.includes('\'默认角色\''), '我的设定字段：我的名字/默认角色（DSH 视角）');
  ok(gms.includes('GUIDE_FIELD') && gms.includes('GUIDE_TEXT'), '未配置引导句定义（引导用户配置全局记忆）');
  ok(gms.includes('点击宠物/工具箱图标'), '引导句文案：点击宠物/工具箱图标 进行配置（v0.9.13 用户指令）');
  ok(gms.includes('FORMAT_TIDY_PROMPT') && gms.includes('请按照以下标准格式整理你的全局记忆'), '标准格式整理提示词定义（格式不符时注入）');
  ok(gms.includes('formatMismatch'), 'ensureGuide 返回 formatMismatch（格式检测）');
  const mainSrc0 = read('main.js');
  ok(mainSrc0.includes('memoryFormatMismatch') && mainSrc0.includes('FORMAT_TIDY_PROMPT'), 'main.js 格式不符 → 注入整理提示词');
  ok(mainSrc0.includes('injectTextIntoInput(mw, globalMemoryApi.FORMAT_TIDY_PROMPT'), '整理提示词经注入链路进聊天窗口');
  ok(!mainSrc0.includes('DSH-Desktop 已在运行中'), '去掉"已在运行中"弹框（双击桌面图标直接显示界面）');
  ok(gms.includes('function ensureGuide()'), 'ensureGuide 引导检查（首次对话引导）');
  ok(gms.includes('DEFAULT_DSH_FIELDS'), '内置默认我的设定字段（我的名字/语气/默认角色）');
  ok(gms.includes('DEFAULT_FIELDS'), '内置默认用户设定字段');
  ok(gms.includes('rolesDir'), 'data() 返回角色目录 rolesDir（v1.0.1：窗口左下角显示角色文件路径）');
  ok(gms.includes('function parse('), 'parse 区块化解析（自动识别 ## 标题）');
  ok(gms.includes('kind: \'long\''), '其他 ## 区块识别为长文本（kind=long）');
  ok(gms.includes('renderLong'), '长文本区块渲染');
  ok(gms.includes('用户的称呼'), '默认用户设定含用户的称呼');
  ok(gms.includes('\'我的名字\''), '默认我的设定含我的名字');
  const rjs0 = read('renderer/global-memory.js');
  ok(rjs0.includes('renderCats'), '窗口左侧类别列表（renderCats）');
  ok(rjs0.includes('renderRight'), '窗口右侧内容区（renderRight）');
  ok(rjs0.includes('👤 用户设定') && rjs0.includes('🤖 我的设定') && rjs0.includes('🧠 全局记忆区块') && rjs0.includes('🎭 DSH 角色'),
    '左侧 4 个固定类别：用户设定/我的设定/全局记忆区块/DSH 角色（v1.0.2 用户指令）');
  ok(rjs0.includes('renderMemoList') && rjs0.includes('memo-list') && rjs0.includes('MEMO_KEY') && rjs0.includes('memo-editor'),
    '全局记忆区块：合并所有 ## 区块 + 左侧列表 + 右侧编辑（v1.2.3 用户指令，对齐 DSH 角色）');
  ok(rjs0.includes('默认角色') && rjs0.includes('f-select'), '默认角色字段为下拉选择（f-select）');
  ok(rjs0.includes('isRoleSelect ? \'\' : \'<button class="del"'), '「默认角色」字段行不渲染删除按钮（v1.0.2c 用户反馈：默认角色不能删除）');
  ok(rjs0.includes('const delBtn = row.querySelector(\'.del\')') && rjs0.includes('if (delBtn)'), '删除按钮监听做空值保护（无删除按钮的行不报错）');
  ok(rjs0.includes('btn-add-field'), '窗口有「＋ 添加字段」按钮逻辑');
  ok(rjs0.includes('btn-add-dsh'), '窗口有「＋ 添加 DSH 设定」按钮逻辑');
  ok(rjs0.includes('btn-add-role') && rjs0.includes('role-list') && rjs0.includes('role-item') && rjs0.includes('role-editor-name') && rjs0.includes('role-field-input') && rjs0.includes('data-field'),
    'DSH 角色页：左侧角色列表 + 点击进入编辑（定位/详细记忆固定字段，v1.0.3 用户反馈 2/4）');
  ok(rjs0.includes('role-field-label') && rjs0.includes('## 定位') && rjs0.includes('## 详细记忆'),
    '角色字段标签：## 定位 / ## 详细记忆（v1.0.3 字段输入化）');
  ok(rjs0.includes('MAX_ROLE_NAME = 30') && rjs0.includes('maxlength="') && rjs0.includes('role-editor-count'),
    '角色名长度限制：前端 maxlength=30 + 字数计数（v1.0.3 用户反馈 2）');
  ok(rjs0.includes('selectedRoleIndex') && rjs0.includes('点击左侧角色进入编辑'), '点击角色进入编辑：selectedRoleIndex 选中态 + 引导文案');
  ok(!rjs0.includes('role-tabs') && !rjs0.includes('renderRoleTabs') && !rjs0.includes('activeRole'),
    '角色页不再用顶部 tab / activeRole 状态（v1.0.2 改卡片列表）');
  ok(rjs0.includes('addEventListener(\'focus\'') && rjs0.includes('signature'), '窗口聚焦时按 变更指纹（signature：AGENTS.md+角色文件）自动刷新（v1.0.2b 用户反馈）');
  ok(!rjs0.includes('path-memory') && !rjs0.includes('path-roles'), '去掉左下角双路径显示（v1.0.1 用户反馈）');
  ok(rjs0.includes('btn-open-memory') && rjs0.includes('btn-open-roles') && rjs0.includes('openGlobalMemoryRoles'),
    '两个按钮：记忆文件位置(AGENTS) / 角色文件位置（v1.0.1 用户指令）');
  const ghtml = read('renderer/global-memory.html');
  ok(ghtml.includes('dsh-view') && ghtml.includes('(DSH 视角)'), '标题红色标注（DSH 视角）（v0.9.16 用户指令）');
  ok(ghtml.includes('记忆文件位置(AGENTS)'), '按钮文案：记忆文件位置(AGENTS)（v1.0.1 用户指令）');
  ok(ghtml.includes('tip-red') && ghtml.includes('双击对话框选择角色') && ghtml.includes('默认角色请在[我的设定]中选择'),
    '红色提示文案：双击对话框选择角色，默认角色请在[我的设定]中选择（v1.0.3 用户反馈 2）');
  ok(!rjs0.includes('tip-red'), 'DSH 角色页不再内嵌红色提示（已移到窗口介绍下方全局显示）');
  ok(!rjs0.includes('新对话时会弹窗选择角色'), '窗口不再说明新对话弹窗选角色（v0.9.15：新建对话不提示）');
  const rsel = read('modules/role-selector.js');
  ok(!rsel.includes('dsh.sessions.current') && !rsel.includes('setInterval'), '不再轮询 DSH 会话切换（v0.9.15：新建对话不弹窗）');
  ok(rsel.includes('本次对话角色为'), '选定角色后注入「本次对话角色为 xxxx，角色定义文件为 xxxx」');
  ok(rsel.includes('不选择') || rsel.includes('取消'), '弹窗支持不选择');
  ok(rsel.includes('injectDblclick') && rsel.includes('chooseRole'), '双击 DSH 输入框重选角色（injectDblclick 唯一入口）');
  const mainSrc1 = read('main.js');
  ok(!mainSrc1.includes('roleSelectorApi.start()') && !mainSrc1.includes('roleSelectorApi.stop()'), '主进程不再启动/停止会话轮询（新建对话不弹窗）');
  ok(mainSrc1.includes('roleSelectorApi.injectDblclick(mainWindow)'), '主窗口就绪后注入双击重选角色监听');
  ok(mainSrc1.includes('.format-tidy-injected') && mainSrc1.includes('tidyMarker'), 'N3：整理提示仅首次注入（标记文件防重复覆盖，外审 zx9）');
  ok(mainSrc1.includes('mw.isMinimized()'), 'P2-1：外观轮询最小化时跳过（isMinimized，外审 zx9）');
  const preloadSrc = read('preload.js');
  ok(preloadSrc.includes('getPathForFile 失败') && preloadSrc.includes('console.warn'), 'S13：getPathForFile 异常记录 warn（外审 zx29）');
  ok(preloadSrc.includes('openGlobalMemoryRoles'), 'preload：openGlobalMemoryRoles API（v1.0.1：角色文件位置）');
  const ipcSrc3 = read('modules/ipc.js');
  ok(ipcSrc3.includes('memory:open-roles') && ipcSrc3.includes('roles'), 'IPC：memory:open-roles 打开角色目录（v1.0.1）');
  const menuSrc = read('modules/menu.js');
  ok(menuSrc.includes('打开记忆目录') && menuSrc.includes('app.getPath(\'home\'), \'.dsh\''), '文件菜单「打开记忆目录」→ ~/.dsh（v1.0.1 用户指令）');
  ok(rjs0.includes('guide-tip'), '窗口显示未配置引导提示条');
  ok(rjs0.includes('TIDY_PROMPT') && rjs0.includes('整理你的全局记忆，不要改变原意'), '保存后整理记忆提示词');
  ok(rjs0.includes('tidy-bar') && rjs0.includes('showTidyBar'), '保存后询问是否让 DSH 整理记忆');
  ok(rjs0.includes('injectPrompt'), '整理提示词经注入链路进 DSH 输入框');
  ok(!/window\.prompt\(/.test(rjs0), '不使用 window.prompt（沙箱渲染进程禁用，改界面内输入）');
  ok(rjs0.includes('memo-editor-title'), '区块标题可修改（全局记忆区块右侧编辑标题输入框，v1.2.3）');
  ok(rjs0.includes('onSaveClick'), '保存走前端二次确认（onSaveClick）');
  ok(rjs0.includes('确认保存？'), '文件存在 → 按钮二次确认（防误覆盖）');
  ok(rjs0.includes('SAVE_TIMEOUT_MS') || rjs0.includes('保存超时'), '保存带超时兜底（绝不卡「保存中」）');
  ok(rjs0.includes('collectPayload'), '保存收集用户+DSH+区块');
  ok(rjs0.includes('saveGlobalMemory'), '保存调 saveGlobalMemory');
  ok(rjs0.includes('getGlobalMemory'), '读取调 getGlobalMemory');
  const ipcSrc2 = read('modules/ipc.js');
  ok(!ipcSrc2.includes('showMessageBox'), '主进程 memory:save 不再弹 dialog（确认移前端，防子窗口挂起卡死）');
  ok(ipcSrc2.includes('覆盖确认由前端按钮二次确认'), '注释说明确认移前端');
  ok(ipcSrc2.includes('catch (err)') && ipcSrc2.includes('保存全局记忆异常'), 'memory:save handler try/catch（绝不 reject 卡死前端）');
  const mw = read('modules/windows/misc-windows.js');
  ok(mw.includes('openGlobalMemoryWindow'), 'misc-windows 有全局记忆窗口');
  ok(mw.includes('\'global-memory.html\''), '窗口加载 global-memory.html');
  ok(mw.includes('autoHideMenuBar: true'), '弹窗不显示菜单栏（autoHideMenuBar）');
  ok(mw.includes('width: 960'), '全局记忆窗口默认加宽（960，v1.0.2b 用户反馈）');
  const aw = read('modules/windows/about-window.js');
  ok(aw.includes('autoHideMenuBar: true'), '更新/联系/关于窗口不显示菜单栏');
  const lw = read('modules/windows/loading-window.js');
  ok(lw.includes('autoHideMenuBar: true'), '加载窗口不显示菜单栏');
  const html0 = read('renderer/global-memory.html');
  ok(html0.includes('id="cats"') && html0.includes('id="right-body"'), '左右分栏布局（左类别 / 右内容）');
  ok(html0.includes('参考提示词库') || html0.includes('左边'), '布局说明');
  ok(html0.includes('全局记忆区块') && html0.includes('文件全文'), '窗口说明：全局记忆区块汇总 ## 区块、DSH 角色输入框即文件全文（v1.0.2）');
  ok(html0.includes('tidy-bar'), 'html 有整理记忆确认条容器');
  const loadHtml = read('renderer/loading.html');
  ok(loadHtml.includes('① 检查 DSH 组件'), '启动阶段①文案：检查 DSH 组件（用户反馈：运行时表述不清）');
  ok(!loadHtml.includes('检查 DSH 运行时'), '旧的"检查 DSH 运行时"文案已移除');
  const mainSrc = read('main.js');
  ok(mainSrc.includes('ensureGuide()'), '启动时调用 ensureGuide（未配置插入引导句）');
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
  ok(Array.isArray(d0.defaultFields) && d0.defaultFields.includes('用户的称呼'), 'data 带默认字段');
  // v1.0.5（删除生效语义）：模拟窗口流程 —— 首次先加载模板 long 区块（含「其他记忆」）再提交，避免误删模板区块
  const tplLongs = (d0.sections || []).filter((s) => s.kind === 'long')
    .map((s) => ({ title: s.title, body: (s.body || []).join('\n') }));
  const r1 = api.save({ users: [{ name: '用户的称呼', value: '小六' }], dsh: [], sections: tplLongs });
  ok(r1.ok === true && fs.existsSync(target), 'save 自动创建 AGENTS.md');
  const raw1 = fs.readFileSync(target, 'utf8');
  ok(raw1.includes('# AGENTS.md（全局记忆）'), '模板头部正确');
  ok(raw1.includes('## 用户设定') && raw1.includes('- 用户的称呼：小六'), '用户设定独立区块写入');
  ok(raw1.includes('## 其他记忆'), '模板含其他记忆区');
  ok(!raw1.includes('基础设定（DSH-Desktop 图形化编辑）'), '模板无旧「基础设定」容器');
  // 2) 自动识别：模拟用户式多区块 AGENTS.md（含列表/代码块/空行），parse 全识别
  const rich = `# AGENTS.md（全局记忆）

## 身份与称呼

- 我的姓名：**小六**
- 对用户的称呼：**用户**

## 项目通用约定（用户指令）

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
  ok(d2.exists === true, '识别：文件已存在');
  ok(Array.isArray(d2.sections) && d2.sections.length === 3, `自动识别 3 个 ## 区块（实际 ${d2.sections.length}）`);
  const secTitles = d2.sections.map((s) => s.title);
  ok(secTitles.includes('身份与称呼') && secTitles.includes('项目通用约定（用户指令）') && secTitles.includes('全局记忆指令'),
    '识别出 身份与称呼 / 项目通用约定 / 全局记忆指令');
  ok(d2.sections.every((s) => s.kind === 'long'), '非基础设定区块均为长文本模式');
  const sec1 = d2.sections.find((s) => s.title === '身份与称呼');
  ok(Array.isArray(sec1.body) && sec1.body.join('\n').includes('我的姓名：**小六**'), '区块 body 保留原内容');
  const sec2 = d2.sections.find((s) => s.title === '项目通用约定（用户指令）');
  ok(sec2.body.join('\n').includes('```powershell') && sec2.body.join('\n').includes('$env:PATH'), '代码块原样识别保留');
  // 3) 保存不破坏：只改基础设定字段，其他区块原样（格式/空行/代码块不变）
  const r2 = api.save({
    fields: [{ name: '用户的称呼', value: '小六' }, { name: '我的微信号', value: 'wx-12345' }],
    sections: d2.sections.map((s) => ({ title: s.title, body: s.body.join('\n') })),
  });
  ok(r2.ok === true, '保存成功');
  const raw2 = fs.readFileSync(target, 'utf8');
  ok(raw2.includes('- 用户的称呼：小六') && raw2.includes('- 我的微信号：wx-12345'), '基础设定字段写入');
  ok(raw2.includes('## 身份与称呼') && raw2.includes('我的姓名：**小六**'), '其他区块标题与内容保留');
  ok(raw2.includes('```powershell') && raw2.includes('$env:PATH = "..."'), '代码块原样保留（不破坏格式）');
  ok(raw2.includes('## 全局记忆指令'), '第三个区块保留');
  ok(raw2.includes('## 用户设定'), '保存后生成独立「用户设定」顶层区块');
  ok(raw2.indexOf('## 身份与称呼') > raw2.indexOf('## 用户设定'), '用户设定在头部之后、其他区块之前');
  // 4) 区块内容编辑：改长文本保存 → 文件更新
  const r3 = api.save({
    users: [{ name: '用户的称呼', value: '小六' }],
    dsh: [],
    sections: d2.sections.map((s) => (s.title === '身份与称呼' ? { title: s.title, body: '- 我的姓名：**小六**（已更新）' } : { title: s.title, body: s.body.join('\n') })),
  });
  ok(r3.ok === true, '长文本编辑保存成功');
  ok(fs.readFileSync(target, 'utf8').includes('- 我的姓名：**小六**（已更新）'), '长文本区块内容更新生效');
  // 4.5) 标题修改（v0.9.12 修复：按序覆盖，旧标题消失 / 新标题生效 / 无重复副本）
  const r3b = api.save({
    users: [{ name: '用户的称呼', value: '小六' }],
    dsh: [],
    sections: d2.sections.map((s) => (s.title === '身份与称呼' ? { title: '身份与称呼（改）', body: '- 我的姓名：**小六**' } : { title: s.title, body: s.body.join('\n') })),
  });
  ok(r3b.ok === true, '标题修改保存成功');
  const raw3b = fs.readFileSync(target, 'utf8');
  ok(raw3b.includes('## 身份与称呼（改）'), '新标题生效');
  ok(!raw3b.includes('## 身份与称呼\n') && !raw3b.includes('## 身份与称呼（改）\n\n## 身份与称呼（改）'), '旧标题消失且无重复副本');
  ok((raw3b.match(/## 身份与称呼/g) || []).length === 1, '身份与称呼相关区块仅 1 个');
  // 4.6) DSH 设定独立顶层区块（v0.9.12 用户指令：删除"基础设定"容器）
  //      save 带 dsh → 生成独立「## 我的设定」区块；重读回填
  const r3c = api.save({
    users: [{ name: '用户的称呼', value: '小六' }],
    dsh: [{ name: '我的名字', value: '小鲸鱼' }, { name: '角色 1', value: '资深 C++ 工程师' }],
    sections: d2.sections.map((s) => ({ title: s.title, body: s.body.join('\n') })),
  });
  ok(r3c.ok === true, '含 DSH 设定保存成功');
  const raw3c = fs.readFileSync(target, 'utf8');
  ok(raw3c.includes('## 用户设定') && raw3c.includes('## 我的设定'), '用户设定 / DSH 设定 两个独立顶层区块写入');
  ok(!raw3c.includes('基础设定（DSH-Desktop 图形化编辑）'), '不再输出旧「基础设定」容器');
  ok(raw3c.includes('- 我的名字：小鲸鱼') && raw3c.includes('- 角色 1：资深 C++ 工程师'), 'DSH 设定字段写入');
  const d3c = api.data();
  const usersSec3c = d3c.sections.find((s) => s.kind === 'users');
  const dshSec3c = d3c.sections.find((s) => s.kind === 'dsh');
  ok(!!usersSec3c && !!dshSec3c, '解析出 用户设定/DSH 设定 两个独立区块');
  ok(Array.isArray(dshSec3c.fields) && dshSec3c.fields.length === 2
    && dshSec3c.fields[0].name === '我的名字' && dshSec3c.fields[0].value === '小鲸鱼', 'DSH 设定解析回填（重开窗口仍在）');
  // 4.7) DSH 设定为空 → 不输出 DSH 区块（保持文件简洁）
  const r3d = api.save({ users: [{ name: '用户的称呼', value: '小六' }], dsh: [], sections: [] });
  ok(r3d.ok === true && !fs.readFileSync(target, 'utf8').includes('## 我的设定'), 'DSH 设定为空不输出区块');
  // 4.8) 旧格式迁移：文件含旧「## 基础设定」容器 + 「### 角色设定」→ 解析成 用户/DSH 两个独立区块
  fs.writeFileSync(target, '# AGENTS.md\n\n## 基础设定（DSH-Desktop 图形化编辑）\n\n- 用户的称呼：旧称呼\n\n### 角色设定（DSH 扮演）\n\n- 角色 1：旧角色\n', 'utf8');
  const d3e = api.data();
  const usersSec3e = d3e.sections.find((s) => s.kind === 'users');
  const dshSec3e = d3e.sections.find((s) => s.kind === 'dsh');
  ok(!!usersSec3e && usersSec3e.fields.some((it) => it.name === '用户的称呼' && it.value === '旧称呼'),
    '旧容器用户字段迁移到「用户设定」独立区块');
  ok(!!dshSec3e && dshSec3e.fields.length === 1 && dshSec3e.fields[0].value === '旧角色',
    '旧「角色设定」子组迁移为「DSH 设定」独立区块');
  // 4.9) v0.9.14（用户反馈：旧窗口保存的文件仍是「你的称呼/DSH 的名字」旧视角）：
  //      字段名自动迁移为 DSH 视角（你的→用户 / DSH 的名字→我的名字 / 项目背景→当前项目）+ 旧模板头部说明迁移
  fs.writeFileSync(target, `# AGENTS.md（全局记忆）

> 此文件由 DSH-Desktop「全局记忆」窗口维护，DSH 会自动读取其中的内容作为长期记忆（无需手动发送）。
> 「用户设定」与「DSH 设定」请用窗口中的表单编辑；其他内容可自行追加到「其他记忆」区。

## 用户设定

- 你的称呼：用户
- 你的身份/角色：技术总监
- 项目背景：DSH-Desktop
- 常用约定：有改必升版本号

## DSH 设定

- DSH 的名字：小鲸鱼
- 语气风格：简洁
- 输出习惯：结论先行

## DSH 角色

- 角色 1：学习导师
`, 'utf8');
  const d3f = api.data();
  const usersSec3f = d3f.sections.find((s) => s.kind === 'users');
  const dshSec3f = d3f.sections.find((s) => s.kind === 'dsh');
  const unames3f = (usersSec3f.fields || []).map((it) => it.name);
  ok(unames3f.includes('用户的称呼') && unames3f.includes('用户的身份/角色') && unames3f.includes('当前项目') && unames3f.includes('常用约定'),
    '旧字段名迁移：你的称呼→用户的称呼 / 你的身份/角色→用户的身份/角色 / 项目背景→当前项目');
  ok(!unames3f.includes('你的称呼') && !unames3f.includes('你的身份/角色') && !unames3f.includes('项目背景'), '旧用户字段名不再出现');
  const dnames3f = (dshSec3f.fields || []).map((it) => it.name);
  ok(dnames3f.includes('我的名字') && !dnames3f.includes('DSH 的名字'), '旧字段名迁移：DSH 的名字→我的名字');
  ok(dshSec3f.title === '我的设定', '旧「DSH 设定」区块标题 →「我的设定」');
  ok(d3f.head.includes('我的设定') && !d3f.head.includes('「DSH 设定」请用窗口中的表单编辑'), '旧模板头部说明迁移为 DSH 视角');
  const r3f = api.save({ users: usersSec3f.fields, dsh: dshSec3f.fields, roles: [], sections: [] });
  ok(r3f.ok === true, '迁移后保存成功');
  const raw3f = fs.readFileSync(target, 'utf8');
  ok(raw3f.includes('- 用户的称呼：用户') && raw3f.includes('- 我的名字：小鲸鱼') && raw3f.includes('- 当前项目：DSH-Desktop'),
    '保存后文件为 DSH 视角字段');
  ok(!raw3f.includes('你的称呼') && !raw3f.includes('DSH 的名字') && !raw3f.includes('## DSH 设定'), '保存后无旧视角残留');
  // 4.10) v0.9.16（外审 zx(9) 复核 N1/N2）：payload 上限 1MB + 字段值内换行过滤
  const bigPayload = { users: [{ name: '用户的称呼', value: 'x'.repeat(2 * 1024 * 1024) }], dsh: [], sections: [] };
  const rBig = api.save(bigPayload);
  ok(rBig.ok === false && /1MB/.test(rBig.message || ''), 'N1：超 1MB payload 拒绝（返回 message，外审 zx9）');
  fs.rmSync(target, { force: true });
  const rNl = api.save({
    users: [{ name: '用户的称呼', value: '用户\n第二行' }],
    dsh: [{ name: '我的名字', value: '小鲸鱼\r\n尾巴' }],
    sections: [],
  });
  ok(rNl.ok === true, 'N2：多行字段值保存成功');
  const rawNl = fs.readFileSync(target, 'utf8');
  ok(rawNl.includes('- 用户的称呼：用户 第二行') && rawNl.includes('- 我的名字：小鲸鱼 尾巴'),
    'N2：字段值内换行替换为空格（不撕行，外审 zx9）');
  ok((rawNl.match(/\n- 我的名字：/g) || []).length === 1, 'N2：字段行未被多行值拆散');
  // 5) 空字段名行过滤
  const r4 = api.save({ users: [{ name: '', value: '空名行' }, { name: '用户的称呼', value: '李四' }], dsh: [], sections: [] });
  ok(r4.ok === true && !fs.readFileSync(target, 'utf8').includes('- ：空名行'), '空字段名行被过滤');
  // 6) 无 ## 区块的文件 → sections 为空
  fs.writeFileSync(target, '只有一行没有区块标题\n', 'utf8');
  const d5 = api.data();
  ok(d5.sections.length === 0 && d5.head.includes('只有一行'), '无 ## 区块 → sections 空（内容归头部）');
  // 7) 未配置引导（用户指令）：无文件 → ensureGuide 建模板+引导句；已配置 → 不插入；save 配置完成 → 删除引导句
  fs.rmSync(target, { force: true });
  const g1 = api.ensureGuide();
  ok(g1.ok === true && g1.guided === true, '无文件 ensureGuide 创建模板并插入引导句');
  ok(fs.readFileSync(target, 'utf8').includes('引导提示') && fs.readFileSync(target, 'utf8').includes('请在对话中引导用户点击宠物/工具箱图标'),
    '引导句写入文件');
  ok(g1.formatMismatch === false, '模板格式符合标准（无格式整理需求）');
  const g2 = api.ensureGuide();
  ok(g2.guided === false, '重复 ensureGuide 幂等（不重复插入）');
  // 已配置（用户设定有值）→ ensureGuide 不插入
  await api.save({ users: [{ name: '用户的称呼', value: '小六' }], dsh: [], sections: [] });
  ok(!fs.readFileSync(target, 'utf8').includes('引导提示'), '配置完成后引导句被删除');
  const g3 = api.ensureGuide();
  ok(g3.guided === false && !fs.readFileSync(target, 'utf8').includes('引导提示'), '已配置后 ensureGuide 不再插入');
  // 8) v0.9.13 格式检测（用户指令）：已存在记忆但不符标准格式（缺用户/DSH 区块）→ formatMismatch=true
  fs.writeFileSync(target, '# AGENTS.md\n\n## 身份与称呼\n\n- 我的姓名：**小六**\n', 'utf8');
  const g4 = api.ensureGuide();
  ok(g4.formatMismatch === true, '旧格式记忆（无用户/DSH 设定区块）→ formatMismatch=true（待整理）');
  ok(!fs.readFileSync(target, 'utf8').includes('引导提示'), '无用户设定区块 → 不插引导句（由注入整理提示接管）');
  // 9) v0.9.13 角色设定（方案）+ v1.0.2 全文语义：角色 value = 角色 .md 全文
  fs.rmSync(target, { force: true });
  const full1 = '# 角色：角色 1\n\n## 定位\n\n工作编程助手（文件：~/.dsh/roles/角色 1.md）\n\n## 详细记忆\n\n详细记忆内容A';
  const full2 = '# 角色：角色 2\n\n## 定位\n\n闲聊伙伴（文件：~/.dsh/roles/角色 2.md）\n\n## 详细记忆\n\n详细记忆内容B';
  const r9 = api.save({
    users: [{ name: '用户的称呼', value: '小六' }],
    dsh: [{ name: '我的名字', value: '小鲸鱼' }],
    roles: [
      { name: '角色 1', value: full1 },
      { name: '角色 2', value: full2 },
    ],
    sections: [],
  });
  ok(r9.ok === true, '含角色保存成功');
  const raw9 = fs.readFileSync(target, 'utf8');
  ok(raw9.includes('## DSH 角色') && raw9.includes('- 角色 1：工作编程助手（文件：~/.dsh/roles/角色 1.md）'),
    'v1.0.2：AGENTS.md 角色行只存定位（从全文 ## 定位 节提取，不写全文）');
  const roleFile1 = path.join(tmp, '.dsh', 'roles', '角色-1.md'); // 文件名安全化：空格 → -
  const roleFile2 = path.join(tmp, '.dsh', 'roles', '角色-2.md');
  ok(fs.existsSync(roleFile1) && fs.existsSync(roleFile2), '角色文件自动建立（~/.dsh/roles/）');
  ok(fs.readFileSync(roleFile1, 'utf8').includes('# 角色：角色 1') && fs.readFileSync(roleFile1, 'utf8').includes('详细记忆内容A'),
    'v1.0.2：角色文件 = UI 提交全文（## 定位 / ## 详细记忆 原样保留）');
  const d9 = api.data();
  const rolesSec9 = d9.sections.find((s) => s.kind === 'roles');
  ok(!!rolesSec9 && rolesSec9.fields.length === 2 && rolesSec9.fields[1].name === '角色 2', 'DSH 角色解析回填（重开窗口仍在）');
  ok(!!rolesSec9 && rolesSec9.fields[0].value === '## 详细记忆\n\n详细记忆内容A' && rolesSec9.fields[0].desc === '工作编程助手（文件：~/.dsh/roles/角色 1.md）',
    'v1.0.3：data() 角色拆字段 —— value = 详细记忆及剩余内容、desc = ## 定位 全文（字段输入化，用户反馈 4）');
  ok(typeof d9.mtime === 'number' && d9.mtime > 0, 'v1.0.2：data() 返回 mtime（AGENTS.md 修改时间）');
  ok(typeof d9.signature === 'string' && d9.signature.length > 0 && d9.signature.includes('角色'), 'v1.0.2b：data() 返回 signature（AGENTS.md+角色文件 变更指纹）');
  // 10) v1.0.2（用户反馈 5①）：角色改名 → 旧文件删除 + 新文件建立（内容保留、标题更新）；删除角色 → 文件同步删除
  const r10a = api.save({
    users: [{ name: '用户的称呼', value: '小六' }], dsh: [],
    roles: [{ name: '学习导师', value: full1 }, { name: '角色 2', value: full2 }], // 角色 1 → 学习导师（UI 内存携带旧全文）
    sections: [],
  });
  ok(r10a.ok === true, '角色改名保存成功');
  ok(!fs.existsSync(roleFile1) && fs.existsSync(path.join(tmp, '.dsh', 'roles', '学习导师.md')),
    'v1.0.2：改名后旧角色文件删除、新文件建立（不再每次改名堆积新文件）');
  const renamed = fs.readFileSync(path.join(tmp, '.dsh', 'roles', '学习导师.md'), 'utf8');
  ok(renamed.includes('# 角色：学习导师') && renamed.includes('详细记忆内容A'),
    'v1.0.2：改名后文件标题更新为「# 角色：学习导师」，详细记忆内容保留');
  const r10b = api.save({
    users: [{ name: '用户的称呼', value: '小六' }], dsh: [],
    roles: [{ name: '学习导师', value: renamed }],
    sections: [],
  });
  ok(r10b.ok === true && !fs.existsSync(path.join(tmp, '.dsh', 'roles', '角色-2.md')),
    'v1.0.2：删除角色 → 其 .md 文件同步删除');
  // 角色文件安全名：非法字符（空格/斜杠）替换为 -（防路径穿越）
  const r10 = api.save({ users: [{ name: '用户的称呼', value: '小六' }], dsh: [], roles: [{ name: '角色 A/B', value: '测试' }], sections: [] });
  ok(r10.ok === true && fs.existsSync(path.join(tmp, '.dsh', 'roles', '角色-A-B.md')), '角色文件名非法字符安全化（空格/斜杠 → -）');
  // 11) v1.0.2b（用户反馈：改角色 .md 后需重开窗口才刷新）：角色文件外部修改 → signature 变化
  const sig1 = api.data().signature;
  fs.writeFileSync(path.join(tmp, '.dsh', 'roles', '角色-A-B.md'), '# 角色：角色 A/B\n\n## 定位\n\n测试\n\n## 详细记忆\n\n外部修改内容', 'utf8');
  const sig2 = api.data().signature;
  ok(typeof sig1 === 'string' && sig1 !== sig2 && sig2.includes('角色 A/B'),
    'v1.0.2b：角色文件被外部修改 → signature 变化（聚焦刷新能检测到，无需重开窗口）');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 7. package.json 版本
// ---------------------------------------------------------------------------
function testVersion() {
  console.log('[7] package.json 版本');
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  ok(pkg.version === '1.0.5', `version = 1.0.5（实际 ${pkg.version}）`);
}

// ---------------------------------------------------------------------------
// 8. v1.0.3（用户反馈 1-6）：设置联动 / 角色字段输入 / 竖排选择 / 二级分类 / DSH 版本持久化
// ---------------------------------------------------------------------------
function testV103() {
  console.log('[8] v1.0.3 修复验证');
  // 问题①：最小化到托盘 / 关闭时总是询问 / 记住选择 三向联动
  const settingsSrc = read('modules/settings.js');
  ok(settingsSrc.includes('setCloseAsk') && settingsSrc.includes('closeAsk'), 'settings：新增 setCloseAsk（关闭时总是询问开关）');
  ok(settingsSrc.includes('开启最小化到托盘：已清除「记住退出」记忆'), 'setMinimizeToTray：开启时清除「记住退出」（防矛盾状态）');
  ok(settingsSrc.includes('s.minimizeToTray = false') && settingsSrc.includes('action === \'quit\''), 'setCloseChoice：记住退出 → 取消最小化到托盘勾选');
  ok(settingsSrc.includes('s.closeAsk = false') && settingsSrc.includes('action === \'tray\''), 'setCloseChoice：记住托盘 → 保持托盘勾选、取消总是询问');
  const mwSrc = read('modules/windows/main-window.js');
  ok(mwSrc.includes('settings.closeAsk') && mwSrc.includes('openCloseChoiceWindow(win)') && mwSrc.includes('win.hide();'),
    'close 逻辑：closeAsk 才询问；未勾选且未记忆 → 直接驻留托盘（不再每次弹窗）');
  const menuSrc2 = read('modules/menu.js');
  ok(menuSrc2.includes('label: \'关闭时总是询问\',') && menuSrc2.includes('type: \'checkbox\''), '菜单：「关闭时总是询问」改为 checkbox 开关');
  ok(menuSrc2.includes('清除「记住：') && menuSrc2.includes('关闭到托盘'), '菜单：清除记忆按钮动态显示当前记住的选择');
  // 问题③：角色选择竖排窗口
  const rp = read('modules/role-picker.js');
  ok(rp.includes('openRolePicker') && rp.includes('role-picker:select') && rp.includes('list.find'),
    'role-picker 模块：竖排选择窗口 + IPC 结果回传');
  const rsel2 = read('modules/role-selector.js');
  ok(rsel2.includes('openRolePicker') && rsel2.includes('chosen.index'), 'role-selector：pickRole 改走竖排窗口');
  const preload2 = read('preload.js');
  ok(preload2.includes('rolePickerResult'), 'preload：rolePickerResult API（选择结果上报）');
  const rphtml = read('renderer/role-picker.html');
  ok(rphtml.includes('role-picker.js') && rphtml.includes('id="list"') && rphtml.includes('不选择'), 'role-picker.html：独立竖排列表页面（含取消按钮）');
  // 问题⑤：内置库二级子分类（在现有分类下细分，我的提示词不受影响）
  const prompts = JSON.parse(fs.readFileSync(path.join(APP, 'prompts.json'), 'utf8'));
  ok(!('groups' in prompts) && Array.isArray(prompts.categories), 'prompts.json：无一级分组（改为分类内二级子分类）');
  ok(prompts.categories.length === 6 && prompts.categories.every((c) => Array.isArray(c.subs) && c.subs.length >= 2),
    'prompts.json：6 个分类全部含二级子分类（每类 ≥2 个）');
  const totalItems = prompts.categories.reduce((n, c) => n + c.subs.reduce((m, s) => m + s.items.length, 0), 0);
  ok(totalItems === 201, `prompts.json：条目总数 201（v1.0.5 新增 100 条，实际 ${totalItems}）`);
  ok(prompts.version === 6, `prompts.json：version 6（实际 ${prompts.version}）`);
  const plib = read('renderer/promptlib.js');
  ok(plib.includes('expandedCats') && plib.includes('cat-head') && plib.includes('selectSub') && plib.includes('currentSub'),
    'promptlib：一级分类可折叠 + 二级子分类选中（用户反馈 5 修正）');
  ok(plib.includes('promptlibBound') && plib.includes('dataset.promptlibBound'),
    'promptlib：分类头事件委托只绑定一次（防监听器累积导致展开/收起失效，用户反馈）');
  ok(plib.includes('customGroups') && plib.includes('filteredCustom'), 'promptlib：我的提示词分组逻辑保留（不受影响）');
  // 问题⑥：DSH 版本选择持久化到 userData（升级壳不回退）
  const rt = read('modules/dsh-runtime.js');
  ok(rt.includes('userDshVersionFile') && rt.includes('saveUserDshVersion') && rt.includes('readUserDshVersion'),
    'dsh-runtime：userData 版本持久化 API（dsh-version.json）');
  ok(rt.includes('const userVer = readUserDshVersion()') && rt.includes('String(userVer.version)'),
    'readShellConfig：userData 记录优先于 config.json（升级壳覆盖 config 不回退）');
  ok(rt.includes('config.json 写入失败（安装目录只读？）'), 'updateDshVersion：config 写失败也以 userData 记录为准');
  ok(rt.includes('cfg.dshVersion !== \'latest\'') && rt.includes('saveUserDshVersion(installedDshVersion()'),
    'ensureDshRuntime：精确版本安装后持久化（latest 语义不受影响）');
  // 问题④：角色字段输入化（主进程解析/组装）
  const gmSrc = read('modules/global-memory.js');
  ok(gmSrc.includes('parseRoleContent') && gmSrc.includes('renderRoleContent'), 'global-memory：角色字段解析（定位/详细记忆）与组装函数');
  ok(gmSrc.includes('value: rest') && gmSrc.includes('desc'), 'data()：角色 value = 详细记忆及剩余、desc = 定位全文');
  ok(gmSrc.includes('it.desc != null') && gmSrc.includes('parseRoleContent(String((it && it.value)'),
    'save()：兼容旧 payload（value=全文）→ 解析拆分再组装（不丢数据）');
}

// ---------------------------------------------------------------------------
// 9. v1.0.5（用户反馈 1-4）：提示词 +100 / 区块删除生效 / 角色记忆说明 / 备份恢复
// ---------------------------------------------------------------------------
function testV105() {
  console.log('[9] v1.0.5 修复验证');
  // 问题②：区块删除生效 —— 主进程长区块以窗口提交集合为准（删除后不再 fallback 原文件）
  const gm = read('modules/global-memory.js');
  ok(gm.includes('submittedLongs') && gm.includes('usedTitles'), 'global-memory：长区块按窗口提交集合合并（标题匹配原位覆盖 / 删除生效）');
  ok(!gm.includes('incoming ? incoming.title : s.title'), 'global-memory：已移除"缺失区块 fallback 原文件"逻辑（修复删除后刷新回来）');
  // 问题③：角色记忆说明句
  ok(gm.includes('ROLE_NOTE_FIELD') && gm.includes('ROLE_NOTE_TEXT') && gm.includes('roleNote'),
    'global-memory：角色记忆说明句常量 + roleNote 标记');
  ok(gm.includes('name === ROLE_NOTE_FIELD') && gm.includes('cur.roleNote = true'),
    'parse：说明句识别为 roleNote（不算角色字段，防重复累积）');
  ok(gm.includes('if (roleNote) lines.push'), 'renderRoles：roleNote=true 时输出说明句');
  ok(gm.includes('ROLE_NOTE_FIELD}：${ROLE_NOTE_TEXT}'), 'TEMPLATE：角色记忆说明句（新用户首次创建即含）');
  // 问题④：备份 / 一键恢复
  ok(gm.includes('writeBackup') && gm.includes('backupFile') && gm.includes('restoreBackup') && gm.includes('isCorrupt'),
    'global-memory：备份 / 一键恢复 / 损坏检测函数');
  ok(gm.includes('if (raw !== null) writeBackup()'), 'save()：保存前自动备份（有旧内容时）');
  const ipc = read('modules/ipc.js');
  ok(ipc.includes('memory:restore-backup'), 'ipc：memory:restore-backup handler');
  const pre = read('preload.js');
  ok(pre.includes('restoreGlobalMemoryBackup'), 'preload：restoreGlobalMemoryBackup API');
  const rjs = read('renderer/global-memory.js');
  ok(rjs.includes('fileCorrupt') && rjs.includes('updateCorruptBar'), 'renderer：损坏状态跟踪 + 恢复条显隐');
  const rhtml = read('renderer/global-memory.html');
  ok(rhtml.includes('corrupt-bar') && rhtml.includes('btn-restore-bak'), 'global-memory.html：恢复提示条 + 一键恢复按钮');
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
  testV103(); // v1.0.3：6 项修复断言
  testV105(); // v1.0.5：提示词 +100 / 区块删除 / 角色记忆说明 / 备份恢复
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
