'use strict';

/**
 * DSH-Desktop — 用户设置模块（v0.8.1 T5 从 main.js 抽出，纯搬移不改变行为）
 *
 * 设置持久化到 userData/settings.json。settings 对象本体仍由 main.js 持有
 * （大量窗口/菜单代码直接读 settings.xxx），本模块经 deps 读写它。
 *
 * 依赖注入说明（deps 字段）：
 *   - app / fs / path     Electron 与 Node 模块
 *   - appendLog          日志函数
 *   - getSettings        当前设置对象（getter，运行时实时取值）
 *   - setSettings        替换设置对象（loadSettings 合并后整体替换）
 *   - refreshMenus       重建托盘 + 应用菜单（设置变化后同步显示状态）
 */

function createSettings(deps) {
  const {
    app, fs, path,
    appendLog, getSettings, setSettings, refreshMenus,
  } = deps;

  /** 设置文件路径（userData/settings.json） */
  function settingsFile() {
    return path.join(app.getPath('userData'), 'settings.json');
  }

  function loadSettings() {
    try {
      const disk = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
      setSettings({ ...getSettings(), ...disk });
    } catch { /* 首次运行/损坏：用默认值 */ }
  }

  function saveSettings() {
    try {
      fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
      fs.writeFileSync(settingsFile(), JSON.stringify(getSettings(), null, 2), 'utf8');
    } catch (err) {
      appendLog('error', `保存设置失败：${err.message}`);
    }
  }

  /** 开机自启（设置菜单与托盘菜单统一入口；开发模式 setLoginItemSettings 无效属正常） */
  function setAutostart(enabled) {
    try {
      app.setLoginItemSettings({ openAtLogin: !!enabled });
      getSettings().autostart = !!enabled;
      saveSettings();
      appendLog('info', `开机自启已${enabled ? '开启' : '关闭'}`);
    } catch (err) {
      appendLog('error', `设置开机自启失败：${err.message}`);
    }
    refreshMenus();
  }

  /** 最小化到托盘总开关（v1.0.3：与关闭行为记忆联动 —— 开启托盘时清除「记住退出」，消除矛盾状态） */
  function setMinimizeToTray(enabled) {
    const s = getSettings();
    s.minimizeToTray = !!enabled;
    // v1.0.3（老大反馈 1）：记忆=退出 与 托盘常驻 语义矛盾 ——
    // 开启托盘时清除「记住退出」，避免「勾着最小化到托盘，关闭却直接退出」
    if (enabled && s.rememberCloseChoice && s.closeChoice === 'quit') {
      s.closeChoice = null;
      s.rememberCloseChoice = false;
      appendLog('info', '开启最小化到托盘：已清除「记住退出」记忆（关闭行为已改为托盘驻留）');
    }
    saveSettings();
    appendLog('info', `最小化到托盘已${enabled ? '开启' : '关闭'}（关闭窗口${enabled ? '将按设置执行' : '将直接退出'}）`);
    refreshMenus();
  }

  /** 关闭时总是询问开关（v1.0.3：独立开关；勾选后每次关闭都弹窗询问） */
  function setCloseAsk(enabled) {
    const s = getSettings();
    s.closeAsk = !!enabled;
    // 勾选「总是询问」→ 清除记忆（询问优先于记忆，避免两个开关语义冲突）
    if (enabled && s.rememberCloseChoice) {
      s.closeChoice = null;
      s.rememberCloseChoice = false;
      appendLog('info', '开启「关闭时总是询问」：已清除关闭行为记忆');
    }
    saveSettings();
    appendLog('info', `关闭时总是询问已${enabled ? '开启' : '关闭'}`);
    refreshMenus();
  }

  /** 记住关闭选择（action: 'quit' | 'tray'；v1.0.3：联动最小化到托盘勾选状态） */
  function setCloseChoice(action, remember) {
    const s = getSettings();
    s.closeChoice = action;
    s.rememberCloseChoice = !!remember;
    if (remember) {
      s.closeAsk = false; // 已记住选择：不再总是询问
      if (action === 'quit') {
        // v1.0.3（老大反馈 1）：记住退出 = 关闭即退出 → 托盘常驻失去意义，
        // 取消勾选「最小化到托盘」（避免「勾着托盘却关闭即退出」的矛盾显示）
        s.minimizeToTray = false;
      } else if (action === 'tray') {
        s.minimizeToTray = true;
      }
      appendLog('info', `已记住关闭行为：${action === 'quit' ? '退出' : '关闭到托盘'}（最小化到托盘=${s.minimizeToTray ? '开启' : '关闭'}）`);
    }
    saveSettings();
    refreshMenus();
  }

  /** 清除记忆：关闭窗口时恢复询问 */
  function clearCloseChoice() {
    getSettings().closeChoice = null;
    getSettings().rememberCloseChoice = false;
    saveSettings();
    appendLog('info', '已清除关闭行为记忆，关闭窗口时将再次询问');
    refreshMenus();
  }

  /** 启动时检查更新开关 */
  function setCheckUpdateOnStart(enabled) {
    getSettings().checkUpdateOnStart = !!enabled;
    saveSettings();
    appendLog('info', `启动时检查更新已${enabled ? '开启' : '关闭'}`);
    refreshMenus();
  }

  return {
    settingsFile,
    loadSettings,
    saveSettings,
    setAutostart,
    setMinimizeToTray,
    setCloseAsk, // v1.0.3：关闭时总是询问开关
    setCloseChoice,
    clearCloseChoice,
    setCheckUpdateOnStart,
  };
}

module.exports = { createSettings };
