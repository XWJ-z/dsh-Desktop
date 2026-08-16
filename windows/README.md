# 🪟 DSH-Desktop · Windows 桌面版

> DeepSeek Harness Web GUI（DSH）的 **Windows 桌面套壳**——纯套壳：壳只提供运行环境，DSH 本体由 npm 按配置的版本提供。
> 版本命名规则见[根目录 README](../README.md#版本命名规则)。

## 简介

DSH 本身是运行在浏览器中的 Web 界面（`http://127.0.0.1:3080`）。本工程用 **Electron** 写了一个原生外壳：自带 Node+npm 环境，启动时自动用 `npm install` 拉取指定版本的 `@deepseek-ai/dsh`（等价于官方一键使用 `npx @deepseek-ai/dsh web`），然后拉起 `dsh web` 服务，等待就绪后在独立窗口中承载完整的 GUI，关闭窗口即停止服务。应用使用 DSH-Desktop 品牌图标。

## ✨ 特性

- 🐋 **DeepSeek 品牌**：官方鲸鱼图标，应用名 DSH-Desktop
- 🐋 **桌面宠物（v0.8.11+）**：Q 版鲸鱼住在主窗口内（右下角，可拖拽），悬停出菜单（提示词库/网页打开/隐藏）、单击气泡互动、连点 5 次彩蛋、深夜犯困、注入提示词开心跳跃
- 🖥️ **一键启动**：双击运行，自动拉取并启动 DSH 服务、打开桌面窗口，无需手动开终端
- 🔌 **自动探测端口**：默认 `127.0.0.1:3080`，被占用时自动顺延
- 📦 **纯套壳，DSH 不内置**：壳自带 Node+npm 环境，DSH 由 `npm install @deepseek-ai/dsh@<版本>` 安装到用户数据目录（与官方 `npx` 同机制）；目标电脑无需预装 Node/npm
- 🔄 **更新 DSH 不重打包壳**：改 `windows/app/config.json` 里的 `dshVersion` 即可切换 DSH 版本，壳代码不受 DSH 版本影响（官方破坏性更新也能从容应对）
- ⬆️ **检查更新（v0.5.3+）**：「帮助 → 检查更新」现代窗口同屏展示 **DSH**（npm 源最新版，一键升级改 config 重启安装）与 **DSH-Desktop 壳**（GitHub version.json 三源并发检查——jsDelivr/GitHub API/raw.githubusercontent 取最高版本，规避 CDN 缓存旧版漏报；多镜像下载 + SHA256 校验 + **断点续传（v0.7.2+，中断自动续传）**；v0.8.11 起下载互斥——多入口触发不冲突）两侧更新状态，带徽章/更新日志/下载进度条
- 📢 **公告（v0.8.11+）**：帮助菜单「公告」展示项目公告（远程拉取 + 本地已读，有新公告时菜单标「（新）」）
- 💬 **帮助菜单（v0.5.3+，v0.6.4 起更名）**：检查更新、公告、更新日志、联系我们（QQ 群二维码大图 + 一键复制群号）、关于（现代窗口：版本/DSH/服务地址）、DeepSeek 官网、DSH 项目主页
- 📋 **内置提示词库（v0.8.3+，v0.8.7 升级）**：61 条精选提示词（学习/写作/工作/生活/编程 + 🛠️ DSH 任务 15 条），分类浏览 + 搜索 + 复制 + **一键注入 DSH 输入框**（真实键盘输入，发送按钮可点；已有内容时弹覆盖/追加/取消询问，可记住选择）
- 📂 **常用目录直达**：文件菜单可一键打开日志目录 / 数据目录
- 🗔️ **系统托盘（v0.6.0+）**：关闭窗口最小化到托盘，DSH 服务后台继续运行；托盘菜单可打开主界面 / 检查更新 / 开机自启 / 退出（退出前弹确认，避免误退导致服务停止）；**双击快捷方式恢复窗口（v0.8.8+）**
- ⚡ **开机自启（v0.6.0+）**：设置菜单 / 托盘菜单勾选后开机自动启动（写入注册表 Run 键，安装版生效）；v0.6.6 起自启为**静默启动**——不弹窗口，后台运行 + 托盘常驻
- 🪟 **窗口状态记忆（v0.6.6+）**：记住主窗口位置/大小/最大化状态，下次启动还原；记忆位置在屏幕外时自动兜底默认尺寸
- 🩺 **一键诊断报告（v0.7.0+）**：帮助菜单「生成诊断报告」一键收集环境信息（版本/DSH/运行器/端口/系统）+ 最近日志 + 配置（敏感字段自动打码），复制到剪贴板并保存本地 —— 出问题直接发群里，免来回询问
- 💾 **数据备份（v0.7.0+）**：文件菜单「备份数据…」一键打包 DSH 用户数据（~/.dsh）+ 设置到 tar.gz（仅相对路径、不含可重建的运行时/安装包/日志，体积可控），换机迁移超方便
- 📥 **数据恢复（v0.7.0+）**：文件菜单「恢复数据…」选择备份包，校验格式后还原到本机固定位置；原数据改名 `.bak` 保留不覆盖；版本差异提示 + 一键重启生效；DSH 服务运行时先提示退出再恢复（v0.7.1+）
- ⚙️ **设置菜单（v0.6.1+）**：开机自启 / 最小化到托盘 / 启动时检查更新开关 / 快捷键（呼出/隐藏主窗口，默认 Ctrl+Alt+D）/ 提示词注入总是询问 / 显示桌面宠物；「关闭时总是询问」可清除关闭行为记忆
- 🔔 **启动检查更新（v0.6.5+）**：启动自动检查新版本，发现新版弹窗询问「立即更新 / 稍后」，可设置菜单关闭（默认开启）
- 🪟 **关闭窗口询问（v0.6.1+）**：点 X 弹窗选择「退出」或「关闭到托盘」，可勾选「记住我的选择」下次直接执行
- 📝 **更新日志展示（v0.6.0+）**：更新窗口桌面端卡片展示最新版本更新日志（多行分行 + 「vX.Y.Z 更新内容」小标题）；帮助菜单「更新日志」查看应用内全量历史（v0.8.1+）
- 📜 **内置日志**：DSH 服务日志落盘到用户数据目录（本地时间戳，按当天日期分文件），可实时在加载页查看
- 🚀 **启动界面友好**：loading 页显示启动阶段与下载进度（MB 增长）、壳/DSH 版本号 + 北极星口号（v0.8.8+）；日志区可折叠、出错自动展开；logo 入场动画
- 🔒 **安全默认**：仅允许访问本地 DSH 服务，外部链接走系统浏览器；默认关闭遥测

## 🚀 快速开始

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

## 📦 打包为可执行程序

```bash
cd windows/app

# 一条命令打包 win32-x64（自动走 npmmirror 镜像 + 工作区缓存，无需手动配置）
npm run pack

# 产物位于 windows/app/dist/DSH-Desktop-win32-x64/DSH-Desktop.exe，双击即可运行
```

> 说明：打包使用 `@electron/packager`，**关闭 ASAR**；壳内含 Electron + npm 包，
> 不含 DSH（DSH 运行时按需安装到用户目录）。

## 🛠️ 制作安装程序（新电脑一键安装）

```bash
cd windows/app

# 生成 NSIS 安装程序（electron-builder，工具集自动下载到工作区缓存）
npm run installer

# 产物位于 windows/app/dist/installer/DSH-Desktop-Setup-<version>.exe
```

把 **DSH-Desktop-Setup-<版本>.exe** 拷贝到目标电脑，双击运行即可：

- 目标电脑**无需预装 DSH / Node.js / npm**（壳自带完整 Electron + npm 环境）
- 默认安装到 `%LOCALAPPDATA%\Programs\DSH-Desktop`（**无需管理员权限**），
  向导中可更改安装目录
- 自动创建**开始菜单 / 桌面快捷方式**与**卸载入口**（「设置 → 应用」可卸载）
- **首次运行需联网**：壳自动用内置 npm 安装 `@deepseek-ai/dsh@<版本>` 到
  `%APPDATA%\DSH-Desktop\dshenv`（下载依赖后离线可用）
- 首次运行自动初始化 DSH profile（`$DSH_HOME`），开箱即用

## 🔄 升级 DSH（不重打包壳）

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

## ⬆️ 菜单内检查更新（v0.5.3+）

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
3. **★ 验证资产存在**：`curl -sI <下载链接>` 返回 200/302（非 404）——0.8.9 教训：
   资产没上传 → 老用户下载 404 → 更新校验失败；
4. 更新仓库根 `version.json`（可用 `windows/app/scripts/release.js` 一键更新：
   `node scripts/release.js <版本> --hash <SHA256>`）：
   - `version` = 新版本号；`release_notes` = 更新日志；
   - `download_urls` = 镜像加速直链数组（`镜像前缀 + GitHub Releases 原链接`）；
   - `hash` = 安装包 SHA256（`certutil -hashfile 安装包.exe SHA256`）；
   - `force` = 是否强制更新（仅重大安全修复设 true，默认 false）；
5. push 到 GitHub，等 jsDelivr 缓存生效（几分钟）后老用户启动即收到更新提示。

## 📁 目录结构

```
windows/
├── app/                     # 应用开发文件（独立 Electron 工程）
│   ├── package.json         # 工程清单（productName: DSH-Desktop；dependencies 含 npm）
│   ├── config.json          # 壳配置：DSH 包名 + 版本号 + registry + qqGroup（升级 DSH 只改这里）
│   ├── main.js              # Electron 主进程入口（约 660 行：常量/状态 + 模块组装 + 生命周期）
│   ├── modules/             # 主进程模块（v0.8.12 拆分，依赖注入）
│   │   ├── logger.js        # 日志 / 阶段 / 进度
│   │   ├── dsh-runtime.js   # DSH 运行时安装与版本检查
│   │   ├── node-resolver.js # Node 运行时解析（内置/系统/兜底）
│   │   ├── port-manager.js  # 端口探测 / 服务就绪轮询
│   │   ├── serverLifecycle.js # dsh web 服务子进程
│   │   ├── updater.js       # 更新检查 / 下载 / SHA256 / 互斥锁
│   │   ├── pet.js           # 鲸鱼桌面宠物
│   │   ├── menu.js          # 应用菜单
│   │   ├── ipc.js           # IPC handler 集中注册
│   │   └── windows/         # 各窗口模块（main/loading/update/about/misc）
│   ├── preload.js           # 预加载脚本（contextBridge 最小暴露）
│   ├── electron-builder.yml # 安装程序配置（NSIS，asar 关闭，extraResources 内置 Node）
│   ├── renderer/            # 各窗口页面（loading/update/contact/about/changelog/notice/promptlib/progress + shared.css）
│   ├── prompts.json         # 内置提示词库（61 条）
│   ├── CHANGELOG.json       # 应用内更新日志（帮助 → 更新日志）
│   ├── resources/node/      # 内置 Node 运行时（fetch-node.js 下载，node.exe）
│   ├── scripts/             # 图标生成 / Node 拉取 / 打包 / 安装程序 / release.js 发布脚本
│   ├── tests/               # mock-load-test.js（模块组装加载测试）、../tests/smoke.js（集成冒烟）
│   └── assets/              # 品牌图标 + QQ 群二维码（icon.png / icon.ico / qq-group.png / pet-whale.svg）
├── tests/                   # 冒烟测试（smoke.js：起壳→就绪→健康→退出→无残留，npm run smoke）
└── README.md                # 本文件
```

> 项目文档（PROJECT / TASKS / MILESTONES / dev-log / 代码审查 / archive）统一归集在
> **`../Dev-log/win-dev-log/`**（开发文档库，不发布到 GitHub）。

## ⚙️ 运行原理

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

## 🔧 环境要求

- **系统**：Windows 10/11 x64
- **首次运行**：需联网（下载 DSH 依赖）；此后离线可用
- **开发/打包**：Node.js ≥ 20（**运行期无需任何外部环境**——壳内置 Node 运行时）

## 📚 相关文档

> 项目文档统一归集在 **`../Dev-log/win-dev-log/`**（开发文档库，不发布到 GitHub）：

- 项目说明 / 任务 / 里程碑：`../Dev-log/win-dev-log/docs/PROJECT.md` / `TASKS.md` / `MILESTONES.md`
- 架构决策记录：`../Dev-log/win-dev-log/docs/decisions/`
- 开发日志：`../Dev-log/win-dev-log/dev-log/`
- 审查记录 / 任务清单：`../Dev-log/win-dev-log/代码审查/`
- 版本命名规则：见[根目录 README](../README.md#版本命名规则)
