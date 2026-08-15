'use strict';

/**
 * loading.js — 启动加载页脚本（独立文件，规避 CSP 对内联脚本的拦截）
 *
 * 与 main.js 通过 preload.js 暴露的 `window.dshDesktop` 通信：
 *  - getPort()：获取实际端口
 *  - getVersion() / getDshVersion()：壳版本 / DSH 运行时版本
 *  - onStage()：订阅启动阶段（①检查 ②下载/安装 ③启动服务 ④就绪）
 *  - onProgress()：订阅下载/安装进度（{ mb }）
 *  - onLog()：订阅主进程日志
 */

const portEl = document.getElementById('port');
const logWrap = document.getElementById('log-wrap');
const logToggle = document.getElementById('log-toggle');
const logEl = document.getElementById('log');
const dlProgressEl = document.getElementById('dl-progress');
const subtitleEl = document.getElementById('subtitle');
const verlineEl = document.getElementById('verline');
const params = new URLSearchParams(location.search);
if (params.get('port')) portEl.textContent = params.get('port');

// 日志区折叠：默认收起为一行，点击展开/收起；出错自动展开
let logExpanded = false;
function setLogExpanded(expanded) {
  logExpanded = expanded;
  logWrap.classList.toggle('expanded', expanded);
  logToggle.textContent = expanded ? '收起日志 ▴' : '查看详细日志 ▾';
}
logToggle.addEventListener('click', () => setLogExpanded(!logExpanded));

// 阶段指示器：点亮当前阶段，其余保持灰（L6：默认高亮①，避免监听注册前阶段已推送）
function setStage(stage) {
  const order = ['check', 'install', 'start', 'ready'];
  const idx = order.indexOf(stage);
  document.querySelectorAll('.stage').forEach((el) => {
    const on = el.dataset.stage === stage;
    el.classList.toggle('active', on);
    // 已完成的阶段标 ✓（含就绪阶段自身）
    el.classList.toggle('done', (idx > 0 && order.indexOf(el.dataset.stage) < idx) ||
      (stage === 'ready' && el.dataset.stage === 'ready'));
  });
  // 安装阶段结束后清空下载进度
  if (stage !== 'install' && dlProgressEl) dlProgressEl.textContent = '';
}
setStage('check'); // 默认处于"检查 DSH 运行时"，即使阶段消息先于监听到达也能显示

if (window.dshDesktop) {
  window.dshDesktop.getPort().then((port) => { if (port) portEl.textContent = port; });
  // L6：页面就绪后主动查询当前阶段，避免阶段消息先于监听注册到达而错过
  if (window.dshDesktop.getStage) {
    window.dshDesktop.getStage().then((stage) => { if (stage) setStage(stage); });
  }
  window.dshDesktop.onStage((stage) => { if (stage) setStage(stage); });

  // 版本行 + 首次/非首次文案（D1 + E4）
  if (window.dshDesktop.getDshVersion) {
    Promise.all([window.dshDesktop.getVersion(), window.dshDesktop.getDshVersion()])
      .then(([shellVer, dshVer]) => {
        if (verlineEl) verlineEl.textContent = `DSH-Desktop v${shellVer} · DSH ${dshVer ?? '未安装'}`;
        // 未安装 DSH = 首次启动：显示引导文案
        if (dshVer == null && subtitleEl) {
          subtitleEl.textContent = '首次启动需要下载 DSH 运行时，请耐心等待';
        }
      })
      .catch(() => { /* ignore */ });
  }

  // 下载/安装进度（D2）
  if (window.dshDesktop.onProgress && dlProgressEl) {
    window.dshDesktop.onProgress(({ mb }) => {
      dlProgressEl.textContent = `已下载 ${mb} MB…`;
    });
  }

  window.dshDesktop.onLog((line) => {
    const div = document.createElement('div');
    div.textContent = line;
    if (/\[error\]|\[npm:err\]|\[dsh:err\]/.test(line)) {
      div.classList.add('error');
      setLogExpanded(true); // 出错自动展开
    }
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  });
}
