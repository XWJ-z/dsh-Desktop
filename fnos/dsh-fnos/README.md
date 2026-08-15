# DSH 飞牛应用包 · 开发包使用说明（6 快速上手）

> 26 已把**整个应用包写好**，6 只需：打包 → 真机测试 → 上架。
> 包位置：`fnos/dsh-fnos/dsh/`（完整结构，可直接 fnpack build）

---

## 〇、项目结构（2026-08-15 规范化）

```
fnos/
├── 代码审查/                # 26 的审查报告 / 方案 / 任务清单（文档）
└── dsh-fnos/
    ├── README.md            # 本说明
    ├── dsh/                 # 应用源码（打包进 fpk，唯一进包目录）
    ├── tools/               # 开发工具（不进包）
    │   ├── fnpack.exe       # 官方打包工具 1.2.3
    │   ├── build-html.js    # 重新生成 about/init 页（base64 内嵌图片）
    │   ├── verify.js        # 集成回归（路由/页面/API/WS/apiUrl 断言）
    │   ├── verify-m1-fix.js # M1 命令弹层修复回归（自包含）
    │   └── ws-stress.js     # WebSocket 健壮性压测
    ├── assets/              # 开发资源（不进包）：qq-group.png 二维码源图
    └── release/             # 发布产物（带版本号）
        ├── dsh-0.2.5.fpk            # 当前版本（fnpack 对齐 manifest + checksum）
        └── archive/                 # 历史版本归档（dsh-0.2.1 ~ dsh-0.2.4）
```

## 一、包内容（26 已完成 ✅）

| 文件 | 说明 |
|------|------|
| `manifest` | 应用元数据（display_name=DeepSeek Harness，依赖 nodejs_v22，网关版本）|
| `config/privilege` | 专用用户 dsh 运行（非 root）|
| `config/resource` | 数据目录 data-share（dsh/data）|
| `app/ui/config` | 网关入口 /app/dsh → app.sock，桌面标题 DeepSeek Harness |
| `app/ui/images/` | 入口图标 64/256（鲸鱼）|
| `app/server/server.js` | 网关 Socket 代理 → 127.0.0.1:3080（含 HTTP+WebSocket 转发、/about、/api/health）|
| `app/server/dsh-manager.js` | DSH 运行时管理（npm install 到 var/dshenv，幂等）|
| `app/server/about.html` | 联系我们页（群号 916607090 + 二维码 base64 内嵌；源图在 assets/）|
| `cmd/main` | 生命周期脚本（start 自动装 DSH → 启动代理；stop/status）|
| `etc/config.json` | DSH 版本/源/群号配置（用户可改 dshVersion 升级 DSH）|
| `ICON.PNG` / `ICON_256.PNG` | 应用中心图标（鲸鱼 512/256）|
| `wizard/` | 向导占位（无自定义向导，空表单）|

## 二、6 的操作步骤（约1小时）

```powershell
# 1. 准备 fnpack（若未下载）
#    下载 fnpack-1.2.3-windows-amd64 → 重命名为 fnpack.exe → 放 dsh-fnos/tools/ 目录

# 2. 打包（直接对 26 写的包执行；fnpack 在 tools/ 下）
cd fnos\dsh-fnos
.\tools\fnpack.exe build --directory dsh

# 3. 产物 dsh.fpk 生成 → 复制为 release\dsh-<版本>.fpk
#    （fnpack 对齐格式 + checksum 即可直接安装，无需额外处理 manifest）
```

> 不需要 `fnpack create`——包结构已完整。若 fnpack 校验报缺文件，按提示补（一般不会）。

## 三、真机测试（老大 NAS）

```bash
# SSH 到 NAS 安装
appcenter-cli install-fpk dsh.fpk

# 查看日志（安装/启动/DSH 下载进度）
tail -f /var/apps/dsh/var/app.log

# 测试清单
# 1. 桌面出现 DeepSeek Harness 图标
# 2. 点击打开 → 首次等待 DSH 下载（几分钟）→ DSH Web GUI
# 3. 地址 /app/dsh/about → 二维码+群号
# 4. 停止/启动应用（应用中心）→ 数据保留
# 5. ps 确认进程用户是 dsh；ss -tlnp 确认无额外公网监听
```

## 四、可能遇到的问题与处理

| 问题 | 处理 |
|------|------|
| fnpack 报 wizard 为空 | 已放 .gitkeep 占位，正常 |
| DSH 下载慢/失败 | 检查 config.json registry（npmmirror）；NAS 网络 |
| 打开白屏 | 看 app.log；DSH 服务是否起来（curl 127.0.0.1:3080）|
| 网关 404 | 确认 manifest os_min_version ≥ 1.1.3100（已配）|
| 端口冲突 3080 | cmd/main 改 DSH_PORT + config 同步（暂固定）|

## 五、上架材料（6 负责截图）

1. **真实截图 3-5 张**：DSH 主界面 / 聊天界面 / /about 联系我们页
2. 应用图标：已就绪（ICON.PNG）
3. 提交：飞牛粉丝群 → 社区主理人 → 开发者先锋交流群 → 提交 fpk + 截图 + manifest 信息

---

*有问题随时同步 26，我随时改包。*

---

## 六、开发记录（6 完善 2026-08-15，已本地验证 ✅）

