# 项目说明（PROJECT.md）

## 1. 背景

DeepSeek Harness（DSH）是 DeepSeek 的智能体开发工具。当前它以 **Web GUI** 形式运行：
`dsh web` 启动一个本地 HTTP 服务（默认 `http://127.0.0.1:3080`），用户在浏览器中完成
与智能体的全部交互。官方一键使用方式是 `npx @deepseek-ai/dsh web`。

Web 形态的痛点：

- 需要手动打开终端、输入命令、再开浏览器（且目标电脑通常**没有 Node/npx 环境**）
- 与其它浏览器标签混在一起，容易被误关
- 缺少桌面应用应有的原生体验（独立窗口、图标、日志落盘）

本项目的目标：**做一个纯套壳的 Windows 桌面应用 DSH-Desktop**——壳自带
Node+npm 环境并承载 DSH Web GUI；DSH 本体不内置，由壳按配置的版本用 npm 拉取，
与官方 `npx @deepseek-ai/dsh web` 同机制。这样 DSH 更新只需改版本号，壳不受影响
（官方已预告未来有破坏性更新）。

## 2. 目标（验收标准）

- [x] 桌面应用能自动启动 `dsh web` 服务并在原生窗口中加载完整 GUI
- [x] 关闭窗口即停止服务，不留后台进程
- [x] 端口被占用时自动顺延，不与现有 DSH 实例冲突
- [x] 软件名称统一为 **DSH-Desktop**（productName / 窗口 / 可执行文件名 / 菜单）
- [x] 应用图标使用 **DeepSeek 官方鲸鱼标识**（源自 dsh-web-frontend 官方 favicon）
- [x] 目录结构：开发文件独立放在 `app/`，开发日志独立放在 `docs/dev-log/`
- [x] 具备项目管理结构（任务看板、里程碑、决策记录）
- [x] 具备开发日志文档（`docs/dev-log/DEVELOPMENT_LOG.md`，持续追加）
- [x] 打包出可直接分发的 Windows 可执行程序（绿色目录版）
- [x] 制作 NSIS 安装器：新电脑无需预装 DSH/Node/npm，双击 Setup EXE 一键安装（T-011）
- [x] **纯套壳架构**：DSH 不内置，壳自带 npm 环境按版本拉取（T-026）

## 3. 技术选型

| 决策点 | 选择 | 理由 |
| --- | --- | --- |
| 桌面框架 | **Electron** | 环境无 Rust 工具链，Tauri 不可行；Electron 纯 Node/npm 生态，与 DSH 全 JS 技术栈一致 |
| DSH 运行方式 | 子进程 `dsh web` | 复用官方 CLI 与 profile 机制（`$DSH_HOME/profiles/web`），不侵入 DSH 内部实现 |
| DSH 来源 | **npm 按版本安装到用户目录**（`config.json` 指定） | 与官方 `npx` 同机制；更新 DSH 只改版本号，壳不解耦受影响；不内置源码（官方有破坏性更新预告） |
| npm/npx 环境 | **壳内置 npm 包**（纯 JS，随壳分发） | 目标电脑无需预装 Node/npm；Electron 自带 Node 充当运行时 |
| Node 运行时（开发） | 系统 Node | 原生模块 ABI 与 node_modules 一致，开箱即用 |
| Node 运行时（打包） | **内置真实 Node**（`resources/node/node.exe`，fetch-node.js 获取） | DSH 原生模块（koffi/node-pty/sharp）按 Node ABI 编译，须用真实 Node 运行；Electron-as-Node 仅兜底 |
| 打包工具（绿色目录） | `@electron/packager` | 轻量、直接产出可执行目录；`@electron/rebuild` 解决原生模块 ABI |
| 打包工具（安装器） | `electron-builder`（NSIS） | 产出 Setup EXE；向导式安装 + 快捷方式 + 卸载入口；v26 纯 JS 实现 |
| 端口策略 | 默认 3080，占用自动顺延 | 与官方默认一致，且不干扰已运行的 DSH |

## 4. 架构

见 `README.md` 的「运行原理」图。关键组件（均在 `app/` 下）：

- **main.js**：Electron 主进程。读取 `config.json` → 检查/安装 DSH 运行时
  （内置 npm `install --prefix %APPDATA%\DSH-Desktop\dshenv`）→ 服务子进程
  生命周期 → 窗口管理、日志、菜单。
- **config.json**：壳配置——DSH 包名 + 版本号 + registry。升级 DSH 只改这里。
- **preload.js**：contextBridge 最小暴露（版本、端口、阶段、日志订阅），渲染进程无 Node 权限。
- **renderer/loading.html**：启动加载页（DeepSeek 品牌图标内联 base64），阶段指示器
  （①检查 ②下载 ③启动 ④就绪）+ 实时日志，服务就绪后主进程切换到主窗口。
- **scripts/render-icon.js**：用 Electron 离屏渲染把品牌 SVG 栅格化为 icon.png / icon.ico。
- **scripts/rebuild-native.js**：原生模块 ABI 预检（N-API 预编译通常全部通过，无需重建）。
- **scripts/fetch-node.js**：下载/精简内置 Node 运行时到 `resources/node/node.exe`（幂等）。
- **scripts/pack.js**：`@electron/packager` 打包（asar 关闭，含内置 Node）。
- **scripts/installer.js**：`electron-builder` NSIS 安装器构建（镜像/缓存自动配置，前置 fetch-node）。
- **electron-builder.yml**：安装器配置（NSIS、asar 关闭、快捷方式、卸载入口、extraResources 内置 Node）。

