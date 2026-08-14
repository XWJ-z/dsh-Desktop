# 开发日志（DEVELOPMENT_LOG.md）

> 开发日志按时间倒序记录（最新在上）。每次变更（代码 / 文档 / 验证结果）追加一条。
> 格式：`YYYY-MM-DD HH:MM — 做了什么 / 结果如何 / 下一步`。

---

## 2026-08-14

### 22:00 — T-023 暂缓：代码签名以后再搞
- 老大决定：**要钱算了，以后再搞**（Azure Trusted Signing 需订阅/按量付费）。
- 处置：TASKS.md T-023 标记 **暂缓（P3）**；方案与开通指南保留
  （`docs/T023-Azure-Trusted-Signing-指南.md`），electron-builder.yml 的
  `azureSignOptions` 占位保持未启用——以后要签随时可启用，不阻塞当前分发
  （未签名安装包可正常使用，仅 SmartScreen 有「未知发布者」提示）。

### 21:55 — T-023 代码签名：方案定为 Azure Trusted Signing
- **背景**：老大选定 **Azure Trusted Signing**（免买证书/硬件令牌，按签名次数计费）。
- **调研确认**：electron-builder 26.15.3 已原生支持（`win.azureSignOptions` →
  `WindowsSignAzureManager` → PowerShell `Invoke-TrustedSigning`，认证走
  Azure.Identity EnvironmentCredential：`AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/
  `AZURE_CLIENT_SECRET`）。
- **落地**：
  - `app/electron-builder.yml` `win:` 下写好 `azureSignOptions` 注释模板
    （endpoint/certificateProfileName/codeSigningAccountName/publisherName），
    保持未启用（避免未开通时报错）；
  - 新增 `docs/T023-Azure-Trusted-Signing-指南.md`：完整开通步骤（注册资源
    提供程序 → 建账户 → 组织/个人验证 → 证书配置文件 → Entra ID 应用授权 →
    本机 Invoke-TrustedSigning 验证 → 构建接入 → SmartScreen 信誉说明 → FAQ）；
  - TASKS.md T-023 更新为"方案已定，待开通"。
- **验证**：electron-builder.yml 语法解析正常（azureSignOptions 保持未启用）。
- **下一步**：老大按指南在 Azure 门户开通（约 30–60 分钟，身份验证需审核），
  填值启用后跑 `npm run installer` 验证 `Get-AuthenticodeSignature` = Valid。

### 21:45 — v0.4.2 收尾：版本号修正 + 清理 v0.3.0 残留
- **版本号修正**：`package.json` 0.4.0 → **0.4.2**（与任务清单 v0.4.2 对齐），
  重建绿色目录版与安装包；删除过时的 `DSH-Desktop-Setup-0.4.0.exe`。
- **清理 v0.3.0 残留**（26 终审通过后）：
  - 删除 `app/dist/installer/DSH-Desktop-Setup-0.3.0.exe`（120.7 MB）与 `.blockmap`；
  - 删除 `builder-debug.yml`（electron-builder 构建临时产物）；
  - 文档当前状态引用同步：MILESTONES M2.4/M2.5 标记 ✅ 已完成、M3 交付物与
    验收标准更新为 0.4.2 安装包；开发日志 v0.4.2 条目产物名更新；
    历史记录（v0.3.0 日志/里程碑/任务）按档案保留。
- **最终产物**：`app/dist/installer/DSH-Desktop-Setup-0.4.2.exe`（120.7 MB）+
  `app/dist/DSH-Desktop-win32-x64/DSH-Desktop.exe`（215.1 MB）。
- **下一步**：老大分发 0.4.2 安装包；T-023 代码签名仍待办。

### 21:30 — v0.4.2 实施：日志时间 + 启动界面优化（任务C/D/E，T-029）
- **依据**：`代码审查/修复任务清单-v0.4.2-日志与启动界面-20260814.md`
  （26 审查 v4.0：任务C 日志时间 P0、任务D 启动界面 P1、任务E 视觉细节可选）。
- **任务C 日志本地时间（P0）**：
  - 根因：`appendLog`/`logPath` 用 `new Date().toISOString()`（UTC），比北京时间晚 8 小时，
    深夜日志文件名还会归到前一天；
  - 修复：新增 `localTimestamp()`（yyyy-MM-dd HH:mm:ss）与 `localDate()`（yyyy-MM-dd），
    两处替换；开发模式实测日志时间与系统时间一致（21:17:42）。
- **任务D 启动界面优化**：
  - **D1 版本信息**：preload 新增 `getDshVersion()`（IPC `dsh:installed-dsh-version`），
    loading 页底部新增版本行 `DSH-Desktop v0.4.2 · DSH 0.1.0-rc.6`；
  - **D2 下载进度**：main.js 新增 `dirSizeMB()` 目录体积统计，npm install 期间每 2 秒
    轮询 `dshRuntimeDir()` 并经 IPC `dsh:progress` 推送；loading 阶段②旁显示
    "已下载 xx.x MB…"，离开安装阶段自动清空；preload 新增 `onProgress()`。
- **任务E 视觉细节（全部落地）**：
  - 日志区默认折叠为"查看详细日志 ▾"，点击展开/收起，收到含 `[error]` 行自动展开；
  - ④就绪与已完成阶段显示 ✓（CSS ::before + 过渡）；
  - logo 入场动画（fade-in + scale）；
  - 首次启动文案：`getDshVersion()==null`（DSH 未安装）时 subtitle 显示
    "首次启动需要下载 DSH 运行时（约几十 MB），请耐心等待"。
- **验证**：main.js/preload/loading.js 语法通过；localTimestamp/localDate 与系统时间
  一致、dirSizeMB 精确统计与不存在目录兜底 0.0 均验证通过；开发模式启动（独立
  userData/3099 端口）确认日志本地时间生效、loading 页正常加载；未做完整安装流程
  验证（避免与正在运行的 DSH 实例冲突）。
- **产物**：`app/dist/DSH-Desktop-win32-x64/DSH-Desktop.exe` 与
  `app/dist/installer/DSH-Desktop-Setup-0.4.2.exe` 重建中。
- **下一步**：老大实机回归（日志时间、首次启动进度、版本行、日志折叠、就绪✓），
  通过后通知 26 终审。

### 21:07 — v0.4.0 实施：菜单优化 + DSH 版本检查（任务A/B，T-028）
- **依据**：`代码审查/修复任务清单-v0.4-菜单与版本检查-20260814.md`（26 新需求：
  菜单优化 + DSH 官方版本检查）。
- **任务A 菜单优化（main.js buildMenu）**：
  - 【文件】重新加载界面 CmdOrCtrl+R、打开日志目录（自帮助移入）、
    **打开数据目录**（新增，`shell.openPath(app.getPath('userData'))`）、退出；
  - 【视图】实际大小/放大/缩小、全屏、**开发者工具 F12**（自文件移入，仅此一处，
    删除原 role:reload/toggleDevTools 重复项）；
  - 【帮助】**检查 DSH 更新**（新增）、关于 DSH-Desktop（升级）、
    **DeepSeek 官网 / DSH 项目主页**（新增，`shell.openExternal`）。
- **任务B DSH 版本检查**：
  - `fetchLatestDshVersion()`：https 查询 npm registry `dist-tags.latest`
    （scoped 包 `/`→`%2f` 编码，8s 超时，失败静默返回 null）；
  - `compareSemver()`：完整 semver 2.0 子集比较，支持 `-rc.x` 预发布
    （数字段数值比较 rc.10>rc.9、字母段字典序、段多者大、正式版>预发布、
    非 semver 如 latest 返回 0 不误报）；14 个用例全部通过；
  - `updateDshVersion()`：先备份 `config.json.bak` 再改写 dshVersion；
  - `checkDshUpdate()`：帮助菜单点击 → 当前 vs 最新 → 有新版【立即升级】
    （改写配置 + `app.relaunch()` 重启自动安装），10 秒防抖防连点；
  - 启动后**静默检查一次**：有新版仅记日志 + 菜单项加"（有新版本）"后缀；
  - 关于对话框：追加"DSH 最新"行 + 【检查更新】按钮（B5 增强）。
- **验证**：main.js 语法通过；compareSemver 14 用例全绿；真实请求
  npmmirror 与 npmjs 均返回 `@deepseek-ai/dsh` latest=0.1.0-rc.6；
  updateDshVersion 备份/改写/失败兜底隔离测试通过。
- **产物**：`app/dist/DSH-Desktop-win32-x64/DSH-Desktop.exe` 重建完成（v0.4.0）。
- **下一步**：老大实机回归（菜单无重复、日志/数据目录打开、官网/主页跳转、
  检查更新各分支、断网兜底、升级重启链路）；通过后制作 0.4.0 安装包并通知 26 终审。

### 21:50 — 按复审报告 v2.0 修复（H4 致命项 + L5/L6 低危项）
- **依据**：`代码审查/审查报告-v2.0-复审-20260814.md`（26 复审：7 项修复全部落实，新发现 H4）。
- **H4（必须修复）：loading 页内联脚本被 CSP 拦截**——
  - 根因：CSP `default-src 'self'` 未声明 `script-src`，内联 `<script>` 回退到
    `'self'` 而**被禁止执行** → 阶段指示器/日志/端口全部不工作，启动过程依然不可见；
  - 修复：内联脚本提取为外部文件 `renderer/loading.js`（CSP 对 file:// 本地脚本
    显式放行），CSP 改为
    `default-src 'self' file: data:; style-src 'unsafe-inline'; script-src 'self' file:; img-src 'self' file: data:`。
- **L5**：启动失败错误条 HTML 转义顺序修正（先 `&`→`&amp;` 再其余）。
- **L6**：阶段①默认高亮 + 主进程维护 `currentStage`，页面就绪后 `getStage()` 主动
  查询（避免阶段消息早于监听注册到达而错过）。
- **产物**：重建 `app/dist/installer/DSH-Desktop-Setup-0.3.0.exe`。
- **下一步**：老大按 v2.0 回归清单 1~7 实机验证。

### 21:30 — 按代码审查报告修复（v0.3.1，审查清单 6 项）
- **依据**：`代码审查/修复任务清单-20260814.md`（26 技术总监审查报告 v1.0）。
- **P0-任务1（H1）logo 不显示**：`loading.html` CSP 增加 `img-src 'self' file: data:`，
  logo 改为**内联 base64**（免疫 file:// 协议下 `'self'` 无法匹配本地资源的问题）。
- **P0-任务2（H2）主窗口尺寸/加载空白**：
  - loading 窗口（1280×820）与主窗口（1440×900）**彻底分离**：服务就绪后关闭
    loading 窗口，新建主窗口承载 GUI（原代码复用 loading 窗口导致设计尺寸从未生效）；
  - 主窗口 GUI 加载期间注入"正在加载界面…"覆盖层，`did-finish-load` 后移除。
- **P0-任务3（H3）选择工作区崩溃（重点）**：
  - 根因：DSH 原生模块（koffi COM 等）按 **Node ABI** 编译，打包模式用
    `ELECTRON_RUN_AS_NODE`（Electron-as-Node）运行 DSH 时 **ABI 不兼容**，
    目录选择 worker 崩溃；sharp/node-pty 同隐患；
  - 修复：**内置真实 Node 运行时**——新增 `scripts/fetch-node.js`（npmmirror
    下载 Node 24.19.0 win-x64 → 解压精简到 `resources/node/node.exe`，约 74MB）；
    `resolveRunner()` 打包模式**优先使用内置 Node**，Electron-as-Node 降为兜底；
    `--expose-internals` 仅在兜底路径追加；installer/pack 前置自动获取 Node。
- **P1-任务4（M1）子进程残留**：全局 `trackedChildren` 登记 npm install 与 dsh
  服务子进程，退出/失败路径统一 `killTrackedChildren` 清理（SIGTERM → SIGKILL 宽限）。
- **P1-任务5 启动阶段进度 UI**：loading 页新增 4 阶段指示器
  （①检查运行时 ②下载/安装 ③启动服务 ④就绪），主进程 `pushStage()` 经 IPC
  `dsh:stage` 推送；preload 新增 `onStage` 订阅。
- **P2-M2**：GUI 渲染进程 `render-process-gone` / `unresponsive` 弹窗提示并提供
  重载入口；**P2-M3**：`appendLog` 仅向 loading 窗口广播（避免对 GUI 无效 IPC）。
- **验证**：内置 Node v24.19.0 运行内置 npm 12.0.2 正常；JS 全量语法检查通过；
  安装包重建中。
- **下一步**：老大实机回归（首次启动全流程 / 二次启动 / 选择工作区 / 无残留进程）。

### 21:00 — 修复首次运行 npm 安装失败（EALLOWSCRIPTS，v0.3.0 套壳）
- **现象**：老大在其它电脑实机运行新壳，报"DSH 运行时安装失败（npm 退出码 1）"。
- **根因**（本机隔离复现）：main.js 使用 `--allow-scripts <pkg>` **CLI 参数**，
  但 npm 12 在 **project-scoped 安装**（带 `--prefix` 的项目安装）中**明确禁止**
  该参数，直接报 `EALLOWSCRIPTS` 退出码 1（错误信息明确要求改用
  package.json 的 `allowScripts` 字段或 `.npmrc` 设置）。
- **修复**：
  - 移除 `--allow-scripts` CLI 参数；
  - 改为在运行时目录（`dshenv`）**预置 `.npmrc`**：`allow-scripts=...` +
    `registry=https://registry.npmmirror.com`（国内镜像，防网络受限）；
  - `config.json` 新增可选 `registry` 字段（默认 npmmirror，可覆盖）；
  - 隔离环境复测：`.npmrc` 方案 → `added 527 packages`，exit 0，`dsh --version` 正常。