### 6.1 代码改动（相对 26 初版）

| 文件 | 改动 |
|------|------|
| `app/server/server.js` | **重写**：①网关前缀剥离（兼容 fnOS 网关带/不带 `/app/dsh` 前缀）；②内聚管理 DSH web 生命周期（ensure → spawn `dsh web` → 就绪探测 → 退出清理），壳只暴露一个进程给 cmd/main；③DSH web 意外退出自动重启（指数退避 1s→30s）；④未就绪时返回初始化页而非 502；⑤WebSocket 隧道/代理增加 error 兜底（客户端断连不再拖垮进程） |
| `app/server/init.html` | **新增**：初始化提示页（深色风格，轮询 /api/health，就绪自动进入） |
| `app/server/about.html` | 二维码改为 **base64 内嵌**（不再依赖外链路由），logo 修正为鲸鱼图标（原错用二维码图） |
| `app/server/dsh-manager.js` | npm 调用跨平台兼容（Windows 走 shell，飞牛 Linux 直接 spawn） |
| `cmd/main` | 简化：只管理 server.js 一个进程（DSH web 由 server.js 内部拉起）；传递 GATEWAY_PREFIX / DATA_DIR 环境变量；DATA_DIR 指向 data-share |
| `cmd/` | **补齐 8 个生命周期脚本**（install/upgrade/uninstall/config 的 init/callback）——fnpack 校验强制要求 |
| `config/privilege` | 去掉 `username/groupname` 字段（fnpack 1.2.3 schema 不接受，run-as: package 时系统自动创建 dsh 用户） |
| `config/resource` | 保留单一 `dsh/data` share（已验证合法） |
| `wizard/` | **删除**（.gitkeep 空文件导致 fnpack JSON 校验失败；参考项目无 wizard 亦可打包） |
| `app/www/` | 删除空目录 |

### 6.2 打包（fnpack 已就绪）

```powershell
cd fnos\dsh-fnos
.\fnpack.exe build --directory dsh   # 产物 dsh.fpk（约 470KB）
```

- fnpack.exe 已从官方 CDN 下载：`https://static2.fnnas.com/fnpack/fnpack-1.2.3-windows-amd64`
- 打包校验通过：manifest / privilege / resource / ICON / app / cmd 全绿

### 6.3 本地验证结果（Windows 真跑 DSH 0.1.0-rc.6）

| # | 测试项 | 结果 |
|---|--------|------|
| 1 | server.js 启动 → ensure（复用已装 DSH，秒回）→ spawn DSH web → 就绪 | ✅ 2-3 秒 |
| 2 | 全新目录 npm install（npmmirror 完整下载 DSH）→ 就绪 | ✅ 真实下载成功 |
| 3 | /api/health（带/不带前缀） | ✅ dshReady 正确 |
| 4 | /about、/app/dsh/about（前缀剥离） | ✅ 中文/群号/二维码内嵌正常 |
| 5 | /、/app/dsh/（代理到 DSH Web GUI） | ✅ 返回 DSH 页面 |
| 6 | DSH web 崩溃 → 自动重启（1s 退避） | ✅ health 恢复 true |
| 7 | 壳 SIGTERM → DSH web 子进程被清理（无残留） | ✅ |
| 8 | WebSocket 连上即断 ×30 → 壳不崩、health 正常 | ✅ |
| 9 | DSH 未就绪时 / → 初始化页（中文正常） | ✅ |

### 6.4 真机测试（老大 NAS）清单

```bash
# 安装
appcenter-cli install-fpk dsh.fpk
# 看日志
tail -f /var/apps/dsh/var/app.log
```

1. 桌面出现 DeepSeek Harness 图标，点击打开
2. 首次启动：初始化页 → DSH 下载（几分钟）→ 自动进入 DSH Web GUI
3. DSH 功能可用（聊天/工作区），数据落在 `$TRIM_DATA_SHARE_PATHS`（dsh/data）
4. /app/dsh/about 显示二维码+群号 916607090
5. 停止/启动：数据保留；DSH web 崩溃自动重启
6. 安全：`ps` 确认 dsh 用户运行；`ss -tlnp` 确认无额外公网监听
7. 卸载：可选验证数据保留（var 目录）

> 开发辅助脚本（不进包）：`build-html.js`（重新生成 about/init 页）、`verify.js`（路由验证）、`ws-stress.js`（WebSocket 健壮性验证）。

---

## 七、同步 Windows 版 v0.5 功能（6 完成 2026-08-15，已本地验证 ✅）

扫描 `windows/app/`（main.js + renderer）后，把适用飞牛的功能全部同步：

