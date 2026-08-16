<div align="center">

<img src="windows/app/assets/icon.png" width="120" alt="DSH-Desktop 图标"/>

# 🐋 DSH-Desktop

**DeepSeek Harness Web GUI（DSH）** —— Windows 桌面版 & 飞牛 OS 原生应用，一键安装，开箱即用

[![GitHub Release](https://img.shields.io/github/v/release/XWJ-z/dsh-Desktop?style=for-the-badge&label=最新版本)](https://github.com/XWJ-z/dsh-Desktop/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/XWJ-z/dsh-Desktop/total?style=for-the-badge&label=累计下载)](https://github.com/XWJ-z/dsh-Desktop/releases)
[![Platform](https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-Windows%2010%2F11%20%C2%B7%20%E9%A3%9E%E7%89%9B%20OS-4ec5eb?style=for-the-badge)](https://github.com/XWJ-z/dsh-Desktop/releases/latest)

---

### 🪟 Windows 桌面版

<a href="https://github.com/XWJ-z/dsh-Desktop/releases/download/v0.7.10/DSH-Desktop-Setup-0.7.10.exe">
<img src="https://img.shields.io/badge/下载安装包-DSH--Desktop--Setup--0.7.10.exe%20%E7%BA%A6114MB-2ea44f?style=for-the-badge&logo=windows&logoColor=white" alt="下载 DSH-Desktop 安装包"/>
</a>

双击运行即可安装 · 无需预装 DSH / Node.js / npm · 首次运行联网自动拉取 DSH 依赖

[查看全部版本 →](https://github.com/XWJ-z/dsh-Desktop/releases)

---

### 🐮 飞牛 OS（fnOS）应用包 v0.2.5

<a href="https://github.com/XWJ-z/dsh-Desktop/releases/download/v0.5.9/dsh-0.2.5.fpk">
<img src="https://img.shields.io/badge/下载飞牛应用包-dsh--0.2.5.fpk%20%E7%BA%A60.3MB-2ea44f?style=for-the-badge&logo=linux&logoColor=white" alt="下载 fnOS 应用包"/>
</a>

飞牛 OS 手动安装该 `.fpk` 应用包（依赖 `nodejs_v22`）

</div>

## 🪟 Windows 桌面版

将 **DeepSeek Harness Web GUI（DSH）** 封装成 Windows 桌面应用（**DSH-Desktop**）的工程——**纯套壳**：壳只提供运行环境，DSH 本体由 npm 按配置的版本提供。

DSH 本身是运行在浏览器中的 Web 界面（`http://127.0.0.1:3080`）。本工程用 **Electron** 写了一个原生外壳：自带 Node+npm 环境，启动时自动用 `npm install` 拉取指定版本的 `@deepseek-ai/dsh`（等价于官方一键使用 `npx @deepseek-ai/dsh web`），然后拉起 `dsh web` 服务，等待就绪后在独立窗口中承载完整的 GUI，关闭窗口即停止服务。应用使用 DSH-Desktop 品牌图标。

### Windows 特性

- 🐋 **DeepSeek 品牌**：官方鲸鱼图标，应用名 DSH-Desktop
- 🖥️ **一键启动**：双击运行，自动拉取并启动 DSH 服务、打开桌面窗口，无需手动开终端
- 🔌 **自动探测端口**：默认 `127.0.0.1:3080`，被占用时自动顺延
- 📦 **纯套壳，DSH 不内置**：壳自带 Node+npm 环境，DSH 由 `npm install @deepseek-ai/dsh@<版本>` 安装到用户数据目录（与官方 `npx` 同机制）；目标电脑无需预装 Node/npm
- 🔄 **更新 DSH 不重打包壳**：改 `windows/app/config.json` 里的 `dshVersion` 即可切换 DSH 版本，壳代码不受 DSH 版本影响（官方破坏性更新也能从容应对）
- ⬆️ **检查更新（v0.5.3+）**：「帮助 → 检查更新」现代窗口同屏展示 **DSH**（npm 源最新版，一键升级改 config 重启安装）与 **DSH-Desktop 壳**（GitHub version.json 三源并发检查——jsDelivr/GitHub API/raw.githubusercontent 取最高版本，规避 CDN 缓存旧版漏报；多镜像下载 + SHA256 校验 + **断点续传（v0.7.2+，中断自动续传）**）两侧更新状态，带徽章/更新日志/下载进度条
- 💬 **帮助菜单（v0.5.3+，v0.6.4 起更名）**：检查更新、联系我们（QQ 群二维码大图 + 一键复制群号）、关于（现代窗口：版本/DSH/服务地址）、DeepSeek 官网、DSH 项目主页
- 📂 **常用目录直达**：文件菜单可一键打开日志目录 / 数据目录
- 🌐 **网页打开（v0.5.9+，v0.7.1 起改按钮，v0.7.5 起可拖拽，v0.7.6 位置记忆）**：主窗口**「网页打开」醒目按钮**（品牌蓝色渐变胶囊，默认顶部居中，可拖拽到任意位置避开界面元素；拖拽位置退出时保存、重启恢复；视图菜单可「恢复默认布局」），一键在系统默认浏览器中打开 DSH 网页界面
- 🗔️ **系统托盘（v0.6.0+）**：关闭窗口最小化到托盘，DSH 服务后台继续运行；托盘菜单可打开主界面 / 检查更新 / 开机自启 / 退出（退出前弹确认，避免误退导致服务停止）
- ⚡ **开机自启（v0.6.0+）**：设置菜单 / 托盘菜单勾选后开机自动启动（写入注册表 Run 键，安装版生效）；v0.6.6 起自启为**静默启动**——不弹窗口，后台运行 + 托盘常驻
- 🪟 **窗口状态记忆（v0.6.6+）**：记住主窗口位置/大小/最大化状态，下次启动还原；记忆位置在屏幕外时自动兜底默认尺寸
- 🩺 **一键诊断报告（v0.7.0+）**：帮助菜单「生成诊断报告」一键收集环境信息（版本/DSH/运行器/端口/系统）+ 最近日志 + 配置（敏感字段自动打码），复制到剪贴板并保存本地 —— 学员出问题直接发群里，免来回询问
- 💾 **数据备份（v0.7.0+）**：文件菜单「备份数据…」一键打包 DSH 用户数据（~/.dsh）+ 设置到 tar.gz（仅相对路径、不含可重建的运行时/安装包/日志，体积可控），换机迁移超方便
- 📥 **数据恢复（v0.7.0+）**：文件菜单「恢复数据…」选择备份包，校验格式后还原到本机固定位置；原数据改名 `.bak` 保留不覆盖；版本差异提示 + 一键重启生效；DSH 服务运行时先提示退出再恢复（v0.7.1+）
- ⚙️ **设置菜单（v0.6.1+）**：开机自启 / 最小化到托盘 / 启动时检查更新开关；「关闭时总是询问」可清除关闭行为记忆
- 🔔 **启动检查更新（v0.6.5+）**：启动自动检查新版本，发现新版弹窗询问「立即更新 / 稍后」，可设置菜单关闭（默认开启）
- 🪟 **关闭窗口询问（v0.6.1+）**：点 X 弹窗选择「退出」或「关闭到托盘」，可勾选「记住我的选择」下次直接执行
- 📝 **更新日志展示（v0.6.0+）**：更新窗口桌面端卡片展示最新版本更新日志（多行分行 + 「vX.Y.Z 更新内容」小标题）
- 📜 **内置日志**：DSH 服务日志落盘到用户数据目录（本地时间戳，按当天日期分文件），可实时在加载页查看
- 🚀 **启动界面友好**：loading 页显示启动阶段与下载进度（MB 增长）、壳/DSH 版本号；日志区可折叠、出错自动展开；logo 入场动画
- 🔒 **安全默认**：仅允许访问本地 DSH 服务，外部链接走系统浏览器；默认关闭遥测

## 🐮 飞牛 OS（fnOS）应用

**DeepSeek Harness Web GUI（DSH）的飞牛 OS 原生应用**，一键安装，开箱即用（v0.2.5 已提交应用中心，上架审核中）。

- 📦 **原生应用包**：`dsh-0.2.5.fpk`（fnpack 打包，应用名 `dsh` / DeepSeek Harness）
- 🖥️ **平台要求**：飞牛 OS（fnOS）v1.1.3100+，全平台
- ⚙️ **运行依赖**：`nodejs_v22`（安装时自动关联）
- 🚀 **桌面入口**：`dsh.main`，支持停止应用（ctl_stop）
- 🏷️ **应用信息**：开发者 zx(xwj) · 发布者 zx(xwj) · 来源 thirdparty
- 🔗 **Win-飞牛联动**：版本号/配置/更新检查的共享协议见《[Win-飞牛联动协议草案](windows/docs/decisions/0003-win-fnos-protocol.md)》（跨端联动立项时复用）

**安装方式**：下载 [dsh-0.2.5.fpk](https://github.com/XWJ-z/dsh-Desktop/releases/download/v0.5.9/dsh-0.2.5.fpk) → 在飞牛 OS 应用中心手动安装。

> 开发打包、真机测试、上架说明见 `fnos/dsh-fnos/README.md`（`fnos/` 目录含应用源码、`fnpack.exe` 打包工具、回归验证脚本与 `release/` 发布产物；`fnos/代码审查/` 为内部文档不上传）。

## 快速开始

```bash
# 进入应用工程目录
cd windows/app

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
cd windows/app

# 一条命令打包 win32-x64（自动走 npmmirror 镜像 + 工作区缓存，无需手动配置）
npm run pack

# 产物位于 windows/app/dist/DSH-Desktop-win32-x64/DSH-Desktop.exe，双击即可运行
```

> 说明：打包使用 `@electron/packager`，**关闭 ASAR**；壳内含 Electron + npm 包，
> 不含 DSH（DSH 运行时按需安装到用户目录）。

## 制作安装程序（新电脑一键安装）

```bash
cd windows/app

# 生成 NSIS 安装程序（electron-builder，工具集自动下载到工作区缓存）
npm run installer

# 产物位于 windows/app/dist/installer/DSH-Desktop-Setup-<version>.exe
```

把 **DSH-Desktop-Setup-0.7.10.exe** 拷贝到目标电脑，双击运行即可：

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

### 菜单内检查更新（v0.5.3+）

「帮助」菜单 → **「检查更新」**：现代窗口同屏展示两侧更新状态（卡片 + 徽章 + 进度条）：

- **DSH 卡片**：当前/最新版本 + 更新日志，有新版点【立即升级】自动备份并改写
  `config.json` 的 `dshVersion`，随后重启应用自动安装新版；
- **DSH-Desktop 壳卡片**：当前/最新版本 + 更新内容，点【下载更新】从镜像列表逐个
  尝试下载（进度条实时显示），完成后校验 SHA256 并打开安装包（用户按向导完成升级）；
- 应用启动后**静默检查一次**，有新版时菜单项显示「检查更新（有新版本）」；
- 断网 → 卡片显示"查询失败"，不影响使用。

**发布新版本操作（维护者）：**
1. `windows/app/package.json` 版本号递增 → `npm run installer` 产出新安装包；
2. 上传安装包到 GitHub Releases（附件无大小限制）；
3. 更新仓库根 `version.json`：
   - `version` = 新版本号；`release_notes` = 更新日志；
   - `download_urls` = 镜像加速直链数组（`镜像前缀 + GitHub Releases 原链接`）；
   - `hash` = 安装包 SHA256（`certutil -hashfile 安装包.exe SHA256`）；
   - `force` = 是否强制更新（仅重大安全修复设 true，默认 false）；
4. push 到 GitHub，等 jsDelivr 缓存生效（几分钟）后老用户启动即收到更新提示。

## 目录结构

```
dsh-Desktop/
├── windows/                    # Windows 桌面版（Electron 工程 + 文档 + 审查）
│   ├── app/                    # 应用开发文件（独立 Electron 工程）
│   │   ├── package.json        # 工程清单（productName: DSH-Desktop；dependencies 含 npm）
│   │   ├── config.json         # 壳配置：DSH 包名 + 版本号 + registry + qqGroup（升级 DSH 只改这里）
│   │   ├── main.js             # Electron 主进程：内置 Node 拉取 DSH、拉起服务、开窗口
│   │   ├── preload.js          # 预加载脚本（contextBridge 最小暴露）
│   │   ├── electron-builder.yml# 安装程序配置（NSIS，asar 关闭，extraResources 内置 Node）
│   │   ├── renderer/loading.html # 启动加载页（内联 logo + 阶段指示器 + 实时日志）
│   │   ├── renderer/update.html  # 更新窗口（v0.5.3 现代化：壳+DSH 卡片/徽章/进度条）
│   │   ├── renderer/contact.html # 联系我们窗口（v0.5.3：二维码大图 + 复制群号）
│   │   ├── renderer/about.html   # 关于窗口（v0.5.3：版本信息卡片 + 链接按钮）
│   │   ├── resources/node/     # 内置 Node 运行时（fetch-node.js 下载，node.exe）
│   │   ├── scripts/
│   │   │   ├── render-icon.js  # DeepSeek 品牌图标栅格化（SVG → png/ico）
│   │   │   ├── make-icon.js    # 占位图标生成（无品牌素材时的回退）
│   │   │   ├── fetch-node.js   # 下载/精简内置 Node 运行时（幂等）
│   │   │   ├── pack.js         # 绿色目录打包脚本（@electron/packager，asar 关闭）
│   │   │   ├── installer.js    # 安装程序构建脚本（electron-builder NSIS）
│   │   │   └── rebuild-native.js # 原生模块 ABI 预检（通常全部通过，无需重建）
│   │   └── assets/             # 品牌图标 + QQ 群二维码（icon.png / icon.ico / qq-group.png）
│   ├── tests/                   # 自动化测试（v0.7.10+）
│   │   └── smoke.js            # 最小集成冒烟测试（起壳→就绪→健康→退出→无残留，npm run smoke）
│   ├── docs/                   # 文档
│   │   ├── PROJECT.md          # 项目说明（背景 / 架构 / 技术决策）
│   │   ├── TASKS.md            # 任务管理看板
│   │   ├── MILESTONES.md       # 里程碑
│   │   ├── dev-log/            # 开发日志（按月建文件夹、按天写文件：<YYYY-MM>/<YYYY-MM-DD>.md）
│   │   └── decisions/          # 架构决策记录（ADR）
│   └── 代码审查/               # 审查报告与修复任务清单
├── version.json                # 壳自动更新清单（GitHub 根目录，jsDelivr 可达）
├── fnos/                       # 飞牛 OS（fnOS）应用开发（dsh-fnos：源码 + 工具 + release；代码审查不上传）
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

## 📐 版本命名规则（vX.Y.Z）

> 本项目版本号遵循 `vX.Y.Z` 三段式规则（Z 从 1 开始，无 0）：

| 段位 | 含义 | 说明 |
|------|------|------|
| **X** | 大版本（重大更新/架构级迭代）| **0 为开发版本**；X 加一 = 重大更新、大版本迭代（如 0.x → 1.x）|
| **Y** | 功能集合版本 | 当前大版本下的新增功能集合（每加一个 Y，代表一批新功能）|
| **Z** | 修复迭代版本 | Y 功能版本下的修复/迭代版本 |

**特殊规则：**

1. **Z = 4 → 紧急更新**：表示有重大漏洞或安全问题，跳过常规迭代直接发布修复版。
   - 例：`0.7.2` 发现大漏洞 → 发布 `0.7.4` 修复
   - 例：`0.11.18` 出现漏洞/安全问题 → 发布 `0.11.24` 修复
2. **Z 末尾为 0 → 当前 Y 版本的最终版本**：该功能版本线的最后一个版本，**发布后不再有后续**。
   - 例：`0.7.10`、`0.8.20` 均为最终版本（有了 `0.7.10` 就不会有 `0.7.11` 等）
3. **Z 从 1 开始，没有 0**：
   - ❌ `0.8.0` 不合法 → ✅ 应为 `0.8.1`
   - ❌ `1.0.0` 不合法 → ✅ 应为 `1.0.1`
   - （Z 末尾的 0 仅用于「最终版本」标记，如 0.7.10 / 0.8.20）

**示例（当前版本线）：**

| 版本 | 说明 |
|------|------|
| v0.7.4 | Z=4 紧急更新（修复首次安装下载卡死）|
| v0.7.10 | Z 末尾 0 = v0.7 功能线的最终版本（稳定里程碑）|

## 环境要求

- 🪟 **Windows**：Windows 10/11 x64；首次运行需联网（下载 DSH 依赖）；此后离线可用
- 🐮 **飞牛 OS**：fnOS ≥ 1.1.3100，安装 `dsh-0.2.5.fpk`（自动关联 `nodejs_v22`）
- 开发/打包需 Node.js ≥ 20（**运行期无需任何外部环境**——壳内置 Node 运行时）

## 相关链接

- DeepSeek Harness 源码：<https://github.com/deepseek-ai/deepseek-harness>
- DSH npm 包：<https://www.npmjs.com/package/@deepseek-ai/dsh>