- **产物**：重建 `app/dist/installer/DSH-Desktop-Setup-0.3.0.exe`（98.4 MB）。
- **下一步**：老大用新包重新实机验收。

### 20:30 — 架构重构：纯套壳 v0.3.0（DSH 不内置，壳自带 npm 按版本拉取，T-026）
- **决策**（老大定调）：不做"内置 DSH 源码"，只做套壳——壳自带 Node+npm 环境，
  运行时用 `npm install @deepseek-ai/dsh@<版本>` 拉取 DSH（与官方
  `npx @deepseek-ai/dsh web` 同机制）。原因：官方已预告有破坏性更新；内置源码
  会让每次 DSH 更新都重打包壳；而 npx 方式更新 DSH 只改版本号，壳不受影响。
- **改造**：
  - `package.json`：dependencies 由 `@deepseek-ai/dsh` 改为 `npm`（纯 JS 11.8 MB，
    供 npx 使用）；版本升至 0.3.0；
  - 新增 `app/config.json`：`{ dshPackage: "@deepseek-ai/dsh", dshVersion: "0.1.0-rc.6" }`
    —— 升级 DSH 只改这里，重启壳即生效；
  - `main.js` 重写 DSH 运行时管理：`ensureDshRuntime()` 检查
    `%APPDATA%\DSH-Desktop\dshenv` 版本是否匹配，缺失/不符则用内置 npm 执行
    `install --prefix dshenv --allow-scripts <pkg>@<ver>`（放行 node-pty/koffi/
    dsh-subprocess-local 等生命周期脚本，保险起见；均自带 N-API 预编译）；
    之后照旧 `--expose-internals <bin> web --host --port` 启动；
  - 移除 overlay（directory-picker-browse）与 heal-node-modules 钩子（DSH 不再内置，
    不再需要补齐 peer 依赖；目录选择器回归 DSH 官方 npx 同机制）。