| Windows 版功能 | 飞牛版实现 | 验证 |
|---|---|---|
| **检查 DSH 官方更新**（npm dist-tags.latest + 语义化比较） | `server.js` 新增 `/api/update`（查询）与 `/api/update/upgrade`（热升级：改写 `etc/config.json` dshVersion → 自动重装 DSH → 重启，无需重启应用） | ✅ 真实查询 npm：current/latest 均 rc.6；无更新时正确返回 no-update |
| **关于窗口版本详情 + 更新入口** | `about.html` 新增"DSH 运行时更新"卡片（当前/最新/一键升级 + 状态提示）+ 项目主页链接 | ✅ |
| **日志环形缓冲（800 行）** | `server.js` 日志模块：本地时间 + 内存环形缓冲 + 落盘 `$TRIM_PKGVAR/app.log`；`/api/log` 返回最近 500 行 | ✅ |
| **日志查看页** | 新增 `/log` 页面（`log.html`，深色，自动刷新 + 错误高亮），入口在 about/init 页 | ✅ |
| **启动阶段/进度 UI**（对齐 loading 窗口） | `init.html` 增强：4 阶段指示器（检查/下载/启动/就绪）+ 下载进度 MB（每 2 秒统计 dshenv 体积）+ 日志链接；`/api/status` 供轮询 | ✅ |
| **未捕获异常兜底** | `server.js` 全局 uncaughtException/unhandledRejection 记录后不退出 | ✅ |
| **JSON 解析 BOM 防护** | `readConfig`/`installedVersion` 剥离 BOM（防 Windows 记事本等编辑工具污染） | ✅ |
| 壳自动更新 | ❌ 不适用（应用商店上架，按对齐要求） | - |
| 端口自动顺延/单实例锁/窗口诊断 | ❌ 飞牛场景不适用（生命周期脚本管理单实例；DSH_PORT 可配置） | - |

**验证结果（Windows 真跑 DSH 0.1.0-rc.6）：**
- verify.js 19 项全 PASS（页面/API/前缀/更新查询/WebSocket）
- ws-stress 30 次连上即断 → 壳不崩
- 版本管理：首次安装 ✅ / 版本匹配秒回 ✅ / config 驱动重装（npm 机制与首次安装同路径）✅
- 退出清理无残留 ✅

**最终产物：** `dsh.fpk`（约 477KB，fnpack 校验全绿）。真机测试清单见 6.4。

---

## 八、图标与初始化体验修复（6 完成 2026-08-15）

### 8.1 图标统一为 Windows 官方图标
- 来源：`windows/app/assets/icon.png`（512×512 官方鲸鱼图标）
- 已替换：`ICON.PNG`（512）、`ICON_256.PNG`（256）、`app/ui/images/icon_256.png`（256）、`app/ui/images/icon_64.png`（64，System.Drawing 高质量缩放）
- `about.html` / `init.html` 内嵌 logo base64 已用 `build-html.js update-logo` 重新生成 ✅

### 8.2 初始化"疑似卡住"修复（根因：失败无声 + npm 慢重试 + stdin 死锁隐患）
| 问题 | 修复 |
|---|---|
| ensure 失败只写日志，初始化页无限等待 | server.js 增加 `ensureError` 状态；`/api/status` 返回 error；初始化页显示"初始化失败 + 原因 + 重试按钮"（POST `/api/restart` 重新初始化） |
| npm 网络失败默认长重试（接近 10 分钟超时才报错） | `dsh-manager.js` 收紧 `--fetch-retries=2 --fetch-retry-mintimeout=5000 --fetch-retry-maxtimeout=15000`，失败 1-2 分钟内可见 |
| npm/postinstall 读 stdin 可能挂起（spawnSync 默认 stdin 为 pipe 未关闭） | `spawnSync` 显式 `stdio: ['ignore','pipe','pipe']`，杜绝死锁 |
| 下载慢无提示 | 初始化页等待超 5 分钟显示"下载可能较慢或网络异常，请查看日志"；安装完成日志含总耗时 |
| 超时无明确日志 | 10 分钟超时输出 `安装超时（10 分钟）：请检查网络后重试` |

**验证**：正常路径全通过（health/status/restart/页面）；失败路径实测（config 指向不存在版本 99.99.99）→ npm 快速失败 → `/api/status` error 正确返回，初始化页将显示失败+重试而非无限等待 ✅

---

## 九、真机暴露的根因修复（6 完成 2026-08-15，老大 NAS 日志定位）

### 9.1 根因1：npm EACCES（初始化立即失败的真凶）
- **现象**（NAS 日志）：`npm error code: 'EACCES', syscall: 'mkdir', path: '/home/dsh'` → npm 需要写 dsh 用户 home（.npm 缓存/日志），但 `/home/dsh` 不存在/不可写 → **1 秒内安装失败**
- **修复**：`dsh-manager.js` 把 npm 的 `HOME` 与 `--cache` 重定向到 `$TRIM_PKGVAR`（`npm-cache` 子目录，dsh 用户可写）→ 不再碰 /home/dsh

### 9.2 根因2：config.json 未进包（spec 变成 latest）
- **现象**：fpk 解包确认 **fnpack 不打包 `etc/` 目录** → NAS 上 `/var/apps/dsh/etc/config.json` 不存在 → 读取失败回退 `dshVersion=latest` → npm 每次解析 latest
- **修复**：① 新增包内默认配置 `app/server/config.json`（随 app.tgz 分发）；② `dsh-manager.js`/`server.js` 读取顺序：`$TRIM_PKGETC/config.json`（用户可改，优先）→ 包内默认；③ `cmd/main` 与 `install_callback` 启动/安装时自动把默认配置复制到 `$TRIM_PKGETC`

### 9.3 其他修复
- 日志双写（server.js 自己落盘 + cmd/main 重定向 → 每行两遍）：server.js 改为只输出 stdout，落盘由 cmd/main 重定向完成
- 诊断增强：dsh-manager 日志打印配置来源/HOME/cache 路径；cmd/main 打印 TRIM_* 环境变量值