## 5. 关键技术细节

### 5.1 DSH 运行时管理（npx 机制）

- 壳配置 `app/config.json`：`{ "dshPackage": "@deepseek-ai/dsh", "dshVersion": "0.1.0-rc.6", "registry": "https://registry.npmmirror.com" }`
- 运行时目录：`%APPDATA%\DSH-Desktop\dshenv`（用户数据目录，用户可写）
- 启动检查：`dshenv/node_modules/@deepseek-ai/dsh` 的版本是否等于 `dshVersion`；
  缺失或版本不符时用内置 npm 执行：
  ```
  npm install --prefix <dshenv> --no-save --no-audit --no-fund \
       @deepseek-ai/dsh@<版本>
  ```
- npm 12 默认阻止生命周期脚本；在 `dshenv/.npmrc` 预置 `allow-scripts` 放行
  node-pty/koffi/dsh-subprocess-local 等（project-scoped 安装不允许 `--allow-scripts`
  CLI 参数，必须走 `.npmrc`/package.json）；同时写入 `registry`（默认 npmmirror）
- 首次运行需联网下载 DSH 依赖树；安装完成后离线可用
- 升级：改 `config.json` 的 `dshVersion` 重启即可（壳无需重打包）

### 5.2 服务启动命令

```
node <dshenv>/node_modules/@deepseek-ai/dsh/lib/bin.js web --host 127.0.0.1 --port <port>
```

- 默认端口 3080 来自 `dsh-web-app/cordis.patch.yml`：`port: !!js ctx.webStartup.port ?? 3080`
- 环境变量 `DSH_HOME` 继承自系统（默认 `%USERPROFILE%\.dsh`），复用已初始化的 web profile
- 默认设置 `DSH_TELEMETRY_DISABLED=1`（可被用户环境变量覆盖）

### 5.3 原生模块 ABI

DSH 依赖树中的原生模块（node-pty 1.1.0、koffi、sharp）均附带 **N-API 预编译产物**，
在系统 Node 与 Electron（ELECTRON_RUN_AS_NODE）下可直接加载，**无需重建**。
npm 12 默认阻止生命周期脚本，壳通过 `--allow-scripts` 放行上述包（仅保险，预编译已随包分发）。
`scripts/rebuild-native.js` 现为 ABI 预检脚本。

### 5.4 内置真实 Node 运行时（审查 H3）

- 背景：DSH 原生模块（koffi COM 绑定、node-pty、sharp 等）按 **Node ABI** 编译；
  `ELECTRON_RUN_AS_NODE`（Electron-as-Node）下 ABI 不兼容，导致目录选择 worker
  崩溃（`win32 folder dialog worker exited before reporting a result`）。
- 方案：`scripts/fetch-node.js` 从 npmmirror 下载 Node 24.19.0 win-x64 并精简到
  `resources/node/node.exe`（约 74 MB）；electron-builder 以 `extraResources`
  放到安装包 `resources/node/`；`resolveRunner()` 打包模式**优先内置 Node**，
  Electron-as-Node 仅作兜底（此时才追加 `--expose-internals`）。

### 5.5 必须关闭 ASAR

壳与 DSH 运行时均为平铺 node_modules 布局；DSH 的 `healProfilesModuleFallback` 会把
`$DSH_HOME/profiles/node_modules/<包>` 符号链接指向运行时 node_modules；若打进
`app.asar`，Node ESM loader 无法穿越 asar 解析包（`ERR_MODULE_NOT_FOUND`）。
打包必须 `asar: false`（scripts/pack.js 已内置）。

### 5.6 安装包更小

DSH 不内置后，安装包由 141 MB 降至约 98 MB（Electron + npm 包 + 壳代码）；
DSH 依赖树（数百 MB）改由运行时按需安装到用户目录。

## 6. 已知限制 / 待办

- 安装程序未做代码签名（SmartScreen 可能提示"未知发布者"，需用户确认运行；正式分发需购买证书，T-023）
- **首次运行需联网**（下载 DSH 依赖树，数百 MB）；无网环境需预先在其它机器安装后拷贝 `dshenv`
- 目录选择器使用 DSH 默认行为（官方 npx 同机制；若在打包环境遇到原生对话框
  worker 问题，可参照 T-025 的 overlay 方案规避，本项目当前未做此覆盖）
- 新机器上若 `$DSH_HOME/profiles/web` 未初始化，首次运行需引导（T-015）
- 打包版依赖共享 profile（`$DSH_HOME/profiles`），与系统 DSH 实例共用会话/配置
- 安装版与绿色目录版共用同一 profile 目录，若两者同时运行会因单实例锁互斥（同一 userData）

## 7. 相关文档

- 任务管理：`docs/TASKS.md`
- 里程碑：`docs/MILESTONES.md`
- 开发日志：`docs/dev-log/DEVELOPMENT_LOG.md`
- 架构决策：`docs/decisions/`
