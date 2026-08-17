'use strict';

/**
 * cdp-v097-check.js — v0.9.7 起公告/更新日志 CDP 仿真（真包，团队标准流程）
 * 持续演进：版本断言随每版更新（当前 0.9.11）；v0.9.11 追加 P3-3
 * changelog:data 降序排序断言（共享 compareSemver 运行级验证）。
 *
 * 覆盖：
 *  1. 公告窗口数据：notice:data 附带完整 marquee（新字段，非截断）
 *  2. 公告自动刷新：日志含「公告自动刷新已启动（每 10 分钟）」+ fetchLatest 已执行
 *  3. 更新日志：changelog:data 返回 0.9.7 条目 + 0.9.6 12 条（与 GitHub 一致）+ 降序
 *  4. 版本：dsh:version = 当前版本；notice-cache.json 落盘（完整 marquee）
 *
 * 用法：node tests/cdp-v097-check.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_ROOT = path.join(__dirname, '..');
const PACKED_EXE = path.join(APP_ROOT, 'dist', 'DSH-Desktop-win32-x64', 'DSH-Desktop.exe');
const SIM_ROOT = path.join(os.tmpdir(), 'dsh-sim-v097');
const SIM_PORT = 3100;
const SIM_DEBUG_PORT = 9240;
// 预置一条超长 marquee（>30 字符，模拟菜单栏会被截断的公告全文）
const MARQUEE_FULL = 'v0.9.6 已发布：拖文件入工作区 + 提示词库 101 条 + 自定义提示词！欢迎加入 QQ 群 916607090 交流～';

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
      'Get-Process | Where-Object { $_.Path -like \'*dsh-sim-v097*\' -or $_.Path -like \'*dsh-Desktop-win32-x64*\' } | Stop-Process -Force',
    ], { stdio: 'ignore', timeout: 15_000 });
    console.log('[x] 仿真进程已清理（按 Path 匹配）');
  } catch (err) {
    console.warn('[x] 杀仿真进程警告（可能已退出）：' + err.message);
  }
}

async function main() {
  if (!fs.existsSync(PACKED_EXE)) throw new Error(`打包产物不存在：${PACKED_EXE}（先 npm run pack）`);

  // 仿真目录：dshenv 从 v095 仿真复用（真实安装），DSH_HOME 预置单工作区
  fs.rmSync(SIM_ROOT, { recursive: true, force: true });
  const userData = path.join(SIM_ROOT, 'userdata');
  const dshHome = path.join(SIM_ROOT, 'dshhome');
  const workspace = path.join(SIM_ROOT, 'workspace');
  fs.mkdirSync(path.join(userData, 'dshenv'), { recursive: true });
  fs.mkdirSync(path.join(dshHome, 'storages'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const v095Dshenv = path.join(os.tmpdir(), 'dsh-sim-v095', 'userdata', 'dshenv');
  if (fs.existsSync(path.join(v095Dshenv, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
    fs.cpSync(v095Dshenv, path.join(userData, 'dshenv'), { recursive: true });
    console.log('[0] dshenv 复用 v095 仿真（真实安装）');
  } else {
    throw new Error('dshenv 源缺失（dsh-sim-v095/userdata/dshenv）');
  }
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(dshHome, 'settings.yaml'),
    'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n', 'utf8');
  fs.writeFileSync(path.join(dshHome, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: ['sim-ws'] },
    tables: {
      workspaces: { 'sim-ws': { path: workspace, title: 'v097-sim', sessionIds: [], createdAt: now, updatedAt: now } },
    },
  }, null, 2), 'utf8');

  // 预置公告缓存（模拟"上次拉取成功"）：无论网络成败，IPC 都应带完整 marquee
  fs.writeFileSync(path.join(userData, 'notice-cache.json'), JSON.stringify({
    version: 2, updated: '2026-08-17',
    marquee: MARQUEE_FULL,
    items: [
      { id: '20260817-1', title: 'v0.9.6 已发布', date: '2026-08-17', content: '仿真公告内容' },
      { id: '20260816-1', title: 'v0.8.30 已发布', date: '2026-08-16', content: '仿真公告内容 2' },
    ],
  }, null, 2), 'utf8');

  // 启动
  // v0.9.12：设置 USERPROFILE/HOME → 仿真目录，隔离 ~/.dsh —— 否则启动时
  // ensureGuide 会读写真实用户的 ~/.dsh/AGENTS.md（污染老大真实全局记忆）
  console.log('[1] 启动打包应用（--port=' + SIM_PORT + ' --remote-debugging-port=' + SIM_DEBUG_PORT + '）');
  const child = spawn(PACKED_EXE, [
    `--user-data-dir=${userData}`,
    `--port=${SIM_PORT}`,
    `--remote-debugging-port=${SIM_DEBUG_PORT}`,
  ], {
    env: { ...process.env, DSH_HOME: dshHome, USERPROFILE: SIM_ROOT, HOME: SIM_ROOT },
    stdio: 'ignore', detached: true, windowsHide: true,
  });
  child.unref();

  const mainTarget = await waitTarget(SIM_DEBUG_PORT, (t) => t.type === 'page' && new RegExp(`^http://127\\.0\\.0\\.1:${SIM_PORT}`).test(t.url));
  ok(!!mainTarget, 'DSH 主页面 target 就绪');
  if (!mainTarget) { killSim(); process.exit(1); }
  const cdp = cdpConnect(mainTarget.webSocketDebuggerUrl);

  try {
    // 0. 等 preload 注入完成（主页面 target 就绪 ≠ dshDesktop 已挂上，竞态防护）
    let dshReady = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 30_000) {
      try {
        const r = await cdp.send('Runtime.evaluate', { expression: '!!window.dshDesktop', returnByValue: true });
        dshReady = !!(r.result && r.result.value === true);
      } catch { /* ignore */ }
      if (dshReady) break;
      await sleep(500);
    }
    ok(dshReady, 'preload dshDesktop 已注入');
    if (!dshReady) throw new Error('dshDesktop 注入超时');

    // ① 版本 0.9.13
    const ver = await cdp.send('Runtime.evaluate', {
      expression: 'window.dshDesktop.getVersion()', returnByValue: true, awaitPromise: true,
    });
    ok(ver.result && ver.result.value === '0.9.15', `壳版本 = 0.9.15（实际 ${ver.result && ver.result.value}）`);

    // ①.5 宠物注入正常（v0.9.10 间歇提示改动不破坏注入）+ 气泡元素存在
    // 注：injectPet 在 did-finish-load 后执行，需轮询等待注入完成
    let pv = null;
    const pt0 = Date.now();
    while (Date.now() - pt0 < 30_000) {
      try {
        const r = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const p = document.getElementById('dsh-pet');
            return { hasPet: !!p, hasBubble: !!(p && p.querySelector('.pet-bubble')), hasMenu: !!(p && p.querySelector('.pet-menu')) };
          })()`,
          returnByValue: true,
        });
        pv = r.result && r.result.value;
        if (pv && pv.hasPet) break;
      } catch { /* ignore */ }
      await sleep(700);
    }
    ok(!!pv && pv.hasPet, '桌面宠物已注入（#dsh-pet）');
    ok(!!pv && pv.hasBubble, '宠物气泡元素存在');
    ok(!!pv && pv.hasMenu, '宠物菜单元素存在');

    // ①.6 v0.9.13（老大反馈：眼睛跑到头顶眨眼）：眨眼改几何闭眼 ——
    // 右眼瞳孔 ellipse（第 2 个）存在且初始 ry=24（几何属性，无 transform 位移风险）
    const wink = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const g = document.querySelector('#dsh-pet .eye-r');
        const pupil = g && g.querySelectorAll('ellipse')[1];
        return { hasPupil: !!pupil, ry: pupil ? pupil.getAttribute('ry') : null };
      })()`,
      returnByValue: true,
    });
    const wv = wink.result && wink.result.value;
    ok(!!wv && wv.hasPupil, '眨眼几何目标（右眼瞳孔 ellipse）存在');
    ok(!!wv && wv.ry === '24', `瞳孔初始 ry=24（实际 ${wv && wv.ry}）`);

    // ①.65 v0.9.13（老大反馈：选错角色只能重开新对话）：双击输入框重选角色
    const roleDbl = await cdp.send('Runtime.evaluate', {
      expression: `(() => ({
        hasChooseRole: typeof window.dshDesktop.chooseRole === 'function',
        dblInjected: !!window.__dshRoleDblclick,
      }))()`,
      returnByValue: true,
    });
    const rdv = roleDbl.result && roleDbl.result.value;
    ok(!!rdv && rdv.hasChooseRole, 'preload 暴露 chooseRole（双击输入框重选角色）');
    ok(!!rdv && rdv.dblInjected, '双击监听已注入（双击输入框 → 弹角色选择）');

    // ①.7 v0.9.12：宠物菜单含「🧠 全局记忆」（排在提示词库前）+ preload API 存在
    const mem = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const items = Array.from(document.querySelectorAll('#dsh-pet .pet-item')).map((it) => it.textContent.trim());
        return {
          hasMemory: items.includes('🧠 全局记忆'),
          memoryFirst: items.indexOf('🧠 全局记忆') >= 0 && items.indexOf('🧠 全局记忆') < items.indexOf('💡 提示词库'),
          api: typeof window.dshDesktop.openGlobalMemory === 'function',
        };
      })()`,
      returnByValue: true,
    });
    const mv = mem.result && mem.result.value;
    ok(!!mv && mv.hasMemory, '宠物菜单含「🧠 全局记忆」');
    ok(!!mv && mv.memoryFirst, '「🧠 全局记忆」排在「💡 提示词库」前面');
    ok(!!mv && mv.api, 'preload 暴露 openGlobalMemory API');

    // ①.8 v0.9.12：点击「🧠 全局记忆」→ 打开图形化编辑窗口（global-memory.html target）
    await cdp.send('Runtime.evaluate', {
      expression: 'window.dshDesktop.openGlobalMemory()', returnByValue: true, awaitPromise: true,
    });
    const memWin = await waitTarget(SIM_DEBUG_PORT, (t) => /global-memory\.html/.test(t.url), 15_000);
    ok(!!memWin, '「🧠 全局记忆」点击打开编辑窗口（global-memory.html）');
    if (memWin && memWin.webSocketDebuggerUrl) {
      // 窗口内：左右分栏 —— 左类别列表 / 右内容区（页面加载异步，轮询等待就绪）
      const memCdp = cdpConnect(memWin.webSocketDebuggerUrl);
      try {
        let fv = null;
        const t1 = Date.now();
        while (Date.now() - t1 < 10_000) {
          const f = await memCdp.send('Runtime.evaluate', {
            expression: `(() => {
              const cats = Array.from(document.querySelectorAll('#cats .cat[data-key]'));
              const rows = Array.from(document.querySelectorAll('#fields .row'));
              const dshRows = Array.from(document.querySelectorAll('#dsh-fields .row'));
              return {
                hasCats: !!document.getElementById('cats'),
                hasRight: !!document.getElementById('right-body'),
                catCount: cats.length,
                catTexts: cats.map((c) => (c.textContent || '').trim()),
                rowCount: rows.length,
                names: rows.map((r) => (r.querySelector('.f-name') || {}).value || '').filter(Boolean),
                hasAddField: !!document.getElementById('btn-add-field'),
                hasAddSec: !!document.getElementById('btn-add-sec'),
                hasDshGroup: !!document.getElementById('dsh-fields'),
                dshCount: dshRows.length,
                hasAddDsh: !!document.getElementById('btn-add-dsh'),
                hasGuideTip: !!document.querySelector('.guide-tip'),
                path: (document.getElementById('path') || {}).textContent || '',
              };
            })()`,
            returnByValue: true,
          });
          fv = f.result && f.result.value;
          if (fv && fv.hasCats && fv.rowCount >= 6) break;
          await sleep(500);
        }
        ok(!!fv && fv.hasCats && fv.hasRight, '窗口左右分栏（左类别 / 右内容）');
        ok(!!fv && fv.catCount >= 4, `左侧类别列表（${fv && fv.catCount} 项：用户/我的/角色/区块）`);
        ok(!!fv && fv.catTexts.some((t) => t.includes('用户设定')) && fv.catTexts.some((t) => t.includes('我的设定')) && fv.catTexts.some((t) => t.includes('DSH 角色')),
          `左侧含 用户设定/我的设定/DSH 角色 三个独立类别（${fv && fv.catTexts.join(' | ')}）`);
        ok(!!fv && fv.catTexts.some((t) => t.includes('其他记忆')), '自动识别出 其他记忆 区块');
        ok(!!fv && fv.rowCount >= 4 && fv.names.includes('用户的称呼'), '用户设定字段列表默认显示（含用户的称呼）');
        ok(!!fv && fv.hasAddField && fv.hasAddSec, '有「＋ 添加字段」和「＋ 添加区块」按钮');
        ok(!!fv && fv.hasGuideTip, '未配置引导提示条显示（引导用户配置全局记忆）');
        // 点击「我的设定」类别 → 右侧显示 我的设定 字段列表（含默认角色下拉）
        const dshCat = await memCdp.send('Runtime.evaluate', {
          expression: `(() => {
            const cat = Array.from(document.querySelectorAll('#cats .cat[data-key]'))
              .find((c) => (c.textContent || '').includes('我的设定'));
            if (!cat) return { ok: false };
            cat.click();
            return { ok: true };
          })()`,
          returnByValue: true,
        });
        ok(!!(dshCat.result && dshCat.result.value && dshCat.result.value.ok), '点击「我的设定」类别');
        let dv = null;
        const td = Date.now();
        while (Date.now() - td < 5000) {
          const s = await memCdp.send('Runtime.evaluate', {
            expression: `(() => {
              const rows = Array.from(document.querySelectorAll('#dsh-fields .row'));
              const names = rows.map((r) => (r.querySelector('.f-name') || {}).value || '').filter(Boolean);
              const roleRow = rows.find((r) => (r.querySelector('.f-name') || {}).value === '默认角色');
              return {
                hasDshFields: !!document.getElementById('dsh-fields'),
                dshCount: rows.length,
                dshNames: names,
                hasDefaultRoleSelect: !!(roleRow && roleRow.querySelector('select.f-select')),
                hasAddDsh: !!document.getElementById('btn-add-dsh'),
              };
            })()`,
            returnByValue: true,
          });
          dv = s.result && s.result.value;
          if (dv && dv.hasDshFields && dv.dshCount >= 1) break;
          await sleep(400);
        }
        ok(!!dv && dv.hasDshFields && dv.dshCount >= 1, `我的设定独立区块视图（${dv && dv.dshCount} 个字段）`);
        ok(!!dv && dv.dshNames.includes('我的名字') && dv.dshNames.includes('默认角色'), '我的设定默认字段（我的名字/默认角色）');
        ok(!!dv && dv.hasDefaultRoleSelect, '默认角色为下拉选择（select）');
        ok(!!dv && dv.hasAddDsh, '有「＋ 添加 DSH 设定」按钮');
        // 点击「DSH 角色」类别 → 角色字段列表 + 添加角色按钮
        const roleCat = await memCdp.send('Runtime.evaluate', {
          expression: `(() => {
            const cat = Array.from(document.querySelectorAll('#cats .cat[data-key]'))
              .find((c) => (c.textContent || '').includes('DSH 角色'));
            if (!cat) return { ok: false };
            cat.click();
            return { ok: true };
          })()`,
          returnByValue: true,
        });
        ok(!!(roleCat.result && roleCat.result.value && roleCat.result.value.ok), '点击「DSH 角色」类别');
        let rv = null;
        const tr = Date.now();
        while (Date.now() - tr < 5000) {
          const s = await memCdp.send('Runtime.evaluate', {
            expression: `(() => {
              const rows = Array.from(document.querySelectorAll('#role-fields .row'));
              return {
                hasRoleFields: !!document.getElementById('role-fields'),
                roleCount: rows.length,
                roleNames: rows.map((r) => (r.querySelector('.f-name') || {}).value || '').filter(Boolean),
                hasAddRole: !!document.getElementById('btn-add-role'),
              };
            })()`,
            returnByValue: true,
          });
          rv = s.result && s.result.value;
          if (rv && rv.hasRoleFields && rv.roleCount >= 1) break;
          await sleep(400);
        }
        ok(!!rv && rv.hasRoleFields && rv.roleCount >= 1, `DSH 角色独立区块视图（${rv && rv.roleCount} 个角色）`);
        ok(!!rv && rv.roleNames.includes('角色 1') && rv.roleNames.includes('角色 3'), '默认角色 1/2/3');
        ok(!!rv && rv.hasAddRole, '有「＋ 添加角色」按钮');
        // v0.9.15（老大指令）：DSH 角色页红色提示「双击对话框选择角色，默认角色 1」
        const tip = await memCdp.send('Runtime.evaluate', {
          expression: `(() => {
            const el0 = document.querySelector('#right-body .tip-red');
            return { has: !!el0, text: el0 ? (el0.textContent || '').trim() : '' };
          })()`,
          returnByValue: true,
        });
        const tipV = tip.result && tip.result.value;
        ok(!!tipV && tipV.has && tipV.text.includes('双击对话框选择角色') && tipV.text.includes('默认角色 1'),
          `角色页红色提示：双击对话框选择角色，默认角色 1（v0.9.15，实际 ${tipV && tipV.text}）`);
        // 点击左侧区块 → 右侧显示标题输入框（可改）+ 长文本
        const sec = await memCdp.send('Runtime.evaluate', {
          expression: `(() => {
            const cat = Array.from(document.querySelectorAll('#cats .cat[data-key]'))
              .find((c) => (c.textContent || '').includes('其他记忆'));
            if (!cat) return { ok: false };
            cat.click();
            return { ok: true };
          })()`,
          returnByValue: true,
        });
        ok(!!(sec.result && sec.result.value && sec.result.value.ok), '点击「其他记忆」类别');
        let sv = null;
        const t2 = Date.now();
        while (Date.now() - t2 < 5000) {
          const s = await memCdp.send('Runtime.evaluate', {
            expression: `(() => {
              const t = document.getElementById('sec-title');
              const b = document.getElementById('sec-body');
              return { hasTitle: !!t, title: t ? t.value : '', hasBody: !!b };
            })()`,
            returnByValue: true,
          });
          sv = s.result && s.result.value;
          if (sv && sv.hasTitle && sv.hasBody) break;
          await sleep(400);
        }
        ok(!!sv && sv.hasTitle && sv.hasBody, '右侧显示区块标题输入框（可修改）+ 长文本内容');
        ok(!!sv && sv.title === '其他记忆', `标题可编辑且已回填（${sv && sv.title}）`);
        ok(!!fv && /AGENTS\.md$/.test(fv.path), `窗口显示记忆文件路径（${fv && fv.path}）`);
      } catch (err) {
        ok(false, '全局记忆窗口内容断言异常：' + err.message);
      } finally {
        memCdp.close();
      }

      // ①.9 v0.9.12：未配置全局记忆 → 启动自动创建并插入引导句（仿真 ~/.dsh 隔离，不碰真实文件）
      const simAgents = path.join(SIM_ROOT, '.dsh', 'AGENTS.md');
      ok(fs.existsSync(simAgents), '仿真 ~/.dsh/AGENTS.md 已自动创建（USERPROFILE 隔离）');
      if (fs.existsSync(simAgents)) {
        const simText = fs.readFileSync(simAgents, 'utf8');
        ok(simText.includes('请在对话中引导用户点击宠物/工具箱图标'), '引导句已插入（v0.9.13 文案：引导点击宠物/工具箱配置）');
        ok(simText.includes('## 用户设定') && simText.includes('## 我的设定') && simText.includes('## DSH 角色'), '用户设定 / 我的设定 / DSH 角色 三个独立顶层区块');
        ok(!simText.includes('基础设定（DSH-Desktop 图形化编辑）'), '无旧「基础设定」容器');
      }
    }

    // ② 公告：notice:data 附带完整 marquee（v0.9.7 新字段）
    const notice = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const d = await window.dshDesktop.getNotices();
        return { notices: (d && d.notices || []).map((n) => n.id), current: d && d.current, marquee: d && d.marquee };
      })()`,
      returnByValue: true, awaitPromise: true,
    });
    const nv = notice.result && notice.result.value;
    ok(!!nv && Array.isArray(nv.notices) && nv.notices.length >= 2, `公告列表来自缓存（${nv && nv.notices && nv.notices.length} 条）`);
    ok(!!nv && nv.marquee === MARQUEE_FULL, 'notice:data 返回完整 marquee（未截断，公告窗口横幅用）');
    ok(!!nv && nv.marquee && nv.marquee.length > 30 && !nv.marquee.includes('…'), 'marquee 长度 > 30 且不含省略号（全文）');

    // ③ 更新日志：changelog:data 含 0.9.7 + 0.9.6 12 条 + released 标记（v0.9.9）
    // + P3-3（v0.9.11）：主进程按 compareSemver 降序返回（0.9.11 排第一）
    const cl = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const d = await window.dshDesktop.getChangelog();
        const v096 = (d && d.versions || []).find((v) => v.version === '0.9.6');
        const v097 = (d && d.versions || []).find((v) => v.version === '0.9.7');
        const v098 = (d && d.versions || []).find((v) => v.version === '0.9.8');
        const releasedCount = (d && d.versions || []).filter((v) => v.released === true).length;
        const sortedFirst = (d && d.versions || [])[0] && (d && d.versions || [])[0].version;
        return { has097: !!v097, n096: v096 && v096.notes.length, first096: v096 && v096.notes[0], r096: v096 && v096.released, r098: v098 && v098.released, releasedCount, sortedFirst };
      })()`,
      returnByValue: true, awaitPromise: true,
    });
    const cv = cl.result && cl.result.value;
    ok(!!cv && cv.has097, 'changelog:data 含 0.9.7 条目');
    ok(!!cv && cv.n096 === 12, `changelog:data 0.9.6 条目 = 12 条（与 GitHub 一致，实际 ${cv && cv.n096}）`);
    ok(!!cv && typeof cv.first096 === 'string' && cv.first096.startsWith('1. '), '0.9.6 首条带编号（与 GitHub body 相同）');
    ok(!!cv && cv.r096 === true, 'changelog:data 0.9.6 released=true');
    ok(!!cv && cv.r098 === false, 'changelog:data 0.9.8（内部）released=false');
    ok(!!cv && cv.releasedCount === 12, `released=true 共 12 个（实际 ${cv && cv.releasedCount}）`);
    ok(!!cv && cv.sortedFirst === '0.9.15', `changelog:data 降序首条 = 0.9.15（P3-3 共享比较，实际 ${cv && cv.sortedFirst}）`);

    // ④ 日志：公告自动刷新已启动 + fetchLatest 已执行
    await sleep(1500); // 等 checkUpdatesOnStart 的 fetchLatest 落日志
    const logDir = path.join(userData, 'logs');
    const logs = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
    let logText = '';
    for (const f of logs) logText += fs.readFileSync(path.join(logDir, f), 'utf8');
    ok(logs.length > 0, `日志文件存在（${logs.length} 个）`);
    ok(logText.includes('公告自动刷新已启动（每 10 分钟）'), '日志：公告自动刷新已启动（定时器）');
    ok(/公告拉取(成功|失败|：)/.test(logText) || logText.includes('公告拉取'), '日志：fetchLatest 已执行');

    // ⑤ notice-cache.json 落盘（含完整 marquee）
    const cacheF = path.join(userData, 'notice-cache.json');
    const cache = JSON.parse(fs.readFileSync(cacheF, 'utf8'));
    ok(!!cache.marquee && cache.marquee.length > 30, 'notice-cache.json 已写盘且 marquee 完整');
  } catch (err) {
    console.error('  ✗ 异常：' + err.message);
    failed++;
  } finally {
    cdp.close();
  }

  killSim();
  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