### 9.4 验证（Windows 真跑）
- fresh2 完整 npm install（HOME/cache 重定向）✅ DSH rc.6 装好，npm-cache 落数据目录
- 空 PKGETC 场景 → 回退读包内 config.json → current=0.1.0-rc.6（非 latest）✅
- server 全链路（ensure 秒回 → DSH web ready）✅
- fpk 内容验证：app.tgz 含 server/config.json + server.js/dsh-manager.js/页面 ✅

---

## 十、网关路径重写（6 完成 2026-08-15，本地验证 ✅）

### 问题
DSH 前端是**预编译产物**，所有资源与 API 都是**根绝对路径**（`/assets/*`、`/plugins/<id>/client.js`、`/api/*`、WebSocket `/api/events.mux|host`）。飞牛统一网关只转发 `/app/dsh/*` → 浏览器请求根路径会 404，页面资源/API 全断。

### 修复（`server.js` 网关模式自动启用，GATEWAY_PREFIX 非空时）
| 层 | 重写 |
|---|---|
| **HTML**（index.html 响应） | `src/href="/assets/`、`/manifest.webmanifest`、`/favicon.svg` → 加 `/app/dsh` 前缀 |
| **HTML 内 __DSH_BOOT__** | `/plugins/<id>/client.js` bundle URL → 加前缀（38 个 bundle 全部） |
| **JS**（bundle 内容） | `"/api/` 与 `` `/api/ `` URL 字面量 → 前缀化；`API_PATH = "/api"` 常量 → 前缀化（只用于拼 URL） |
| **请求头** | 转发到 DSH web 时 `Host → 127.0.0.1:DSH_PORT` + **删除 Origin**（DSH 的 /api 信任栅栏要求 Host loopback 且 Origin.host == Host.host，网关透传 NAS 域名会 403） |
| **WebSocket 隧道** | 同上（Host/Origin 改写） |

**精确性**：`channel !== "/api"` 等**比较逻辑不被误伤**（规则只匹配带斜杠后缀的 URL 形式）。

### 其他修复
- **DSH web 持续启动失败上限**：连续重启 5 次后停止并提示（防端口残留导致无限重启循环）
- **页面 API 路径自愈**：init/about/log 页的 fetch 基于 `location.pathname` 推导（防 `/app/dsh` 无尾斜杠导致相对路径错位）

### 验证（本地真跑 DSH 0.1.0-rc.6）
- 页面 HTML：assets/manifest/favicon 全部前缀化，无残留 ✅
- `__DSH_BOOT__`：38 个 bundle URL 全部前缀化 ✅
- client-connection bundle：`/api/events.mux`、`/api/events.host`、`/api/respond`、`` `/api/${method} `` 全部 → `/app/dsh/api/...`，无残留 ✅
- 信任改写：带 NAS 域名 Host/Origin 的 API 请求 → 非 403 ✅
- 比较逻辑 `!== "/api"` 保留 ✅

---

## 十一、v0.2 版本开发记录（6 完成 2026-08-15，本地验证 ✅）

> 依据：《0.2版本方案与任务清单-20260815.md》（26 编制）。多用户隔离已确认推迟至 **v0.6**，本轮不做。

### 11.1 T-F1（P0）：修复 /home/dsh ENOENT（文件浏览/工作区打不开）

| 文件 | 改动 |
|------|------|
| `cmd/main` | 启动前 `mkdir -p $TRIM_APPHOME` + `chown dsh:dsh`（失败忽略）；启动 server.js 时传 `TRIM_APPHOME` 环境变量 |
| `server.js` | `spawnDshWeb()` 设置 `env.HOME = TRIM_APPHOME || PKGVAR || DATA_DIR || '/tmp'`（DSH 文件浏览/工作区默认目录依赖 HOME，不设会 opendir /home/dsh ENOENT）|

> 根因：dsh-manager 只在 npm 安装时重定向 HOME，DSH web 进程未设置 → 仍指向不存在的 /home/dsh。

### 11.2 T1/T2/T3/T4：四菜单 Web 化（等效 Windows 版菜单）

| 任务 | 改动 |
|------|------|
| T1 悬浮入口 | `server.js` 新增 `FLOATING_ENTRY` 常量，`rewriteBody()` HTML 分支在 `</body>` 前注入右下角悬浮入口（关于我们/检查更新/运行日志，链接带网关前缀）；无 `</body>` 的异常页面自动追加 |
| T2 update.html | **新增** `app/server/update.html`：打开自动查询 `/api/update`，展示当前/最新版本 + 状态徽章（最新/可更新）+ 一键升级（POST /api/update/upgrade）；导航（关于/日志/返回 DSH）；与 init/about 同风格，apiUrl 路径自愈 |
| T3 about 增强 | links 增加「检查更新」「DeepSeek 官网」；版本行动态追加服务地址（网关前缀）|
| T4 路由 | `server.js` handlePage 注册 `/update`（含前缀剥离路径 `/app/dsh/update`）|

### 11.3 manifest / 版本

- `version=0.1.0 → 0.2.0`；`change_log` 更新；`server.js APP_VERSION` 同步 0.2.0

### 11.4 验证结果（本地，DSH 运行时未装场景）

