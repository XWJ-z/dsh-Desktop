'use strict';

/**
 * DSH-Desktop — 拖拽文件注入模块（v0.9 T3）
 *
 * 职责：向主窗口注入全局拖拽监听（与宠物注入同级，did-finish-load 后调用）：
 *  - 防 DSH 页面默认导航（不 preventDefault，拖文件进窗口会跳到 file://）
 *  - 全窗口 overlay「松开以将文件放入工作区」（北极星：不懂的人知道会发生什么）
 *  - drop 时同步调用 preload 的 getPathForFile 取文件路径（Electron 32+
 *    唯一方式；异步调用会丢 File 引用返回空），经 dropFiles 送主进程
 *
 * 要点：
 *  - dragenter/dragover/drop 用 capture 阶段监听（window 为最祖先），
 *    文件拖拽一律拦截，DSH 页面自身的会话/工作区拖拽（text/plain，非 Files）
 *    完全不受影响；
 *  - 幂等：同一页面生命周期只安装一次（window.__dshDropInstalled）；
 *    overlay 被 SPA 清掉时 dragenter 自动重建；
 *  - 只对 Files 拖拽显示 overlay / 取路径；非文件拖拽不 preventDefault。
 *  - v1.1.5：纯图片拖拽（PNG/JPEG/WebP/GIF）放行给 DSH 原生附件处理（0.1.1-rc.2+），
 *    非图片/混合文件仍由本模块拦截复制进工作区。
 *    ⚠ Chromium 限制：dragenter/dragover 阶段（protected mode）读不到
 *    dataTransfer.files / items[].type，类型判断只能在 drop（readwrite）阶段做，
 *    故 dragenter/dragover/dragleave 对任何 Files 拖拽一律承接，drop 再分流。
 *
 * ⚠ v0.9.2 bug 修复（zx(6)，2026-08-17）：
 *   之前仅 drop 调用了 stopPropagation，dragenter/dragover/dragleave 只
 *   preventDefault —— 事件继续传播到 document，DSH 自身的 document 级拖放
 *   监听（dsh-client-ui-attachment DropOverlay / DragMask「图片拖动添加界面」）
 *   收到 dragenter 后激活遮罩，而 drop 被我们吞掉、其 enter/leave 计数
 *   永不归零 → 遮罩卡死在屏幕上。修复：Files 拖拽的四个事件全部
 *   preventDefault + stopPropagation + stopImmediatePropagation，
 *   DSH 页面从第一个事件起就完全收不到文件拖拽。
 *
 * 依赖注入（deps）：
 *  - appendLog    日志模块
 */

