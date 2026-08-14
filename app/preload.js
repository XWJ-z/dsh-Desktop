'use strict';

/**
 * DSH Desktop — 预加载脚本
 * 通过 contextBridge 向渲染进程暴露最小化的、只读的桌面应用信息。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshDesktop', {
  /** 桌面应用版本号 */
  getVersion: () => ipcRenderer.invoke('dsh:version'),
  /** 已安装 DSH 运行时版本（未安装返回 null） */
  getDshVersion: () => ipcRenderer.invoke('dsh:installed-dsh-version'),
  /** DSH Web 服务实际使用的端口 */
  getPort: () => ipcRenderer.invoke('dsh:port'),
  /** 订阅启动阶段（①检查 ②下载/安装 ③启动服务 ④就绪，返回取消订阅函数） */
  onStage: (callback) => {
    const handler = (_event, stage) => callback(stage);
    ipcRenderer.on('dsh:stage', handler);
    return () => ipcRenderer.removeListener('dsh:stage', handler);
  },
  /** 查询当前启动阶段（页面脚本就绪后调用，避免错过早期推送） */
  getStage: () => ipcRenderer.invoke('dsh:stage'),
  /** 订阅下载/安装进度（{ mb: '23.4' }，返回取消订阅函数） */
  onProgress: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('dsh:progress', handler);
    return () => ipcRenderer.removeListener('dsh:progress', handler);
  },
  /** 订阅主进程日志（返回取消订阅函数） */
  onLog: (callback) => {
    const handler = (_event, line) => callback(line);
    ipcRenderer.on('dsh:log', handler);
    return () => ipcRenderer.removeListener('dsh:log', handler);
  },
});