- **验证**（全部隔离环境，未启动 GUI、未影响现有实例）：
  - Electron-as-Node（打包 exe）直接跑内置 npm → `npm --version` = 12.0.2；
  - 内置 npm `install --prefix <隔离目录> @deepseek-ai/dsh@0.1.0-rc.6`
    → added 528 packages（首次联网）；`dsh --version` → 0.1.0-rc.6；
  - koffi/node-pty 预编译随包分发，不受 npm 12 阻止 install-scripts 影响；
  - 静默安装新包到隔离目录 → 文件齐全（npm/config/main）；安装包 141 MB → **98 MB**。
- **下一步**：老大用新包实机验收首次运行（联网下载 DSH → GUI）；后续可按需做
  自动更新（T-013）与代码签名（T-023）。

### 19:20 — 修复安装版「无法选择工作区域」（directory picker worker 失败）
- **现象**：安装版运行正常，但选择工作区域时报
  `directory picker failed: win32 folder dialog worker exited before reporting a result`。
- **根因**（代码 + 探针双重定位）：
  - DSH 的 `directory-picker-auto` 在 **win32 + 127.0.0.1** 时选择 **native** 后端
    （`dsh-host-directory-picker-native`），它会 `spawn` 一个 worker 子进程
    （`worker.cjs`，koffi 调 Win32 COM 弹 IFileOpenDialog），通过 IPC 汇报结果；
  - 实测（打包版 RUN_AS_NODE 下探针）：`process.send` 可用、koffi/user32/ole32
    绑定正常、`DSH_DIALOG_TITLE` 正常——但 worker 发出 `showing` 后即退出，
    `done` 永远收不到（`post` 回调里主动 `disconnect()` → `process.on('disconnect')`
    → `exit(0)`，在 Electron-as-Node 与 plain Node 下行为一致）；
  - 结论：该 rc 版 native worker 的「先 showing 后 done」协议在子进程环境中不稳定，
    且 Electron-as-Node 下更易触发——不属于封装可修的范畴。
