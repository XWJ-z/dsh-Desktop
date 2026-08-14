# ADR-0001：桌面框架选型 — Electron

- 状态：**已接受**（2026-08-14）
- 关联任务：T-002

## 背景

需要把 DSH Web GUI 封装为 Windows 桌面应用。候选框架：Electron、Tauri、以及
「纯浏览器书签/快捷方式」等非原生方案。

## 约束

- 本机工具链：Node v24 / npm 10 可用；**pnpm、git、rustc 不可用**
- DSH 本体为纯 Node.js 生态（Cordis 插件系统 + React 前端）
- 需要以子进程方式运行官方 `dsh web` CLI（原生模块：node-pty、koffi、sharp 等）

## 决策

采用 **Electron**。

| 方案 | 结论 | 理由 |
| --- | --- | --- |
| Tauri | ❌ 否决 | 需要 Rust 工具链（rustc 缺失），且无法直接复用 Node 子进程生态 |
| Electron | ✅ 采纳 | npm 直接安装；`ELECTRON_RUN_AS_NODE` 可免外部 Node 运行 DSH；生态成熟 |
| 快捷方式方案 | ❌ 否决 | 不算真正的桌面应用，无日志/生命周期管理 |

## 后果

- **正面**：纯 npm 工作流；Electron 自带 Node 运行时，打包后无需用户安装 Node。
- **负面/风险**：
  1. 原生模块 ABI 需要在打包前用 `@electron/rebuild` 重建为 Electron ABI；
  2. 打包体积较大（Electron 运行时 + DSH 依赖树）；
  3. 若本机缺少 VS Build Tools，`node-pty` 等模块可能无法从源码构建
     （优先尝试 prebuild-install 下载 Electron 预编译产物）。
- **缓解**：开发模式始终使用系统 Node（ABI 匹配，零风险）；打包模式失败时保留
  便携模式（应用定位 npx 缓存中的 DSH，用系统 Node 运行）。
