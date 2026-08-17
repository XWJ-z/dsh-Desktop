'use strict';

/**
 * cdp-v095-sim.js — v0.9.5 功能 CDP 仿真（真包，团队标准流程）
 *
 * 覆盖（在真实打包产物 + 真实 DSH 页面上）：
 *  1. 提示词库窗口能打开（toolbox:open-promptlib → promptlib.html target）
 *  2. 提示词库双 tab 渲染（📚 内置库 / ✏️ 我的提示词）+ 内置库 101 条数据可用
 *  3. 自定义提示词 IPC 全链路：save → list（读回）→ delete
 *     （写真实 userData/custom-prompts.json，仿真结束清理）
 *  4. 公告 notice:data 返回 notice.json items（唯一源），菜单公告条 marquee 有值
 *  5. 拖拽回归：文件仍复制进 拖入文件/ + DropOverlay 探针全 0（0.9.2/0.9.3 不回归）
 *
 * 用法：node tests/cdp-v095-sim.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_ROOT = path.join(__dirname, '..');
const PACKED_EXE = path.join(APP_ROOT, 'dist', 'DSH-Desktop-win32-x64', 'DSH-Desktop.exe');
const SIM_ROOT = path.join(os.tmpdir(), 'dsh-sim-v095');
const SIM_PORT = 3099;
const SIM_DEBUG_PORT = 9239;

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function httpGet(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { status: res.status, body: await res.text() };
  } finally { clearTimeout(t); }
}

function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('ws connect fail')));
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

async function waitTarget(debugPort, predicate, timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await httpGet(`http://127.0.0.1:${debugPort}/json`);
      if (r.status === 200) {
        const targets = JSON.parse(r.body);
        const hit = targets.find(predicate);
        if (hit) return hit;
      }
    } catch { /* ignore */ }
    await sleep(800);
  }
  return null;
}

