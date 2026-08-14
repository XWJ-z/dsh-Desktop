# DSH-Desktop

将 **DeepSeek Harness Web GUI（DSH）** 封装成 Windows 桌面应用（**DSH-Desktop**）的工程——**纯套壳**：壳只提供运行环境，DSH 本体由 npm 按配置的版本提供。

DSH 本身是运行在浏览器中的 Web 界面（`http://127.0.0.1:3080`）。本工程用 **Electron** 写了一个原生外壳：自带 Node+npm 环境，启动时自动用 `npm install` 拉取指定版本的 `@deepseek-ai/dsh`（等价于官方一键使用 `npx @deepseek-ai/dsh web`），然后拉起 `dsh web` 服务，等待就绪后在独立窗口中承载完整的 GUI，关闭窗口即停止服务。应用图标使用 DeepSeek 官方鲸鱼标识。

## 特性

- 🐋 **DeepSeek 品牌**：官方鲸鱼图标，应用名 DSH-Desktop
- 🖥️ **一键启动**：双击运行，自动拉取并启动 DSH 服务、打开桌面窗口，无需手动开终端
- 🔌 **自动探测端口**：默认 `127.0.0.1:3080`，被占用时自动顺延
- 📦 **纯套壳，DSH 不内置**：壳自带 Node+npm 环境，DSH 由 `npm install @deepseek-ai/dsh@<版本>` 安装到用户数据目录（与官方 `npx` 同机制）；目标电脑无需预装 Node/npm
- 🔄 **更新 DSH 不重打包壳**：改 `app/config.json` 里的 `dshVersion` 即可切换 DSH 版本，壳代码不受 DSH 版本影响（官方破坏性更新也能从容应对）
- ⬆️ **检查 DSH 更新**：帮助菜单「检查 DSH 更新」查询 npm 源最新版并一键升级（备份 config.json 后改写版本号、重启自动安装），启动后静默检查、有新版时菜单提示
- 📂 **常用目录直达**：文件菜单可一键打开日志目录 / 数据目录；帮助菜单直达 DeepSeek 官网与 DSH 项目主页
- 📜 **内置日志**：DSH 服务日志落盘到用户数据目录（本地时间戳，按当天日期分文件），可实时在加载页查看
- 🚀 **启动界面友好**：loading 页显示启动阶段与下载进度（MB 增长）、壳/DSH 版本号；日志区可折叠、出错自动展开；logo 入场动画
- 🔒 **安全默认**：仅允许访问本地 DSH 服务，外部链接走系统浏览器；默认关闭遥测

## 快速开始

```bash
# 进入应用工程目录
cd app

# 安装依赖（electron + npm 包 + 打包工具）
npm install

# 开发模式启动（使用系统 Node 运行 npm/DSH，ABI 匹配）
npm start

# 自定义端口
npm start -- --port 4000
```

> 开发模式下若本机有 Node，壳直接用系统 Node 跑 npm；无 Node 时退化为
> Electron 自带 Node（与打包模式一致）。

## 打包为可执行程序

```bash
cd app

# 一条命令打包 win32-x64（自动走 npmmirror 镜像 + 工作区缓存，无需手动配置）
npm run pack

# 产物位于 app/dist/DSH-Desktop-win32-x64/DSH-Desktop.exe，双击即可运行
```

> 说明：打包使用 `@electron/packager`，**关闭 ASAR**；壳内含 Electron + npm 包，
> 不含 DSH（DSH 运行时按需安装到用户目录）。

## 制作安装程序（新电脑一键安装）

```bash
cd app

# 生成 NSIS 安装程序（electron-builder，工具集自动下载到工作区缓存）
npm run installer

# 产物位于 app/dist/installer/DSH-Desktop-Setup-<version>.exe
```

把 **DSH-Desktop-Setup-0.4.2.exe** 拷贝到目标电脑，双击运行即可：

- 目标电脑**无需预装 DSH / Node.js / npm**（壳自带完整 Electron + npm 环境）
- 默认安装到 `%LOCALAPPDATA%\Programs\DSH-Desktop`（**无需管理员权限**），
  向导中可更改安装目录
- 自动创建**开始菜单 / 桌面快捷方式**与**卸载入口**（「设置 → 应用」可卸载）
- **首次运行需联网**：壳自动用内置 npm 安装 `@deepseek-ai/dsh@0.1.0-rc.6` 到
  `%APPDATA%\DSH-Desktop\dshenv`（下载约数百 MB 依赖，之后离线可用）
- 首次运行自动初始化 DSH profile（`$DSH_HOME`），开箱即用

## 升级 DSH（不重打包壳）

安装目录下的 `resources/app/config.json`：

```json
{
  "dshVersion": "0.1.0-rc.6",
  "dshPackage": "@deepseek-ai/dsh",
  "registry": "https://registry.npmmirror.com"
}
```

- 改 `dshVersion` 为期望版本（或 `latest`），重启 DSH-Desktop 即拉取新版本；
- `registry` 为 npm 源（默认 npmmirror 镜像，国内可达；可改回官方源）；
- 壳代码、安装包都不需要重新构建——DSH 与壳完全解耦；
- 官方破坏性更新时，先在本机验证新版本可用，再更新版本号即可。

### 菜单内检查更新（v0.4+）

