'use strict';

/**
 * close-choice.js — 关闭行为询问弹窗（v0.6.1）
 * 用户点窗口 X 且未记住选择时弹出：
 *  - 关闭到托盘（后台运行，默认推荐）
 *  - 退出（停止 DSH 服务）
 *  - 复选框「记住我的选择」→ 主进程持久化，下次直接执行不再询问
 */

const el = (id) => document.getElementById(id);
const dsh = window.dshDesktop;

function choose(action) {
  const remember = el('remember').checked;
  if (dsh && dsh.chooseCloseAction) {
    dsh.chooseCloseAction({ action, remember });
  }
}

el('btn-tray').addEventListener('click', () => choose('tray'));
el('btn-quit').addEventListener('click', () => choose('quit'));