| # | 测试项 | 结果 |
|---|--------|------|
| 1 | node --check 全部 JS + 语法 | ✅ |
| 2 | verify.js 25 项（页面/API/前缀/update 页/日志/WS）| ✅ 全 PASS |
| 3 | 悬浮入口注入单元测试（inject-test.js，从 server.js 提取真实模板）10 项 | ✅ 注入位置/链接前缀/三入口/无 body 追加/JS 不注入 |
| 4 | health appVersion=0.2.0 | ✅ |
| 5 | /update 与 /app/dsh/update 均 200 | ✅ |
| 6 | fnpack build 校验全绿；fpk 解包：manifest version=0.2.0 + server/update.html 已进包 | ✅ |

> 沙箱限制说明：本环境禁止网络与子进程 pipe，DSH 运行时安装（spawn EPERM）无法在本地完成；
> DSH 就绪后的悬浮入口真机表现（iframe 内点击导航）需在真机测试清单确认。

### 11.5 真机测试补充清单（相对 v0.1 新增）

1. **文件浏览/工作区正常**（/home/dsh 不再 ENOENT）★重点
2. DSH GUI 右下角悬浮入口显示，点击「关于/更新/日志」可进入对应壳页面
3. /update 页：版本显示 + 一键升级 DSH 运行时
4. /about：版本/服务地址/官网/项目链接完整
5. 回归：首次启动初始化 → GUI → 重启数据保留

### 11.6 遗留说明

- 测试辅助脚本（不进包）：`verify.js`（新增 update 页/前缀/悬浮注入 3 组检查）、`inject-test.js`（悬浮注入单元验证）、`ws-stress.js`
- v0.2 产物：`dsh.fpk`（约 416KB，fnpack 校验全绿）

---

## 十二、v0.2.1 版本开发记录（6 完成 2026-08-15，本地验证 ✅）

> 依据：《审查报告v3.0-软件版本v0.2.1-飞牛独立审查-20260815.md》（26 编制）。
> 老大要求：**飞牛安装包也加版本号**（参照 Windows 安装包 `DSH-Desktop-Setup-0.5.8.exe` 命名惯例）。

### 12.1 版本号（老大核心需求）

| 项 | 值 | 位置 |
|----|-----|------|
| 应用版本 | **0.2.1** | manifest `version` + server.js `APP_VERSION`（两处同步，报告"版本号管理"节）|
| 安装包文件名 | **`dsh-0.2.1.fpk`**（fnpack build 后复制，与 `dsh.fpk` 同内容）| dsh-fnos/ |
| change_log | 追加 v0.2.1 说明 | manifest |

### 12.2 顺手修复（报告 P1/P2 建议项）

| # | 报告项 | 修复 | 验证 |
|---|--------|------|------|
| N1 | 安装进度不含 npm 缓存（下载阶段恒 0）| `ensureDshBinAsync` 进度 = dshenv + npm-cache 之和（对齐 Windows 已修项）| ✅ 代码就位 |
| N2 | fetchJson 无精简头/无大小上限 | 加 `headers`/`maxBytes(5MB)` 参数；查 npm 用 `Accept: application/vnd.npm.install-v1+json`（对齐 Windows v13）| ✅ 真实查询 latest=0.1.0-rc.6 成功 |
| N4 | restart/upgrade 无管理员限制 | 新增 `isAdmin()`：有 X-Trim-* 网关上下文时要求 `X-Trim-Isadmin: true`，否则 403；本地无头直连放行 | ✅ 非管理员 403 / 管理员放行 / 本地放行 |
| N5 | upgradeDsh 无并发防抖 | `upgradingDsh` 标志，并发返回 `busy` | ✅ |
| 附带 | 403/busy 无页面提示 | about/update 页升级失败映射补 `forbidden`/`busy` 文案 | ✅ 包内已含 |

### 12.3 验证结果

- verify.js 25 项全 PASS（appVersion=0.2.1、/update、前缀、页面、WS）
- N4 行为：无 X-Trim 头 → 放行；X-Trim-Isadmin:false → 403；admin → 200 no-update（真实查询 npm）
- fnpack build 全绿；解包确认 manifest version=0.2.1、about/update 含 forbidden 文案
- 产物：`dsh-0.2.1.fpk`（约 421KB）+ `dsh.fpk`

### 12.4 未做（报告 P2/P3，记录待办）

- N3 群号动态化（qqGroup 配置下发）：需新 API + about 页动态渲染，P2 取舍未做
- N6 dirSizeMB 同步遍历：2 秒间隔可接受，0.6 再改异步
- N7 qq-group.png 删除（-160KB）：与 N3 联动，暂保留
- 0.6 多用户后：N4 管理员校验是必须项（已提前就位）

---

## 十三、v4.0 复审修复记录（6 完成 2026-08-15，本地验证 ✅）

> 依据：《审查报告v4.0-软件版本v0.2.1-飞牛复审-20260815.md》（26 编制）+《0.2版本方案与任务清单 v2》（T1-T5）。
> 结论：P0-1 硬伤（三页面 API 404）已修；P0-2 授权目录已补；M1 需真机 A-D 定位（代码已留排查线索）。

### 13.1 P0-1：四页面 apiUrl 拼接修复（硬伤）

