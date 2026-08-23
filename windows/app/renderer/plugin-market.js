/**
 * DSH-Desktop — 插件库窗口脚本（v1.2.6）
 * 经 preload（window.dshDesktop）：
 *   市场：getPlugins/searchPlugins/getPluginsByCategory/copyPluginCommand/openPluginRepo/refreshPlugins/getPluginCategories
 *   已装：getInstalledPlugins
 *   自建：listBuiltPlugins/saveBuiltPlugin/deleteBuiltPlugin
 * 子窗口 sandbox+contextIsolation，禁用 require。
 */

const dsh = window.dshDesktop;
const el = (id) => document.getElementById(id);
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

let allPlugins = [];

// ── 三块 Tab 切换 ──
const tabs = document.querySelectorAll('.tabs .tab');
const panels = { installed: el('panel-installed'), create: el('panel-create'), market: el('panel-market') };
let marketLoaded = false;
tabs.forEach((t) => {
  t.addEventListener('click', () => {
    const name = t.dataset.tab;
    tabs.forEach((x) => x.classList.toggle('active', x === t));
    Object.keys(panels).forEach((k) => { panels[k].hidden = k !== name; });
    if (name === 'installed') loadInstalled();
    else if (name === 'create') loadCreate();
    else if (name === 'market') {
      if (!marketLoaded) { marketLoaded = true; loadCategories(); loadPlugins(); }
    }
  });
});

// 反馈横幅（banner2）
let banner2Timer = null;
function notify(elId, text, ok) {
  const b = el(elId);
  if (!b) return;
  b.textContent = text;
  b.className = 'banner2 show ' + (ok ? 'ok' : 'fail');
  clearTimeout(banner2Timer);
  banner2Timer = setTimeout(() => { b.className = 'banner2'; }, 2600);
}

// ── 📦 已装插件（dsh plugin list）──
async function loadInstalled() {
  const box = el('inst-list');
  box.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const r = await dsh.getInstalledPlugins();
    if (!r || !r.ok) {
      box.innerHTML = '<div class="empty">' + escapeHtml((r && r.message) || '无法枚举已装插件') + '<br><span style="font-size:11px;color:var(--text-quaternary)">（需 DSH 运行时就绪；若提示需 pnpm，请安装 pnpm 或用 corepack）</span></div>';
      return;
    }
    const list = r.plugins || [];
    if (!list.length) { box.innerHTML = '<div class="empty">还没有已安装的插件 —— 到「插件市场」复制安装命令，或到「自建插件」记录</div>'; return; }
    box.innerHTML = '';
    list.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'plug-card';
      const cmd = 'dsh plugin --profile web add ' + escapeHtml(p.name);
      card.innerHTML =
        '<div class="plug-card-head"><span class="plug-card-name">' + escapeHtml(p.name) + '</span><span class="tag">已安装</span></div>' +
        '<div class="plug-card-actions"><button class="btn sm ghost act-copy">复制安装命令</button></div>';
      card.querySelector('.act-copy').addEventListener('click', () => {
        dsh.copyPluginCommand('dsh plugin --profile web add ' + p.name).then((ok) => notify('inst-banner', ok ? '安装命令已复制 ✓' : '复制失败', !!ok));
      });
      box.appendChild(card);
    });
  } catch (e) {
    box.innerHTML = '<div class="empty">加载已装插件失败：' + escapeHtml(e.message || String(e)) + '</div>';
  }
}
el('inst-refresh').addEventListener('click', () => {
  notify('inst-banner', '正在枚举已装插件…', true);
  loadInstalled();
});

// ── ✏️ 自建插件（纯文本封装）──
let builtList = [];
let editingBuilt = null;
async function loadCreate() {
  try {
    builtList = await dsh.listBuiltPlugins();
  } catch {
    builtList = [];
  }
  renderCreateList();
  if (editingBuilt && builtList.some((b) => b.name === editingBuilt)) {
    // 保持当前编辑
  } else if (builtList.length > 0) {
    selectCreate(builtList[0].name);
  } else {
    editingBuilt = null; resetForm();
  }
}
function renderCreateList() {
  const box = el('create-items');
  if (!builtList.length) { box.innerHTML = '<div class="empty">还没有自建插件</div>'; return; }
  box.innerHTML = '';
  builtList.forEach((b) => {
    const item = document.createElement('div');
    item.className = 'create-item' + (editingBuilt === b.name ? ' active' : '');
    item.innerHTML = '<span class="create-item-name">' + escapeHtml(b.name) + '</span><button class="del" title="删除">×</button>';
    item.addEventListener('click', () => selectCreate(b.name));
    item.querySelector('.del').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm('确定删除自建插件「' + b.name + '」？')) return;
      const r = await dsh.deleteBuiltPlugin(b.name);
      if (r && r.ok) { notify('create-banner', '插件已删除 ✓', true); editingBuilt = null; loadCreate(); }
      else notify('create-banner', '删除失败', false);
    });
    box.appendChild(item);
  });
}
function selectCreate(name) {
  editingBuilt = name;
  const b = builtList.find((x) => x.name === name);
  if (b) {
    el('form-name').value = b.name;
    el('form-desc').value = b.description || '';
    el('form-command').value = b.command || '';
    el('form-hint').value = b.hint || '';
  }
  renderCreateList();
}
function resetForm() {
  el('form-name').value = ''; el('form-desc').value = ''; el('form-command').value = ''; el('form-hint').value = '';
}
el('create-new').addEventListener('click', () => { editingBuilt = null; resetForm(); renderCreateList(); el('form-name').focus(); });
el('form-save').addEventListener('click', async () => {
  const name = el('form-name').value.trim();
  if (!name) { notify('create-banner', '请填写插件名称', false); return; }
  try {
    const r = await dsh.saveBuiltPlugin({
      name,
      description: el('form-desc').value.trim(),
      command: el('form-command').value.trim(),
      hint: el('form-hint').value.trim(),
    });
    if (r && r.ok) { notify('create-banner', '插件已保存 ✓', true); editingBuilt = name; loadCreate(); }
    else notify('create-banner', '保存失败：' + ((r && r.message) || '未知'), false);
  } catch (e) {
    notify('create-banner', '保存失败（异常）：' + (e && e.message ? e.message : String(e)), false);
  }
});