帮助菜单提供 **「检查 DSH 更新」**：自动查询 npm 源上的最新版，与当前 DSH 版本对比：

- 有新版 → 弹窗显示 `当前 → 最新`，点【立即升级】自动备份并改写
  `config.json` 的 `dshVersion`，随后重启应用自动安装新版（无需手动改文件）；
- 无新版 → 提示「已是最新版本」；断网 → 友好提示，不影响使用；
- 应用启动后会**静默检查一次**，发现新版时菜单项显示「检查 DSH 更新（有新版本）」；
- 关于对话框（帮助 → 关于 DSH-Desktop）同步显示 DSH 最新版本，并提供「检查更新」按钮。

## 目录结构

```
dsh-Desktop/
├── app/                        # 应用开发文件（独立 Electron 工程）
│   ├── package.json            # 工程清单（productName: DSH-Desktop；dependencies 含 npm）
│   ├── config.json             # 壳配置：DSH 包名 + 版本号 + registry（升级 DSH 只改这里）
│   ├── main.js                 # Electron 主进程：内置 Node 拉取 DSH、拉起服务、开窗口
│   ├── preload.js              # 预加载脚本（contextBridge 最小暴露）
│   ├── electron-builder.yml    # 安装程序配置（NSIS，asar 关闭，extraResources 内置 Node）
│   ├── renderer/loading.html   # 启动加载页（内联 logo + 阶段指示器 + 实时日志）
│   ├── resources/node/         # 内置 Node 运行时（fetch-node.js 下载，node.exe）
│   ├── scripts/
│   │   ├── render-icon.js      # DeepSeek 品牌图标栅格化（SVG → png/ico）
│   │   ├── make-icon.js        # 占位图标生成（无品牌素材时的回退）
│   │   ├── fetch-node.js       # 下载/精简内置 Node 运行时（幂等）
│   │   ├── pack.js             # 绿色目录打包脚本（@electron/packager，asar 关闭）
│   │   ├── installer.js        # 安装程序构建脚本（electron-builder NSIS）
│   │   └── rebuild-native.js   # 原生模块 ABI 预检（通常全部通过，无需重建）
│   └── assets/                 # 品牌图标（icon-source.svg / icon.png / icon.ico）
├── docs/                       # 文档
│   ├── PROJECT.md              # 项目说明（背景 / 架构 / 技术决策）
│   ├── TASKS.md                # 任务管理看板
│   ├── MILESTONES.md           # 里程碑
│   ├── dev-log/                # 开发日志
│   │   └── DEVELOPMENT_LOG.md  # 开发日志（持续追加）
│   └── decisions/              # 架构决策记录（ADR）
├── README.md
└── .gitignore
```

## 运行原理

```
┌──────────────────────────────────────────────┐
│  DSH-Desktop (Electron 壳)                   │
│                                              │
│  main.js                                     │
│   ├─ 读取 config.json（DSH 包名/版本）       │
│   ├─ 检查 %APPDATA%\DSH-Desktop\dshenv       │
│   │    └─ 缺失/版本不符 → 内置 npm 安装       │
│   │       npm install --prefix dshenv        │
│   │         @deepseek-ai/dsh@<版本>          │
│   ├─ spawn: 内置 Node (resources/node)       │
│   │        <dshenv>/dsh/lib/bin.js web       │
│   │        --host 127.0.0.1 --port 3080      │
│   ├─ 等待 HTTP 就绪                          │
│   ├─ 关闭 loading 窗口 → 新建主窗口加载 GUI   │
│   └─ 退出时统一 kill 所有子进程               │
└──────────────────────────────────────────────┘
```

> 内置 Node（`resources/node/node.exe`）是**真实 Node 运行时**——DSH 的原生模块
> （koffi/node-pty/sharp）按 Node ABI 编译，必须用真实 Node 运行（Electron-as-Node
> 仅兜底），目录选择器/图片处理/终端等功能才能正常工作。

- **开发模式**：用系统 Node 运行 npm/DSH（原生模块与 node_modules ABI 一致）
- **打包模式**：优先内置 Node（真实 Node，ABI 完全匹配）；Electron-as-Node 兜底
- **DSH 运行时**：始终安装在用户数据目录（`%APPDATA%\DSH-Desktop\dshenv`），
  首次联网下载，之后离线可用；改 `config.json` 版本号即升级

- **开发模式**：用系统 Node 跑内置 npm 与 DSH（原生模块与 node_modules ABI 一致）
- **打包模式**：`ELECTRON_RUN_AS_NODE=1` 让 Electron 自身充当 Node 运行时，并追加
  `--expose-internals`（DSH HMR 需要）；原生模块均为 N-API 预编译，无需 rebuild
- **DSH 运行时**：始终安装在用户数据目录（`%APPDATA%\DSH-Desktop\dshenv`），
  首次联网下载，之后离线可用；改 `config.json` 版本号即升级

## 环境要求

- Windows 10/11 x64
- 首次运行需联网（下载 DSH 依赖）；此后离线可用
- Node.js ≥ 20（仅开发/打包需要；**运行期无需任何外部环境**——壳内置 Node 运行时）

## 相关链接

- DeepSeek Harness 源码：<https://github.com/deepseek-ai/deepseek-harness>
- DSH npm 包：<https://www.npmjs.com/package/@deepseek-ai/dsh>
