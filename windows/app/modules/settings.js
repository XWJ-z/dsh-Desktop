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

  /** 最小化到托盘总开关 */
  function setMinimizeToTray(enabled) {
    getSettings().minimizeToTray = !!enabled;
    saveSettings();
    appendLog('info', `最小化到托盘已${enabled ? '开启' : '关闭'}（关闭窗口${enabled ? '将询问/驻留托盘' : '将直接退出'}）`);
    refreshMenus();
  }

  /** 记住关闭选择（action: 'quit' | 'tray'） */
  function setCloseChoice(action, remember) {
    getSettings().closeChoice = action;
    getSettings().rememberCloseChoice = !!remember;
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
    setCloseChoice,
    clearCloseChoice,
    setCheckUpdateOnStart,
  };
}

module.exports = { createSettings };
