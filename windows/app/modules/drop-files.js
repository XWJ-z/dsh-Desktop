'use strict';

/**
 * DSH-Desktop — 拖拽文件处理模块（v0.9 T4/T5）
 *
 * 职责：处理 preload `dropFiles(paths)` 传来的拖入文件列表：
 *  ① 定位当前 DSH 工作区（workspace 模块）
 *  ② 复制进工作区的专用文件夹「拖入文件」（不污染工作区根目录，老大指令
 *     v0.9.3）：重名自动 `xxx (1).ext`（不覆盖）；文件夹递归复制；
 *     快捷方式（.lnk）原样复制不解析目标（简单安全）；>50MB 用异步复制
 *     并气泡提示「正在复制大文件…」
 *  ③ 注入提示词（复用 prompt-inject 链路）：单文件 / 多文件文案，
 *     文件名带相对路径（如「拖入文件/xxx.txt」，DSH 按工作区相对路径定位）
 *  ④ 宠物气泡反馈；注入失败降级为提示用户自行输入
 *
 * 依赖注入（deps）：
 *  - fs / path                        Node 模块
 *  - appendLog                        日志模块
 *  - getWorkspacePath                 工作区定位（workspace 模块）
 *  - promptInject                     prompt-inject 模块（injectTextIntoInput）
 *  - petBubble                        pet 模块（主进程直接显示气泡）
 *  - getMainWindow                    () => 主窗口
 */

const BIG_FILE_BYTES = 50 * 1024 * 1024; // 大文件阈值（T5）
// v0.9.3：拖入文件统一放入工作区下的专用文件夹（老大指令），不直接放根目录
const DROP_DIR_NAME = '拖入文件';

function createDropFiles(deps) {
  const { fs, path, appendLog, getWorkspacePath, promptInject, petBubble, getMainWindow } = deps;

  /** 重名自动加 (1) 后缀（不覆盖），返回最终目标路径（位于工作区/拖入文件/） */
  function uniqueDest(ws, src) {
    const dir = path.join(ws, DROP_DIR_NAME);
    const name = path.basename(src);
    let dest = path.join(dir, name);
    let i = 1;
    while (fs.existsSync(dest)) {
      const ext = path.extname(name);
      dest = path.join(dir, `${path.basename(name, ext)} (${i})${ext}`);
      i++;
    }
    return dest;
  }

  /**
   * 复制单个源路径（文件/文件夹）到工作区的「拖入文件」文件夹。
   * @returns {Promise<string|null>} 复制后的 basename；失败返回 null
   */
  async function copyOne(src, ws) {
    let st;
    try {
      st = fs.statSync(src);
    } catch (err) {
      appendLog('error', `拖入路径不可用 ${src}: ${err.message}`);
      return null;
    }
    // 专用文件夹不存在则创建（幂等；复制目标必须存在）
    const dropDir = path.join(ws, DROP_DIR_NAME);
    try {
      fs.mkdirSync(dropDir, { recursive: true });
    } catch (err) {
      appendLog('error', `创建拖入文件夹失败 ${dropDir}: ${err.message}`);
      return null;
    }
    const dest = uniqueDest(ws, src);
    try {
      if (st.isDirectory()) {
        // 文件夹：递归复制（fs.cpSync；目标目录名同样参与重名去重）
        fs.cpSync(src, dest, { recursive: true });
      } else if (st.size > BIG_FILE_BYTES) {
        // T5：大文件异步复制 + 进行中气泡（fs.promises.copyFile 不卡主进程）
        petBubble(getMainWindow(), '正在复制大文件…请稍候');
        await fs.promises.copyFile(src, dest);
      } else {
        // 小文件：同步短操作（复制是快速本地 IO，避免异步竞态）
        fs.copyFileSync(src, dest);
      }
      return path.basename(dest);
    } catch (err) {
      appendLog('error', `复制文件失败 ${src}: ${err.message}`);
      return null;
    }
  }

  /** 提示词文案（单文件 / 多文件；copied 元素已带「拖入文件/」相对路径，
   *  DSH 按工作区相对路径定位文件） */
  function buildPrompt(copied) {
    return copied.length === 1
      ? `请分析工作区里的文件：${copied[0]}`
      : `请分析工作区里的这些文件：${copied.join('、')}`;
  }

  /** 主窗口气泡反馈（宠物形态用宠物气泡；工具箱/无宠物时用 toast 兜底 —— 见 pet.petBubble） */
  function feedback(win, text) {
    petBubble(win, text);
  }

  /**
   * 处理拖入文件：定位工作区 → 复制 → 注入提示词 → 气泡反馈。
   * @param paths 拖入文件/文件夹的绝对路径数组（来自 renderer getPathForFile）
   * @returns {Promise<{ok:boolean, reason?:string, message?:string, copied?:string[], injected?:string|null}>}
   */
  async function handleDropFiles(paths) {
    const mainWindow = getMainWindow();
    const valid = Array.isArray(paths)
      ? paths.filter((p) => typeof p === 'string' && p.trim().length > 0)
      : [];
    if (valid.length === 0) {
      // 文件路径全部读取失败（如 File 引用丢失）：给反馈，避免静默失败
      feedback(mainWindow, '无法读取文件路径，请重试');
      return { ok: false, reason: 'no-files', message: '没有可用的文件' };
    }

    // ① 定位工作区
    const ws = await getWorkspacePath(mainWindow);
    if (!ws) {
      feedback(mainWindow, '请先在 DSH 里选择工作区（左侧工作区列表）');
      return { ok: false, reason: 'no-workspace', message: '请先在 DSH 里选择工作区' };
    }

    // ② 复制（逐个；部分失败不影响其他文件）
    // copied 元素为相对路径（如「拖入文件/a.txt」），供提示词使用
    const copied = [];
    for (const src of valid) {
      const name = await copyOne(src, ws);
      if (name) copied.push(`${DROP_DIR_NAME}/${name}`);
    }
    if (copied.length === 0) {
      feedback(mainWindow, '文件复制失败，请检查文件是否被占用后重试');
      return { ok: false, reason: 'copy-failed', message: '文件复制失败' };
    }

    // ③ 注入提示词（复用 promptlib:inject 链路；celebrate:false —— 气泡反馈走本模块）
    const text = buildPrompt(copied);
    const injected = await promptInject.injectTextIntoInput(mainWindow, text, { celebrate: false });
    if (injected && injected.ok) {
      feedback(mainWindow, copied.length === 1
        ? '文件已放入工作区，发送消息即可分析～'
        : `已放入 ${copied.length} 个文件，发送消息即可分析～`);
      return { ok: true, copied, injected: text };
    }

    // ④ 注入失败（无输入框/焦点被拦截/用户取消）：降级提示 —— 文件已复制，用户自己输入
    appendLog('warn', `拖文件注入提示词失败：${(injected && injected.reason) || 'unknown'}`);
    feedback(mainWindow, `文件已放入工作区（${copied.length} 个），在输入框输入提示词即可分析`);
    return { ok: true, copied, injected: null };
  }

  return { uniqueDest, copyOne, buildPrompt, handleDropFiles, DROP_DIR_NAME };
}

module.exports = { createDropFiles };