- **修复**：按 DSH 官方注释推荐（"Mount -native or -browse directly in an overlay
  to pin the interaction"），用 `--patch` overlay **固定 browse 后端**：
  - 新增 `app/overlays/directory-picker-browse.yml`：禁用 `directory-picker`(auto)，
    insert `dsh-host-directory-picker-browse` + `dsh-client-ui-directory-picker-browse`；
  - `main.js` 启动 dsh 时追加 `--patch <overlay>`（`pickerOverlayArgs()`，文件随应用分发）；
  - browse 后端纯 Node stdlib（目录列表 + 新建目录），**不 spawn 任何进程**，
    任何环境都可用；已用 `dsh --dump-config --patch` 验证 overlay 生效
    （auto 行 disabled、browse 双面插入）。
- **产物**：重建 `app/dist/installer/DSH-Desktop-Setup-0.2.0.exe`（141.8 MB），
  overlay 已打进安装内容。
- **下一步**：老大重新安装验收——选择工作区域应弹出应用内目录浏览界面。

### 18:40 — 新增安装功能：NSIS 安装器（T-011/T-022，M3 第一步）
- **需求**：在一台没有 DSH 的新电脑上，运行 EXE 安装文件即可自带安装 DSH 并使用
  DSH-Desktop（无需预装 Node/DSH，应用自包含完整 DSH 与 Electron 运行时）。
