/**
 * DSH-Desktop — 插件市场窗口（v1.1.1）
 * 经 preload（window.dshDesktop）：getPlugins/searchPlugins/getPluginsByCategory
 * copyPluginCommand/openPluginRepo —— 子窗口 sandbox+contextIsolation，禁用 require。
 */

const dsh = window.dshDesktop;
const el = (id) => document.getElementById(id);

let allPlugins = [];

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadCategories();
  await loadPlugins();

  // 搜索框回车 / 搜索按钮触发搜索
  el('searchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') searchPlugins();
  });
  el('searchBtn').addEventListener('click', () => searchPlugins());

  // v1.1.1 二轮（老大确认）：手动刷新 —— 绕过 7 天缓存，三源实时拉取并重载列表
  el('refreshBtn').addEventListener('click', async () => {
    const btn = el('refreshBtn');
    btn.disabled = true;
    showBanner('正在刷新插件列表…');
    try {
      const ok = await dsh.refreshPlugins();
      await loadPlugins(); // 刷新后重载（getPlugins 返回新缓存）
      showBanner(ok ? '已刷新，显示最新插件列表' : '刷新失败（网络不可用），显示缓存列表');
    } catch {
      await loadPlugins();
      showBanner('刷新失败，请检查网络后重试');
    } finally {
      btn.disabled = false;
    }
  });

  // v1.1.1：静态「全部」分类项绑定点击（HTML 预置项，loadCategories 只绑定动态项）
  const allCat = document.querySelector('.category-item[data-category="all"]');
  if (allCat) allCat.addEventListener('click', () => filterByCategory('all'));
});

// 加载分类列表（全部 + 18 官方分类 + 其他；v1.1.1 无表情图标）
async function loadCategories() {
  const categories = (await dsh.getPluginCategories()) || [];
  const list = el('categoryList');

  categories.forEach((cat) => {
    const li = document.createElement('li');
    li.className = 'category-item';
    li.dataset.category = cat.id;
    li.textContent = cat.name || cat.id;
    li.addEventListener('click', () => filterByCategory(cat.id));
    list.appendChild(li);
  });
}

// 加载全部插件
async function loadPlugins() {
  const container = el('pluginContainer');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    allPlugins = await dsh.getPlugins();
    renderPlugins(allPlugins);
  } catch {
    container.innerHTML = '<div class="empty-state">加载失败，请重试</div>';
  }
}

// 渲染插件卡片
function renderPlugins(plugins) {
  const container = el('pluginContainer');

  if (!plugins || plugins.length === 0) {
    container.innerHTML = '<div class="empty-state">暂无插件（网络不可用或列表为空）</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'plugin-grid';

  plugins.forEach((plugin) => {
    const card = document.createElement('div');
    card.className = 'plugin-card';

    const nameEl = document.createElement('div');
    nameEl.className = 'plugin-name';
    nameEl.textContent = plugin.name || '未知插件';

    const catEl = document.createElement('div');
    catEl.className = 'plugin-category';
    catEl.textContent = getCategoryName(plugin.category);

    const descEl = document.createElement('div');
    descEl.className = 'plugin-description';
    // v1.1.1：中文描述优先，无则回退英文
    descEl.textContent = plugin.descriptionZh || plugin.description || '';

    const actions = document.createElement('div');
    actions.className = 'plugin-actions';

    if (plugin.repoUrl) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.textContent = '查看 GitHub';
      btn.addEventListener('click', () => dsh.openPluginRepo(plugin.repoUrl));
      actions.appendChild(btn);
    }

    // 复制安装命令：优先完整命令（command），无则用 installCmd（仓库名）
    const installTarget = plugin.command || plugin.installCmd;
    if (installTarget) {
      const btn2 = document.createElement('button');
      btn2.className = 'btn btn-secondary';
      btn2.textContent = '复制安装命令';
      // v1.1.1（老大指令）：先弹免责声明确认，确认后才复制
      btn2.addEventListener('click', () => showConfirmModal(installTarget));
      actions.appendChild(btn2);
    }

    card.appendChild(nameEl);
    card.appendChild(catEl);
    card.appendChild(descEl);
    card.appendChild(actions);
    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

// 搜索插件
async function searchPlugins() {
  const query = el('searchInput').value.trim();
  const container = el('pluginContainer');
  container.innerHTML = '<div class="loading">搜索中...</div>';

  try {
    const plugins = await dsh.searchPlugins(query);
    renderPlugins(plugins);
  } catch {
    container.innerHTML = '<div class="empty-state">搜索失败，请重试</div>';
  }
}

// 按分类筛选
async function filterByCategory(categoryId) {
  document.querySelectorAll('.category-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.category === categoryId);
  });

  const container = el('pluginContainer');
  container.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const plugins = await dsh.getPluginsByCategory(categoryId);
    renderPlugins(plugins);
  } catch {
    container.innerHTML = '<div class="empty-state">加载失败，请重试</div>';
  }
}

// 顶部反馈横幅
let bannerTimer = null;
function showBanner(text) {
  const b = el('banner');
  b.textContent = text;
  b.style.display = 'block';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => {
    b.style.display = 'none';
  }, 1800);
}

// ── v1.1.1：免责声明确认模态框（复制安装命令前必须确认）──
let pendingInstallCmd = null;

function showConfirmModal(cmd) {
  pendingInstallCmd = cmd;
  el('confirm-cmd').textContent = cmd;
  el('confirm-modal').style.display = 'flex';
}

function closeConfirmModal() {
  el('confirm-modal').style.display = 'none';
  pendingInstallCmd = null;
}

el('confirm-ok').addEventListener('click', async () => {
  if (pendingInstallCmd) {
    await dsh.copyPluginCommand(pendingInstallCmd);
    showBanner('安装命令已复制，请在 DSH 中执行');
  }
  closeConfirmModal();
});

el('confirm-cancel').addEventListener('click', closeConfirmModal);

// 获取分类名称（与主进程 PLUGIN_CATEGORIES 一致）
function getCategoryName(categoryId) {
  const map = {
    'ui-enhance': 'UI增强',
    'usage-billing': '用量与计费',
    theme: '主题外观',
    model: '模型提供方',
    session: '会话与消息',
    memory: '记忆',
    tool: '工具能力',
    visual: '视觉多模态',
    skills: 'Skills',
    workflow: '工作流自动化',
    notifications: '通知与集成',
    git: 'Git与工程',
    security: '安全与治理',
    output: '输出与交付',
    domain: '领域专家',
    'dev-tools': '开发与运行时',
    market: '插件市场',
    fun: '娱乐',
    other: '其他',
  };
  return map[categoryId] || '其他';
}
