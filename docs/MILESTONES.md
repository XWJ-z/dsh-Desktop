# 里程碑（MILESTONES.md）

| 里程碑 | 目标 | 计划时间 | 状态 | 交付物 |
| --- | --- | --- | --- | --- |
| M1 可运行桌面壳 | 桌面应用能自动启动 DSH 并加载 Web GUI | 2026-08-14 | ✅ 已完成 | Electron 壳 + 项目管理文档 |
| M2 打包分发 | 产出 win32-x64 可执行程序，原生模块 ABI 正确 | 2026-08-14 | ✅ 已完成 | `app/dist/DSH-Desktop-win32-x64/` |
| M2.1 品牌与结构（v0.2.0） | DeepSeek 官方图标 + 名称 DSH-Desktop；开发文件入 `app/`、开发日志入 `docs/dev-log/` | 2026-08-14 | ✅ 已完成 | 品牌图标（svg/png/ico）+ 重组目录 |
| M2.2 **纯套壳（v0.3.0）** | DSH 不内置，壳自带 npm 按版本拉取（官方 npx 同机制） | 2026-08-14 | ✅ 已完成 | 安装包 98 MB；`config.json` 版本可配置 |
| M2.3 **审查修复（v0.3.0）** | 按 26 审查报告修复 H1/H2/H3/M1/M2/M3（含内置真实 Node） | 2026-08-14 | ✅ 已完成 | 安装包 120.7 MB（含 Node 74MB）；窗口/日志/进程管理完善 |
| M2.4 **菜单与版本检查（v0.4.0）** | 菜单去重/分组/补入口 + DSH 官方版本检查（查询 npm 源、一键升级、启动静默检查、关于集成） | 2026-08-14 | ✅ 已完成 | 26 终审通过；安装包 120.7 MB |
| M2.5 **日志与启动界面（v0.4.2）** | 日志本地时间修复 + loading 版本行/下载进度/视觉细节 | 2026-08-14 | ✅ 已完成 | 26 终审通过；安装包 120.7 MB |
| M3 体验打磨（第一步：安装器） | NSIS 安装程序，新电脑无需 DSH/Node/npm 一键安装 | 2026-08-14 | 🔄 进行中 | `app/dist/installer/DSH-Desktop-Setup-0.4.2.exe`（T-011/T-026~T-029 完成，T-023 签名待办） |

## M1 验收标准（全部达成 ✅）

- [x] 所有开发文件位于 `D:\00xm\x-app\dsh-Desktop`
- [x] 具备项目管理结构（TASKS / MILESTONES / ADR）
- [x] 具备开发日志文档（DEVELOPMENT_LOG.md）
- [x] `npm start` 后出现桌面窗口并加载 DSH Web GUI
- [x] 关闭窗口后 DSH 子进程随之退出

## M2 验收标准（全部达成 ✅）

- [x] `npm run pack` 产出 `dist/DSH Desktop-win32-x64/DSH Desktop.exe`
- [x] 双击 exe 可启动 DSH 并加载 GUI（electron-as-node + --expose-internals，无需系统 Node）
- [x] 日志正常落盘，异常退出有提示
- [x] 端口被占用时自动顺延，不影响已运行的 DSH 实例

## M2.2（纯套壳 v0.3.0）验收标准

- [x] 壳内不再内置 DSH（`node_modules/@deepseek-ai/dsh` 不存在）
- [x] 壳内含 npm 包（`node_modules/npm`，供 npx 使用）
- [x] `config.json` 可配置 DSH 包名/版本；改版本号即升级 DSH，壳无需重打包
- [x] 首次运行自动 npm 安装 DSH 到 `%APPDATA%\DSH-Desktop\dshenv`（隔离环境验证 528 包 + `dsh --version` 正常）
- [x] 安装包由 141 MB 降至 98 MB

## M3（安装器）验收标准

- [x] `npm run installer` 产出 `dist/installer/DSH-Desktop-Setup-0.4.2.exe`
- [x] 向导式安装：默认 `%LOCALAPPDATA%\Programs\DSH-Desktop`，无需管理员权限，可改目录
- [x] 安装后创建开始菜单/桌面快捷方式与卸载入口（「设置 → 应用」）
- [x] 新电脑无需预装 DSH / Node.js / npm（壳自带 Electron + npm 环境）
- [x] 首次运行联网自动安装 DSH（官方 npx 同机制），之后离线可用
- [ ] 代码签名（T-023）：消除 SmartScreen「未知发布者」提示