- **实现**：
  - 新增 `electron-builder.yml`（NSIS 向导式、per-user 安装到
    `%LOCALAPPDATA%\Programs\DSH-Desktop`，无需管理员；自动创建桌面/开始菜单
    快捷方式与卸载入口；asar 关闭，与绿色目录版同约束）。
  - 新增 `scripts/installer.js`（`npm run installer`），自动配置 npmmirror 镜像
    与工作区缓存（`.builder-cache`、复用 `.electron-cache`），产物
    `app/dist/installer/DSH-Desktop-Setup-0.2.0.exe`。
  - 新增 `scripts/heal-node-modules.js`（electron-builder `afterPack` 钩子）：
    electron-builder 的 node-module 收集器只跟随 dependencies/optionalDependencies，
    会漏掉 DSH 依赖树中的 **peer 依赖**（实测漏 19 个 @deepseek-ai 运行时包 + 嵌套
    依赖共 183 项，如 `cordis-plugin-group`、`dsh-invariants` 等，导致安装版
    `ERR_MODULE_NOT_FOUND`）；钩子在打包后把源 node_modules 的**生产闭包**
    （deps + optional + peer）补齐到 `resources/app/node_modules`，与绿色目录版一致。
  - package.json 新增 devDependency `electron-builder@^26.15.3` 与 `installer` 脚本。
