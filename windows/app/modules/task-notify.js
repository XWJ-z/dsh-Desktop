'use strict';

/**
 * DSH-Desktop — 任务完成通知模块（v1.2.1 T8）
 *
 * 需求：DSH 跑长任务时，完成后弹系统通知（点击回主窗口），不用一直盯着界面。
 *
 * 检测（先调研 -> 保守方案）：
 *  DSH 任务端无稳定可依赖的「结束信号」API，采用**保守空闲判定**：
 *  - 监听 DSH 服务子进程 stdout/stderr；
 *  - 观察到输出（视为任务进行中）后开始计空闲；
 *  - 空闲超过 IDLE_MS（默认 3 分钟）→ 弹一次「DSH 任务完成」通知；
 *  - 再次有新输出（新一轮任务）→ 重新武装；空闲超时只在「有活动后」触发一次。
 *
 * 开关：settings.taskNotify（默认 true）；关闭时完全静默（不监听不通知）。
 *
 * 依赖注入（deps）：
 *  - getSettings / getServerChild
 *  - appendLog
 *  - notify           通知函数（main.js 注入：Electron Notification + 点击回主窗口）
 *  - showMainWindow   点击通知回主窗口
 */

const IDLE_MS = 3 * 60 * 1000; // 空闲 3 分钟视为任务完成（保守，避免误报）

function createTaskNotify(deps) {
  const { appendLog, getSettings, getServerChild, notify, showMainWindow, idleMs } = deps;
  const IDLE_MS = idleMs || 3 * 60 * 1000; // 空闲判定时长（默认 3 分钟，测试可注入）

  let watchedChild = null;
  let lastActivity = 0;
  let armed = false;    // 观察到输出后开始计空闲
  let notified = false; // 本「任务」已通知过（防重复）
  let idleTimer = null;

  /** 收到 DSH 输出行：刷新活动时间 + 武装 + 重置空闲计时 */
  function feed() {
    lastActivity = Date.now();
    if (!getSettings().taskNotify) return; // 开关关闭：完全静默（不武装不通知）
    // 新一轮活动（上一轮已通知过）→ 重新武装；否则首次活动也武装
    if (notified) { notified = false; armed = true; }
    else if (!armed) armed = true;
    resetIdleTimer();
  }

  function resetIdleTimer() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const idle = Date.now() - lastActivity;
      if (armed && !notified && idle >= IDLE_MS && getSettings().taskNotify) {
        notified = true;
        armed = false;
        appendLog('info', '检测到 DSH 任务空闲（视为任务完成），弹系统通知');
        doNotify();
      }
    }, IDLE_MS);
  }

  /** 弹系统通知（点击回主窗口） */
  function doNotify() {
    try {
      notify();
    } catch (err) {
      appendLog('warn', `弹任务完成通知失败：${err.message}`);
    }
  }

  /** 订阅 DSH 服务子进程输出（幂等：子进程变化才重挂监听） */
  function watchServer() {
    const child = getServerChild();
    if (!child || child === watchedChild) return;
    watchedChild = child;
    try {
      child.stdout && child.stdout.on('data', () => feed());
      child.stderr && child.stderr.on('data', () => feed());
      appendLog('info', '任务完成通知：已监听 DSH 服务输出（空闲判定）');
    } catch (err) {
      appendLog('warn', `任务完成通知监听失败：${err.message}`);
    }
  }

  /** 立即手动通知（调试/测试用） */
  function notifyNow() {
    if (getSettings().taskNotify) {
      notified = true;
      doNotify();
      return true;
    }
    return false;
  }

  return {
    watchServer,
    feed,
    notifyNow,
    showMainWindow,
    getState: () => ({ armed, notified, lastActivity }), // 调试/测试用
    IDLE_MS,
  };
}

module.exports = { createTaskNotify, IDLE_MS };
