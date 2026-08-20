'use strict';

/**
 * DSH-Desktop — 桌面宠物/工具箱模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：
 *  - petSvgText：读取 Q 版鲸鱼 SVG（assets/pet-whale.svg，内联注入）
 *  - toolboxSvgText：读取工具箱 SVG（assets/toolbox.svg，内联注入）
 *  - injectPet：主窗口注入鲸鱼宠物或工具箱图标（v0.8.15：双形态切换 ——
 *    petHidden=false 注入宠物，petHidden=true 注入工具箱；二者共享位置记忆
 *    与拖拽逻辑，工具箱菜单保留「提示词库/网页打开」入口 + 「显示宠物」；
 *    v0.8.17：默认位置底部居中；
 *    v0.9.10：间歇性功能提示 —— 启动 30s 后每 5 分钟随机弹功能引导气泡，
 *    洗牌队列一轮不重复，工具箱形态/页面隐藏/气泡显示中跳过）
 *  - resetWebOpenBtnLayout：恢复默认布局（宠物/工具箱回底部居中）
 *
 * 依赖注入（deps）：
 *  - app / fs / path
 *  - appendLog                       日志模块
 *  - getSettings / saveSettings      设置（webOpenBtnPos / petHidden）
 *  - getMainWindow / getWebUrl
 */