- **验证**（本机静默安装到隔离目录）：
  - 安装程序 exit 0；`DSH-Desktop.exe`、DSH 运行时、`Uninstall DSH-Desktop.exe` 就位；
  - 注册表卸载项（DisplayName=DSH-Desktop, v0.2.0）与桌面快捷方式创建成功；
  - 安装版 `node_modules` 与绿色目录版 diff 无缺失（heal 钩子生效）；
  - 启动安装版（隔离 userData/DSH_HOME/端口）：DSH 入口走 app-local node_modules、
    运行器为 Electron 自带 Node、`--expose-internals` 生效，日志链完整。
- **排障记录**：
  1. npm 首次安装 electron-builder 时 `spawn EPERM`（沙箱拦截生命周期脚本 spawn），
     改用 `--ignore-scripts` + `npm ci --ignore-scripts` 重建完整依赖树后恢复；
  2. electron-builder 需以管道 stdio 运行 npm 子进程收集依赖，沙箱下需完整权限；
  3. `afterPack` 钩子中 `context.packager.info.appDir` 才是应用源目录（v26 API）。
- **下一步**：老大在干净电脑/隔离环境验收；T-023 代码签名消除 SmartScreen 提示。

### 15:30 — v0.2.0 最终验收与瞬时故障说明
- **最终验收**（`app/dist/DSH-Desktop-win32-x64/DSH-Desktop.exe`）：启动 →
  `DSH 服务就绪：3081` → `[loading] 加载完成：http://127.0.0.1:3081/` → 关窗 →
  `应用已退出 code=0`，全部进程退出、端口释放；userData 迁移到
  `%APPDATA%\DSH-Desktop`；harness 3080 服务不受影响（共享链接已愈合回 npx 缓存）。
- **排障记录**：第二次打包后首启曾报
  `Cannot find package ...cordis\index.js`（瞬时失败）。定位结论：打包 overwrite 重建
  dist 目录时，`$DSH_HOME/profiles/node_modules` 共享符号链接仍指向旧目录，
  与新链接愈合存在竞态；随后直接 boot 复测 HTTP 200 正常，应用复跑亦通过。
  影响面：仅打包后首次启动偶发，重试即可；根因已记录，后续可在打包流程末尾增加
  "愈合共享链接"步骤（见 TASKS.md 待办）。

### 15:10 — 品牌改造与目录重组（v0.2.0，T-019/T-020）
- **图标**：从官方包提取 DeepSeek 鲸鱼 logo（`@deepseek-ai/dsh-web-frontend/dist/favicon.svg`），
  合成品牌图标（鲸鱼白 + DeepSeek 蓝渐变圆角底，`app/assets/icon-source.svg`）；
  新增 `scripts/render-icon.js` 用 Electron 离屏渲染栅格化为 `icon.png`（512）与
  `icon.ico`（256，经 nativeImage.resize 缩放，避免二次开窗挂起）。
- **命名**：`productName` 与打包名改为 `DSH-Desktop`（`DSH-Desktop.exe`）；主进程
  `APP_NAME`、加载页标题同步；版本升至 0.2.0。
- **目录重组**：所有开发文件移入 `app/`（main/preload/renderer/scripts/assets/package.json/
  node_modules/dist/缓存）；开发日志移入 `docs/dev-log/DEVELOPMENT_LOG.md`；
  根目录仅保留 README、.gitignore、docs/。README 与项目文档路径同步更新。

### 14:45 — 收尾
- 清理临时测试文件；`rebuild` 脚本正式更名 `preflight`（保留别名），`pack:all` 移除
  （`npm run pack` 为唯一正式打包命令）。