function createDragDrop(deps) {
  const { appendLog } = deps;

  /** 主窗口注入拖拽监听（幂等；SPA 重渲染不影响 window 级监听） */
  function injectDropHandler(win) {
    if (!win || win.isDestroyed()) return;
    win.webContents.executeJavaScript(`
      (() => {
        if (window.__dshDropInstalled) return;
        window.__dshDropInstalled = true;

        const overlay = document.createElement('div');
        overlay.id = 'dsh-drop-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483645;display:none;'
          + 'align-items:center;justify-content:center;background:rgba(15,17,21,.6);'
          + 'color:#dbe2f0;font:16px "Segoe UI","Microsoft YaHei",sans-serif;'
          + 'border:2px dashed #4d6bfe;pointer-events:none;';
        overlay.textContent = '松开以将文件放入工作区';
        document.body.appendChild(overlay);

        // overlay 可能被 DSH SPA 清掉：dragenter 时确保存在（重建并恢复显示）
        const ensureOverlay = () => {
          const exist = document.getElementById('dsh-drop-overlay');
          const el = exist || overlay;
          if (!exist) document.body.appendChild(el);
          return el;
        };

        const hasFiles = (dt) => !!dt && Array.from(dt.types || []).includes('Files');
        // v1.1.5（DSH 0.1.1-rc.2 原生支持图片拖放）：纯图片拖拽放行给 DSH 原生处理。
        // ⚠ Chromium 限制：dragenter/dragover 阶段（mode=protected）dataTransfer.items[].type
        //   与 files 均为空/不可读，故该函数只在 drop 阶段可靠 —— 必须用 files[].type 判断，
        //   而非 items[].type（后者在这两个阶段恒为空，会把图片误判为非图片而拦截）。
        //   type 为 image/png|jpeg|webp|gif 视为纯图片；空 type 不算（兜底走我们）
        //   ⚠ 用字符串构造 RegExp：注入体在 JS 模板字符串（反引号）内，正则字面量里的
        //   图片 MIME 分隔符会被模板字符串处理掉导致语法错误，故不用正则字面量。
        const IMG_TYPE_RE = new RegExp('^image/(png|jpe?g|webp|gif)$', 'i');
        const isImageOnlyDrag = (dt) => {
          try {
            const files = Array.from((dt && dt.files) || []);
            if (files.length === 0) return false;
            return files.every((f) =>
              IMG_TYPE_RE.test((f && f.type) || ''));
          } catch { return false; }
        };
        let depth = 0;

        window.addEventListener('dragenter', (e) => {
          if (!hasFiles(e.dataTransfer)) return;
          // 必须 stopPropagation+stopImmediatePropagation：否则 DSH 自己的
          // document 级拖放监听（DropOverlay）会收到 dragenter 激活「图片
          // 拖动添加界面」，而 drop 被我们吞掉后其计数永不归零 → 遮罩卡死
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          depth++;
          const ov = ensureOverlay();
          ov.style.display = 'flex';
        }, true);

        // dragover 必须 preventDefault（否则浏览器默认导航到 file://，drop 不触发）
        // 注：dragover 阶段 files/items[].type 不可读（Chromium protected mode），
        // 类型一律在 drop 阶段分流；此处对任何 Files 拖拽统一承接。
        window.addEventListener('dragover', (e) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }, true);

        window.addEventListener('dragleave', (e) => {
          if (!hasFiles(e.dataTransfer)) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (--depth <= 0) { depth = 0; ensureOverlay().style.display = 'none'; }
        }, true);

        window.addEventListener('drop', (e) => {
          if (!hasFiles(e.dataTransfer)) return;
          // v1.1.5（DSH 0.1.1-rc.2 原生支持图片拖放）：纯图片拖拽放行给 DSH 原生处理。
          // 类型必须在此（drop，mode=readwrite）判断 —— files[].type 此刻才可靠；
          // 放行 = 不 preventDefault、不 stopPropagation，让事件继续冒泡到 DSH 的
          // document 级监听完成缩略图附件；同时收起我们的遮罩、归零深度。
          if (isImageOnlyDrag(e.dataTransfer)) {
            depth = 0;
            ensureOverlay().style.display = 'none';
            return;
          }
          e.preventDefault();
          e.stopPropagation(); // 非图片/混合：文件拖拽全窗口接管，DSH 页面不处理
          e.stopImmediatePropagation();
          depth = 0;
          ensureOverlay().style.display = 'none';
          const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
          if (files.length === 0) return;
          // getPathForFile 必须在 drop 事件同步调用（异步会丢 File 引用）
          const paths = files
            .map((f) => {
              try {
                return (window.dshDesktop && window.dshDesktop.getPathForFile)
                  ? window.dshDesktop.getPathForFile(f) : '';
              } catch { return ''; }
            })
            .filter(Boolean);
          // 全部取路径失败也上报（主进程给「无法读取文件路径」反馈，避免静默失败）
          if (window.dshDesktop && window.dshDesktop.dropFiles) {
            window.dshDesktop.dropFiles(paths);
          }
        }, true);

        return 'installed';
      })()
    `).then((r) => {
      if (r === 'installed') appendLog('info', '[gui] 拖拽监听已注入（v0.9 拖文件入工作区）');
    }).catch(() => { /* ignore */ });
  }

  return { injectDropHandler };
}

module.exports = { createDragDrop };
