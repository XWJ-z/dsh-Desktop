# ADR-0002：DSH 分发方式 — 纯套壳 + npm 按版本拉取

- 状态：**已接受**（2026-08-14）
- 关联任务：T-026

## 背景

DSH-Desktop 需要把 DSH Web GUI 带给没有 Node/npx 环境的普通电脑。此前方案是
把 `@deepseek-ai/dsh` 及完整依赖树**内置进安装包**（自包含、离线可用）。但存在
明显短板：DSH 发布新版本时，必须重新打包整个安装包（含数百 MB 依赖树）重新分发；
且官方已预告未来会有**破坏性更新**，内置源码会让壳与 DSH 强耦合。

## 约束

- 目标电脑通常**没有 Node/npx 环境**（这正是要做桌面套壳的原因）
- DSH 官方一键使用方式即 `npx @deepseek-ai/dsh web`
- Electron 自带完整 Node 运行时（`ELECTRON_RUN_AS_NODE` 模式已验证可用）
- npm 本身是纯 JS 包（约 12 MB），可以随壳分发

## 决策

**纯套壳**：壳（Electron + 内置 npm 包）只提供运行环境与窗口；DSH 不内置，
由壳在运行时按 `config.json` 指定的版本，用内置 npm 执行
`npm install --prefix %APPDATA%\DSH-Desktop\dshenv @deepseek-ai/dsh@<版本>`
安装到用户数据目录，然后照常启动 `dsh web`。升级 DSH 只需改版本号，壳不受影响。

| 方案 | 结论 | 理由 |
| --- | --- | --- |
| 内置 DSH 源码 | ❌ 否决 | 更新需重打包；官方有破坏性更新预告，壳与 DSH 强耦合；安装包 141 MB+ |
| 纯套壳 + npm 拉取 | ✅ 采纳 | 与官方 `npx` 同机制；更新 DSH 只改 `config.json`；安装包降至约 98 MB；壳与 DSH 版本解耦 |
| 壳内依赖系统 Node | ❌ 否决 | 目标电脑通常没有 Node/npx 环境 |

## 后果

- **正面**：
  1. 更新 DSH 不重打包壳（改 `config.json` 版本号即可）；
  2. 安装包更小（不含 DSH 依赖树）；
  3. 与官方 npx 用法一致，行为可预期；
  4. 官方破坏性更新时，壳只需跟随调整启动参数，无需跟进 DSH 内部实现。
- **负面/风险**：
  1. **首次运行需联网**（下载 DSH 依赖树，数百 MB）；无网环境需预装后拷贝 `dshenv`；
  2. 首次启动有下载等待（加载页实时显示 npm 日志缓解）；
  3. npm 12 默认阻止生命周期脚本，需 `--allow-scripts` 放行 node-pty/koffi 等
     （均自带 N-API 预编译，放行仅为保险）。
- **缓解**：首次下载走 npmmirror 可提速；后续启动离线复用 `dshenv`；版本号固定
  在 `config.json`，不会因官方破坏性更新自动踩坑。