| 页 | 修复 |
|----|------|
| about/update/log/init | `apiUrl()` 改为提取 pathname 前两段作网关前缀：`/app/dsh/about` → `/app/dsh/api/*`；本地 `/about` → `/api/*`（旧写法只去尾斜杠 → `/app/dsh/about/api/*` 全 404）|
| 验证 | verify.js 新增 9 项 apiUrl 断言（网关/本地/带斜杠/自定义前缀）+ 四页面静态断言；44 项全 PASS |

### 13.2 P0-2：授权目录软链接（v0.2 问题1）

- `cmd/main` 新增 `link_auth_dirs()`：清理旧链接 → 遍历 `TRIM_DATA_ACCESSIBLE_PATHS`（冒号分隔）→ 主目录建 `auth-<目录名>` 软链接；start_app 启动 server.js 前调用
- 验证：应用中心授权目录 → 重启 → DSH 主目录出现 auth-* → 可直接浏览/选工作区（真机验证项）

### 13.3 M2/L1：返回 DSH 入口 + 导航 pageUrl 化

- about.html / log.html 补「返回 DSH」链接（对齐 update.html lk-back，指向网关根）
- about.html 内页导航（更新/日志）改为 pageUrl() 推导（防 `/app/dsh/about/` 尾斜杠相对路径解析错位）

### 13.4 M3：升级端口竞争加固

- `upgradeDsh()` kill 后 `once('exit')` 等旧进程真正退出（5s 兜底）再 ensure——防重装秒回时旧进程未释放 3080 → EADDRINUSE
- 升级后清版本缓存

### 13.5 L2/L6：悬浮注入收窄 + 版本缓存

- L2：悬浮入口只注入含 `__DSH_BOOT__` 的 DSH 入口页（不遮挡内部页面 UI/模态框）
- L6：`getDshVersion()` 缓存 60s（spawnSync 开销）；`ensureAndStart` ready 时强制实时查询

### 13.6 M1：命令弹出闪现 —— 需真机 A-D 定位（未改代码）

- 静态审查发现**理论误伤点**：rewriteBody 的 `"\/api\//` 规则会替换 `startsWith("/api/")`、`includes("/api/")` 等**带尾斜杠的比较字面量**（无尾斜杠的 `!== "/api"` 不受影响）——已写入 server.js 注释作排查线索
- 真机 DevTools 排查：点击命令时 Console 有无 JS 报错/请求 404；对比「原始响应 vs 重写后响应」确认是否误伤 → 再决定收窄规则或跳过该 chunk（A→B→C→D 顺序）
- **未做猜测性修改**（v2 要求"必须定位根因，不能只试不查"）

### 13.7 验证与产物

- verify.js **44 项全 PASS**（新增：9 项 apiUrl 断言、四页面 apiUrl 修复版、about/log lk-back、prefix log）
- inject-test.js 11 项全 PASS（新增：无 __DSH_BOOT__ 不注入）
- fnpack build 全绿；解包确认：manifest 0.2.1、cmd/main link_auth_dirs、四页面 apiUrl 修复版、lk-back、server.js L2/M3/L6/M1 注释
- 产物：`dsh-0.2.1.fpk`（约 423KB）

### 13.8 真机回归重点（v4.0 报告要求）

1. **打开 /app/dsh/about、/update、/log 三页面**：更新检查/升级/日志加载正常（P0-1 修复验证）★
2. 授权目录：应用中心授权 → DSH 主目录见 auth-* → 可浏览/选工作区（P0-2）★
3. 命令弹出（M1）：DevTools A-D 定位后按结论处理
4. 返回 DSH 链接：about/log 页可一键回 DSH（M2）
5. 升级 DSH 运行时：版本变化后 about/update 显示正确（M3/L6）

---

## 十五、v0.2.3 版本开发记录（6 完成 2026-08-15）

> 老大指令：修复后版本 0.2.3。修复项：① 运行时 Manifest: Syntax error ② session.export HEAD 400。

### 15.1 排查结论（重要：安装从未失败）

- 老大测试确认：**4 个字段变体包全部可安装** → 完整 manifest（15 字段含 install_dep_apps/os_min_version/ctl_stop/change_log）**安装没问题**
- **"Manifest: Line: 1, column: 1, Syntax error" 是运行时 F12 报错，不是安装失败** —— 浏览器对 `<link rel="manifest" href="/manifest.webmanifest">` 的 PWA 解析错误
- 官方模板 fpk（fnpack 生成）可安装 → fnpack 打包格式没问题

### 15.2 修复（v0.2.3 最终版）

| 项 | 修复 |
|----|------|
| **Manifest: Syntax error（运行时）** | rewriteBody **移除 `<link rel="manifest">` 标签**（桌面 Web 应用不依赖 PWA manifest，浏览器不再请求/解析）；JS 侧补 `"/manifest.webmanifest"` 前缀化规则 |
| **session.export 400（最终根因）** | **壳路由 `split('?')[0]` 丢掉 query string** → 转发无参数路径 → DSH web 400 缺参。修复：`proxyHttp(req, res, stripPrefix(req.url))` **转发保留 query**。验证：带 query → 404 session not found（参数到达），无 query → 400 缺参（对照组）|
| session.export HEAD | proxyHttp **HEAD → GET 转发**（DSH web 不支持 HEAD）|
| M1 命令弹层 | 已含全部修复（RPC 通道前缀化 + CHANNEL_PATTERN 放宽）|

