'use strict';

/**
 * memory-project.js — 记忆管理窗口「项目记忆」Tab + Tab 切换（v1.2.1 T2）
 *
 * 职责：
 *  - Tab 切换（全局记忆 / 项目记忆）：只控制 #panel-global / #panel-project 显隐，
 *    不触碰 global-memory.js 的任何逻辑（Tab 1 零回归）。
 *  - 项目记忆：当前工作区显示 + 区块编辑器（head + ## 区块）+ 项目列表切换 +
 *    新建（手动输入路径）+ 删除 + 打开目录。
 *
 * 依赖（preload）：dshDesktop.getProjectMemory / readProjectMemory /
 *   saveProjectMemory / deleteProjectMemory / openProjectMemoryFolder。
 * 说明（来自方案）：全局记忆用于所有对话，项目记忆仅当前项目生效（<工作区>/AGENTS.md，
 *   DSH 启动自动读取，壳体只做编辑界面）。
 */

(function () {
  // ── Tab 切换 ──
  const tabGlobal = document.getElementById('tab-global');
  const tabProject = document.getElementById('tab-project');
  const panelGlobal = document.getElementById('panel-global');
  const panelProject = document.getElementById('panel-project');

  function showTab(name) {
    const isGlobal = name === 'global';
    panelGlobal.hidden = !isGlobal;
    panelProject.hidden = isGlobal;
    tabGlobal.classList.toggle('active', isGlobal);
    tabProject.classList.toggle('active', !isGlobal);
    if (!isGlobal) pm.load();
  }
  if (tabGlobal && tabProject) {
    tabGlobal.addEventListener('click', () => showTab('global'));
    tabProject.addEventListener('click', () => showTab('project'));
  }

  const $ = (id) => document.getElementById(id);

  // ── 项目记忆编辑状态 ──
  const pm = {
    current: null, // 当前编辑的项目路径
    data: null,    // data() 结果（含 workspace / projects）
    warning: false,

    async load() {
      try {
        const d = await window.dshDesktop.getProjectMemory();
        this.data = d;
        this.renderWorkspace(d);
        this.renderList(d.projects || []);
        if (d.workspace) {
          this.switchTo(d.workspace);
        } else {
          // 未定位工作区 → 引导 + 手动输入兜底
          $('pm-main').style.display = 'none';
          $('pm-guide').hidden = false;
          $('pm-guide').innerHTML =
            '请先在 DSH 中选择工作区，再回来编辑项目记忆。也可以<b>手动输入项目路径</b>：' +
            '<div style="display:flex;gap:8px;margin-top:8px;">' +
            '<input id="pm-manual-path" placeholder="例如 D:\\code\\myapp" style="flex:1;padding:8px 10px;background:var(--bg-input);border:1px solid var(--border-standard);border-radius:8px;color:var(--text-primary);font-size:12.5px;outline:none;">' +
            '<button id="pm-manual-go" class="btn" style="padding:8px 16px;">打开该项目</button></div>';
          $('pm-manual-go').addEventListener('click', async () => {
            const p = $('pm-manual-path').value.trim();
            if (!p) return;
            const r = await window.dshDesktop.readProjectMemory(p);
            if (r && r.ok) {
              $('pm-guide').hidden = true;
              $('pm-main').style.display = 'flex';
              this.current = r.workspace;
              this.fillEditor(r);
              this.renderList(this.data.projects || []);
            } else {
              $('pm-guide').innerHTML = '<span style="color:#e5484d;">路径无效：必须是已存在的目录。</span>';
            }
          });
        }
      } catch (e) {
        console.warn('[project-memory] load 失败：', e);
      }
    },

    renderWorkspace(d) {
      const row = $('pm-ws-row');
      if (d.workspace) {
        row.innerHTML = `<span>当前项目：</span><code>${escapeHtml(d.workspace)}</code>`;
      } else {
        row.innerHTML = '<span>当前项目：<b>未定位（请先在 DSH 中选择工作区）</b></span>';
      }
    },

    renderList(projects) {
      const list = $('pm-list');
      if (!projects || projects.length === 0) {
        list.innerHTML = '<div class="pm-empty">还没有编辑过项目记忆</div>';
        return;
      }
      list.innerHTML = '';
      projects.forEach((p) => {
        const item = document.createElement('div');
        item.className = 'pm-item' + (this.current === p.path ? ' active' : '');
        item.innerHTML =
          `<span class="pm-item-name">${escapeHtml(p.name || p.path)}</span>` +
          (p.lastEdited ? `<span class="pm-item-date">${escapeHtml(p.lastEdited)}</span>` : '');
        item.addEventListener('click', () => this.switchTo(p.path));
        list.appendChild(item);
      });
    },

    async switchTo(path) {
      const r = await window.dshDesktop.readProjectMemory(path);
      if (!r || !r.ok) {
        if (this.warning) return;
        this._warn('项目记忆读取失败：' + ((r && r.message) || '路径无效'));
        return;
      }
      this.warning = false;
      this.current = r.workspace;
      $('pm-guide').hidden = true;
      $('pm-main').style.display = 'flex';
      this.fillEditor(r);
      this.renderList(this.data.projects || []);
    },

    _warn(msg) {
      this.warning = true;
      $('pm-guide').hidden = false;
      $('pm-guide').textContent = '⚠️ ' + msg;
    },

    fillEditor(r) {
      this._existingPath = r.path || '';
      $('pm-current-path').textContent = r.workspace || '';
      const head = $('pm-head');
      head.value = r.head || '';
      const sections = $('pm-sections');
      sections.innerHTML = '';
      const secs = (r.sections || []).slice();
      if (secs.length === 0) {
        $('pm-empty').hidden = false;
      } else {
        $('pm-empty').hidden = true;
        secs.forEach((s) => this._addSec(s.title, (s.body || []).join('\n')));
      }
    },

    _addSec(title, body) {
      const sections = $('pm-sections');
      const wrap = document.createElement('div');
      wrap.className = 'pm-sec';
      wrap.innerHTML =
        '<div class="pm-sec-head">' +
        '<span class="hash">##</span>' +
        '<input class="pm-sec-title" value="' + escAttr(title || '') + '" placeholder="区块标题（如 项目背景）">' +
        '<button class="del" title="删除该区块">×</button></div>' +
        '<textarea class="pm-sec-body" placeholder="区块内容…">' + escText(body || '') + '</textarea>';
      wrap.querySelector('.del').addEventListener('click', () => wrap.remove());
      sections.appendChild(wrap);
      $('pm-empty').hidden = true;
    },

    collect() {
      const sections = [];
      document.querySelectorAll('#pm-sections .pm-sec').forEach((el) => {
        const title = el.querySelector('.pm-sec-title').value.trim();
        const body = el.querySelector('.pm-sec-body').value.replace(/\r?\n/g, '\n');
        if (title) sections.push({ title, body });
      });
      return { head: $('pm-head').value, sections };
    },
  };

  // ── 项目记忆：新建 / 添加区块 / 保存 / 删除 / 打开目录 ──
  const newRow = $('pm-new-row');
  $('pm-new').addEventListener('click', () => {
    newRow.style.display = 'flex';
    $('pm-new-path').focus();
  });
  $('pm-new-cancel').addEventListener('click', () => { newRow.style.display = 'none'; $('pm-new-path').value = ''; });
  async function openByPath(p) {
    if (!p) return;
    const r = await window.dshDesktop.readProjectMemory(p);
    if (r && r.ok) {
      pm.current = r.workspace;
      $('pm-guide').hidden = true;
      $('pm-main').style.display = 'flex';
      pm.fillEditor(r);
      pm.renderList((pm.data.projects || []).concat([{ path: r.workspace, name: basename(r.workspace) }]));
    } else {
      alert('路径无效：必须是已存在的目录。');
    }
  }
  $('pm-new-go').addEventListener('click', async () => {
    const p = $('pm-new-path').value.trim();
    await openByPath(p);
    if (pm.current) { newRow.style.display = 'none'; }
  });
  $('pm-new-path').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pm-new-go').click(); });

  $('pm-add-sec').addEventListener('click', () => pm._addSec('', ''));

  $('pm-save').addEventListener('click', async () => {
    if (!pm.current) { alert('请先选择/输入项目路径'); return; }
    const { head, sections } = pm.collect();
    // 重组全文：head + ## 区块（对齐 project-memory.renderProjectMemory）
    const blocks = [];
    if (head.trim()) blocks.push(head.trim());
    sections.forEach((s) => {
      const b = (s.body || '').replace(/^\s*\n+|\s+$/g, '');
      blocks.push('## ' + s.title + (b ? '\n\n' + b : ''));
    });
    const content = blocks.join('\n\n') + (blocks.length ? '\n' : '');
    const r = await window.dshDesktop.saveProjectMemory(pm.current, content);
    if (r && r.ok) {
      showBanner('项目记忆已保存 ✓', true);
      const d = await window.dshDesktop.getProjectMemory(); // 刷新索引/列表
      pm.data = d;
      pm.renderList(d.projects || []);
    } else {
      showBanner('保存失败：' + ((r && r.message) || '未知错误'), false);
    }
  });

  $('pm-delete').addEventListener('click', async () => {
    if (!pm.current) return;
    if (!confirm('确定删除该项目记忆（' + pm.current + '/AGENTS.md）？此操作不可恢复。')) return;
    const r = await window.dshDesktop.deleteProjectMemory(pm.current);
    if (r && r.ok) {
      showBanner('项目记忆已删除 ✓', true);
      const d = await window.dshDesktop.getProjectMemory();
      pm.data = d;
      pm.renderList(d.projects || []);
      if (d.workspace) pm.switchTo(d.workspace);
      else { $('pm-main').style.display = 'none'; $('pm-guide').hidden = true; pm._warn('项目记忆已删除，请选择/输入项目'); }
    } else {
      showBanner('删除失败：' + ((r && r.message) || '未知错误'), false);
    }
  });

  $('pm-open-folder').addEventListener('click', async () => {
    if (pm.current) await window.dshDesktop.openProjectMemoryFolder(pm.current);
  });

  // ── 工具 ──
  let bannerTimer = null;
  function showBanner(text, ok) {
    const b = $('pm-banner');
    if (!b) return;
    b.textContent = text;
    b.className = 'banner show ' + (ok ? 'ok' : 'fail');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { b.className = 'banner'; }, 2600);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escText(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function basename(p) {
    try { const parts = String(p).split(/[\\/]/).filter(Boolean); return parts[parts.length - 1] || p; }
    catch { return p; }
  }
})();
