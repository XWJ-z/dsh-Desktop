# DSH-Desktop e2e 测试（Playwright · T7 严格测试门禁）

> 依据：《v0.9开发任务清单-20260816.md》T7.1（26 编制，老大指令「0.9 严格测试通过才能上架」）
> 状态：首批 6 条用例已编写，**在 Windows 真机运行**（本目录测试不与开发机共享会话数据，勿在本机跑）。

## 运行

```bash
cd windows/app
npm run test:e2e        # = playwright test --config tests/e2e/playwright.config.js
```

## 前置条件（真机）

1. **应用已构建或已安装**：默认启动 `dist/installer/win-unpacked/DSH-Desktop.exe`；
   无打包产物时自动回退开发模式（`electron .`）。可用环境变量覆盖：
   ```bash
   $env:DSH_E2E_EXE = "C:\path\to\DSH-Desktop.exe"
   ```
2. **DSH 已正常使用过**（dshenv 已装、至少有一个会话）——T4/T5 的「注入输入框」需要
   主界面输入框存在（新装未建会话的机器上输入框不渲染）。
3. **⚠ 专用测试机 / 临时测试工作区**：用例 T5 会把测试文件复制进**当前 DSH 工作区**
   （真实用户目录会混入测试文件）。强烈建议：
   - 在专用测试机跑；或
   - 先把 DSH 当前会话切到临时测试工作区（如 `C:\dsh-e2e-tmp`），跑完再切回。
4. 托盘设置：T2 依赖「最小化到托盘」开启（默认开启）；若测试机改为「关闭即退出」，
   请先改回默认再跑。

## 用例清单（6 条）

| # | 用例 | 断言要点 |
|---|------|---------|
| T1 | 启动 | loading → 主窗口出现，URL 为 http://127.0.0.1:port，页面有内容 |
| T2 | 托盘常驻 | 关窗 → 进程存活、无 GUI 窗口 → 二次启动实例 → 主窗口恢复 |
| T3 | 全局快捷键 | SendKeys Ctrl+Alt+D → 窗口隐藏（呼出/隐藏切换） |
| T4 | 提示词库 | 打开面板渲染出内容 → 主窗口注入「e2e 测试提示词」→ 输入框可见 |
| T5 | ★ 拖动文件 | CDP 原生文件拖拽 → 不导航 + 输入框注入「请分析工作区里的文件：…」+ 气泡反馈 |
| T6 | 更新窗口 | 打开 → 显示版本信息（DSH-Desktop / v0.9 / 版本） |

## 说明与已知限制

- **串行执行**（workers:1）：应用单实例锁 + 全局快捷键，并行会互相干扰。
- **T3 全局快捷键**：Playwright 无法注入 OS 级按键，用 PowerShell `SendKeys` 发送
  `Ctrl+Alt+D`；若 SendKeys 被安全软件拦截，断言会失败，需手工验证该项。
- **T5 文件拖拽**：用 CDP `Input.dispatchDragEvent`（带 `files` 列表）模拟 OS 文件拖拽，
  渲染进程会生成真实 File，`webUtils.getPathForFile` 可读到路径——与真实拖拽同链路。
  ✅ **已双重实测验证**（2026-08-17，Electron 43）：
  1. `tests/cdp-drag-sim-check.js`（最小宿主 + 真实 preload/注入/复制逻辑）8/8 通过；
  2. ★ `tests/cdp-v090-sim.js`（**真实打包产物 + 真实 DSH 页面**，团队标准仿真流程：
     `--user-data-dir` 隔离 + `--port` + `--remote-debugging-port`）**7/7 通过**——
     CDP files → 真实 File → getPathForFile → drop:files IPC → 复制落盘 → 气泡反馈，
     页面不导航，drag 诊断确认 `types=[text/plain,text/uri-list,Files]`。
  完整应用的 e2e T5 仍需真机（原因见上）；若未来 Electron 大版本不再支持该 CDP 字段，
  可降级为在页面里直接调 `window.dshDesktop.dropFiles([真实路径])`（仍覆盖复制→注入→气泡链路）。
- **失败定位**：trace 保留在 `test-results/`（retain-on-failure），可 `npx playwright show-trace` 查看。
- **浏览器依赖**：Playwright 测试 Electron 不需要下载 Chromium（用应用自带 Electron）。
  首次安装依赖：`npm i -D @playwright/test`（已完成）。

## 手工回归（T7.2，10 项）

自动化之外的 10 项手工清单见任务清单 T7.2 表，真机逐项执行并记录结果。
