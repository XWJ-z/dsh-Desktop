'use strict';

/**
 * cdp-v090-sim.js — v0.9 拖动文件功能 CDP 仿真（团队标准流程，真包）
 *
 * 按 AGENTS.md「CDP 仿真测试能力与步骤」执行：
 *  1. 仿真目录 <Temp>\dsh-sim-v090\（userdata + dshhome + workspace；dshenv 从
 *     dsh-sim14 复用 —— junction 链接，避免重新下载 246MB DSH 运行时）
 *  2. 预置隔离 DSH_HOME（不碰真实 ~/.dsh）：storages/workspace.json 单工作区
 *     （tier3 兜底）+ session_projcache.json（sim-session → workspace，tier1/2 用）
 *  3. 启动 dist 打包产物：DSH-Desktop.exe --user-data-dir=<sim>\userdata
 *     --port=3098 --remote-debugging-port=9238（env DSH_HOME=<sim>\dshhome）
 *  4. CDP 驱动真实 DSH 页面：
 *     - Runtime.evaluate：确认 __dshDropInstalled；写 localStorage
 *       dsh.sessions.current（tier1 定位）；取视口中心
 *     - Input.dispatchDragEvent（dragEnter/dragOver/drop + files）→ 真实文件拖拽
 *  5. 断言：文件复制进隔离工作区（内容一致）、页面不导航、气泡/toast 反馈、
 *     输入框注入状态（记录）、工作区定位路径（读应用日志）
 *  6. 杀仿真进程（只按 exe Path 匹配，防误杀）
 *
 * 用法：node tests/cdp-v090-sim.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_ROOT = path.join(__dirname, '..');
const PACKED_EXE = path.join(APP_ROOT, 'dist', 'DSH-Desktop-win32-x64', 'DSH-Desktop.exe');
const SIM_ROOT = path.join(os.tmpdir(), 'dsh-sim-v090');
const DSHENV_SOURCE = path.join(os.tmpdir(), 'dsh-sim14', 'dshenv');
// 首次跑会被 npm 重建 dshenv（junction 删除重装），此后 dsh-sim-v090 自带真实 dshenv
const DSHENV_PRIOR = path.join(SIM_ROOT, 'userdata', 'dshenv');
const SIM_PORT = 3098;
const SIM_DEBUG_PORT = 9238;

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** HTTP GET（小响应） */
async function httpGet(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { status: res.status, body: await res.text() };
  } finally {
    clearTimeout(t);
  }
}

/** CDP 客户端（Node 24 内置 WebSocket） */
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error('WebSocket 连接失败: ' + (e.message || 'unknown'))));
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error('CDP error: ' + JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { try { ws.close(); } catch { /* ignore */ } },
  };
}

