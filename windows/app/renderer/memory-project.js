'use strict';

/**
 * memory-project.js — 记忆管理窗口「项目记忆」Tab + Tab 切换（v1.2.3 重构）
 *
 * 布局（对齐全局记忆「左导航 + 右编辑」的三栏）：
 *  - 左栏「项目列表」：列出所有候选工作区的项目记忆（DSH 工作区注册表 + 历史索引 + 当前工作区），
 *    带 是否有 AGENTS.md（exists）/ 是否当前工作区（current）标记；
 *  - 中栏「区块导航」：当前项目 AGENTS.md 的 ## 区块（含 ### 子区块缩进），可选中/新增/删除；
 *  - 右栏「内容编辑」：编辑选中区块/子区块的标题 + 内容（复用全局记忆 memo-* 样式）。
 *
 * 依赖（preload）：dshDesktop.getProjectMemory / readProjectMemory /
 *   saveProjectMemory / deleteProjectMemory / openProjectMemoryFolder。
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

  // ── 编号辅助（与全局记忆一致：新增区块/子区块自动编号）──
  const CN_NUMS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  function cnNum(n) {
    const x = Math.floor(Number(n) || 0);
    if (x <= 0) return String(x);
    if (x < 10) return CN_NUMS[x];
    const tens = Math.floor(x / 10);
    const ones = x % 10;
    if (x < 20) return '十' + (ones ? CN_NUMS[ones] : '');
    return CN_NUMS[tens] + '十' + (ones ? CN_NUMS[ones] : '');
  }
  function cnToNum(s) {
    const str = String(s || '').trim();
    if (!str) return null;
    if (str.length === 1) { const i = CN_NUMS.indexOf(str); return i >= 0 ? i : null; }
    if (str === '十') return 10;
    const shi = str.indexOf('十');
    if (shi === -1) return null;
    const tens = shi === 0 ? 1 : CN_NUMS.indexOf(str[shi - 1]);
    if (tens <= 0) return null;
    let val = tens * 10;
    const tail = str.slice(shi + 1);
    if (tail) { const o = CN_NUMS.indexOf(tail); if (o < 0) return null; val += o; }
    return val;
  }
  function numFromTitle(title) {
    const t = String(title || '').trim();
    const c = /^([零一二三四五六七八九十]+)/.exec(t);
    if (c) { const v = cnToNum(c[1]); if (v != null) return v; }
    const a = /^(\d+)/.exec(t);
    if (a) return parseInt(a[1], 10);
    return null;
  }
  function nextSubNum(subs) {
    let maxM = 0, sectionN = null;
    (Array.isArray(subs) ? subs : []).forEach((sb) => {
      const m = /^(\d+)[.、](\d+)\b/.exec(String(sb.title || '').trim());
      if (m) { const n = parseInt(m[1], 10); const mm = parseInt(m[2], 10); if (mm > maxM) { maxM = mm; sectionN = n; } }
    });
    return sectionN === null ? null : `${sectionN}.${maxM + 1}`;
  }

  // ── 项目记忆编辑状态 ──
  const pm = {
    current: null,           // 当前编辑的项目路径
    data: null,              // data() 结果（含 projects / workspace）
    head: '',                // 当前项目记忆的头部（第一个 ## 前）
    sections: [],            // 当前项目记忆 [{title, body, subs:[{title,body}]}]
    selectedSectionIndex: -1,
    selectedSubIndex: -1,
    warning: false,

    async load() {
      try {
        const d = await window.dshDesktop.getProjectMemory();
        this.data = d;
        this.renderList((d.projects || []));
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
              this.loadProject(r);
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

    renderList(projects) {
      const list = $('pm-list');
      if (!projects || projects.length === 0) {
        list.innerHTML = '<div class="pm-empty">还没找到工作区（请先在 DSH 中选择）</div>';
        return;
      }
      list.innerHTML = '';
      projects.forEach((p) => {
        const item = document.createElement('div');
        item.className = 'pm-item' + (this.current === p.path ? ' active' : '');
        const mark = p.current === true
          ? '<span class="pm-item-date" style="color:var(--brand);">当前</span>'
          : (p.exists === false ? '<span class="pm-item-date" style="color:#e5484d;">无记忆</span>' : '');
        item.innerHTML =
          `<span class="pm-item-name">${escapeHtml(p.name || p.path)}</span>` +
          mark +
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
      this.loadProject(r);
      this.renderList((this.data && this.data.projects) || []);
    },

    _warn(msg) {
      this.warning = true;
      $('pm-guide').hidden = false;
      $('pm-guide').textContent = '⚠️ ' + msg;
    },

    loadProject(r) {
      this._existingPath = r.path || '';
      this.head = r.head || '';
      $('pm-current-path').textContent = r.workspace || '';
      $('pm-head').value = this.head;
      this.sections = (r.sections || []).map((s) => ({
        title: s.title,
        body: (s.body || []).join('\n'),
        subs: (Array.isArray(s.subs) && s.subs.length)
          ? s.subs.map((sb) => ({ title: sb.title, body: (sb.body || []).join('\n') }))
          : [],
      }));
      if (this.sections.length === 0) this.selectedSectionIndex = -1;
      else if (this.selectedSectionIndex < 0 || this.selectedSectionIndex >= this.sections.length) this.selectedSectionIndex = 0;
      if (this.selectedSubIndex !== -1 && !((this.sections[this.selectedSectionIndex] || {}).subs || [])[this.selectedSubIndex]) this.selectedSubIndex = -1;
      this.renderNav();
    },

    // ── 中栏：区块导航（复用 memo-list / memo-item / memo-group / memo-sub 样式）──
    renderNav() {
      const nav = $('pm-nav');
      if (!nav) return;
      const hasSubs = (s) => Array.isArray(s.subs) && s.subs.length > 0;
      if (this.sections.length === 0) {
        nav.innerHTML = '<div class="sec-empty">还没有 ## 区块 —— 点下方「＋ 添加区块」新建</div>';
        this.renderEditor();
        return;
      }
      nav.innerHTML = this.sections.map((s, i) => {
        if (!hasSubs(s)) {
          return `<div class="memo-item${i === this.selectedSectionIndex && this.selectedSubIndex === -1 ? ' active' : ''}" data-i="${i}" title="点击编辑此区块">
            <span class="memo-item-icon">##</span>
            <span class="memo-item-name">${escapeHtml(s.title || '（未命名）')}</span>
            <button class="del" data-i="${i}" title="删除此区块">✕</button>
          </div>`;
        }
        const group = `<div class="memo-group${i === this.selectedSectionIndex && this.selectedSubIndex === -1 ? ' active' : ''}" data-i="${i}" title="点击编辑此区块标题/前言">
          <span class="memo-item-icon">##</span>
          <span class="memo-group-name">${escapeHtml(s.title || '（未命名）')}</span>
          <button class="del" data-i="${i}" title="删除此区块（含子区块）">✕</button>
        </div>`;
        const subs = s.subs.map((sb, j) => `
          <div class="memo-sub${i === this.selectedSectionIndex && this.selectedSubIndex === j ? ' active' : ''}" data-i="${i}" data-j="${j}" title="点击编辑此子区块">
            <span class="memo-item-icon memo-sub-icon">###</span>
            <span class="memo-sub-name">${escapeHtml(sb.title || '（未命名）')}</span>
            <button class="del" data-i="${i}" data-j="${j}" title="删除此子区块">✕</button>
          </div>`).join('');
        return group + subs;
      }).join('');
      nav.querySelectorAll('.memo-item, .memo-group').forEach((row) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.del')) return;
          this.selectedSectionIndex = Number(row.dataset.i);
          this.selectedSubIndex = -1;
          this.renderNav();
        });
      });
      nav.querySelectorAll('.memo-sub').forEach((row) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('.del')) return;
          this.selectedSectionIndex = Number(row.dataset.i);
          this.selectedSubIndex = Number(row.dataset.j);
          this.renderNav();
        });
      });
      nav.querySelectorAll('.memo-item .del, .memo-group .del').forEach((b) => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.sections.splice(Number(b.closest('[data-i]').dataset.i), 1);
          this.selectedSubIndex = -1;
          this.renderNav();
        });
      });
      nav.querySelectorAll('.memo-sub .del').forEach((b) => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          const i = Number(b.dataset.i);
          const j = Number(b.dataset.j);
          const sec = this.sections[i];
          if (sec && Array.isArray(sec.subs)) sec.subs.splice(j, 1);
          this.renderNav();
        });
      });
      this.renderEditor();
    },

    // ── 右栏：内容编辑（复用 memo-editor 样式）──
    renderEditor() {
      const ed = $('pm-editor');
      if (!ed) return;
      if (this.sections.length === 0) {
        $('pm-empty').hidden = false;
        ed.style.display = 'none';
        return;
      }
      $('pm-empty').hidden = true;
      ed.style.display = 'flex';
      const s = this.sections[this.selectedSectionIndex];
      if (!s) {
        ed.innerHTML = '<div class="sec-empty">点击左侧区块进入编辑，或「＋ 添加区块」新建</div>';
        return;
      }
      if (this.selectedSubIndex >= 0) {
        const sb = (s.subs && s.subs[this.selectedSubIndex]);
        if (!sb) { ed.innerHTML = '<div class="sec-empty">该子区块不存在</div>'; return; }
        ed.innerHTML = `
          <div class="memo-editor-head">
            <span class="hash">###</span>
            <input class="memo-editor-title" value="${escAttr(sb.title)}" placeholder="子区块标题（如 4.1 场景）" />
            <button class="del" title="删除此子区块">✕</button>
          </div>
          <div class="memo-editor-field">
            <div class="memo-editor-label">子区块内容<span class="hint">（长文本 · 格式原样保留）</span></div>
            <textarea class="memo-editor-body" rows="9" placeholder="此子区块内容…">${escText(sb.body)}</textarea>
          </div>`;
        const title = ed.querySelector('.memo-editor-title');
        title.addEventListener('input', () => {
          s.subs[this.selectedSubIndex].title = title.value;
          const item = document.querySelector(`.memo-sub[data-i="${this.selectedSectionIndex}"][data-j="${this.selectedSubIndex}"] .memo-sub-name`);
          if (item) item.textContent = title.value || '（未命名）';
        });
        ed.querySelector('.memo-editor-head .del').addEventListener('click', () => {
          s.subs.splice(this.selectedSubIndex, 1);
          this.selectedSubIndex = -1;
          this.renderNav();
        });
        ed.querySelector('.memo-editor-body').addEventListener('input', (e) => { s.subs[this.selectedSubIndex].body = e.target.value; });
        return;
      }
      // 区块级：## 标题 + 前言；含子区块时提供只读汇总
      const hasSubs = Array.isArray(s.subs) && s.subs.length > 0;
      const hasIntro = String(s.body || '').trim() !== '';
      let introField = '';
      if (!hasSubs || hasIntro) {
        introField = `
          <div class="memo-editor-field">
            <div class="memo-editor-label${hasSubs ? ' with-del' : ''}">区块内容<span class="hint">（长文本 · 格式原样保留）</span>${hasSubs ? '<button class="del intro-del" title="删除此区块的前言内容">✕</button>' : ''}</div>
            <textarea class="memo-editor-body${hasSubs ? ' compact' : ''}" rows="10" placeholder="此区块内容…">${escText(s.body)}</textarea>
          </div>`;
      }
      const subPreview = hasSubs ? `
        <div class="memo-sub-preview">
          <div class="memo-editor-label">本区块全部内容<span class="hint">（只读汇总 · 编辑请在左侧点 ### 子项）</span></div>
          ${s.subs.map((sb) => `
            <div class="memo-sub-preview-item">
              <div class="memo-sub-preview-head"><span class="hash">###</span>${escapeHtml(sb.title || '（未命名）')}</div>
              <pre class="memo-sub-preview-body">${escapeHtml(sb.body || '')}</pre>
            </div>`).join('')}
        </div>` : '';
      // v1.2.5：「＋ 添加子区块」—— 选中 ## 区块时提供（与全局记忆一致），给该区块新增 ### 子区块
      const addSubBtn = '<button id="pm-add-sub" class="add-field add-sub-btn">＋ 添加子区块</button>';
      ed.innerHTML = `
        <div class="memo-editor-head">
          <span class="hash">##</span>
          <input class="memo-editor-title" value="${escAttr(s.title)}" placeholder="区块标题（如 项目背景）" />
          <button class="del" title="删除此区块">✕</button>
        </div>${introField}${subPreview}${addSubBtn}`;
      const title = ed.querySelector('.memo-editor-title');
      title.addEventListener('input', () => {
        s.title = title.value;
        const item = document.querySelector(`.memo-item[data-i="${this.selectedSectionIndex}"] .memo-item-name, .memo-group[data-i="${this.selectedSectionIndex}"] .memo-group-name`);
        if (item) item.textContent = title.value || '（未命名）';
      });
      ed.querySelector('.memo-editor-head .del').addEventListener('click', () => {
        this.sections.splice(this.selectedSectionIndex, 1);
        this.selectedSubIndex = -1;
        this.renderNav();
      });
      const introDel = ed.querySelector('.intro-del');
      if (introDel) introDel.addEventListener('click', () => { s.body = ''; this.renderNav(); });
      const body = ed.querySelector('.memo-editor-body');
      if (body) body.addEventListener('input', (e) => { s.body = e.target.value; });
      const addSubEl = ed.querySelector('#pm-add-sub');
      if (addSubEl) addSubEl.addEventListener('click', () => this.addSub());
    },

    addSection() {
      const baseName = '新区块';
      const maxNum = this.sections.reduce((a, s) => Math.max(a, numFromTitle(s.title) || 0), 0);
      const num = maxNum >= 1 ? maxNum + 1 : null;
      let title = num !== null ? `${cnNum(num)}、${baseName}` : baseName;
      let i = 1;
      while (this.sections.some((s2) => s2.title === title)) { i++; title = num !== null ? `${cnNum(num)}、${baseName}${i}` : `${baseName}${i}`; }
      this.sections.push({ title, body: '', subs: [] });
      this.selectedSectionIndex = this.sections.length - 1;
      this.selectedSubIndex = -1;
      this.renderNav();
      const t = document.querySelector('#pm-editor .memo-editor-title');
      if (t) { t.focus(); t.select(); }
    },

    addSub() {
      const s = this.sections[this.selectedSectionIndex];
      if (!s) return;
      if (!Array.isArray(s.subs)) s.subs = [];
      let num = nextSubNum(s.subs);
      if (!num) {
        const sn = numFromTitle(s.title);
        if (sn != null && sn >= 1) num = `${sn}.${s.subs.length + 1}`;
      }
      const title = num ? `${num} 新区块` : `场景 ${s.subs.length + 1}`;
      s.subs.push({ title, body: '' });
      this.selectedSubIndex = s.subs.length - 1;
      this.renderNav();
      const t = document.querySelector('#pm-editor .memo-editor-title');
      if (t) { t.focus(); t.select(); }
    },

    collect() {
      const sections = this.sections
        .map((s) => ({
          title: String(s.title || '').trim(),
          body: (s.body || '').replace(/\r?\n/g, '\n'),
          subs: (Array.isArray(s.subs) && s.subs.length)
            ? s.subs.map((sb) => ({ title: String(sb.title || '').trim(), body: String(sb.body || '').replace(/\r?\n/g, '\n') })).filter((sb) => sb.title !== '')
            : undefined,
        }))
        .filter((s) => s.title !== '');
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
      pm.loadProject(r);
      const list = (pm.data && pm.data.projects) || [];
      if (!list.some((x) => x.path === r.workspace)) list.push({ path: r.workspace, name: basename(r.workspace) });
      pm.renderList(list);
    } else {
      alert('路径无效：必须是已存在的目录。');
    }
  }
  $('pm-new-go').addEventListener('click', async () => {
    const p = $('pm-new-path').value.trim();
    await openByPath(p);
    if (pm.current) newRow.style.display = 'none';
  });
  $('pm-new-path').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pm-new-go').click(); });

  $('pm-add-sec').addEventListener('click', () => pm.addSection());
  $('pm-add-sub-nav').addEventListener('click', () => pm.addSub());

  $('pm-save').addEventListener('click', async () => {
    if (!pm.current) { alert('请先选择/输入项目路径'); return; }
    const { head, sections } = pm.collect();
    // 重组全文：head + ## 区块（含 ### 子区块）
    const blocks = [];
    if (head.trim()) blocks.push(head.trim());
    sections.forEach((s) => {
      const b = (s.body || '').replace(/^\s*\n+|\s+$/g, '');
      let block = '## ' + s.title + (b ? '\n\n' + b : '');
      if (Array.isArray(s.subs) && s.subs.length) {
        const subBlocks = s.subs.map((sb) => {
          const sbB = (sb.body || '').replace(/^\s*\n+|\s+$/g, '');
          return '### ' + sb.title + (sbB ? '\n\n' + sbB : '');
        }).join('\n\n');
        block += '\n\n' + subBlocks;
      }
      blocks.push(block);
    });
    const content = blocks.join('\n\n') + (blocks.length ? '\n' : '');
    const r = await window.dshDesktop.saveProjectMemory(pm.current, content);
    if (r && r.ok) {
      showBanner('项目记忆已保存 ✓', true);
      const d = await window.dshDesktop.getProjectMemory(); // 刷新项目列表（exists 标记）
      pm.data = d;
      pm.renderList((d.projects || []));
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
      pm.renderList((d.projects || []));
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