### 15.3 产物与验证

- `release/dsh-0.2.3.fpk`（约 260KB，fnpack 全绿；验证含全部修复标记、无测试桩）
- verify-manifest-remove.js 5 项 PASS；verify.js 新增 query 保留回归用例
- release/ 已清理测试包（变体/test 模板归档或删除）

---

## 十六、v0.2.4 版本开发记录（6 完成 2026-08-15）

> 老大需求：**目录选择图形化**（不再只能输入路径）。

### 16.1 机制研究

- DSH 的 `ctx.directoryPicker` 有两种能力：**native**（OS 对话框，Electron）与 **browse**（应用内树形浏览，为 Web/远程客户端设计）
- web profile 用 `directory-picker-auto`（探测环境选 native/browse）；飞牛 Web 环境 native 不可用 → **fallback 手动输入路径**（老大反馈的现象）
- **browse 完全可用**：纯 Node fs 实现（list/createDirectory），无额外依赖，中文 UI（"选择工作区目录/主目录/新建文件夹"）

### 16.2 实现（壳层强制 browse）

- `server.js` 新增 `ensureBrowsePatch()`：生成 `$DATA_DIR/web-browse.patch.yml`（禁用 `directory-picker`(auto) + 挂载 browse backend/surface），幂等
- `spawnDshWeb` 改为 `bin --profile web --patch <file> --host --port`（--patch 是 launcher 层参数，`web` 别名不接受）
- 版本：manifest + APP_VERSION = **0.2.4**，change_log 恢复中文（安装已验证）

### 16.3 验证（本地实测 browse 模式）

- patch 生效：browse client 进 `__DSH_BOOT__` ✓、native 移除 ✓、auto 禁用无冲突 ✓
- RPC 端到端：`host.listDirectory` → **200 真实目录树**（crumbs 面包屑 + entries）✓；`host.pickDirectory` → 明确提示 "composed picker serves browse"（browse 模式确认）✓
- 产物：`release/dsh-0.2.4.fpk`（约 261KB，含全部历史修复 + browse）

### 16.4 真机反馈与结论（v0.2.4 最终版）

**真机诊断（老大 NAS 日志）**：
- `TRIM_DATA_ACCESSIBLE_PATHS` 存在但**为空**——飞牛「访问权限」授权是**文件系统 ACL**（dsh 用户可访问 /vol1/影视），**不注入路径列表**
- DSH 自带 browse 目录选择器在真机未生效（点「添加工作区」仍显示输入框）
- 应用 home 真变量是 `TRIM_PKGHOME`（`TRIM_APPHOME` 未设置）→ 已修正 cmd/main + server.js

**决策（老大）**：**图形化目录选择不是核心功能，放弃，以后再说**。

**v0.2.4 最终内容（回退后）**：
- ✅ 移除全部图形化目录选择代码（注入 UI / /api/dir/list / browse patch）——界面干净，无多余图标
- ✅ 保留核心修复：query 保留（Session 导出）、manifest link 移除、HEAD→GET、命令弹层（RPC 通道 + CHANNEL_PATTERN）、TRIM_PKGHOME 主目录修正
- 产物：`release/dsh-0.2.4.fpk`（约 261KB，fnpack 全绿）

**遗留说明**：目录选择仍为 DSH 默认（手动输入路径）；授权目录靠飞牛 ACL 放行、手动输路径访问——图形化方案待后续（0.5+）再评估（DSH 版本升级或壳注入方案）。

---

## 十七、v0.2.5 版本开发记录（6 完成 2026-08-15）

> 老大需求：**应用信息修改**（上架材料前置）。

### 17.1 修改内容（manifest 应用信息）

| 字段 | 原值 | 新值 |
|------|------|------|
| `maintainer`（开发者） | XWJ | **DeepSeek** |
| `distributor`（发布者） | XWJ | **清零** |
| `desc`（应用介绍） | DeepSeek Harness Web GUI for fnOS | **DeepSeek Harness Web GUI（DSH）的飞牛原生应用，一键安装，开箱即用** |
| `version` | 0.2.4 | **0.2.5** |
| `change_log` | 修复会话导出与命令弹层；应用主目录修正 | **更新应用信息（开发者 DeepSeek、发布者清零、应用介绍）** |

- `maintainer_url` 保持项目主页（github.com/XWJ-z/dsh-Desktop）
- `server.js` `APP_VERSION` 同步 0.2.5（两处版本号管理）
- 中文 desc/change_log 为 UTF-8，fnpack 打包后包内 UTF-8 解码验证正确（PowerShell 默认 GBK 显示乱码是显示假象，非文件问题）

### 17.2 验证与产物

- fnpack build 全绿；解包验证：manifest version=0.2.5 + maintainer=DeepSeek + distributor=清零 + 中文 desc/change_log（UTF-8 正确）✓
- app.tgz 内 server.js `APP_VERSION = '0.2.5'` ✓；`node --check` 语法 OK ✓
- 0.2.4 移入 `release/archive/`，产物：`release/dsh-0.2.5.fpk`（约 261KB）

---

## 十四、v0.2.2 版本开发记录（6 完成 2026-08-15，本地验证 ✅）