function createPet(deps) {
  const { app, fs, path, appendLog, getSettings, saveSettings, getMainWindow, getWebUrl } = deps;

  /** v0.8.11（T1）：读取 Q 版鲸鱼 SVG（内联注入用；失败返回空串，前端兜底 emoji） */
  let petSvgCache = null;
  function petSvgText() {
    if (petSvgCache === null) {
      try {
        petSvgCache = fs.readFileSync(path.join(app.getAppPath(), 'assets', 'pet-whale.svg'), 'utf8');
      } catch {
        petSvgCache = '';
      }
    }
    return petSvgCache;
  }

  /** v0.8.15：读取工具箱 SVG（v0.8.11 T5 曾删除注入，现恢复用于宠物隐藏时兜底入口） */
  let toolboxSvgCache = null;
  function toolboxSvgText() {
    if (toolboxSvgCache === null) {
      try {
        toolboxSvgCache = fs.readFileSync(path.join(app.getAppPath(), 'assets', 'toolbox.svg'), 'utf8');
      } catch {
        toolboxSvgCache = '';
      }
    }
    return toolboxSvgCache;
  }

  /**
   * v0.8.11（T2）+ v0.8.15：注入鲸鱼桌面宠物 或 工具箱图标（主窗口 did-finish-load /
   * 宠物开关 / 恢复默认布局时调用）。
   * 双形态设计（老大反馈 v0.8.15）：隐藏宠物后自动变回工具箱图标 ——
   * 网页打开/提示词库入口不丢失；工具箱菜单含「显示宠物」可切回鲸鱼。
   *
   * v0.8.23（老大反馈：仍要点恢复默认布局才出现）：
   *  注入脚本改为「页面内自愈」—— 首次注入时注册 window.__dshEnsurePet 创建函数
   *  + MutationObserver 监视 DOM：SPA 清除宠物/把它藏到视口外时，页面内立即重建，
   *  不再依赖主进程 3s 轮询（v0.8.22 只查存在性，节点残留不可见时误判"存在"）。
   *  幂等：同一页面生命周期内只安装一次；watchdog / 恢复默认布局触发 injectPet 时，
   *  若已安装自愈则仅做可见性检查 + 触发重建（不重复安装）。
   */
  function injectPet(win) {
    if (!win || win.isDestroyed()) return;
    const saved = getSettings().webOpenBtnPos;
    const petHidden = !!getSettings().petHidden;
    const petSvg = petSvgText();
    const toolboxSvg = toolboxSvgText();
    win.webContents
      .executeJavaScript(
        `
      (() => {
        // 已安装自愈（同一页面生命周期内幂等）：仅做可见性检查，缺失/不可见则重建
        if (window.__dshPetSelfHeal) {
          const p = document.getElementById('dsh-pet');
          let visible = false;
          if (p) {
            const r = p.getBoundingClientRect();
            visible = r.width > 0 && r.height > 0 &&
              r.right > -10 && r.bottom > -10 &&
              r.left < window.innerWidth + 10 && r.top < window.innerHeight + 10;
          }
          if (!visible && window.__dshEnsurePet) window.__dshEnsurePet();
          return;
        }
        window.__dshPetSelfHeal = true;

        const url = '${getWebUrl()}';
        const saved = ${JSON.stringify(saved || null)};
        const petSvg = ${JSON.stringify(petSvg)};
        const toolboxSvg = ${JSON.stringify(toolboxSvg)};
        const petHidden = ${petHidden};

        // ── 创建/重建函数（SPA 清除后由 observer 调用；可见则不动）──
        window.__dshEnsurePet = function ensurePet() {
          // 移除加载遮罩（若残留，避免盖住宠物）
          const overlay = document.getElementById('dsh-loading-overlay');
          if (overlay) overlay.remove();
          const exist = document.getElementById('dsh-pet');
          if (exist) {
            const r = exist.getBoundingClientRect();
            const vis = r.width > 0 && r.height > 0 &&
              r.right > -10 && r.bottom > -10 &&
              r.left < window.innerWidth + 10 && r.top < window.innerHeight + 10;
            if (vis) return;      // 存在且可见：不动
            if (exist._tipCleanup) exist._tipCleanup(); // v0.9.10：清理间歇提示定时器
            exist.remove();       // 残留不可见节点：移除重建
          }

        // v0.8.19（老大反馈）：校验记忆位置是否在当前可视区内 ——
        // 窗口尺寸变化/分辨率调整后旧坐标可能跑到屏幕外（重开宠物"消失"），
        // 不可见则回退默认（底部居中）。
        const savedValid = saved && typeof saved.x === 'number' && typeof saved.y === 'number'
          && saved.x >= -10 && saved.y >= -10
          && saved.x + 64 <= window.innerWidth + 10
          && saved.y + 64 <= window.innerHeight + 10;

        // v0.8.15（真机修复）：前端同步切换 宠物 ⇄ 工具箱 —— 不依赖 IPC 往返。
        // 隐藏/显示宠物时直接改 SVG + 菜单项 + title，即时生效；IPC 仅持久化。
        // v0.8.16：isToolbox 记录当前形态 —— 工具箱形态下禁用宠物专属交互
        // （表情/气泡/彩蛋/眨眼/深夜犯困），仅保留拖拽与悬停菜单。
        let isToolbox = petHidden;
        const switchMode = (hidden) => {
          isToolbox = hidden;
          pet.dataset.mode = hidden ? 'toolbox' : 'pet'; // v0.8.16：主进程按此判断形态（如注入庆祝）
          const svg = hidden ? toolboxSvg : petSvg;
          const cur = pet.querySelector('svg');
          if (cur && svg) {
            // v0.8.30 R5（审查报告 v24.0）：tmp.innerHTML 解析 → DOMParser（更规范）
            const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
            const ns = doc.querySelector('svg');
            if (ns) { ns.style.cssText = 'width:100%;height:100%;pointer-events:none;display:block;'; cur.replaceWith(ns); }
          }
          pet.title = hidden ? '工具箱（可拖拽，悬停出菜单）' : '小鲸鱼（可拖拽，悬停出菜单）';
          const last = pet.querySelector('.pet-item:last-child');
          if (last) {
            last.dataset.action = hidden ? 'showpet' : 'hide';
            last.textContent = hidden ? '🐋 显示宠物' : '🙈 隐藏宠物';
          }
        };

        const pet = document.createElement('div');
        pet.id = 'dsh-pet';
        pet.dataset.mode = petHidden ? 'toolbox' : 'pet'; // v0.8.16：形态标记（主进程注入庆祝判断）
        pet.title = petHidden ? '工具箱（可拖拽，悬停出菜单）' : '小鲸鱼（可拖拽，悬停出菜单）';
        pet.innerHTML = (petHidden ? toolboxSvg : petSvg)
          + '<div class="pet-bubble"></div>'
          + '<div class="pet-menu">'
          // v0.9.12（老大指令）：全局记忆入口放提示词库前面（点击打开记忆文件，首次自动建立）
          +   '<div class="pet-item" data-action="memory">🧠 全局记忆</div>'
          +   '<div class="pet-item" data-action="promptlib">💡 提示词库</div>'
          // v1.1.1：插件市场入口（老大指令：保留 💎 图标）
          +   '<div class="pet-item" data-action="pluginmarket">💎 插件市场</div>'
          +   '<div class="pet-item" data-action="webopen">🌐 网页打开</div>'
          +   (petHidden
              ? '<div class="pet-item" data-action="showpet">🐋 显示宠物</div>'
              : '<div class="pet-item" data-action="hide">🙈 隐藏宠物</div>')
          + '</div>';
        pet.style.cssText = 'position:fixed;z-index:2147483646;width:64px;height:64px;'
          + (savedValid
            // v0.8.24（老大反馈：移动位置后重开消失）：原写法 top:Ypx 后又被
            // top:auto 覆盖（同一行重复 top），fixed 元素 top:auto 时垂直位置
            // 不可控（跑到视口外）→ 重开不可见；恢复默认布局走 bottom 分支才正常。
            ? 'left:' + saved.x + 'px;top:' + saved.y + 'px;right:auto;'
            // v0.8.17（老大指令）：默认位置底部居中（像素计算，不用 transform 避免与拖拽冲突）
            : 'left:' + Math.round((window.innerWidth - 64) / 2) + 'px;bottom:24px;right:auto;top:auto;')
          + 'cursor:grab;user-select:none;filter:drop-shadow(0 4px 12px rgba(77,107,254,.35));';
        const svgEl = pet.querySelector('svg');
        if (svgEl) svgEl.style.cssText = 'width:100%;height:100%;pointer-events:none;display:block;';
        // 气泡 / 菜单容器样式（全部内联，兼容 DSH 页面 CSP）
        // v0.8.18（老大指令）：气泡移到宠物下方（top:100%）—— 上方会遮挡 DSH 选项/输入框
        const bubble = pet.querySelector('.pet-bubble');
        // v0.9.13（老大反馈：气泡竖排/字级乱断）：改为横排每行约 8 字 ——
        // 不用 em/overflow-wrap:anywhere（曾致一个字就换行的竖排），
        // 用固定像素 max-width:120px（内容 100px ≈ 8 个 12.5px 中文字）+ keep-all
        bubble.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);'
          + 'margin-top:8px;max-width:120px;padding:6px 10px;background:#171a21;color:#dbe2f0;'
          + 'border:1px solid #2a2f3a;border-radius:10px;font:12.5px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;'
          + 'white-space:normal;word-break:keep-all;text-align:center;display:none;'
          + 'box-shadow:0 4px 16px rgba(0,0,0,.4);pointer-events:none;';
        const menu = pet.querySelector('.pet-menu');
        menu.style.cssText = 'position:absolute;bottom:100%;left:50%;transform:translateX(-50%);'
          + 'margin-bottom:30px;min-width:130px;background:#171a21;border:1px solid #2a2f3a;'
          + 'border-radius:10px;padding:4px;display:none;z-index:2147483646;'
          + 'box-shadow:0 8px 24px rgba(0,0,0,.5);font:600 13px/1 "Segoe UI","Microsoft YaHei",sans-serif;';
        pet.querySelectorAll('.pet-item').forEach((it) => {
          it.style.cssText = 'padding:8px 12px;border-radius:6px;cursor:pointer;color:#dbe2f0;white-space:nowrap;';
        });

        // ── 表情切换（SVG 内 .eye/.mouth/.tail；内联 transform + transition，兼容 CSP）──
        const eyes = () => Array.from(pet.querySelectorAll('.eye'));
        const mouth = () => pet.querySelector('.mouth');
        const tail = () => pet.querySelector('.tail');
        const prep = (el) => { if (el) { el.style.transformBox = 'fill-box'; el.style.transformOrigin = 'center'; el.style.transition = 'transform .2s ease'; } };
        eyes().forEach(prep); prep(mouth()); prep(tail());

        // v0.9.13（老大反馈：实机点击宠物眼睛跑到头顶眨眼）：眨眼改为**几何闭眼** ——
        // 直接改右眼瞳孔 ellipse 的 ry（半径），圆心/位置固定，不依赖 transform-box
        // origin 计算（实机 GPU 合成下 fill-box scaleY 可能以错误原点收缩 → 眼睛位移；
        // 虚拟机软件渲染不触发，故无法复现）。几何属性在任何渲染环境都不会位移。
        let pupilRy = null;
        const setWink = (on) => {
          const g = pet.querySelector('.eye-r');
          if (!g) return;
          const pupil = g.querySelectorAll('ellipse')[1]; // 第 2 个 ellipse = 深色瞳孔
          if (!pupil) return;
          if (pupilRy === null) pupilRy = pupil.getAttribute('ry');
          pupil.setAttribute('ry', on ? '1' : String(pupilRy));
        };

        const setCls = (cls) => {
          pet.classList.remove('happy', 'sleepy', 'wink', 'hover');
          eyes().forEach((e) => { e.style.transform = ''; });
          if (mouth()) mouth().style.transform = '';
          if (tail()) tail().style.transform = '';
          setWink(false); // v0.9.13：眨眼几何恢复（瞳孔 ry 还原）
          if (!cls) {
            // v0.9.13（老大反馈：点击宠物眼睛乱跑）：表情结束后鼠标仍悬停 → 恢复抬头，
            // 避免"点击→弯眼→复位"瞬间眼睛位置突兀
            if (pet.matches(':hover') && !isToolbox) { setCls('hover'); }
            return;
          }
          pet.classList.add(cls);
          if (cls === 'happy') {
            eyes().forEach((e) => { e.style.transform = 'scaleY(.4)'; });   // 弯眼笑
            if (mouth()) mouth().style.transform = 'scale(1.15)';           // 张嘴
          } else if (cls === 'sleepy') {
            eyes().forEach((e) => { e.style.transform = 'scaleY(.25)'; });  // 半闭眼
            if (mouth()) mouth().style.transform = 'scaleY(1.7)';           // 打哈欠
          } else if (cls === 'wink') {
            setWink(true); // v0.9.13：眨眼改几何闭眼（瞳孔 ry→1，圆心固定不位移）
          } else if (cls === 'hover') {
            eyes().forEach((e) => { e.style.transform = 'translateY(-3px)'; }); // 抬头看
            if (tail()) tail().style.transform = 'rotate(-14deg)';              // 尾巴翘起
          }
        };
        // 跳跃 / 喷水动画（Web Animations API，无 CSP 依赖）
        const jump = () => {
          pet.animate(
            [{ transform: 'translateY(0)' }, { transform: 'translateY(-18px)' },
             { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }],
            { duration: 600, easing: 'ease' });
        };
        const splash = () => {
          const s = document.createElement('span');
          s.textContent = '💦';
          s.style.cssText = 'position:absolute;top:6px;right:6px;font-size:16px;pointer-events:none;';
          pet.appendChild(s);
          s.animate(
            [{ opacity: 0, transform: 'translateY(0) scale(.5)' },
             { opacity: 1, offset: .3 },
             { opacity: 0, transform: 'translateY(-26px) scale(1.4)' }],
            { duration: 700, easing: 'ease-out' }).onfinish = () => s.remove();
        };

        // ── 气泡文案库（26 提供，见方案 2.4）──
        const LINES = {
          welcome: ['嗨！我是小鲸鱼，有事儿叫我就行～', '欢迎回来！想聊点啥？',
                    '欢迎回来！把文件拖进来就能让我分析～'],
          hover: ['需要帮忙吗？点上面的菜单看看～', '找不到入口？我在这儿呢！'],
          click: ['有什么想问的？试试提示词库～', '点我可以和你玩哦！', '今天也要加油呀！🐋',
                  '嘘——我在认真看你干活呢', '要我帮你打开网页版吗？',
                  '把文件拖进来，我帮你放进工作区～', '悬停看看菜单，有惊喜～'],
          done: ['搞定！去发送吧～', '填好了，快试试！'],
          copied: ['复制好啦，去输入框粘贴吧（Ctrl+V）'],
          egg: ['嘿嘿，被你发现啦！', '哇哦！喷水庆祝！'],
          hide: ['那我先休息啦，右键可以叫我回来～'],
          sleepy: ['这么晚还不睡呀…', '夜猫子！明天还要上课呢'],
          // v1.1.1（26 方案七 ③）：加群引导气泡 —— 点击时约 5% 概率混入
          // （每 20 次点击一次），低频不烦人
          group: ['有问题？Q 群 916607090 找我呀～', '想要更多提示词？进群 916607090 领～'],
          // v0.9.10（老大反馈：交互词少，间歇性提示功能）：
          // 功能引导词库 —— 间歇定时器随机弹出，覆盖主要功能入口
          tips: [
            '把文件直接拖进窗口，发送消息我就能帮你分析～',
            '悬停点「提示词库」，101 条模板直接套用～',
            '常用套路存成自己的提示词，重启不丢～',
            '菜单栏最右端 📢 公告条，最新消息一眼看到～',
            '按 Ctrl+Alt+D 随时呼出/隐藏窗口（设置里可改）～',
            '重要数据记得备份：文件 → 备份数据～',
            '遇到问题「帮助 → 生成诊断报告」，我们好排查～',
            '文件夹也能拖进来，整目录一起复制进工作区～',
            '设置 → 外观 可切换浅色/深色，跟着感觉走～',
            '有问题进 QQ 群 916607090，随时来找我玩～',
          ],
        };
        // v0.9.10：say 支持自定义显示时长（功能提示文字较长，默认 2200ms）
        const say = (arr, ms) => {
          bubble.textContent = arr[Math.floor(Math.random() * arr.length)];
          bubble.style.display = 'block';
          clearTimeout(pet._bt);
          pet._bt = setTimeout(() => { bubble.style.display = 'none'; }, ms || 2200);
        };
        const showMenu = (v) => { menu.style.display = v ? 'block' : 'none'; };

        // ── 拖拽（pointer 事件，复用工具箱逻辑：4px 阈值 + 边界钳制 + 位置记忆）──
        let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
        pet.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          dragging = true; moved = false;
          sx = e.clientX; sy = e.clientY;
          const r = pet.getBoundingClientRect();
          ox = r.left; oy = r.top;
          pet.style.right = 'auto';
          pet.style.left = r.left + 'px';
          pet.style.top = r.top + 'px';
          try { pet.setPointerCapture(e.pointerId); } catch { /* ignore */ }
          e.preventDefault();
        });
        pet.addEventListener('pointermove', (e) => {
          if (!dragging) return;
          const dx = e.clientX - sx, dy = e.clientY - sy;
          if (!moved && Math.hypot(dx, dy) < 4) return;
          moved = true;
          pet.style.cursor = 'grabbing';
          let nx = ox + dx, ny = oy + dy;
          nx = Math.min(Math.max(nx, 0), Math.max(0, window.innerWidth - pet.offsetWidth));
          ny = Math.min(Math.max(ny, 0), Math.max(0, window.innerHeight - pet.offsetHeight));
          pet.style.left = nx + 'px';
          pet.style.top = ny + 'px';
        });
        const endDrag = () => {
          if (!dragging) return;
          dragging = false;
          pet.style.cursor = 'grab';
          if (moved) {
            const r = pet.getBoundingClientRect();
            if (window.dshDesktop && window.dshDesktop.saveWebOpenBtnPos) {
              window.dshDesktop.saveWebOpenBtnPos({ x: Math.round(r.left), y: Math.round(r.top) });
            }
            moved = false;
          }
        };
        pet.addEventListener('pointerup', endDrag);
        pet.addEventListener('pointercancel', endDrag);

        // ── 悬停：抬头 + 气泡 + 菜单（工具箱形态：仅出菜单，无表情/气泡）──
        pet.addEventListener('mouseenter', () => {
          if (isToolbox) { showMenu(true); return; } // v0.8.16：工具箱只出菜单
          setCls('hover');
          say(LINES.hover);
          showMenu(true);
        });
        pet.addEventListener('mouseleave', () => {
          if (!isToolbox) setCls('');
          setTimeout(() => { if (!menu.matches(':hover')) showMenu(false); }, 150);
        });
        menu.addEventListener('mouseleave', () => showMenu(false));

        // ── 菜单项（pointerdown 拦截，防拖拽劫持点击）──
        menu.querySelectorAll('.pet-item').forEach((it) => {
          it.addEventListener('pointerdown', (e) => e.stopPropagation());
          it.addEventListener('mouseenter', () => { it.style.background = '#2a2f3a'; });
          it.addEventListener('mouseleave', () => { it.style.background = ''; });
          it.addEventListener('click', (e) => {
            e.stopPropagation();
            showMenu(false);
            if (it.dataset.action === 'memory') {
              // v0.9.12（老大指令）：打开全局记忆文件（首次自动建立）
              if (window.dshDesktop && window.dshDesktop.openGlobalMemory) window.dshDesktop.openGlobalMemory();
            } else if (it.dataset.action === 'promptlib') {
              if (window.dshDesktop && window.dshDesktop.openPromptLib) window.dshDesktop.openPromptLib();
            } else if (it.dataset.action === 'pluginmarket') {
              // v1.1.1：打开插件市场窗口
              if (window.dshDesktop && window.dshDesktop.openPluginMarket) window.dshDesktop.openPluginMarket();
            } else if (it.dataset.action === 'webopen') {
              if (window.dshDesktop && window.dshDesktop.openExternal) window.dshDesktop.openExternal(url);
            } else if (it.dataset.action === 'hide') {
              // v0.8.11（T5.2）/ v0.8.15：隐藏宠物 —— 前端同步切换为工具箱
              // （即时生效，不依赖 IPC 往返；IPC 仅持久化 petHidden）
              setCls('');
              say(LINES.hide);
              setTimeout(() => {
                switchMode(true); // 前端立即变工具箱
                if (window.dshDesktop && window.dshDesktop.setPetHidden) window.dshDesktop.setPetHidden(true);
              }, 600);
            } else if (it.dataset.action === 'showpet') {
              // v0.8.15：工具箱菜单「显示宠物」→ 前端同步切回鲸鱼
              switchMode(false);
              if (window.dshDesktop && window.dshDesktop.setPetHidden) window.dshDesktop.setPetHidden(false);
            }
          });
        });

        // ── 单击：随机气泡 + 3s 内连点 5 次 → 彩蛋（T4；v0.8.16：工具箱形态无此交互）──
        let clickCount = 0, clickTimer = null;
        pet.addEventListener('click', (e) => {
          if (moved) { e.preventDefault(); e.stopPropagation(); return; }  // 拖拽不算点击
          if (e.target.closest('.pet-menu')) return;
          if (isToolbox) return; // v0.8.16：工具箱形态单击不响应（无宠物彩蛋/气泡）
          clickCount++;
          clearTimeout(clickTimer);
          clickTimer = setTimeout(() => { clickCount = 0; }, 3000);
          if (clickCount >= 5) {
            clickCount = 0;
            setCls('happy');
            say(LINES.egg);
            jump();
            splash();
          } else {
            setCls('happy');
            // v1.1.1（26 方案七 ③）：约 5% 概率混入加群引导（每 20 次点击一次，低频不烦人）
            say(Math.random() < 0.05 ? LINES.group : LINES.click);
            setTimeout(() => setCls(''), 1500);
          }
        });

        // ── 右键：菜单切换 ──
        pet.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          showMenu(!menu.style.display || menu.style.display === 'none');
        });

        // ── 空闲眨眼（8s 一次，250ms；v0.8.16：工具箱形态无眨眼）──
        // v0.9.13：happy（点击/彩蛋）期间不眨眼 —— 防表情竞争（点击后眼睛乱跳）
        const idleTimer = setInterval(() => {
          if (document.getElementById('dsh-pet') !== pet) { clearInterval(idleTimer); return; }
          if (isToolbox) return;
          if (pet.classList.contains('happy')) return;
          setCls('wink');
          setTimeout(() => setCls(''), 250);
        }, 8000);

        // ── 深夜彩蛋（23:00-05:00，启动 2s 后犯困 + 气泡；工具箱形态无此彩蛋）──
        const h = new Date().getHours();
        if (!isToolbox && (h >= 23 || h < 5)) {
          setTimeout(() => {
            setCls('sleepy');
            say(LINES.sleepy);
            setTimeout(() => setCls(''), 3000);
          }, 2000);
        }

        document.body.appendChild(pet);
        // v0.8.16：仅宠物形态弹欢迎气泡（工具箱形态静默）
        if (!isToolbox) setTimeout(() => say(LINES.welcome), 2500); // 启动欢迎气泡（不抢注意力）

        // ── v0.9.10（老大反馈：交互词少，间歇性提示功能）──
        // 功能引导间歇提示：启动 30s 后第一条，之后每 5 分钟随机一条；
        // 洗牌队列保证一轮（10 条）内不重复；工具箱形态/页面不可见/气泡显示中跳过。
        if (!isToolbox) {
          const tipOrder = LINES.tips.map((_, i) => i).sort(() => Math.random() - 0.5);
          let tipIdx = 0;
          const tipSay = () => {
            if (document.getElementById('dsh-pet') !== pet) return;
            if (isToolbox) return;
            if (document.visibilityState !== 'visible') return;
            if (bubble.style.display === 'block') return; // 已有气泡显示中：不覆盖
            say([LINES.tips[tipOrder[tipIdx % LINES.tips.length]]], 3200);
            tipIdx++;
          };
          const firstTipTimer = setTimeout(tipSay, 30_000);
          const tipTimer = setInterval(() => {
            if (document.getElementById('dsh-pet') !== pet) { clearInterval(tipTimer); return; }
            tipSay();
          }, 300_000);
          pet._tipCleanup = () => { clearTimeout(firstTipTimer); clearInterval(tipTimer); };
        }
        };

        // ── v0.8.23：页面内自愈 —— MutationObserver 监视 DOM，宠物被 SPA
        //    清除/隐藏时立即重建（防抖 500ms，避免高频重建）。
        //    childList+subtree：节点被移除；attributes(style/class)：节点残留但
        //    被 display:none / 移出视口 等样式隐藏 —— 两者都触发可见性复查。
        let lastCheck = 0;
        const onDomChange = () => {
          const now = Date.now();
          if (now - lastCheck < 500) return;
          lastCheck = now;
          const p = document.getElementById('dsh-pet');
          let vis = false;
          if (p) {
            const r = p.getBoundingClientRect();
            vis = r.width > 0 && r.height > 0 &&
              r.right > -10 && r.bottom > -10 &&
              r.left < window.innerWidth + 10 && r.top < window.innerHeight + 10;
          }
          if (!vis && window.__dshEnsurePet) window.__dshEnsurePet();
        };
        window.__dshPetObserver = new MutationObserver(onDomChange);
        window.__dshPetObserver.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });

        // 首次创建
        window.__dshEnsurePet();
      })()
    `,
      )
      .catch(() => {
        /* ignore */
      });
  }

  /** v0.7.6（T-037）/ v0.8.11（T5）/ v0.8.17：恢复默认布局 —— 清除位置记忆，宠物/工具箱回底部居中 */
  function resetWebOpenBtnLayout() {
    getSettings().webOpenBtnPos = null;
    saveSettings();
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents
        .executeJavaScript(
          `
        // v0.8.23：重置页面内自愈状态（断开 observer + 移除节点），
        // 再走主进程 injectPet 完整重装（新位置=底部居中）
        if (window.__dshPetObserver) { window.__dshPetObserver.disconnect(); window.__dshPetObserver = null; }
        window.__dshPetSelfHeal = false;
        const pet = document.getElementById('dsh-pet');
        if (pet) pet.remove();
      `,
        )
        .catch(() => {
          /* ignore */
        })
        .then(() => {
          injectPet(mainWindow); // v0.8.17：按 petHidden 注入宠物或工具箱（底部居中）
        });
    }
    appendLog('info', '已恢复默认布局（宠物/工具箱回底部居中）');
  }

  /**
   * v0.9（T4/T5）：主进程直接显示气泡反馈（拖文件复制结果等）。
   * 与 pet:notify 的差异：工具箱形态也显示（拖文件反馈是壳级提示，不应因
   * 宠物隐藏而丢失）；宠物节点不存在时用底部 toast 兜底（2.6s 自动消失）。
   */
  function petBubble(win, text) {
    if (!win || win.isDestroyed()) return;
    win.webContents
      .executeJavaScript(
        `
      (() => {
        const p = document.getElementById('dsh-pet');
        if (p) {
          const b = p.querySelector('.pet-bubble');
          if (b) {
            b.textContent = ${JSON.stringify(text)};
            b.style.display = 'block';
            clearTimeout(p._bt);
            p._bt = setTimeout(() => { b.style.display = 'none'; }, 2600);
          }
          return;
        }
        let t = document.getElementById('dsh-drop-toast');
        if (!t) {
          t = document.createElement('div');
          t.id = 'dsh-drop-toast';
          t.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483644;'
            + 'max-width:70%;padding:9px 16px;background:#171a21;color:#dbe2f0;'
            + 'border:1px solid #2a2f3a;border-radius:10px;'
            + 'font:13px/1.5 "Segoe UI","Microsoft YaHei",sans-serif;'
            + 'box-shadow:0 4px 16px rgba(0,0,0,.4);pointer-events:none;';
          document.body.appendChild(t);
        }
        t.textContent = ${JSON.stringify(text)};
        t.style.display = 'block';
        clearTimeout(t._timer);
        t._timer = setTimeout(() => { t.style.display = 'none'; }, 2600);
      })()
    `,
      )
      .catch(() => {
        /* ignore */
      });
  }

  return { petSvgText, toolboxSvgText, injectPet, resetWebOpenBtnLayout, petBubble };
}

module.exports = { createPet };
