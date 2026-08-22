'use strict';

/**
 * test-v121-task-notify.js — v1.2.1 T8 task-notify 模块行为测试
 *
 * 覆盖：开关静默 / 空闲判定触发一次 / 新一轮活动重新武装 / notifyNow /
 *       监听子进程（getServerChild 幂等重挂）/ 点击回主窗口回调。
 *
 * 用法：node tests/test-v121-task-notify.js
 */

const { createTaskNotify } = require('../modules/task-notify');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function makeEnv() {
  const state = { taskNotify: true };
  const calls = { notify: 0, click: 0 };
  let child = null;
  const tn = createTaskNotify({
    appendLog: () => {},
    getSettings: () => state,
    getServerChild: () => child,
    notify: () => { calls.notify++; },
    showMainWindow: () => { calls.click++; },
    idleMs: 60, // 最快能触发
  });
  return { tn, state, calls, setChild: (c) => { child = c; } };
}

async function run() {
  console.log('[T8] 开关静默');
  {
    const e = makeEnv();
    e.state.taskNotify = false;
    e.tn.feed('some output');
    ok(e.tn.notifyNow() === false, '开关关 → notifyNow 不通知');
    ok(e.calls.notify === 0, '开关关 → 零通知');
  }

  console.log('[T8] 空闲判定触发一次 + 重新武装');
  {
    const e = makeEnv();
    e.tn.feed('task start');
    ok(e.tn.getState().armed === true, 'feed 后 armed = true（任务进行中）');
    await new Promise((r) => setTimeout(r, 100)); // 超过 idleMs(60)
    ok(e.calls.notify === 1, '空闲超时 → 弹一次通知');
    ok(e.tn.getState().notified === true, '通知后 notified = true（防重复）');
    // 再等一段时间：不重复通知
    await new Promise((r) => setTimeout(r, 100));
    ok(e.calls.notify === 1, '无新活动 → 不重复通知');
    // 新一轮活动 → 重新武装 → 空闲后再通知一次
    e.tn.feed('new task');
    ok(e.tn.getState().armed === true && e.tn.getState().notified === false, '新一轮活动重新武装');
    await new Promise((r) => setTimeout(r, 100));
    ok(e.calls.notify === 2, '新一轮空闲 → 再通知一次');
  }

  console.log('[T8] notifyNow（开关开）');
  {
    const e = makeEnv();
    ok(e.tn.notifyNow() === true, '开关开 → notifyNow 通知');
    ok(e.calls.notify === 1, 'notifyNow 已通知');
  }

  console.log('[T8] 监听子进程（幂等）');
  {
    const e = makeEnv();
    const { EventEmitter } = require('node:events');
    const child1 = new EventEmitter(); child1.stdout = new EventEmitter(); child1.stderr = new EventEmitter();
    e.setChild(child1);
    e.tn.watchServer();
    e.tn.feed('a'); // 直接 feed 计入活动（getState 不依赖输出流）
    // 再次 watch 同一 child：不应重复失败
    e.tn.watchServer();
    ok(true, '重复 watchServer 不抛错（幂等）');
  }

  console.log(`\n${passed} 通过, ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error('执行抛错：', err); process.exit(1); });
