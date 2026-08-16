'use strict';

/**
 * mock-electron 加载测试（v0.8.12 优化方案验证）：
 * 用 mock 的 electron 模块加载 main.js，验证模块组装（logger/node-resolver/
 * port-manager/dsh-runtime/serverLifecycle/updater/pet）在启动早期无 TDZ、
 * 无未定义引用、无 require 错误。app.whenReady 永不 resolve，不进入真实启动。
 */

const Module = require('node:module');

class MockBrowserWindow {
  constructor(opts) { this.opts = opts; this.webContents = { send() {}, on() {}, executeJavaScript() { return Promise.resolve(); }, insertText() {}, setWindowOpenHandler() {}, toggleDevTools() {}, getURL() { return ''; } }; }
  loadFile() { return Promise.resolve(); }
  loadURL() { return Promise.resolve(); }
  show() {} hide() {} focus() {} close() {} destroy() {} reload() {}
  isDestroyed() { return false; }
  isMinimized() { return false; }
  isMaximizable() { return true; }
  isMaximized() { return false; }
  maximize() {} restore() {}
  getBounds() { return { x: 0, y: 0, width: 800, height: 600 }; }
  setProgressBar() {}
  once() {}
  on() {}
}

const mockElectron = {
  app: {
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    on: () => {},
    quit: () => {},
    relaunch: () => {},
    exit: () => {},
    getPath: (name) => (name === 'userData' ? 'C:\\mock\\userData' : 'C:\\mock\\app'),
    getAppPath: () => 'C:\\mock\\app',
    getVersion: () => '0.8.12',
    isPackaged: false,
    getName: () => 'DSH-Desktop',
    setLoginItemSettings: () => {},
    getLoginItemSettings: () => ({ openAtLogin: false, wasOpenedAtLogin: false }),
    setApplicationMenu: () => {},
  },
  BrowserWindow: MockBrowserWindow,
  dialog: { showMessageBox: () => Promise.resolve({ response: 0 }), showErrorBox: () => {} },
  shell: { openExternal: () => {}, openPath: () => {}, showItemInFolder: () => {} },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => {} },
  Tray: class { constructor() {} setToolTip() {} setContextMenu() {} on() {} destroy() {} },
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {} },
  globalShortcut: { register: () => true, unregister: () => {}, unregisterAll: () => {} },
  screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
  clipboard: { writeText: () => {} },
  nativeImage: { createFromPath: () => ({ resize: () => ({ toPNG: () => Buffer.from(''), toICO: () => Buffer.from('') }) }) },
};

const origLoad = Module._load;
Module._load = function (request, _parent, _isMain) {
  if (request === 'electron') return mockElectron;
  return origLoad.apply(this, arguments);
};

try {
  require('../main.js');
  console.log('MAIN LOAD OK: main.js assembled without errors');
} catch (err) {
  console.error('MAIN LOAD FAILED: ' + err.message);
  console.error(err.stack);
  process.exit(1);
}
