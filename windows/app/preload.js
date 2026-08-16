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
  // ── v0.5.3：更新窗口 / 联系我们 / 关于窗口（最小暴露）──
  /** 查询壳+DSH 两侧更新信息 */
  queryUpdate: () => ipcRenderer.invoke('update:query'),
  /** 触发 DSH 升级（改 config + 重启） */
  upgradeDsh: () => ipcRenderer.invoke('update:dsh-upgrade'),
  /** 触发壳更新下载（进度经 onUpdateProgress 推送） */
  downloadShellUpdate: () => ipcRenderer.invoke('update:shell-download'),
  /** 订阅壳更新下载进度（{ percent: 0-100 }，返回取消订阅函数） */
  onUpdateProgress: (callback) => {
    const handler = (_event, info) => callback(info);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },
  /** 复制文本到剪贴板 */
  copyText: (text) => ipcRenderer.invoke('clip:copy', text),
  /** 获取联系我们信息（群号 + 二维码路径） */
  getContactInfo: () => ipcRenderer.invoke('contact:info'),
  /** 获取关于信息（版本/DSH/服务地址/图标） */
  getAboutInfo: () => ipcRenderer.invoke('about:info'),
  /** 关于窗口：关闭并打开更新窗口 */
  openUpdateWindow: () => ipcRenderer.invoke('about:open-update'),
  /** 打开外部链接（仅 http/https） */
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  /** 网页打开按钮拖拽位置上报（v0.7.5：会话内记忆） */
  saveWebOpenBtnPos: (pos) => ipcRenderer.invoke('web-open-btn:pos', pos),
});