- 最终产物：`dist/DSH Desktop-win32-x64/DSH Desktop.exe`（约 596 MB，prune 后）。
- 无遗留进程；harness 自身 3080 服务不受影响。
- **项目状态**：M1（可运行桌面壳）、M2（打包分发）全部达成；M3（安装器/自动更新/
  体积优化）进入 backlog。

### 14:40 — 正式打包命令 `npm run pack` 定稿与 ASAR 排障（M2 最终验收）
- **`@electron/packager` 替换**：electron-packager 已弃用；安装 `@electron/packager`（v20，ESM
  导出，需动态 import）。
- **ASAR 陷阱**：v20 默认启用 ASAR，导致打包版启动失败
  `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-client-ui-tool' imported from
  C:\Users\xwj\.dsh\profiles\web\`。
- **根因**：DSH 的 `healProfilesModuleFallback` 会把共享目录
  `$DSH_HOME/profiles/node_modules/<包>` 符号链接指向**最近一次运行**的 dsh 安装位置；
  ASAR 布局下链接指向 `resources/app.asar/...`，Node ESM loader 无法穿越 asar 解析包。
- **修复**：打包关闭 ASAR（`asar: false`，平铺目录布局，与已验证布局一致）；
  并重新运行 harness 自身 dsh（`--profile web --dump-config`）把共享链接愈合回 npx 缓存安装。
- **最终打包版验收**：GUI 加载完成（3081）→ 窗口关闭 → 「正在关闭 DSH 服务」→「应用已退出
  code=0」，全部进程退出、端口释放；harness 3080 服务不受影响。
- **产物**：`dist/DSH Desktop-win32-x64/DSH Desktop.exe`（约 938 MB，含 Electron 运行时 +
  DSH 依赖树）。

### 14:30 — 打包版完整验收通过（M2 达成）
- **验证结果**（打包版 `dist/DSH Desktop-win32-x64/DSH Desktop.exe`）：
  - 启动：DSH 入口用包内副本、运行器为「Electron 自带 Node（打包模式）」、`--expose-internals` 生效
  - 端口顺延：3080 被 harness 占用时自动使用 3081 ✓
  - GUI 加载：加载页 → 服务就绪 → `[loading] 加载完成：http://127.0.0.1:3081/` ✓
  - 窗口：Win32 枚举确认主窗口 `DeepSeek Harness`（可见）✓
  - 优雅退出：WM_CLOSE → 「正在关闭 DSH 服务」→「应用已退出 code=0」，全部进程退出、端口释放 ✓
- 产物约 938 MB（Electron 运行时 + DSH 依赖树，已列入优化项 T-014）。

### 14:20 — 解决打包模式原生模块问题：无需 rebuild
- **问题**：`@electron/rebuild` 重建 node-pty 失败（本机无 Python/VS Build Tools，node-gyp 无法编译）。
- **调研**：node-pty 1.1.0 自带 `prebuilds/win32-x64/` N-API 预编译产物，koffi/sharp 同为 N-API ——
  **跨 Node/Electron ABI 兼容，根本不需要重建**。
- **新问题**：electron-as-node 启动 dsh 时 HMR 报 `--expose-internals is required`——
  `node-addon-require-builtin` 原生插件在 Electron 下取不到内部 loader。
- **解决**：electron-as-node 模式给 dsh 加 `--expose-internals` 参数（走纯 JS require 路径），
  system node 模式行为不变。验证：electron-as-node + `--expose-internals` 启动 dsh → HTTP 200 ✓。
- **重构**：`scripts/rebuild-native.js` 由「重建」改为「ABI 预检」（4 个原生模块全部 ✓）；
  `scripts/pack.js` 封装 @electron/packager（自动 npmmirror 镜像 + 工作区缓存，一条 `npm run pack`）。

### 14:10 — npm 安装首次失败：系统 npm 缓存 EPERM
- **现象**：`npm install` 在 `C:\Users\xwj\AppData\Local\npm-cache\_cacache\tmp\...` 报
  `EPERM: operation not permitted, open ...`，随后被拒绝（退出码 1）。