function killSim() {
  const { execFileSync } = require('node:child_process');
  try {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Get-Process | Where-Object { $_.Path -like '*dsh-sim-v095*' -or $_.Path -like '*dsh-Desktop-win32-x64*' } | Stop-Process -Force`,
    ], { stdio: 'ignore', timeout: 15_000 });
    console.log('[x] 仿真进程已清理（按 Path 匹配）');
  } catch (err) {
    console.warn('[x] 杀仿真进程警告（可能已退出）：' + err.message);
  }
}

async function main() {
  if (!fs.existsSync(PACKED_EXE)) throw new Error(`打包产物不存在：${PACKED_EXE}（先 npm run pack）`);

  // 仿真目录（userData + dshhome；复用上次 v0.9.5 仿真的 dshenv 或 v090 的）
  fs.rmSync(SIM_ROOT, { recursive: true, force: true });
  const userData = path.join(SIM_ROOT, 'userdata');
  const dshHome = path.join(SIM_ROOT, 'dshhome');
  const workspace = path.join(SIM_ROOT, 'workspace');
  fs.mkdirSync(path.join(userData, 'dshenv'), { recursive: true });
  fs.mkdirSync(path.join(dshHome, 'storages'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const priorBin = path.join(userData, 'dshenv', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const hasPrior = fs.existsSync(priorBin);
  if (!hasPrior) {
    // 从 v090 仿真复用 dshenv（真实安装）；无则从 dsh-sim14 junction
    const v090 = path.join(os.tmpdir(), 'dsh-sim-v090', 'userdata', 'dshenv');
    const v090Bin = path.join(v090, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    if (fs.existsSync(v090Bin)) {
      fs.cpSync(v090, path.join(userData, 'dshenv'), { recursive: true });
      console.log('[0] 仿真目录：' + SIM_ROOT + '（复用 v090 仿真 dshenv）');
    } else {
      const s14 = path.join(os.tmpdir(), 'dsh-sim14', 'dshenv');
      if (!fs.existsSync(s14)) throw new Error('dshenv 源不存在（v090 仿真或 dsh-sim14）');
      fs.symlinkSync(s14, path.join(userData, 'dshenv', 'node_modules'), 'junction');
      console.log('[0] 仿真目录：' + SIM_ROOT + '（dshenv 从 dsh-sim14 junction）');
    }
  } else {
    console.log('[0] 仿真目录：' + SIM_ROOT + '（复用上次 v095 仿真 dshenv）');
  }

  // 预置 DSH_HOME：单工作区（tier3）+ 跳过内测声明 modal
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dshHome, 'settings.yaml'),
    'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n', 'utf8');
  fs.writeFileSync(path.join(dshHome, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['sim-ws'] },
    tables: {
      workspaces: { 'sim-ws': { path: workspace, title: 'v095-sim', sessionIds: [], createdAt: now, updatedAt: now } },
    },
  }, null, 2), 'utf8');

  // 拖入源文件
  const srcFile = path.join(SIM_ROOT, `dsh-v095-sim-${Date.now()}.txt`);
  fs.writeFileSync(srcFile, 'v0.9.5 cdp drag content', 'utf8');

  // 预置公告缓存（模拟"上次拉取成功"）：notice:data 走缓存回退路径
  // （仿真环境网络不稳，notice.json 三源可能拉取失败；缓存路径即"断网不闪没"保证）
  fs.writeFileSync(path.join(userData, 'notice-cache.json'), JSON.stringify({
    version: 1, updated: '2026-08-17',
    marquee: 'v0.9.5 仿真公告！欢迎加入 QQ 群 916607090 交流～',
    items: [
      { id: '20260816-1', title: 'v0.8.30 已发布', date: '2026-08-16', content: '仿真公告内容 1' },
      { id: '20260816-2', title: '加入交流群', date: '2026-08-16', content: '仿真公告内容 2' },
    ],
  }, null, 2), 'utf8');

  // 启动
  console.log('[1] 启动打包应用（--port=' + SIM_PORT + ' --remote-debugging-port=' + SIM_DEBUG_PORT + '）');
  const child = spawn(PACKED_EXE, [
    `--user-data-dir=${userData}`,
    `--port=${SIM_PORT}`,
    `--remote-debugging-port=${SIM_DEBUG_PORT}`,
  ], { env: { ...process.env, DSH_HOME: dshHome }, stdio: 'ignore', detached: true, windowsHide: true });
  child.unref();

  // 等主页面
  const mainTarget = await waitTarget(SIM_DEBUG_PORT, (t) => t.type === 'page' && new RegExp(`^http://127\\.0\\.0\\.1:${SIM_PORT}`).test(t.url));
  ok(!!mainTarget, 'DSH 主页面 target 就绪');
  if (!mainTarget) { killSim(); process.exit(1); }
  const cdp = cdpConnect(mainTarget.webSocketDebuggerUrl);

  try {
    // ① 等拖拽监听注入
    let installed = false;
    const t1 = Date.now();
    while (Date.now() - t1 < 30_000) {
      try {
        const r = await cdp.send('Runtime.evaluate', { expression: '!!window.__dshDropInstalled', returnByValue: true });
        installed = r.result && r.result.value === true;
      } catch { /* ignore */ }
      if (installed) break;
      await sleep(500);
    }
    ok(installed, '拖拽监听已注入');

    // ② 公告：notice:data 返回 notice.json items（唯一源，无 version.json notices）
    const notice = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const d = await window.dshDesktop.getNotices();
        return { notices: (d && d.notices || []).map((n) => n.id), current: d && d.current };
      })()`,
      returnByValue: true, awaitPromise: true,
    });
    const noticeIds = (notice.result && notice.result.value && notice.result.value.notices) || [];
    ok(noticeIds.length > 0, `公告来自 notice.json（items=${noticeIds.length}：${noticeIds.join(',')}）`);
    ok(noticeIds.includes('20260816-1'), '公告含迁移的 v0.8.30 条目');

    // ③ 提示词库窗口打开（IPC → 新 target promptlib.html）
    await cdp.send('Runtime.evaluate', { expression: 'window.dshDesktop.openPromptLib()', returnByValue: true }).catch(() => {});
    const libTarget = await waitTarget(SIM_DEBUG_PORT, (t) => t.type === 'page' && /promptlib\.html/.test(t.url), 30_000);
    ok(!!libTarget, '提示词库窗口已打开（promptlib.html target）');

    // ④ 提示词库 UI：双 tab + 内置库数据（101 条）+ 自定义 tab 空状态
    if (libTarget) {
      const lib = cdpConnect(libTarget.webSocketDebuggerUrl);
      const t2 = Date.now();
      let ui = null;
      while (Date.now() - t2 < 20_000) {
        try {
          const r = await lib.send('Runtime.evaluate', {
            expression: `(() => {
              const tabs = Array.from(document.querySelectorAll('.tab')).map((t) => t.textContent.trim().slice(0, 12));
              const cats = Array.from(document.querySelectorAll('.cat')).length;
              const total = Array.from(document.querySelectorAll('.cat .count')).reduce((s, e) => s + (Number(e.textContent) || 0), 0);
              return { tabs, cats, total, hasBtn: !!document.getElementById('btn-add-custom'), hasSearch: !!document.getElementById('search') };
            })()`,
            returnByValue: true,
          });
          ui = r.result && r.result.value;
          if (ui && ui.tabs && ui.tabs.length >= 2 && ui.total === 101) break;
        } catch { /* ignore */ }
        await sleep(500);
      }
      ok(!!ui && ui.tabs.some((t) => t.includes('内置库')), `双 tab 渲染（tabs=${JSON.stringify(ui && ui.tabs)}）`);
      ok(!!ui && ui.tabs.some((t) => t.includes('我的提示词')), '含「我的提示词」tab');
      ok(!!ui && ui.cats === 6, `内置 6 分类（${ui && ui.cats}）`);
      ok(!!ui && ui.total === 101, `内置条目合计 101（${ui && ui.total}）`);
      ok(!!ui && ui.hasBtn && ui.hasSearch, '＋新建按钮与搜索框存在');

      // 切到「我的提示词」tab → 空状态引导
      await lib.send('Runtime.evaluate', {
        expression: `(() => {
          const tab = Array.from(document.querySelectorAll('.tab')).find((t) => t.textContent.includes('我的提示词'));
          if (tab) tab.click();
          return true;
        })()`,
        returnByValue: true,
      });
      await sleep(600);
      const customEmpty = await lib.send('Runtime.evaluate', {
        expression: `(() => {
          const e = document.getElementById('custom-empty');
          const v = document.getElementById('view-custom');
          return { visible: v && v.style.display !== 'none', emptyText: e && e.textContent };
        })()`,
        returnByValue: true,
      });
      const ce = customEmpty.result && customEmpty.result.value;
      ok(!!ce && ce.visible && ce.emptyText.includes('创建你的第一个提示词'), `自定义 tab 空状态引导（${ce && ce.emptyText}）`);

      // ⑤ 自定义提示词 IPC 全链路：save → list → delete（经 preload 暴露的方法）
      const saveR = await lib.send('Runtime.evaluate', {
        expression: `(async () => {
          const r = await window.dshDesktop.saveCustomPrompt({ cat: '仿真分类', name: '仿真条目', content: '仿真内容：[x]', hint: 'h' });
          return r;
        })()`,
        returnByValue: true, awaitPromise: true,
      });
      const saved = saveR.result && saveR.result.value;
      ok(!!saved && saved.ok === true && !!saved.item && !!saved.item.id, '自定义保存成功（IPC）');
      const cid = saved && saved.item && saved.item.id;

      const listR = await lib.send('Runtime.evaluate', {
        expression: `window.dshDesktop.getCustomPrompts().then((l) => ({ n: l.items.length, has: l.items.some((i) => i.id === ${JSON.stringify(cid)}) }))`,
        returnByValue: true, awaitPromise: true,
      });
      const lv = listR.result && listR.result.value;
      ok(!!lv && lv.n >= 1 && lv.has === true, `保存后列表读回（items=${lv && lv.n}，含新条目）`);

      // ⑤b ★ v0.9.6：自定义分组 —— 保存 2 条不同分类 → 左侧分组「全部/学习/仿真分类」+ 点击分组过滤
      await lib.send('Runtime.evaluate', {
        expression: `(async () => {
          await window.dshDesktop.saveCustomPrompt({ cat: '学习', name: '学习条目', content: '学习内容：[y]', hint: 'h2' });
          return true;
        })()`,
        returnByValue: true, awaitPromise: true,
      });
      // 仿真直接走 IPC 保存（不经弹窗 UI），模拟用户切 tab 触发 loadCustom 刷新视图
      // （真实用户经弹窗保存后 saveFromModal 会自动刷新，产品路径无此问题）
      await lib.send('Runtime.evaluate', {
        expression: `(() => {
          document.getElementById('tab-builtin').click();
          document.getElementById('tab-custom').click();
          return true;
        })()`,
        returnByValue: true,
      });
      await sleep(500);
      const groupsR = await lib.send('Runtime.evaluate', {
        expression: `(() => {
          const cats = Array.from(document.querySelectorAll('#custom-cats .cat')).map((c) => c.dataset.cat + ':' + c.querySelector('.count').textContent);
          const items = document.querySelectorAll('#custom-items .item').length;
          return { cats, items };
        })()`,
        returnByValue: true,
      });
      const gv = groupsR.result && groupsR.result.value;
      ok(!!gv && gv.cats.length === 3 && gv.cats[0].startsWith('__all__:2'),
        `自定义左侧分组（${JSON.stringify(gv && gv.cats)}）`);
      ok(!!gv && gv.cats.some((c) => c.startsWith('学习:1')) && gv.cats.some((c) => c.startsWith('仿真分类:1')),
        '内置类与自定义类分组均显示（各 1 条）');
      ok(!!gv && gv.items === 2, `「全部」显示全部条目（${gv && gv.items}）`);

      // 点击「仿真分类」分组 → 过滤为 1 条
      await lib.send('Runtime.evaluate', {
        expression: `(() => {
          const c = Array.from(document.querySelectorAll('#custom-cats .cat')).find((x) => x.dataset.cat === '仿真分类');
          if (c) c.click();
          return true;
        })()`,
        returnByValue: true,
      });
      await sleep(300);
      const filteredR = await lib.send('Runtime.evaluate', {
        expression: `(() => ({
          items: document.querySelectorAll('#custom-items .item').length,
          active: Array.from(document.querySelectorAll('#custom-cats .cat')).find((x) => x.classList.contains('active')).dataset.cat,
        }))()`,
        returnByValue: true,
      });
      const fv = filteredR.result && filteredR.result.value;
      ok(!!fv && fv.items === 1 && fv.active === '仿真分类', `点击分组过滤（${fv && fv.active} → ${fv && fv.items} 条）`);

      const delR = await lib.send('Runtime.evaluate', {
        expression: `window.dshDesktop.deleteCustomPrompt(${JSON.stringify(cid)}).then((l) => ({ n: l.items.length, gone: !l.items.some((i) => i.id === ${JSON.stringify(cid)}) }))`,
        returnByValue: true, awaitPromise: true,
      });
      const dv = delR.result && delR.result.value;
      ok(!!dv && dv.gone === true, `删除生效（剩余 ${dv && dv.n} 条）`);

      lib.close();
    }

    // ⑥ 拖拽回归：复制进 拖入文件/ + document 探针全 0（0.9.2/0.9.3 防回归）
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        window.__docDrag = { enter: 0, over: 0, drop: 0, leave: 0 };
        const count = (k) => () => { window.__docDrag[k]++; };
        document.addEventListener('dragenter', count('enter'), true);
        document.addEventListener('dragover', count('over'), true);
        document.addEventListener('drop', count('drop'), true);
        document.addEventListener('dragleave', count('leave'), true);
        return true;
      })()`,
      returnByValue: true,
    }).catch(() => {});
    const boxR = await cdp.send('Runtime.evaluate', {
      expression: '({x: Math.round(innerWidth/2), y: Math.round(innerHeight/2)})', returnByValue: true,
    });
    const box = boxR.result.value;
    const dragData = {
      items: [
        { mimeType: 'text/plain', data: 'dsh-v095-sim' },
        { mimeType: 'text/uri-list', data: `file:///${srcFile.replace(/\\/g, '/')}` },
      ],
      files: [srcFile],
      dragOperationsMask: 1,
    };
    await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: box.x, y: box.y, data: dragData });
    await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x: box.x, y: box.y, data: dragData });
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', x: box.x, y: box.y, data: dragData });

    const dropDir = path.join(workspace, '拖入文件');
    let copied = null;
    const t3 = Date.now();
    while (Date.now() - t3 < 20_000) {
      const entries = fs.existsSync(dropDir) ? fs.readdirSync(dropDir).filter((n) => n.startsWith('dsh-v095-sim-')) : [];
      if (entries.length > 0) { copied = entries[0]; break; }
      await sleep(300);
    }
    ok(!!copied, `★ 拖拽回归：文件复制进 拖入文件/（${copied}）`);
    await sleep(400);
    const dc = await cdp.send('Runtime.evaluate', { expression: 'window.__docDrag', returnByValue: true });
    const dcv = (dc.result && dc.result.value) || {};
    ok(dcv.enter === 0 && dcv.drop === 0, `★ DropOverlay 防回归：document 探针全 0（enter=${dcv.enter} drop=${dcv.drop}）`);
  } finally {
    cdp.close();
  }

  killSim();
  console.log('');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('仿真异常：', err);
  killSim();
  process.exit(1);
});