> 老大要求：M1（命令弹层闪现）解决后版本升 0.2.2。
> 方法升级：不再猜测——拿到**真实 DSH 0.1.0-rc.6 前端（43 个 bundle）** + 本地起真实 DSH web 全链路实测，逐项排除。

### 14.1 M1 排查结论（详见《M1命令弹出闪现-深度排查报告-20260815.md》）

| 疑点 | 结论 | 证据 |
|------|------|------|
| A rewriteBody 误伤 JS | ❌ 排除 | 43 个真实 bundle 应用规则：8 处替换 0 处误伤 |
| 响应压缩不重写 | ❌ 排除 | DSH 响应无 content-encoding |
| 重写后资源 404 | ❌ 排除 | 全部 URL 剥前缀后 200 |
| WebSocket 转发 | ❌ 排除 | 网关路径 101 + events.mux 7 帧真实事件 |
| HTTP RPC | ❌ 排除 | /api/respond 链路通 |
| 前端路由依赖 | ❌ 排除 | 仅 location.origin |
| DSH 自身 bug | ❌ 排除 | **Windows 版 v0.5.8 正常（老大确认）** |
| **飞牛 iframe 交互 / 网关延迟** | ✅ **锁定** | 飞牛版与 Windows 唯一差异 = iframe 环境 |

### 14.2 M1 修复（**最终根因：RPC 通道字面量未前缀化**）

**真机报错（老大提供）**：`https://192.168.2.166:64999/api/commands/list 404` —— 请求打到**根路径**（无 `/app/dsh` 前缀）→ 飞牛网关只转发 `/app/dsh/*` → 404 → 命令数据加载失败 → **弹层闪现**。

**根因（bundle 级定位）**：`dsh-api-gateway/client.js`：
```js
const result = await connection.rpc.call("/api", endpoint, { args }, signal);
//                                    ↑ channel 是字面量 "/api"（无尾斜杠）
```
`rpc.call` 内 `new URL(`${channel}/${endpoint}`, origin)` 拼接 → **`/api/commands/list`**（无前缀）。
原替换规则只覆盖 `"/api/`（带斜杠）与 `API_PATH = "/api"` 常量，**漏掉无尾斜杠的 `"/api"` 通道字面量**。

**修复（server.js rewriteBody，两步）**：

**第一步**：新增精确规则 `"\/api"` → `"/app/dsh/api"`（放在带斜杠规则之后）：
```js
.replace(/"\/api"/g, `"${GATEWAY_PREFIX}/api"`)
```
调用方（api-gateway `rpc.call`）+ 接收方比较（connection `channel !== "/api"`）+ 常量**同步替换，比较仍成立**。

**第二步（真机第二轮报错修复）**：channel 前缀化后 connection 的 `assertTarget` 校验 `CHANNEL_PATTERN=/^\/[A-Za-z0-9._~-]+$/`（单段）拒绝多段 `/app/dsh/api`（`invalid RPC target`）。**放宽正则允许 `/` 分段**（同步替换，防静默失败检测已加）：
```js
.replace('CHANNEL_PATTERN = /^\\/[A-Za-z0-9._~-]+$/', 'CHANNEL_PATTERN = /^\\/[A-Za-z0-9._~/-]+$/')
```
- channel 值来自 api-gateway 硬编码（非用户输入），endpoint 仍有严格分段校验 → 安全不降级（验证：恶意 endpoint 仍被拒）
- 防静默失败：DSH 版本升级后文本不匹配时记 warn 日志

**验证（verify-m1-fix.js v2 全 PASS）**：
- api-gateway `rpc.call("/app/dsh/api"` ✅；CHANNEL_PATTERN 放宽命中真实 bundle ✅
- assertTarget 多段 channel 通过 ✅；URL = `/app/dsh/api/commands/list` ✅；恶意 endpoint 被拒 ✅
- verify.js 全量回归 PASS；fpk 包内确认 manifest 0.2.2 + 全部规则 ✅

| 相关改动 | 说明 |
|------|------|
| `server.js` | 新增 `"/api"` 无斜杠替换规则（M1 真根因）；悬浮入口移除（遮挡是次要干扰，一并移除避免误伤弹层）；WS head 顺序修正 |
| `app/ui/config` | `type: url` 回退 `iframe`（根因非 iframe）|
| verify.js / inject-test.js / verify-m1-fix.js | 回归工具更新 |

### 14.3 顺手修复（排查中发现）

- `server.js` WebSocket 转发：`head` 字节改为**写在请求头之后**（HTTP upgrade 协议顺序：请求行→头→空行→head；旧写法 head 在前，WS 握手 head 为空未触发问题，head 非空时会导致上游解析错乱）

### 14.4 版本与产物

- manifest `version=0.2.2`、server.js `APP_VERSION=0.2.2`、change_log 更新
- verify.js 回归全 PASS（appVersion=0.2.2、WS no-hang）
- 产物：`dsh-0.2.2.fpk`（约 423KB，fnpack 校验全绿）

### 14.5 真机回归重点（v0.2.2）

1. ★ **命令弹层**：桌面图标 → 浏览器标签打开 → 点击命令不再闪现（M1 验证）
2. 桌面图标打开方式变化（标签页 vs 窗口内嵌）体验确认
3. 常规回归：/home/dsh、授权目录、about/update/log 三页面、升级 DSH
