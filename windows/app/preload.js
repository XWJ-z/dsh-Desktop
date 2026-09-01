'use strict';

/**
 * DSH Desktop — 预加载脚本
 * 通过 contextBridge 向渲染进程暴露最小化的、只读的桌面应用信息。
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  /** 桌面应用版本号 */
  getVersion: () => ipcRenderer.invoke('dsh:version'),
  /** 已安装 DSH 运行时版本（未安装返回 null） */
  getDshVersion: () => ipcRenderer.invoke('dsh:installed-dsh-version'),
  /** DSH Web 服务实际使用的端口 */
  getPort: () => ipcRenderer.invoke('dsh:port'),
  /** 订阅启动阶段（①检查 ②下载/安装 ③启动服务 ④就绪，返回取消订阅函数） */
  onStage: (callback) => {
    const handler = (_event, stage) => callback(stage);
    ipcRenderer.on('dsh:stage', handler);
    return () => ipcRenderer.removeListener('dsh:stage', handler);
  },
  /** 查询当前启动阶段（页面脚本就绪后调用，避免错过早期推送） */
  getStage: () => ipcRenderer.invoke('dsh:stage'),
  /** 订阅下载/安装进度（{ mb: '23.4' }，返回取消订阅函数） */
  onProgress: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('dsh:progress', handler);
    return () => ipcRenderer.removeListener('dsh:progress', handler);
  },
  /** 订阅主进程日志（返回取消订阅函数） */
  onLog: (callback) => {
    const handler = (_event, line) => callback(line);
    ipcRenderer.on('dsh:log', handler);
    return () => ipcRenderer.removeListener('dsh:log', handler);
  },
  // ── v0.5.3：更新窗口 / 联系我们 / 关于窗口（最小暴露）──
  /** 查询壳+DSH 两侧更新信息 */
  queryUpdate: () => ipcRenderer.invoke('update:query'),
  /** 触发 DSH 升级（改 config + 重启） */
  upgradeDsh: () => ipcRenderer.invoke('update:dsh-upgrade'),
  /** 触发壳更新下载（进度经 onUpdateProgress 推送） */
  downloadShellUpdate: () => ipcRenderer.invoke('update:shell-download'),
  /** 订阅壳更新下载进度（{ percent: 0-100 }，返回取消订阅函数） */
  onUpdateProgress: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  /** 复制文本到剪贴板 */
  copyText: (text) => ipcRenderer.invoke('clip:copy', text),
  /** 获取联系我们信息（群号 + 二维码路径） */
  getContactInfo: () => ipcRenderer.invoke('contact:info'),
  /** 获取关于信息（版本/DSH/服务地址/图标） */
  getAboutInfo: () => ipcRenderer.invoke('about:info'),
  /** 获取更新日志数据（本地 CHANGELOG.json，离线可用；v0.8.1 T3） */
  getChangelog: () => ipcRenderer.invoke('changelog:data'),
  // ── v0.8.3（T1/T3/T4）：提示词库 ──
  /** 获取内置提示词库数据（prompts.json） */
  getPrompts: () => ipcRenderer.invoke('promptlib:data'),
  /** 把提示词直接注入主窗口 DSH 输入框（失败返回 { ok:false, reason }） */
  injectPrompt: (text) => ipcRenderer.invoke('promptlib:inject', text),
  /** 打开提示词库面板（工具箱菜单入口） */
  openPromptLib: () => ipcRenderer.invoke('toolbox:open-promptlib'),
  // ── v0.9.5（T2）：自定义提示词（我的提示词 tab）──
  /** 获取自定义提示词库（{ categories, items }） */
  getCustomPrompts: () => ipcRenderer.invoke('promptlib:custom-list'),
  /** 保存自定义提示词（有 id 更新 / 无 id 新增；返回 { ok, item?, reason? }） */
  saveCustomPrompt: (item) => ipcRenderer.invoke('promptlib:custom-save', item),
  /** 删除自定义提示词（按 id） */
  deleteCustomPrompt: (id) => ipcRenderer.invoke('promptlib:custom-delete', id),
  /** 关于窗口：关闭并打开更新窗口 */
  openUpdateWindow: () => ipcRenderer.invoke('about:open-update'),
  /** 打开外部链接（仅 http/https；opts.user=true 表示显式用户操作，放行本地回环） */
  openExternal: (url, opts) => ipcRenderer.invoke('app:open-external', url, opts || {}),
  /** 网页打开按钮拖拽位置上报（v0.7.5：会话内记忆） */
  saveWebOpenBtnPos: (pos) => ipcRenderer.invoke('web-open-btn:pos', pos),
  // ── v0.8.11（T0.6 / T5 / T5.3）：公告 + 桌面宠物 ──
  /** 获取公告数据（远程拉取；打开即标记已读） */
  getNotices: () => ipcRenderer.invoke('notice:data'),
  /** 设置宠物隐藏状态（右键隐藏宠物） */
  setPetHidden: (v) => ipcRenderer.invoke('pet:hidden', v),
  /** 宠物气泡通知（key: 'copied' 等） */
  petNotify: (key) => ipcRenderer.invoke('pet:notify', key),
  // ── v0.9（T2）：拖拽文件取路径（Electron 32+ 唯一方式，仅 preload 可用）──
  /**
   * 取拖入 File 的本地绝对路径（webUtils.getPathForFile；非 File 或非磁盘文件返回 ''）。
   * ⚠ 必须在 drop 事件同步调用（异步会丢 File 引用，返回空）。
   */
  getPathForFile: (file) => {
    // v0.9.16（外审 zx(29) S13）：异常时 console.warn 辅助排查（渲染进程无 appendLog）
    try {
      return webUtils.getPathForFile(file);
    } catch (err) {
      console.warn('[dshDesktop] getPathForFile 失败：', (err && err.message) || err);
      return '';
    }
  },
  /** 拖拽文件 → 主进程处理（复制进工作区 + 注入提示词） */
  dropFiles: (paths) => ipcRenderer.invoke('drop:files', paths),
  // ── v0.9.12：全局记忆（宠物菜单入口；~/.dsh/AGENTS.md，DSH 自动读取）──
  /** 打开全局记忆编辑窗口（基础设定图形化表单） */
  openGlobalMemory: () => ipcRenderer.invoke('memory:open-window'),
  /** 读取全局记忆数据（{ exists, hasSection, form, file }） */
  getGlobalMemory: () => ipcRenderer.invoke('memory:data'),
  /** 保存全局记忆（区块级写回，返回 { ok, file, message? }） */
  saveGlobalMemory: (form) => ipcRenderer.invoke('memory:save', form),
  /** 打开全局记忆文件所在目录（~/.dsh） */
  openGlobalMemoryFolder: () => ipcRenderer.invoke('memory:open-folder'),
  /** v1.0.1（用户指令）：打开角色文件目录（~/.dsh/roles） */
  openGlobalMemoryRoles: () => ipcRenderer.invoke('memory:open-roles'),
  /** v1.0.5（用户反馈 4）：解析异常时从备份（AGENTS.md.bak）一键恢复全局记忆 */
  restoreGlobalMemoryBackup: () => ipcRenderer.invoke('memory:restore-backup'),
  // ── v1.2.1 T1：项目记忆（工作区级 <工作区>/AGENTS.md，DSH 自动读取）──
  /** 读取项目记忆数据（当前工作区 + 历史项目 + 该工作区记忆） */
  getProjectMemory: () => ipcRenderer.invoke('project-memory:data'),
  /** 保存项目记忆（workspacePath + content）→ 返回 { ok, file?, message? } */
  saveProjectMemory: (workspacePath, content) => ipcRenderer.invoke('project-memory:save', workspacePath, content),
  /** 删除项目记忆（删 <ws>/AGENTS.md + 移出索引） */
  deleteProjectMemory: (workspacePath) => ipcRenderer.invoke('project-memory:delete', workspacePath),
  /** 历史项目列表（索引） */
  listProjectMemories: () => ipcRenderer.invoke('project-memory:list'),
  /** 读取指定项目记忆（项目列表切换 / 手动路径）→ { ok, workspace, exists, path, content, head, sections } */
  readProjectMemory: (workspacePath) => ipcRenderer.invoke('project-memory:read', workspacePath),
  /** 打开项目记忆所在目录 */
  openProjectMemoryFolder: (workspacePath) => ipcRenderer.invoke('project-memory:open-folder', workspacePath),
  // ── v1.2.1 T4：技能库（扫描/读写/删除 + 市场）──
  /** 列出已装技能（扫描 DSH 技能目录 + dedup）→ [{ name, desc, level, path }] */
  listInstalledSkills: () => ipcRenderer.invoke('skill:list-installed'),
  /** 读取单个技能正文（查看详情）→ { ok, name, content, path } */
  readSkill: (name) => ipcRenderer.invoke('skill:read', name),
  /** 保存技能（{ name, description, whenToUse, body }）→ { ok, path?, message? } */
  saveSkill: (payload) => ipcRenderer.invoke('skill:save', payload),
  /** 删除技能（kebab-case 名）→ { ok, message? } */
  deleteSkill: (name) => ipcRenderer.invoke('skill:delete', name),
  /** 技能市场列表（7 天缓存优先）→ [{ name, description, category, repo, file }] */
  getSkillMarket: () => ipcRenderer.invoke('skill:market-list'),
  /** 刷新技能市场（绕过缓存） */
  refreshSkillMarket: () => ipcRenderer.invoke('skill:market-refresh'),
  /** 从市场安装技能（{ name, repo, file }）→ { ok, path?, message? } */
  installSkill: (skill) => ipcRenderer.invoke('skill:install', skill),
  // ── v1.2.1 T7：局域网扫码访问 ──
  /** 打开局域网扫码窗口 */
  openLanQr: () => ipcRenderer.invoke('lan:open-window'),
  /** 局域网二维码数据（每个 IP 带 QR dataURL）→ { enabled, port, ips: [{ip,url,qr}] } */
  getLanQrData: () => ipcRenderer.invoke('lan:qr-data'),
  /** 开启/关闭局域网访问（重启服务 + 弹/关二维码窗口）→ { ok, message? } */
  setLanAccess: (enabled) => ipcRenderer.invoke('lan:set', enabled),
  /** 是否已开启局域网访问 */
  getLanAccess: () => ipcRenderer.invoke('lan:enabled'),
  // ── v0.9.13：角色选择（新对话选角色 / 双击输入框重选）──
  /** 弹窗选择角色并注入提示（无角色配置时不弹） */
  chooseRole: () => ipcRenderer.invoke('role:choose'),
  // v1.0.3（用户反馈 3）：角色选择窗口（竖排列表）结果上报 —— index 为角色列表下标，-1 = 不选择
  rolePickerResult: (index) => ipcRenderer.send('role-picker:select', index),
  // ── v1.1.1：插件市场 ──
  /** 打开插件市场窗口 */
  openPluginMarket: () => ipcRenderer.invoke('toolbox:open-plugin-market'),
  /** v1.2.1 T5：打开技能库窗口 */
  openSkillLibrary: () => ipcRenderer.invoke('toolbox:open-skill-library'),
  /** 获取插件市场分类列表（含「全部」以外的 14 分类） */
  getPluginCategories: () => ipcRenderer.invoke('plugin-market:categories'),
  /** 获取全部插件（缓存优先，过期自动刷新） */
  getPlugins: () => ipcRenderer.invoke('plugin-market:get-plugins'),
  /** v1.1.1 二轮（用户确认）：立即刷新插件列表（绕过 7 天缓存，三源实时拉取） */
  refreshPlugins: () => ipcRenderer.invoke('plugin-market:refresh'),
  /** 搜索插件（按名称/描述模糊匹配） */
  searchPlugins: (query) => ipcRenderer.invoke('plugin-market:search', query),
  /** 按分类筛选插件（'all' = 全部） */
  getPluginsByCategory: (categoryId) => ipcRenderer.invoke('plugin-market:get-plugins-by-category', categoryId),
  /** 复制安装命令到剪贴板 */
  copyPluginCommand: (command) => ipcRenderer.invoke('plugin-market:copy-command', command),
  /** 打开插件 GitHub 仓库（白名单外链） */
  openPluginRepo: (url) => ipcRenderer.invoke('plugin-market:open-repo', url),
  // ── v1.1.1：提示词库单独升级（更新窗口）──
  /** 查询提示词库更新信息（{ current, latest, hasUpdate }） */
  queryPromptsUpdate: () => ipcRenderer.invoke('prompts:query'),
  /** 立即更新提示词库（拉远程数据落缓存，返回 { ok, updated }） */
  updatePrompts: () => ipcRenderer.invoke('prompts:update'),
});
