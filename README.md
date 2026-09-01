<!--  
- 快捷键：`Ctrl+Shift+V`（当前文件）或 `Ctrl+K V`（分屏侧边预览）
- 右上角双页图标（预览按钮），或在命令面板 `Ctrl+Shift+P` 输入 `Markdown: Open Preview` / `Markdown Preview Enhanced: Open Preview`

两个扩展的预览区别__：
- `Ctrl+Shift+V` 打开的是 VS Code 内置预览 + 两个扩展的增强（Markdown All in One 提供同步滚动、目录跳转等）
- Markdown Preview Enhanced 有自己独立的预览窗口（更强，支持公式/图表/导出），用命令面板里搜 `Markdown Preview Enhanced` 相关命令打开

-->

<div align="center">

<img src="windows/app/assets/icon.png" width="120" alt="DSH-Desktop 图标"/>

# 🐋 DSH-Desktop

**DeepSeek Harness Web GUI（DSH）** —— Windows 桌面版 & 飞牛 OS 原生应用，一键安装，开箱即用

[![GitHub Release](https://img.shields.io/github/v/release/XWJ-z/dsh-Desktop?style=for-the-badge&label=最新版本)](https://github.com/XWJ-z/dsh-Desktop/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/XWJ-z/dsh-Desktop/total?style=for-the-badge&label=累计下载)](https://github.com/XWJ-z/dsh-Desktop/releases)
[![Platform](https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-Windows%2010%2F11%20%C2%B7%20%E9%A3%9E%E7%89%9B%20OS-4ec5eb?style=for-the-badge)](https://github.com/XWJ-z/dsh-Desktop/releases/latest)

</div>

---

## 🪟 Windows 桌面版

将 **DeepSeek Harness Web GUI（DSH）** 封装成 Windows 桌面应用（**DSH-Desktop**）——**纯套壳**：壳只提供运行环境（自带 Node+npm），启动时自动拉取指定版本的 DSH、拉起 `dsh web` 服务，在独立原生窗口中承载完整 GUI。

- 🖥️ 双击运行开箱即用，无需预装 DSH / Node.js / npm
- 🐋 鲸鱼桌面宠物互动（v0.8.11+）、内置提示词库一键注入（v0.8.3+）
- 🧠 **全局记忆（v1.0.1+）**：宠物/工具箱菜单「🧠 全局记忆」图形化编辑 DSH 长期记忆（`~/.dsh/AGENTS.md`，DSH 自动读取无需手动发送）——用户设定 / 我的设定（含默认角色下拉）/ DSH 角色 / 其他记忆区块自动识别；角色文件独立存储（`~/.dsh/roles/`），**双击 DSH 输入框随时切换角色**
- ⬆️ 双侧检查更新（DSH + 壳）：三源并发 + 多镜像下载 + SHA256 校验 + 断点续传
- 💾 数据备份/恢复、一键诊断报告、系统托盘、开机自启、全局快捷键

> 👨‍💻 **开发者注意**：直接下载安装包即可（自带运行环境）。如需从源码运行，
> 需 Node.js ≥ 20.17（`node -v` 确认），否则可能报 `crypto.randomUUID is not a function`
> （v1.1.1 起检测到旧版系统 Node 会自动回落 Electron 内置 Node，不再报错）。

> 📌 **声明**：DSH-Desktop 壳由 **zx 个人团队**开发维护，如使用遇到任何问题，欢迎加入 QQ 群 **916607090** 联系反馈；壳内嵌的 DSH（DeepSeek Harness Web GUI）**完全为 DeepSeek 官方发布**，可通过「检查更新」**单独更新**，并支持自由**配置插件**。

> 💡 **普通用户请直接下载安装包**（下方按钮），无需安装 Node.js。
> 源码仅供开发者研究/二开使用。

<a href="https://github.com/XWJ-z/dsh-Desktop/releases/download/v1.2.8/DSH-Desktop-Setup-1.2.8.exe">
<img src="https://img.shields.io/badge/下载安装包-DSH--Desktop--Setup--1.2.8.exe%20%E7%BA%A6115MB-2ea44f?style=for-the-badge&logo=windows&logoColor=white" alt="下载 DSH-Desktop 安装包"/>
</a>

📖 详细说明（特性 / 打包 / 安装 / 升级 / 目录结构 / 运行原理）→ **[windows/README.md](windows/README.md)**

---

## 🐮 飞牛 OS（fnOS）应用

**DeepSeek Harness Web GUI（DSH）的飞牛 OS 原生应用**——安装 `.fpk` 应用包后在应用中心开箱即用（v0.2.5 已提交应用中心，上架审核中）。

- 📦 原生应用包 `dsh-0.2.5.fpk`，平台要求 fnOS v1.1.3100+，依赖 `nodejs_v22`（自动关联）
- 🌐 网关把 DSH Web 界面映射到应用入口 `/app/dsh`，运行时首次启动自动安装到数据目录

<a href="https://github.com/XWJ-z/dsh-Desktop/releases/download/v0.5.9/dsh-0.2.5.fpk">
<img src="https://img.shields.io/badge/下载飞牛应用包-dsh--0.2.5.fpk%20%E7%BA%A60.3MB-2ea44f?style=for-the-badge&logo=linux&logoColor=white" alt="下载 fnOS 应用包"/>
</a>

📖 详细说明（特性 / 安装 / 目录结构 / 开发打包）→ **[fnos/README.md](fnos/README.md)**

---

## 📐 版本命名规则（vX.Y.Z）


**当前版本线：**

| 版本 | 说明 |
|------|------|
| v0.7.4 | Z=4 紧急更新（修复首次安装下载卡死）|
| v0.7.10 | Z 末尾 0 = v0.7 功能线的最终版本（稳定里程碑）|
| v0.8.30 | v0.8 稳定版|
| v0.9.6 | v0.9功能尝鲜|
| v1.0.1 | v1正式版本,此后按例周更|
| v1.0.2 | 修复版：下载提速 / 全局记忆 4 类别 + 角色文件全文同步 / 窗口更宽 / 默认角色不可删 |
| v1.0.3 | 修复与优化：托盘/关闭询问联动 / 角色竖排选择 / 点击角色编辑（名称≤30字）/ 提示词二级子分类 / 更新回退修复 |
| v1.0.5 | 提示词库扩充至 201 条 / 全局记忆：区块删除生效 + 角色记忆说明 + 自动备份一键恢复 |
| v1.1.3 | 帮助文档远程下发（push 即更新）/ 提示词库独立升级 / 插件市场（官方社区 18 分类）/ 启动行为修正（不再自动弹系统浏览器、公告条回归公告窗口、启动界面帮助文档按钮）/ 自动更新修复（三源改用 Electron net） |
| v1.1.6 | 启动检查更新同时检查 DSH 并弹窗提示 / 首次安装直接装最新版 DSH（dshVersion=latest） / 图片拖放放行给 DSH 原生 / 全窗口 UI 协调优化 / 更新下载改 Electron 网络栈 / 中文乱码修复 / 更新失败手动下载按钮 |
| v1.2.8 | 角色选择优化（多次双击不再连开窗口、角色名超长截断）+ 帮助文档改官网直达（http://dsh.xwjznh.cn，去除内置/远程 help.html）+ 启动拦截（系统浏览器不再自动弹本机 DSH 页） |
| v1.2.7 | 全局记忆编辑体验升级（模板/三级子区块/自动编号）+ 项目记忆三栏重构 + 提示词库检查更新「权威源优先」修复 + 手机访问（trusted-host 信任局域网、crypto.randomUUID 补丁、二维码30s/手动刷新）—— 手机可连电脑同一 DSH |
| v1.2.2 | 记忆管理（全局记忆 + 项目记忆）/ 技能库（扫描/自建/市场）/ 局域网扫码访问 / 任务完成通知 / 备份纳入项目记忆 / 技能目录扫描顺序对齐官方 / 记忆与技能安全加固 |

> 本项目（Windows 版 & 飞牛版）版本号统一遵循 `vX.Y.Z` 三段式规则（Z 从 1 开始，无 0）：

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


---



## 📁 目录结构

```
dsh-Desktop/
├── windows/                    # Windows 桌面版（仅开发文件：app 源码 + tests 测试 + README）
│   ├── app/                    # Electron 应用工程（main.js + modules/ + renderer/ + scripts/ + assets/…）
│   ├── tests/                  # 冒烟测试（smoke.js）
│   └── README.md               # Windows 版详细说明（特性/打包/安装/升级/运行原理）
├── fnos/                       # 飞牛 OS 应用（仅开发文件：dsh-fnos 源码 + README）
│   ├── dsh-fnos/               # 飞牛应用开发包（dsh 源码 / tools 工具 / release 产物）
│   └── README.md               # 飞牛版详细说明（特性/安装/目录结构/开发打包）
├── Dev-log/                    # ⚠️ 开发文档库（内部，不发布到 GitHub，详见下方）
├── version.json                # 壳自动更新清单（GitHub 根目录，jsDelivr 可达）
├── README.md                   # 本文件（两个应用简介 + 版本命名规则 + 署名规范）
├── LICENSE                     # MIT License
├── .editorconfig               # 统一编辑器行为
└── .gitignore                  # 忽略规则（含 /Dev-log/ 不发布）
```

### 📂 Dev-log（开发文档库，不发布）

> 开发/审核/反馈/定位文档统一归集于此，**不随仓库发布到 GitHub**（`.gitignore` 已忽略 `/Dev-log/`）。

```
Dev-log/
├── win-dev-log/                 # Windows 相关开发文档
│   ├── dev-log/                 # 开发日志（按月建文件夹、按天写文件：<YYYY-MM>/<YYYY-MM-DD>.md，倒序）
│   ├── docs/                    # 项目文档（PROJECT / TASKS / MILESTONES / T023 / decisions / archive）
│   └── 代码审查/                 # 审核文档（v0.8.x 清单/方案/审查报告；历史归档在 docs/archive）
├── fnos-dev-log/                # 飞牛（fnOS）相关开发文档
│   ├── 代码审查/                 # fnOS 审核文档（0.2.x 线）
│   └── dsh-fnos-README.md       # 飞牛应用开发包使用说明
├── 优化方案/                     # 项目优化方案（诊断 + 方案）
├── 反馈/                         # 开发反馈与计划
└── 定位/                         # 产品定位（北极星）
```

---

## ✍️ 项目署名规范（zx 统一格式）

> 团队统一署名格式：**`zx(身份标识)`**（2026-08-16 起执行）。凡需要署名的地方——代码注释、文档、release_notes、开发日志、版本信息等——一律使用该格式，**不单独写** `zx`  / `6` 等。

| 成员 | 身份 | 署名 |
|------|---------|------|
| xwj | 项目所有 | `zx(xwj)` |
| znh | 项目测试 | `zx(znh)` |
| tsy | 项目开发 | `zx(tsy)` |
| tyx | 项目开发 | `zx(tyx)` |
| 6 | 开发者 | `zx(6)` |
| 26| 技术总监 | `zx(26)` |
| 29| 外审 | `zx(29)` |
| 9 | 外审 | `zx(9)` |

---

## 🔗 相关链接

- DeepSeek Harness 源码：<https://github.com/deepseek-ai/deepseek-harness>
- DSH npm 包：<https://www.npmjs.com/package/@deepseek-ai/dsh>
- [查看全部版本 →](https://github.com/XWJ-z/dsh-Desktop/releases)