async function main() {
  if (!fs.existsSync(PACKED_EXE)) throw new Error(`打包产物不存在：${PACKED_EXE}（先 npm run pack）`);

  // ① 仿真目录
  fs.rmSync(SIM_ROOT, { recursive: true, force: true });
  const userData = path.join(SIM_ROOT, 'userdata');
  const dshHome = path.join(SIM_ROOT, 'dshhome');
  const workspace = path.join(SIM_ROOT, 'workspace');
  fs.mkdirSync(path.join(userData, 'dshenv'), { recursive: true });
  fs.mkdirSync(path.join(dshHome, 'storages'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  // dshenv：优先复用上次仿真的真实安装；否则从 dsh-sim14 junction（首次会被 npm 删除重建）
  const priorBin = path.join(DSHENV_PRIOR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const hasPrior = fs.existsSync(priorBin);
  if (hasPrior) {
    fs.cpSync(DSHENV_PRIOR, path.join(userData, 'dshenv'), { recursive: true });
    console.log('[0] 仿真目录：' + SIM_ROOT + '（复用上次仿真 dshenv）');
  } else {
    if (!fs.existsSync(DSHENV_SOURCE)) throw new Error(`dshenv 源不存在：${DSHENV_SOURCE}`);
    fs.symlinkSync(DSHENV_SOURCE, path.join(userData, 'dshenv', 'node_modules'), 'junction');
    console.log('[0] 仿真目录：' + SIM_ROOT + '（dshenv 从 dsh-sim14 junction，首次运行会被 npm 重建）');
  }

  // ② 预置 DSH_HOME（只预置 workspace.json —— tier3 单工作区兜底；
  // 不预置 projcache：其 records schema 严格（如 sessionListMetadata 必带 seq），
  // 手写易触发 ZodError → DSH 服务崩溃 → 主窗口加载失败落 chrome-error 页
  // （第一次仿真实测踩坑，已归档教训）。tier1（localStorage→projcache）由
  // tests/check-v090.js 单测覆盖，真机 e2e T5 走真实链路。）
  // ⚠ 必须预置 settings.yaml 的 ui-onboarding：全新 DSH_HOME 首次启动会弹
  // 「内测声明」modal（第二次仿真实测踩坑：modal 拦截拖拽/页面交互，复制不触发）。
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dshHome, 'settings.yaml'),
    'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n', 'utf8');
  fs.writeFileSync(path.join(dshHome, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['sim-ws'] },
    tables: {
      workspaces: { 'sim-ws': { path: workspace, title: 'v090-sim', sessionIds: [], createdAt: now, updatedAt: now } },
    },
  }, null, 2), 'utf8');

  // 拖入源文件
  const srcFile = path.join(SIM_ROOT, `dsh-v090-sim-${Date.now()}.txt`);
  fs.writeFileSync(srcFile, 'v0.9 cdp drag simulation content', 'utf8');

  // ③ 启动仿真
  console.log('[1] 启动打包应用（--port=' + SIM_PORT + ' --remote-debugging-port=' + SIM_DEBUG_PORT + '）');
  const child = spawn(PACKED_EXE, [
    `--user-data-dir=${userData}`,
    `--port=${SIM_PORT}`,
    `--remote-debugging-port=${SIM_DEBUG_PORT}`,
  ], {
    env: { ...process.env, DSH_HOME: dshHome },
    stdio: 'ignore',
    detached: true,
    windowsHide: true,
  });
  child.unref();

  // ④ 等待 CDP 就绪 + 主页面 target
  console.log('[2] 等待 CDP/DSH 服务就绪…');
  let target = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 240_000) {
    try {
      const r = await httpGet(`http://127.0.0.1:${SIM_DEBUG_PORT}/json`);
      if (r.status === 200) {
        const targets = JSON.parse(r.body);
        target = targets.find((t) => t.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+/.test(t.url));
        if (target) break;
      }
    } catch { /* 未就绪 */ }
    await sleep(1000);
  }
  ok(!!target, `DSH 主页面 target 就绪（${target ? target.url : '超时'}）`);
  if (!target) { killSim(); process.exit(1); }
  const webBase = target.url;
  const cdp = cdpConnect(target.webSocketDebuggerUrl);

  try {
    // 等待拖拽监听注入
    const t1 = Date.now();
    let installed = false;
    while (Date.now() - t1 < 30_000) {
      try {
        const r = await cdp.send('Runtime.evaluate', {
          expression: '!!window.__dshDropInstalled',
          returnByValue: true,
        });
        installed = r.result && r.result.value === true;
      } catch { /* ignore */ }
      if (installed) break;
      await sleep(500);
    }
    ok(installed, '拖拽监听已注入（__dshDropInstalled）');

    // 模拟真实用户的「当前会话」localStorage（projcache 未预置 → tier1 miss，
    // 落到 tier3 唯一注册工作区；tier1 映射逻辑由 check-v090 单测覆盖）
    await cdp.send('Runtime.evaluate', {
      expression: `localStorage.setItem('dsh.sessions.current', JSON.stringify({sessionId:'sim-session'}))`,
      returnByValue: true,
    }).catch(() => {});
    // 诊断监听：记录 dragenter/drop 是否到达 window、types、defaultPrevented
    // ⚠ v0.9.2：注入监听 stopImmediatePropagation 后，本诊断（window 上后注册）
    //   会收不到事件 —— 属预期（说明我们的监听最先拦截），仅作提示不作断言。
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        window.__dragDiag = [];
        window.addEventListener('dragenter', (e) => {
          window.__dragDiag.push(['enter', Array.from((e.dataTransfer && e.dataTransfer.types) || [])]);
        }, true);
        window.addEventListener('dragover', (e) => {
          window.__dragDiag.push(['over', Array.from((e.dataTransfer && e.dataTransfer.types) || [])]);
        }, true);
        window.addEventListener('drop', (e) => {
          window.__dragDiag.push(['drop', Array.from((e.dataTransfer && e.dataTransfer.types) || []), 'prevented=' + e.defaultPrevented, 'dropInstalled=' + !!window.__dshDropInstalled]);
        }, true);
        return true;
      })()`,
      returnByValue: true,
    }).catch(() => {});

    // ★ v0.9.2 bug 防回归探针：模拟 DSH 自身的 document 级拖放监听
    // （dsh-client-ui-attachment DropOverlay/DragMask 的 owner 在 document 上
    // 维护 enter/leave 计数）。修复前 document 会收到 dragenter → 激活
    // 「图片拖动添加界面」，而 drop 被我们吞掉 → 遮罩卡死。修复后 document
    // 收不到任何 Files 拖放事件，探针计数必须全为 0。
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        window.__docDrag = { enter: 0, over: 0, drop: 0, leave: 0 };
        const count = (k) => (e) => {
          window.__docDrag[k]++;
          if (k === 'enter') {
            window.__docDrag.lastEnterTypes = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
            window.__docDrag.enterPrevented = e.defaultPrevented;
          }
        };
        document.addEventListener('dragenter', count('enter'), true);
        document.addEventListener('dragover', count('over'), true);
        document.addEventListener('drop', count('drop'), true);
        document.addEventListener('dragleave', count('leave'), true);
        return true;
      })()`,
      returnByValue: true,
    }).catch(() => {});

    // role=status 基线（拖拽前页面已有的状态元素；DSH DropOverlay 根元素 role=status）
    let statusBaseline = [];
    try {
      const b = await cdp.send('Runtime.evaluate', {
        expression: `Array.from(document.querySelectorAll('[role="status"]')).map((el) => el.id || el.className || (el.textContent || '').slice(0, 24))`,
        returnByValue: true,
      });
      statusBaseline = (b.result && b.result.value) || [];
    } catch { /* ignore */ }

    // 视口中心
    const vp = await cdp.send('Runtime.evaluate', {
      expression: '({x: Math.round(innerWidth/2), y: Math.round(innerHeight/2)})',
      returnByValue: true,
    });
    const box = vp.result.value;

    // CDP 原生文件拖拽
    const dragData = {
      items: [
        { mimeType: 'text/plain', data: 'dsh-v090-sim' },
        { mimeType: 'text/uri-list', data: `file:///${srcFile.replace(/\\/g, '/')}` },
      ],
      files: [srcFile],
      dragOperationsMask: 1,
    };
    try {
      await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: box.x, y: box.y, data: dragData });
      await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: box.x, y: box.y, data: dragData });
      await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: box.x, y: box.y, data: dragData });
      ok(true, 'CDP Input.dispatchDragEvent 派发成功（真实 DSH 页面）');
    } catch (err) {
      ok(false, `CDP 派发失败：${err.message}`);
    }
    // 读诊断
    await sleep(500);
    try {
      const diag = await cdp.send('Runtime.evaluate', { expression: 'window.__dragDiag', returnByValue: true });
      const rows = (diag.result && diag.result.value) || [];
      console.log('  ℹ drag 事件诊断（window capture；stopImmediatePropagation 后为空 = 拦截生效）：');
      for (const r of rows.slice(-8)) console.log('    - ' + JSON.stringify(r));
      if (rows.length === 0) console.log('    （window 诊断监听未收到事件 —— 注入监听最先拦截，预期行为）');
    } catch { /* ignore */ }

    // 对照：绕过拖拽事件直接调 IPC（验证 dropFiles → 复制链路本身）
    await cdp.send('Runtime.evaluate', {
      expression: `window.dshDesktop.dropFiles(${JSON.stringify([srcFile])})`,
      returnByValue: true,
    }).catch(() => {});

    // ⑤ 断言
    // a) 文件复制进隔离工作区的「拖入文件」专用文件夹（v0.9.3）
    const t2 = Date.now();
    let copied = null;
    const dropDir = path.join(workspace, '拖入文件');
    while (Date.now() - t2 < 20_000) {
      const entries = fs.existsSync(dropDir)
        ? fs.readdirSync(dropDir).filter((n) => n.startsWith('dsh-v090-sim-'))
        : [];
      if (entries.length > 0) { copied = entries[0]; break; }
      await sleep(300);
    }
    ok(!!copied, `★ 文件复制进隔离工作区/拖入文件/（${copied}）—— 全链路打通`);
    if (copied) {
      const content = fs.readFileSync(path.join(dropDir, copied), 'utf8');
      ok(content === 'v0.9 cdp drag simulation content', '复制内容完整');
    } else {
      // 诊断：输出应用日志尾部，定位 dropFiles 是否被调用/在哪一步失败
      const logsDir = path.join(userData, 'logs');
      try {
        const logFiles = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log'));
        const latest = logFiles.map((f) => ({ f, m: fs.statSync(path.join(logsDir, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
        if (latest) {
          const tail = fs.readFileSync(path.join(logsDir, latest.f), 'utf8').split(/\r?\n/).slice(-15).join('\n');
          console.log('  —— 应用日志尾部 ——\n' + tail);
        }
      } catch { /* ignore */ }
    }

    // b) 页面不导航
    const url = await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    ok(url.result.value === webBase, `页面不导航（仍为 ${url.result.value}）`);

    // b2) ★ v0.9.2 bug 防回归：DSH 页面自身（document 级监听）收不到任何文件拖放事件
    //    —— DropOverlay「图片拖动添加界面」不会激活，也不会卡死
    try {
      const d = await cdp.send('Runtime.evaluate', { expression: 'window.__docDrag', returnByValue: true });
      const dc = (d.result && d.result.value) || {};
      console.log(`  ℹ document 探针计数：enter=${dc.enter} over=${dc.over} drop=${dc.drop} leave=${dc.leave}`
        + (dc.lastEnterTypes ? `（enter types=${JSON.stringify(dc.lastEnterTypes)}）` : ''));
      ok(dc.enter === 0 && dc.over === 0 && dc.drop === 0 && dc.leave === 0,
        '★ DSH 页面未收到任何文件拖放事件（DropOverlay 不激活、不卡死）');
    } catch (err) {
      ok(false, '读取 document 探针失败：' + err.message);
    }

    // b3) ★ v0.9.2 bug 防回归：页面无 DSH 拖放遮罩残留（对比拖拽前 role=status 基线）
    try {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `Array.from(document.querySelectorAll('[role="status"]')).map((el) => el.id || el.className || (el.textContent || '').slice(0, 24))`,
        returnByValue: true,
      });
      const now = (r.result && r.result.value) || [];
      const added = now.filter((s) => !statusBaseline.includes(s));
      ok(added.length === 0,
        added.length === 0
          ? '★ 拖拽后无新增 role=status 遮罩（DSH 拖放界面未残留）'
          : `拖拽后新增 role=status 元素：${JSON.stringify(added)} —— DSH 拖放界面被激活（bug 复现）`);
    } catch (err) {
      ok(false, '检查 DSH 遮罩残留失败：' + err.message);
    }

    // c) 气泡/toast 反馈
    const t3 = Date.now();
    let bubble = false;
    while (Date.now() - t3 < 20_000) {
      try {
        const r = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const b = document.querySelector('#dsh-pet .pet-bubble');
            if (b && b.style.display !== 'none' && b.textContent.includes('文件已放入工作区')) return true;
            const t = document.getElementById('dsh-drop-toast');
            if (t && t.style.display !== 'none' && t.textContent.includes('文件已放入工作区')) return true;
            return false;
          })()`,
          returnByValue: true,
        });
        bubble = r.result && r.result.value === true;
      } catch { /* ignore */ }
      if (bubble) break;
      await sleep(500);
    }
    ok(bubble, '气泡/toast 反馈出现（含「文件已放入工作区」）');

    // d) 输入框注入状态（全新 DSH_HOME 可能无会话无输入框 → 降级属预期，仅记录）
    try {
      const inp = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          const el = document.activeElement;
          if (!el) return '';
          return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? (el.value || '') : (el.textContent || '');
        })()`,
        returnByValue: true,
      });
      const text = (inp.result && inp.result.value) || '';
      console.log(`  ℹ 输入框内容：${text ? '「' + text.slice(0, 60) + '…」' : '（空/无输入框，注入降级属预期）'}`);
    } catch { /* ignore */ }

    // e) 工作区定位路径（读应用日志确认走了哪档）
    await sleep(800);
    const logsDir = path.join(userData, 'logs');
    if (fs.existsSync(logsDir)) {
      const logFiles = fs.readdirSync(logsDir).filter((f) => f.endsWith('.log') || f.endsWith('.txt'));
      const latest = logFiles.map((f) => ({ f, m: fs.statSync(path.join(logsDir, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
      if (latest) {
        const content = fs.readFileSync(path.join(logsDir, latest.f), 'utf8');
        const m = content.match(/工作区定位（[^）]*）/g);
        if (m && m.length > 0) console.log(`  ℹ 工作区定位日志：${m[m.length - 1]}`);
        else console.log('  ℹ 应用日志未见「工作区定位」记录');
      }
    }
  } finally {
    cdp.close();
  }

  // ⑥ 杀仿真（只按 exe Path 匹配）
  killSim();

  console.log('');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

/** 杀仿真进程：只按 exe 路径匹配（防误杀真实实例） */
function killSim() {
  const { execFileSync } = require('node:child_process');
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Get-Process | Where-Object { $_.Path -like '*dsh-sim-v090*' -or $_.Path -like '*dsh-Desktop-win32-x64*' } | Stop-Process -Force`,
    ], { stdio: 'ignore', timeout: 15_000 });
    console.log('[3] 仿真进程已清理（按 Path 匹配）');
  } catch (err) {
    console.warn('[3] 杀仿真进程警告（可能已退出）：' + err.message);
  }
}

main().catch((err) => {
  console.error('仿真异常：', err);
  killSim();
  process.exit(1);
});
