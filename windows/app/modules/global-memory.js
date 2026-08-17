'use strict';

/**
 * DSH-Desktop — 全局记忆模块（v0.9.12，老大指令：宠物新增【全局记忆】）
 *
 * 职责：维护用户全局记忆文件（userData/global-memory.md）：
 *  - 首次使用自动创建（带中文模板，引导用户记录偏好/项目背景/常用约定）；
 *  - 宠物菜单「🧠 全局记忆」点击 → 系统默认编辑器打开文件手动修改；
 *  - 文件与 settings.json 同级，纳入数据备份/恢复（backup.js 经 file() 注入）。
 *
 * 依赖注入（deps）：
 *  - app / fs / path / shell      Electron 与 Node 模块
 *  - appendLog                    日志模块
 */

const FILE_NAME = 'global-memory.md';

/** 首次创建时的默认内容（中文模板 + 使用引导） */
const DEFAULT_CONTENT = `# 全局记忆

> 这里记录你想长期保留的信息（个人偏好、项目背景、常用约定等）。
> 编辑保存后即可长期保存；备份数据时本文件会一并备份。
> 提示：需要 DSH 参考记忆内容时，把相关段落复制到对话里发送即可。

## 我的信息
- 称呼：
- 身份/角色：

## 常用偏好
- 语言风格：
- 输出习惯：

## 项目背景
- 项目：
- 技术栈：
- 当前进度：

## 常用约定
- 

## 其他备忘
- 
`;

function createGlobalMemory(deps) {
  const { app, fs, path, shell, appendLog } = deps;

  /** 全局记忆文件路径（userData/global-memory.md，与 settings.json 同级） */
  function file() {
    return path.join(app.getPath('userData'), FILE_NAME);
  }

  /**
   * 确保记忆文件存在：首次没有 → 自动创建（带模板）。
   * @returns {{ ok: boolean, created: boolean, file: string, message?: string }}
   */
  function ensureFile() {
    const f = file();
    try {
      if (!fs.existsSync(f)) {
        fs.writeFileSync(f, DEFAULT_CONTENT, 'utf8');
        appendLog('info', `全局记忆文件已自动创建：${f}`);
        return { ok: true, created: true, file: f };
      }
      return { ok: true, created: false, file: f };
    } catch (err) {
      appendLog('error', `创建全局记忆文件失败：${err.message}`);
      return { ok: false, file: f, message: err.message };
    }
  }

  /**
   * 打开全局记忆文件（确保存在后交给系统默认编辑器，如记事本）。
   * 返回 Promise（shell.openPath 是异步的，失败给 err 字符串）。
   */
  async function open() {
    const r = ensureFile();
    if (!r.ok) return { ok: false, message: r.message };
    try {
      const err = await shell.openPath(r.file);
      if (err) {
        appendLog('warn', `打开全局记忆文件失败：${err}`);
        return { ok: false, file: r.file, message: err };
      }
      return { ok: true, file: r.file, created: r.created };
    } catch (e) {
      appendLog('warn', `打开全局记忆文件异常：${e.message}`);
      return { ok: false, file: r.file, message: e.message };
    }
  }

  return { file, ensureFile, open };
}

module.exports = { createGlobalMemory, FILE_NAME, DEFAULT_CONTENT };
