'use strict';

/**
 * skill-library.js — 技能库窗口脚本（v1.2.1 T5）
 *
 * 三块（Tab）：
 *  - 📦 已装技能：扫描 DSH 技能目录（用户级 + 项目级），查看详情（frontmatter+正文），删除
 *  - ✏️ 自建技能：结构化表单（名称/描述/触发时机/正文）→ 自动生成 SKILL.md frontmatter；列表编辑/删除
 *  - 🌐 技能市场：我们维护的 skills-list.json（分类 + 搜索 + 安装）；安全提示常驻
 *
 * 安全：所有用户数据插值经 escapeHtml 防 XSS；技能名 kebab-case 前端预检（主进程仍校验）。
 */

(function () {
  const $ = (id) => document.getElementById(id);
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  const tabs = document.querySelectorAll('.tabs .tab');
  const panels = {
    installed: $('panel-installed'),
    create: $('panel-create'),
    market: $('panel-market'),
  };
  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      const name = t.dataset.tab;
      tabs.forEach((x) => x.classList.toggle('active', x === t));
      Object.keys(panels).forEach((k) => { panels[k].hidden = k !== name; });
      if (name === 'installed') loadInstalled();
      if (name === 'create') loadCreate();
      if (name === 'market') loadMarket();
    });
  });

  let bannerTimer = null;
  function showBanner(elId, text, ok) {
    const b = $(elId);
    if (!b) return;
    b.textContent = text;
    b.className = 'banner show ' + (ok ? 'ok' : 'fail');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { b.className = 'banner'; }, 2600);
  }

  // ── 已装技能 ──
  let installedCache = [];
  let detailOpen = null;
  async function loadInstalled() {
    try {
      installedCache = await window.dshDesktop.listInstalledSkills();
      renderInstalled(installedCache);
    } catch (e) { showBanner('inst-banner', '加载已装技能失败：' + e.message, false); }
  }
  function renderInstalled(list) {
    const box = $('inst-list');
    if (!list || list.length === 0) { box.innerHTML = '<div class="empty">还没有技能 —— 到「自建技能」创建一个，或到「技能市场」安装</div>'; return; }
    box.innerHTML = '';
    list.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'skill-card';
      const detailHtml = detailOpen === s.name
        ? '<pre class="skill-card-detail" style="white-space:pre-wrap;font:11.5px/1.6 Consolas,\'Courier New\',\'Microsoft YaHei\',monospace;color:var(--text-secondary);background:var(--bg-hover);border-radius:8px;padding:8px 10px;margin:0;max-height:280px;overflow:auto;"></pre>'
        : '';
      card.innerHTML =
        '<div class="skill-card-head"><span class="skill-card-name">' + escapeHtml(s.name) + '</span>' +
        '<span class="tag">' + (s.level === 'project' ? '项目级' : '用户级') + '</span></div>' +
        '<div class="skill-card-desc">' + (escapeHtml(s.desc || '（无描述）')) + '</div>' +
        '<div class="skill-card-actions">' +
        '<button class="btn sm ghost act-detail">' + (detailOpen === s.name ? '收起详情' : '查看详情') + '</button>' +
        '<button class="btn sm ghost act-del" style="color:#e5484d;">删除</button></div>' + detailHtml;
      card.querySelector('.act-detail').addEventListener('click', async () => {
        if (detailOpen === s.name) { detailOpen = null; }
        else {
          detailOpen = s.name;
          const r = await window.dshDesktop.readSkill(s.name);
          if (r && r.ok) {
            // 加载正文后填入 pre
            setTimeout(() => {
              const pre = card.querySelector('.skill-card-detail');
              if (pre && r.content) pre.textContent = r.content;
            }, 30);
          }
        }
        renderInstalled(installedCache.slice());
      });
      card.querySelector('.act-del').addEventListener('click', async () => {
        if (!confirm('确定删除技能「' + s.name + '」？')) return;
        const r = await window.dshDesktop.deleteSkill(s.name);
        if (r && r.ok) { showBanner('inst-banner', '技能已删除 ✓', true); loadInstalled(); }
        else showBanner('inst-banner', '删除失败：' + ((r && r.message) || '未知'), false);
      });
      box.appendChild(card);
    });
  }

  // ── 自建技能 ──
  let createList = [];
  let editingName = null;
  async function loadCreate() {
    try {
      const all = await window.dshDesktop.listInstalledSkills();
      createList = all.filter((s) => s.level === 'user'); // 自建 = 用户级
      renderCreateList();
      if (editingName && createList.some((s) => s.name === editingName)) {
        // 保持当前编辑
      } else if (createList.length > 0) {
        selectCreate(createList[0].name);
      } else {
        editingName = null; resetForm();
      }
    } catch (e) { showBanner('create-banner', '加载失败：' + e.message, false); }
  }
  function renderCreateList() {
    const box = $('create-items');
    if (!createList.length) { box.innerHTML = '<div class="empty">还没有自建技能</div>'; return; }
    box.innerHTML = '';
    createList.forEach((s) => {
      const item = document.createElement('div');
      item.className = 'create-item' + (editingName === s.name ? ' active' : '');
      item.innerHTML = '<span class="create-item-name">' + escapeHtml(s.name) + '</span><button class="del" title="删除">×</button>';
      item.addEventListener('click', () => selectCreate(s.name));
      item.querySelector('.del').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('确定删除技能「' + s.name + '」？')) return;
        const r = await window.dshDesktop.deleteSkill(s.name);
        if (r && r.ok) { showBanner('create-banner', '技能已删除 ✓', true); editingName = null; loadCreate(); }
        else showBanner('create-banner', '删除失败', false);
      });
      box.appendChild(item);
    });
  }
  async function selectCreate(name) {
    editingName = name;
    const r = await window.dshDesktop.readSkill(name);
    if (r && r.ok) {
      const fm = parseFmLine(r.content);
      $('form-name').value = name;
      $('form-desc').value = fm.description || '';
      $('form-when').value = fm.whenToUse || '';
      // 正文 = 去掉 frontmatter
      $('form-body').value = stripFm(r.content);
    }
    renderCreateList();
  }
  function resetForm() {
    $('form-name').value = ''; $('form-desc').value = ''; $('form-when').value = ''; $('form-body').value = '';
  }
  function parseFmLine(content) {
    const m = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(String(content));
    const out = {};
    if (m) {
      m[1].split(/\r?\n/).forEach((l) => {
        const kv = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(l);
        if (kv) out[kv[1]] = kv[2].trim();
        else if (l.trim() && Object.keys(out).length) {
          const lastKey = Object.keys(out).pop();
          out[lastKey] += '\n' + l.trim();
        }
      });
    }
    return out;
  }
  function stripFm(content) {
    return String(content).replace(/^\s*---\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/, '').replace(/^\s*\n+|\s+$/g, '');
  }
  $('create-new').addEventListener('click', () => {
    editingName = null; resetForm();
    renderCreateList();
    $('form-name').focus();
  });
  $('form-save').addEventListener('click', async () => {
    const name = $('form-name').value.trim();
    const desc = $('form-desc').value.trim();
    const when = $('form-when').value.trim();
    const body = $('form-body').value;
    if (!name) { showBanner('create-banner', '请填写技能名称', false); return; }
    if (!/^[a-z0-9-]+$/.test(name)) { showBanner('create-banner', '技能名称必须是小写 kebab-case（a-z、数字、连字符）', false); return; }
    if (!body.trim()) { showBanner('create-banner', '技能正文不能为空', false); return; }
    const r = await window.dshDesktop.saveSkill({ name, description: desc, whenToUse: when, body });
    if (r && r.ok) { showBanner('create-banner', '技能已保存 ✓', true); editingName = name; loadCreate(); }
    else showBanner('create-banner', '保存失败：' + ((r && r.message) || '未知'), false);
  });

  // ── 技能市场 ──
  let marketCache = [];
  let marketCat = 'all';
  let marketCateSet = [];
  async function loadMarket() {
    try {
      marketCache = await window.dshDesktop.getSkillMarket();
      buildMarketCats();
      renderMarket();
    } catch (e) { showBanner('market-banner', '加载技能市场失败：' + e.message, false); }
  }
  function buildMarketCats() {
    const cats = new Set();
    marketCache.forEach((s) => cats.add(s.category || '其他'));
    marketCateSet = ['all', ...Array.from(cats)];
    const box = $('market-cats');
    box.innerHTML = '';
    marketCateSet.forEach((c) => {
      const chip = document.createElement('button');
      chip.className = 'cat-chip' + (marketCat === c ? ' active' : '');
      chip.textContent = c === 'all' ? '全部' : c;
      chip.addEventListener('click', () => { marketCat = c; renderMarket(); });
      box.appendChild(chip);
    });
  }
  function renderMarket() {
    const box = $('market-list');
    const q = ($('market-search').value || '').toLowerCase();
    if (!marketCache.length) { box.innerHTML = '<div class="empty">技能市场为空（可能网络拉取失败，点「刷新」重试）</div>'; return; }
    const shown = marketCache.filter((s) =>
      (marketCat === 'all' || s.category === marketCat) &&
      (!q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)));
    if (!shown.length) { box.innerHTML = '<div class="empty">没有匹配的技能</div>'; return; }
    box.innerHTML = '';
    shown.forEach((s) => {
      const card = document.createElement('div');
      card.className = 'skill-card';
      const reqHtml = s.installReq
        ? '<div class="skill-card-req"><span class="req-label">安装要求</span>' + escapeHtml(s.installReq) + '</div>'
        : '<div class="skill-card-req"><span class="req-label">安装要求</span>自包含纯文本，安装后直接可用</div>';
      card.innerHTML =
        '<div class="skill-card-head"><span class="skill-card-name">' + escapeHtml(s.name) + '</span>' +
        '<span class="tag">' + escapeHtml(s.category || '其他') + '</span></div>' +
        '<div class="skill-card-desc">' + escapeHtml(s.description || '') + '</div>' +
        reqHtml +
        '<div class="skill-card-actions"><button class="btn sm act-install">安装</button>' +
        '<button class="btn sm ghost act-copy-req">复制安装指令</button>' +
        '<button class="btn sm ghost act-src">查看来源</button></div>';
      card.querySelector('.act-install').addEventListener('click', async () => {
        if (!confirm('确定安装技能「' + s.name + '」？\n\n技能内容会注入模型上下文，请确认来源可信。\n\n安装要求：' + (s.installReq || '自包含纯文本'))) return;
        const r = await window.dshDesktop.installSkill({ name: s.name, repo: s.repo, file: s.file });
        if (r && r.ok) { showBanner('market-banner', '技能「' + s.name + '」安装成功 ✓（可在已装技能中查看）', true); }
        else showBanner('market-banner', '安装失败：' + ((r && r.message) || '未知'), false);
      });
      card.querySelector('.act-copy-req').addEventListener('click', () => {
        // 复制安装指令：来源仓库 + 安装要求 + 指引（简单可复制）
        const txt =
          '技能：' + s.name + '\n' +
          '来源：' + s.repo + ' @ ' + s.file + '\n' +
          '安装要求：' + (s.installReq || '自包含纯文本') + '\n' +
          '安装方式：技能库窗口 → 技能市场 → 点「安装」（安装器拉取 SKILL.md 写入本地）';
        if (window.dshDesktop.copyText) {
          window.dshDesktop.copyText(txt).then((r) => showBanner('market-banner', r && r.ok ? '安装指令已复制 ✓' : '复制失败', !!r && r.ok));
        } else {
          showBanner('market-banner', '当前环境不支持复制', false);
        }
      });
      card.querySelector('.act-src').addEventListener('click', () => {
        if (s.repo) window.dshDesktop.openExternal('https://github.com/' + s.repo);
      });
      box.appendChild(card);
    });
  }
  $('market-search').addEventListener('input', renderMarket);
  $('market-refresh').addEventListener('click', async () => {
    showBanner('market-banner', '正在刷新技能市场…', true);
    marketCache = await window.dshDesktop.refreshSkillMarket();
    buildMarketCats();
    renderMarket();
    showBanner('market-banner', '技能市场已刷新 ✓', true);
  });

  loadInstalled(); // 默认打开已装技能
})();
