# 🐮 DSH-Desktop · 飞牛 OS（fnOS）应用

> **DeepSeek Harness Web GUI（DSH）的飞牛 OS 原生应用**，一键安装，开箱即用。
> 版本命名规则见[根目录 README](../README.md#版本命名规则)。

## 简介

把 **DeepSeek Harness Web GUI（DSH）** 以飞牛 OS 原生应用的形式跑在 NAS 上：
安装 `.fpk` 应用包后，在应用中心点开即用——网关把 Web 界面映射到飞牛的应用入口（`/app/dsh`），
DSH 运行时（`@deepseek-ai/dsh`）由应用首次启动时自动安装到数据目录（`var/dshenv`），
与 Windows 版「纯套壳、按版本拉取 DSH」同机制。

## ✨ 特性

- 📦 **原生应用包**：`dsh-0.2.5.fpk`（fnpack 打包，应用名 `dsh` / DeepSeek Harness）
- 🖥️ **平台要求**：飞牛 OS（fnOS）v1.1.3100+，全平台
- ⚙️ **运行依赖**：`nodejs_v22`（安装时自动关联）
- 🚀 **桌面入口**：`dsh.main`，支持停止应用（ctl_stop）
- 🏷️ **应用信息**：开发者 zx(xwj) · 发布者 zx(xwj) · 来源 thirdparty
- 🌐 **网关代理**：`/app/dsh` → `127.0.0.1:3080`（HTTP + WebSocket 转发，含 `/about`、`/api/health`）
- 📦 **运行时自管理**：首次启动 `npm install @deepseek-ai/dsh` 到数据目录（幂等，缺失/版本不符自动补装）
- 💬 **联系我们**：应用内 `/about` 页（QQ 群 916607090 + 二维码）
- 🔗 **Win-飞牛联动**：版本号/配置/更新检查的共享协议见《[Win-飞牛联动协议草案](../Dev-log/win-dev-log/docs/decisions/0003-win-fnos-protocol.md)》（跨端联动立项时复用）

## 📥 安装方式

1. 下载 [dsh-0.2.5.fpk](https://github.com/XWJ-z/dsh-Desktop/releases/download/v0.5.9/dsh-0.2.5.fpk)（依赖 `nodejs_v22`，安装时自动关联）；
2. 在飞牛 OS **应用中心 → 手动安装**，选择该 `.fpk`；
3. 安装后在桌面/应用中心打开 `dsh` 应用即进入 DeepSeek Harness 界面。

## 📁 目录结构

```
fnos/                        # 飞牛 OS 应用（仅开发文件；文档归 Dev-log）
├── README.md                # 本文件
└── dsh-fnos/                # 飞牛应用开发包
    ├── dsh/                 # 应用源码（打包进 fpk，唯一进包目录）
    │   ├── manifest         # 应用元数据（display_name / 依赖 / 网关版本）
    │   ├── config/          # 特权与资源配置（专用用户 dsh、数据目录 data-share）
    │   ├── app/             # 网关入口 / 服务端（server.js + dsh-manager.js）/ about 页
    │   └── etc/             # 启动脚本 / 环境（dsh.main / ctl_stop）
    ├── tools/               # 开发工具（不进包）：fnpack.exe / verify.js / ws-stress.js …
    ├── assets/              # 开发资源（二维码源图等）
    └── release/             # 发布产物（dsh-0.2.5.fpk + archive/ 历史归档）
```

> 飞牛开发文档（代码审查 / 开发包使用说明）统一归集在 **`../Dev-log/fnos-dev-log/`**（不发布到 GitHub）。

## 🛠️ 开发与打包

打包、真机测试、上架说明见 **`../Dev-log/fnos-dev-log/dsh-fnos-README.md`**（449 行完整开发包说明）：

```bash
# 打包（在 dsh-fnos 目录，用官方 fnpack 对齐 manifest + checksum）
fnos/dsh-fnos/tools/fnpack.exe build <dsh目录> -o release/dsh-<版本>.fpk

# 集成回归（路由/页面/API/WS/apiUrl 断言）
node fnos/dsh-fnos/tools/verify.js
```

## 📚 相关文档

- 开发包使用说明：`../Dev-log/fnos-dev-log/dsh-fnos-README.md`
- 飞牛审查记录：`../Dev-log/fnos-dev-log/代码审查/`
- Win-飞牛联动协议：`../Dev-log/win-dev-log/docs/decisions/0003-win-fnos-protocol.md`
- 版本命名规则：见[根目录 README](../README.md#版本命名规则)