// ── 🌐 插件市场（原功能保留）──
function loadCategories() {
  return dsh.getPluginCategories().then((categories) => {
    const list = el('categoryList');
    categories.forEach((cat) => {
      const li = document.createElement('li');
      li.className = 'category-item';
      li.dataset.category = cat.id;
      li.textContent = cat.name || cat.id;
      li.addEventListener('click', () => filterByCategory(cat.id));
      list.appendChild(li);
    });
  }).catch(() => {});
}
function loadPlugins() {
  const container = el('pluginContainer');
  container.innerHTML = '<div class="loading">加载中...</div>';
  return dsh.getPlugins()
    .then((plugins) => { allPlugins = plugins; renderPlugins(allPlugins); })
    .catch(() => { container.innerHTML = '<div class="empty-state">加载失败，请重试</div>'; });
}
function renderPlugins(plugins) {
  const container = el('pluginContainer');
  if (!plugins || plugins.length === 0) { container.innerHTML = '<div class="empty-state">暂无插件（网络不可用或列表为空）</div>'; return; }
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
    const installTarget = plugin.command || plugin.installCmd;
    if (installTarget) {
      const btn2 = document.createElement('button');
      btn2.className = 'btn btn-secondary';
      btn2.textContent = '复制安装命令';
      btn2.addEventListener('click', () => showConfirmModal(installTarget));
      actions.appendChild(btn2);
    }
    card.appendChild(nameEl); card.appendChild(catEl); card.appendChild(descEl); card.appendChild(actions);
    grid.appendChild(card);
  });
  container.innerHTML = '';
  container.appendChild(grid);
}
function searchPlugins() {
  const query = el('searchInput').value.trim();
  const container = el('pluginContainer');
  container.innerHTML = '<div class="loading">搜索中...</div>';
  dsh.searchPlugins(query)
    .then((plugins) => renderPlugins(plugins))
    .catch(() => { container.innerHTML = '<div class="empty-state">搜索失败，请重试</div>'; });
}
function filterByCategory(categoryId) {
  document.querySelectorAll('.category-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.category === categoryId);
  });
  const container = el('pluginContainer');
  container.innerHTML = '<div class="loading">加载中...</div>';
  dsh.getPluginsByCategory(categoryId)
    .then((plugins) => renderPlugins(plugins))
    .catch(() => { container.innerHTML = '<div class="empty-state">加载失败，请重试</div>'; });
}

// 顶部反馈横幅
let bannerTimer = null;
function showBanner(text) {
  const b = el('banner');
  b.textContent = text;
  b.style.display = 'block';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { b.style.display = 'none'; }, 1800);
}

// ── 免责声明确认模态框 ──
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

function getCategoryName(categoryId) {
  const map = {
    'ui-enhance': 'UI增强', 'usage-billing': '用量与计费', theme: '主题外观', model: '模型提供方',
    session: '会话与消息', memory: '记忆', tool: '工具能力', visual: '视觉多模态', skills: 'Skills',
    workflow: '工作流自动化', notifications: '通知与集成', git: 'Git与工程', security: '安全与治理',
    output: '输出与交付', domain: '领域专家', 'dev-tools': '开发与运行时', market: '插件市场', fun: '娱乐', other: '其他',
  };
  return map[categoryId] || '其他';
}

// ── 初始化 ──
document.addEventListener('DOMContentLoaded', () => {
  // 市场交互（搜索 / 刷新 / 静态「全部」分类）
  el('searchInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') searchPlugins(); });
  el('searchBtn').addEventListener('click', () => searchPlugins());
  el('refreshBtn').addEventListener('click', async () => {
    const btn = el('refreshBtn');
    btn.disabled = true;
    showBanner('正在刷新插件列表…');
    try {
      const ok = await dsh.refreshPlugins();
      await loadPlugins();
      showBanner(ok ? '已刷新，显示最新插件列表' : '刷新失败（网络不可用），显示缓存列表');
    } catch {
      await loadPlugins();
      showBanner('刷新失败，请检查网络后重试');
    } finally {
      btn.disabled = false;
    }
  });
  const allCat = document.querySelector('.category-item[data-category="all"]');
  if (allCat) allCat.addEventListener('click', () => filterByCategory('all'));
  loadInstalled(); // 默认打开「已装插件」
});
