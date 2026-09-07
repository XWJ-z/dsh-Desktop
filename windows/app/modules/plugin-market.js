'use strict';

/**
 * DSH-Desktop — 插件市场模块（v2.0.5 重构：列表数据完全走 DSH 服务器，安装包零内置）
 *
 * 职责：提供插件浏览、分类查找、搜索、安装引导：
 *  - 数据源：DSH 服务器 /api/plugins（plugins-updater.js 版本检测 + 数据下载 + 本地缓存）
 *  - 无缓存（首装）自动从服务器下载；下载过一次后本地缓存可离线用
 *  - 安全提示：顶部红色醒目常驻
 *  - 安装引导：复制安装命令（免责确认）/ 查看 GitHub
 *
 * 依赖注入（deps）：
 *  - app / fs / path
 *  - shell / clipboard
 *  - appendLog
 *  - isAllowedExternalUrl   external-links 模块（URL 白名单校验）
 *  - pluginsUpdater         插件库服务器更新模块（getData / downloadData）
 */

// 官方分类（README「## Plugin Categories」18 类 + 兜底其他）；match 用于标题匹配
const PLUGIN_CATEGORIES = [
  { id: 'ui-enhance', name: 'UI增强', match: 'ui enhancements' },
  { id: 'usage-billing', name: '用量与计费', match: 'usage & billing' },
  { id: 'theme', name: '主题外观', match: 'themes & appearance' },
  { id: 'model', name: '模型提供方', match: 'models & providers' },
  { id: 'session', name: '会话与消息', match: 'sessions & messages' },
  { id: 'memory', name: '记忆', match: 'memory' },
  { id: 'tool', name: '工具能力', match: 'tools & capabilities' },
  { id: 'visual', name: '视觉多模态', match: 'vision & multimodal' },
  { id: 'skills', name: 'Skills', match: 'skills' },
  { id: 'workflow', name: '工作流自动化', match: 'workflow & automation' },
  { id: 'notifications', name: '通知与集成', match: 'notifications & integrations' },
  { id: 'git', name: 'Git与工程', match: 'git & engineering' },
  { id: 'security', name: '安全与治理', match: 'security & governance' },
  { id: 'output', name: '输出与交付', match: 'output & deliverables' },
  { id: 'domain', name: '领域专家', match: 'domain & specialist' },
  { id: 'dev-tools', name: '开发与运行时', match: 'development & runtime' },
  { id: 'market', name: '插件市场', match: 'plugin markets & managers' },
  { id: 'fun', name: '娱乐', match: 'just for fun' },
  { id: 'other', name: '其他', match: '' },
];

function createPluginMarket(deps) {
  const { shell, clipboard, appendLog, isAllowedExternalUrl, pluginsUpdater } = deps;

  /**
   * 确保已下载插件数据：无缓存（首装）时自动从服务器下载一次；失败返回 `[]`。
   * @returns {Promise<Array>} 插件数组
   */
  async function ensureData() {
    const g = pluginsUpdater.getData();
    if (!g.needsDownload) return g.data;
    appendLog('info', '插件库无缓存，自动从服务器下载…');
    const r = await pluginsUpdater.downloadData();
    if (!r.ok) {
      appendLog('warn', '插件库自动下载失败，请检查网络后点刷新重试');
      return [];
    }
    return pluginsUpdater.getData().data;
  }

  /** 获取插件列表（优先缓存；无缓存自动下载） */
  async function getPlugins() {
    return await ensureData();
  }

  /** 搜索插件 */
  async function searchPlugins(query) {
    const plugins = await getPlugins();
    if (!query) return plugins;
    const lower = query.toLowerCase();
    return plugins.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(lower)) ||
        (p.description && p.description.toLowerCase().includes(lower)),
    );
  }

  /** 按分类筛选插件 */
  async function getPluginsByCategory(categoryId) {
    const plugins = await getPlugins();
    if (!categoryId || categoryId === 'all') return plugins;
    return plugins.filter((p) => p.category === categoryId);
  }

  /** 刷新插件列表（强制从服务器重新下载 + 落缓存） */
  async function refreshPlugins() {
    const r = await pluginsUpdater.downloadData();
    return !!(r && r.ok);
  }

  /** 复制安装命令到剪贴板 */
  function copyInstallCommand(command) {
    if (command) {
      clipboard.writeText(command);
      appendLog('info', `已复制安装命令：${command}`);
    }
  }

  /** 打开插件 GitHub 页面 */
  function openPluginRepo(repoUrl) {
    if (repoUrl && isAllowedExternalUrl(repoUrl)) {
      shell.openExternal(repoUrl);
      appendLog('info', `已打开插件仓库：${repoUrl}`);
    }
  }

  /** 打开官方插件社区列表（awesome-dsh-plugin，白名单 github.com） */
  function openOfficialMarket() {
    const url = 'https://github.com/Anil-matcha/awesome-dsh-plugin';
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
      appendLog('info', '已打开官方 awesome-dsh-plugin 列表');
    }
  }

  return {
    getPlugins,
    searchPlugins,
    getPluginsByCategory,
    refreshPlugins,
    copyInstallCommand,
    openPluginRepo,
    openOfficialMarket,
    getCategories: () => PLUGIN_CATEGORIES,
  };
}

module.exports = { createPluginMarket };