- **分析**：缓存临时文件写入被拒，疑似沙箱文件策略或与并发 npx 进程（DSH 自身运行在
  npx 缓存中）冲突。
- **处置**：改用工作区内置缓存 `npm install --cache D:\00xm\x-app\dsh-Desktop\.npm-cache`，
  规避系统级缓存写入。`.gitignore` 已排除 `.npm-cache/`。
- **后续**：Electron postinstall 下载二进制同样被系统缓存目录拦截 → 设
  `electron_config_cache=D:\00xm\x-app\dsh-Desktop\.electron-cache`（install.js 只认小写变量）
  并配合 `ELECTRON_MIRROR=npmmirror` 解决。

### 14:00 — 开发模式完整链路验证通过（M1 达成）
- 启动 `electron . --port 3099`（Start-Process 脱离 job 生命周期，规避 PowerShell 不等待
  GUI 程序的问题）。
- **验证结果**：加载页 → `DSH 服务就绪：http://127.0.0.1:3099` → `[loading] 加载完成：
  http://127.0.0.1:3099/`；HTTP 200；Win32 窗口枚举确认 `WINDOW: 27288 | 你好 — DeepSeek Harness`。
- **优雅退出**：WM_CLOSE → 「正在关闭 DSH 服务」→「应用已退出 code=0」，端口释放 ✓
- **排障记录**：
  1. 最初 `& electron.exe` 启动后 job 立即"完成"——GUI 子系统程序不挂控制台，PowerShell 不等待；
  2. 首轮 userData 目录创建被沙箱拦截导致启动即崩溃 → `logPath()` 增加多级回退
     （userData → 应用目录 → 系统临时目录）；
  3. 增加 `did-start-loading / did-finish-load / did-fail-load / render-process-gone /
     uncaughtException` 诊断日志，并统一挂到加载窗口与主窗口（attachWebDiagnostics）。

### 13:55 — 搭建 Electron 项目骨架（T-003/T-004）
- 创建 `package.json`（`@deepseek-ai/dsh` 为运行时依赖，`electron` / `electron-packager` /
  `@electron/rebuild` 为开发依赖）。
- 创建 `main.js`：DSH 入口定位（本地 → npx 缓存 → PATH）、子进程拉起 `dsh web`、
  端口自动顺延（3080 起）、HTTP 就绪探测、加载页 → GUI 跳转、退出时 kill 子进程。
- 创建 `preload.js`（contextBridge 最小暴露）与 `renderer/loading.html`（启动加载页，
  实时显示服务日志）。
- 创建 `scripts/make-icon.js`：纯 Node（zlib）生成 256x256 PNG 并封装为 ICO。
- 图标生成成功：`assets/icon.png` + `assets/icon.ico`（2441 字节）。

### 13:40 — 调研 DSH 启动机制（T-001/T-002）
- **发现**：`dsh` CLI 位于 `@deepseek-ai/dsh/lib/bin.js`，`dsh web` 等价于
  `--profile web`，启动 `$DSH_HOME/profiles/web`（本机 `C:\Users\xwj\.dsh\profiles\web`）。
- **默认端口 3080**：来源为 `dsh-web-app/cordis.patch.yml` 第 120 行
  `port: !!js ctx.webStartup.port ?? 3080`；`--port` 可覆盖。
- **技术选型**：环境无 Rust 工具链（rustc 缺失）→ 排除 Tauri；Electron + npm 可行。
- **运行器策略**：开发用系统 Node（ABI 匹配 node_modules），打包用
  `ELECTRON_RUN_AS_NODE=1` + 打包前 `@electron/rebuild`。

### 13:30 — 项目初始化
- 确认工作目录 `D:\00xm\x-app\dsh-Desktop` 为空目录。
- 环境探测：Node v24.19.0 / npm 10.9.7 可用；pnpm、git、rustc 不可用。
- 确定所有开发文件置于当前目录；创建文档结构（PROJECT / TASKS / MILESTONES / ADR）。
