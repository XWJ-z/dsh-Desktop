'use strict';

/**
 * cdp-v111-test.js — v1.1.1 CDP 仿真（真包，团队标准流程）
 *
 * 覆盖 v1.1.1 新功能：
 *  1. 版本号 = 1.1.1（dsh:version）
 *  2. 宠物/工具箱菜单含「插件市场」（无表情图标；顺序：全局记忆 < 提示词库 < 插件市场 < 网页打开）
 *  3. preload 暴露插件市场 API（openPluginMarket/getPlugins/searchPlugins/
 *     getPluginsByCategory/copyPluginCommand/openPluginRepo）
 *  4. 点击「插件市场」→ 打开 plugin-market.html 窗口
 *  5. 插件市场窗口：搜索框 / 分类列表（全部 + 官方 18 分类 + 其他 = 20 项）/ 插件卡片（预置缓存 2 个）/
 *     安全提示置顶红色常驻 / 中文描述优先 / 免责声明确认模态
 *  6. 分类筛选（点「模型」→ 只剩 model 类）与搜索过滤（关键词）
 *  7. 复制安装命令 → 免责声明确认模态 → 确认后复制（v1.1.1 二轮：模态含 4 条
 *     安装须知 + QQ 群兜底）
 *  8. 插件市场深色模式：shared.css 主题 token 生效（body/卡片/侧边栏随主题，
 *     非硬编码浅色）
 *  8. 提示词库回归：promptlib:data 返回 201 条内置库（缓存不存在 → 回退包内置）
 *  9. 更新窗口：新增「提示词库」卡片（prompts:query IPC 通路 + 卡片渲染）
 * 10. 日志：提示词库缓存已加载（promptsUpdaterApi.loadCache）
 *
 * 用法：node tests/cdp-v111-test.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

const APP_ROOT = path.join(__dirname, '..');
const PACKED_EXE = path.join(APP_ROOT, 'dist', 'DSH-Desktop-win32-x64', 'DSH-Desktop.exe');
// 仿真目录用 os.tmpdir()（沙箱可写临时区；标准 Temp 只读，仅作 dshenv 源）
const WIN_TEMP = path.join(os.homedir(), 'AppData', 'Local', 'Temp');
const SIM_ROOT = path.join(os.tmpdir(), 'dsh-sim-v111');
const SIM_PORT = 3101;
const SIM_DEBUG_PORT = 9241;

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
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
    close() {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
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
    } catch {
      /* ignore */
    }
    await sleep(800);
  }
  return null;
}

function killSim() {
  try {
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-Process | Where-Object { $_.Path -like '*dsh-sim-v111*' -or $_.Path -like '*dsh-Desktop-win32-x64*' } | Stop-Process -Force",
      ],
      { stdio: 'ignore', timeout: 15_000 },
    );
    console.log('[x] 仿真进程已清理（按 Path 匹配）');
  } catch (err) {
    console.warn('[x] 杀仿真进程警告（可能已退出）：' + err.message);
  }
}

async function main() {
  if (!fs.existsSync(PACKED_EXE)) throw new Error(`打包产物不存在：${PACKED_EXE}（先 npm run pack）`);

  // 仿真目录：dshenv 从 dsh-sim-v097 复用（真实安装），USERPROFILE 隔离 ~/.dsh
  fs.rmSync(SIM_ROOT, { recursive: true, force: true });
  const userData = path.join(SIM_ROOT, 'userdata');
  const dshHome = path.join(SIM_ROOT, 'dshhome');
  const workspace = path.join(SIM_ROOT, 'workspace');
  fs.mkdirSync(path.join(userData, 'dshenv'), { recursive: true });
  fs.mkdirSync(path.join(dshHome, 'storages'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  // dshenv 源：优先 dsh-sim8（记忆文件指定），其次 v097/v095 仿真，最后项目内 temp/.sim-promo（2026-08-20 起临时目录统一归集到根 temp/）
  const dshenvCandidates = [
    path.join(WIN_TEMP, 'dsh-sim8', 'dshenv'),
    path.join(WIN_TEMP, 'dsh-sim-v097', 'userdata', 'dshenv'),
    path.join(WIN_TEMP, 'dsh-sim-v095', 'userdata', 'dshenv'),
    path.join(APP_ROOT, '..', '..', 'temp', '.sim-promo', 'userdata', 'dshenv'),
  ];
  let dshenvSrc = null;
  for (const c of dshenvCandidates) {
    if (fs.existsSync(path.join(c, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
      dshenvSrc = c;
      break;
    }
  }
  if (!dshenvSrc) {
    throw new Error('dshenv 源缺失（候选：' + dshenvCandidates.join(' / ') + '）');
  }
  fs.cpSync(dshenvSrc, path.join(userData, 'dshenv'), { recursive: true });
  console.log(`[0] dshenv 复用 ${dshenvSrc}（真实安装）`);
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(dshHome, 'settings.yaml'),
    'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-19.1\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(dshHome, 'storages', 'workspace.json'),
    JSON.stringify(
      {
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, workspaceIds: ['sim-ws'] },
        tables: {
          workspaces: {
            'sim-ws': { path: workspace, title: 'v111-sim', sessionIds: [], createdAt: now, updatedAt: now },
          },
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  // 预置外观：深色 —— 插件市场深色模式断言覆盖「深色 token」分支
  // （浅色分支由系统默认主题覆盖；两分支均为 shared.css token，非硬编码浅色）
  fs.writeFileSync(
    path.join(userData, 'settings.json'),
    JSON.stringify({ appearance: 'dark' }, null, 2),
    'utf8',
  );

  // 预置提示词库缓存（用真实内置 prompts.json 内容）—— 模拟「上次拉取成功」：
  // ① loadCache 打「提示词库缓存已加载」日志（可断言）
  // ② promptlib:data 返回缓存（内容 = 内置 201 条，断言 total=201 仍成立）
  const builtinPrompts = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'prompts.json'), 'utf8'));
  fs.writeFileSync(
    path.join(userData, 'prompts-cache.json'),
    JSON.stringify({ version: builtinPrompts.version || 6, data: builtinPrompts }, null, 2),
    'utf8',
  );

  // 预置插件市场缓存（2 个插件）—— 模拟「旧缓存」格式（无 descriptionZh / 无 descMap），
  // 验证 ensureDescZh 从内置中文描述回退补全（v1.1.1 升级用户立即有中文）
  fs.writeFileSync(
    path.join(userData, 'plugin-market-cache.json'),
    JSON.stringify(
      {
        plugins: [
          {
            name: 'dsh-browser',
            description: 'Browser tools for DSH',
            command: 'dsh plugin --profile web add dsh-browser',
            repo: 'https://github.com/anil-matcha/dsh-browser',
            category: 'ui-enhance',
            repoUrl: 'https://github.com/anil-matcha/dsh-browser',
            installCmd: 'dsh-browser',
          },
          {
            name: 'dsh-code-runner',
            description: 'Run code in sandbox',
            command: 'dsh plugin --profile web add dsh-code-runner',
            repo: 'https://github.com/anil-matcha/dsh-code-runner',
            category: 'dev-tools',
            repoUrl: 'https://github.com/anil-matcha/dsh-code-runner',
            installCmd: 'dsh-code-runner',
          },
        ],
        timestamp: Date.now(),
      },
      null,
      2,
    ),
    'utf8',
  );

  // 预置公告缓存（回归：公告窗口仍正常）
  fs.writeFileSync(
    path.join(userData, 'notice-cache.json'),
    JSON.stringify(
      {
        version: 2,
        updated: '2026-08-19',
        marquee: 'v1.1.1 已发布：帮助文档远程下发 + 提示词库独立升级 + 插件市场！欢迎加入 QQ 群 916607090 交流～',
        items: [
          { id: '20260819-1', title: 'v1.1.1 已发布', date: '2026-08-19', content: '仿真公告内容' },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );

  // 启动（v1.1.1 版本号在 version.json 根目录，包内置 version 由 package.json 提供）
  console.log('[1] 启动打包应用（--port=' + SIM_PORT + ' --remote-debugging-port=' + SIM_DEBUG_PORT + '）');
  const child = spawn(
    PACKED_EXE,
    [`--user-data-dir=${userData}`, `--port=${SIM_PORT}`, `--remote-debugging-port=${SIM_DEBUG_PORT}`],
    {
      env: { ...process.env, DSH_HOME: dshHome, USERPROFILE: SIM_ROOT, HOME: SIM_ROOT },
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    },
  );
  child.unref();

  const mainTarget = await waitTarget(
    SIM_DEBUG_PORT,
    (t) => t.type === 'page' && new RegExp(`^http://127\\.0\\.0\\.1:${SIM_PORT}`).test(t.url),
  );
  ok(!!mainTarget, 'DSH 主页面 target 就绪');
  if (!mainTarget) {
    killSim();
    process.exit(1);
  }
  const cdp = cdpConnect(mainTarget.webSocketDebuggerUrl);

  try {
    // 0. 等 preload 注入完成（竞态防护）
    let dshReady = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 30_000) {
      try {
        const r = await cdp.send('Runtime.evaluate', { expression: '!!window.dshDesktop', returnByValue: true });
        dshReady = !!(r.result && r.result.value === true);
      } catch {
        /* ignore */
      }
      if (dshReady) break;
      await sleep(500);
    }
    ok(dshReady, 'preload dshDesktop 已注入');
    if (!dshReady) throw new Error('dshDesktop 注入超时');

    // ① 版本 1.1.3（1.1.1/1.1.2 未发布，更新内容合并到 1.1.3）
    const ver = await cdp.send('Runtime.evaluate', {
      expression: 'window.dshDesktop.getVersion()',
      returnByValue: true,
      awaitPromise: true,
    });
    ok(ver.result && ver.result.value === '1.1.3', `壳版本 = 1.1.3（实际 ${ver.result && ver.result.value}）`);

    // ② 宠物注入 + 菜单含「💎 插件市场」（老大指令保留 💎；顺序：记忆 < 提示词库 < 插件市场 < 网页打开）
    let pv = null;
    const pt0 = Date.now();
    while (Date.now() - pt0 < 30_000) {
      try {
        const r = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            const p = document.getElementById('dsh-pet');
            const items = Array.from((p && p.querySelectorAll('.pet-item')) || []).map((it) => it.textContent.trim());
            return {
              hasPet: !!p,
              hasMenu: !!(p && p.querySelector('.pet-menu')),
              items,
              hasPluginMarket: items.includes('💎 插件市场'),
              idxMemory: items.indexOf('🧠 全局记忆'),
              idxPrompt: items.indexOf('💡 提示词库'),
              idxPlugin: items.indexOf('💎 插件市场'),
              idxWeb: items.indexOf('🌐 网页打开'),
            };
          })()`,
          returnByValue: true,
        });
        pv = r.result && r.result.value;
        if (pv && pv.hasPet) break;
      } catch {
        /* ignore */
      }
      await sleep(700);
    }
    ok(!!pv && pv.hasPet && pv.hasMenu, '桌面宠物已注入（#dsh-pet + 菜单）');
    ok(!!pv && pv.hasPluginMarket, '宠物菜单含「💎 插件市场」（老大指令保留 💎）');
    ok(
      !!pv && pv.idxPlugin > pv.idxPrompt && pv.idxPlugin < pv.idxWeb,
      `「💎 插件市场」位置在提示词库与网页打开之间（idx: 记忆=${pv && pv.idxMemory} 提示词库=${pv && pv.idxPrompt} 插件=${pv && pv.idxPlugin} 网页=${pv && pv.idxWeb}）`,
    );

    // ③ preload 暴露插件市场 API
    const api = await cdp.send('Runtime.evaluate', {
      expression: `(() => ({
        openPluginMarket: typeof window.dshDesktop.openPluginMarket === 'function',
        openHelpDoc: typeof window.dshDesktop.openHelpDoc === 'function',
        getPlugins: typeof window.dshDesktop.getPlugins === 'function',
        searchPlugins: typeof window.dshDesktop.searchPlugins === 'function',
        getPluginsByCategory: typeof window.dshDesktop.getPluginsByCategory === 'function',
        copyPluginCommand: typeof window.dshDesktop.copyPluginCommand === 'function',
        openPluginRepo: typeof window.dshDesktop.openPluginRepo === 'function',
        getPluginCategories: typeof window.dshDesktop.getPluginCategories === 'function',
        refreshPlugins: typeof window.dshDesktop.refreshPlugins === 'function',
      }))()`,
      returnByValue: true,
    });
    const av = api.result && api.result.value;
    ok(!!av && av.openPluginMarket, 'preload 暴露 openPluginMarket');
    ok(!!av && av.openHelpDoc, 'preload 暴露 openHelpDoc（帮助文档窗口）');
    ok(
      !!av && av.getPlugins && av.searchPlugins && av.getPluginsByCategory,
      'preload 暴露插件列表/搜索/分类筛选 API',
    );
    ok(!!av && av.copyPluginCommand && av.openPluginRepo && av.getPluginCategories, 'preload 暴露复制/打开/分类 API');
    ok(!!av && av.refreshPlugins, 'preload 暴露 refreshPlugins（手动刷新）');

    // ④ 打开插件市场窗口
    await cdp.send('Runtime.evaluate', {
      expression: 'window.dshDesktop.openPluginMarket()',
      returnByValue: true,
      awaitPromise: true,
    });
    const mktWin = await waitTarget(SIM_DEBUG_PORT, (t) => /plugin-market\.html/.test(t.url), 15_000);
    ok(!!mktWin, '插件市场窗口已打开（plugin-market.html）');
    if (mktWin && mktWin.webSocketDebuggerUrl) {
      const mktCdp = cdpConnect(mktWin.webSocketDebuggerUrl);
      try {
        // 窗口内：分类 / 搜索框 / 卡片 / 安全提示
        let mv = null;
        const t1 = Date.now();
        while (Date.now() - t1 < 25_000) {
          const r = await mktCdp.send('Runtime.evaluate', {
            expression: `(() => {
              const cats = Array.from(document.querySelectorAll('.category-item'));
              const cards = Array.from(document.querySelectorAll('.plugin-card'));
              const sec = document.querySelector('.security-warning');
              const main = document.querySelector('.main-container');
              // 安全提示置顶：存在且位于主容器之前（DOM 顺序）
              const securityTop = !!sec && !!main && (() => {
                const secIdx = Array.prototype.indexOf.call(document.body.children, sec);
                const mainIdx = Array.prototype.indexOf.call(document.body.children, main);
                return secIdx >= 0 && mainIdx >= 0 && secIdx < mainIdx;
              })();
              return {
                hasSearch: !!document.getElementById('searchInput'),
                hasSearchBtn: !!document.getElementById('searchBtn'),
                hasBanner: !!document.getElementById('banner'),
                catCount: cats.length,
                catTexts: cats.map((c) => (c.textContent || '').trim()),
                cardCount: cards.length,
                cardNames: cards.map((c) => (c.querySelector('.plugin-name') || {}).textContent || ''),
                descTexts: cards.map((c) => (c.querySelector('.plugin-description') || {}).textContent || ''),
                hasSecurity: !!sec,
                securityText: (sec || {}).textContent || '',
                securityTop,
                hasConfirmModal: !!document.getElementById('confirm-modal'),
              };
            })()`,
            returnByValue: true,
          });
          mv = r.result && r.result.value;
          // 等窗口就绪：搜索框 + 20 分类 + 卡片渲染完成（旧缓存触发 ensureDescZh 需拉取，等待卡片出现）
          if (mv && mv.hasSearch && mv.catCount >= 20 && mv.cardCount === 2) break;
          await sleep(400);
        }
        ok(!!mv && mv.hasSearch && mv.hasSearchBtn, '顶部搜索框 + 搜索按钮存在');
        ok(
          !!mv && mv.catCount === 20,
          `分类列表 20 项（全部 + 官方 18 分类 + 其他，实际 ${mv && mv.catCount}）`,
        );
        ok(
          !!mv &&
            mv.catTexts.some((t) => t.includes('全部')) &&
            mv.catTexts.some((t) => t.includes('模型')) &&
            mv.catTexts.some((t) => t.includes('Skills')),
          `分类含全部/模型/Skills 等（实际 [${mv && mv.catTexts.join(' | ')}]）`,
        );
        ok(!!mv && mv.cardCount === 2, `插件卡片渲染（预置缓存 2 个，实际 ${mv && mv.cardCount}）`);
        ok(
          !!mv && mv.cardNames.includes('dsh-browser') && mv.cardNames.includes('dsh-code-runner'),
          '卡片名称正确（dsh-browser / dsh-code-runner）',
        );
        ok(
          !!mv && mv.hasSecurity && mv.securityText.includes('安全提示') && mv.securityText.includes('第三方') && mv.securityText.includes('⚠️'),
          `安全提示存在（含 ⚠️/安全提示/第三方，单行，实际「${mv && mv.securityText}」）`,
        );
        ok(
          !!mv && mv.securityTop === true,
          '安全提示置顶显示（位于主容器之前，v1.1.1 老大指令）',
        );
        ok(
          !!mv && mv.descTexts.some((t) => /[\u4e00-\u9fff]/.test(t)),
          `旧缓存中文补全生效（ensureDescZh 内置回退，实际描述 [${mv && mv.descTexts.join(' | ')}]）`,
        );

        // ⑤ 分类筛选：点「模型」→ 无卡片（预置缓存无 model 类）；点「全部」恢复
        const clickCat = async (label) => {
          await mktCdp.send('Runtime.evaluate', {
            expression: `(() => {
              const c = Array.from(document.querySelectorAll('.category-item'))
                .find((x) => (x.textContent || '').includes(${JSON.stringify(label)}));
              if (!c) return { ok: false };
              c.click();
              return { ok: true };
            })()`,
            returnByValue: true,
          });
          await sleep(500);
        };
        await clickCat('模型');
        let cv = null;
        const t2 = Date.now();
        while (Date.now() - t2 < 5000) {
          const r = await mktCdp.send('Runtime.evaluate', {
            expression: `(() => ({
              n: document.querySelectorAll('.plugin-card').length,
              loading: !!document.querySelector('.loading'),
            }))()`,
            returnByValue: true,
          });
          cv = r.result && r.result.value;
          // 等待筛选完成：卡片 0 且不在加载态（排除 loading 显示期误判）
          if (cv && cv.n === 0 && !cv.loading) break;
          await sleep(300);
        }
        ok(!!cv && cv.n === 0 && !cv.loading, '分类筛选「模型」→ 无卡片（缓存无 model 类插件）');
        await clickCat('全部');
        let rv2 = null;
        const t3 = Date.now();
        while (Date.now() - t3 < 5000) {
          const r = await mktCdp.send('Runtime.evaluate', {
            expression: `(() => ({
              n: document.querySelectorAll('.plugin-card').length,
              loading: !!document.querySelector('.loading'),
            }))()`,
            returnByValue: true,
          });
          rv2 = r.result && r.result.value;
          // 等待筛选完成：恢复 2 张卡片且不在加载态
          if (rv2 && rv2.n === 2 && !rv2.loading) break;
          await sleep(300);
        }
        ok(!!rv2 && rv2.n === 2 && !rv2.loading, '分类筛选「全部」→ 恢复 2 张卡片');

        // ⑥ 搜索过滤：关键词 dsh-browser
        await mktCdp.send('Runtime.evaluate', {
          expression: `(() => {
            const input = document.getElementById('searchInput');
            input.value = 'dsh-browser';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          })()`,
          returnByValue: true,
        });
        await mktCdp.send('Runtime.evaluate', {
          expression: `(() => { const b = document.getElementById('searchBtn'); if (b) b.click(); return true; })()`,
          returnByValue: true,
        });
        let sv = null;
        const t4 = Date.now();
        while (Date.now() - t4 < 5000) {
          const r = await mktCdp.send('Runtime.evaluate', {
            expression: `(() => ({
              n: document.querySelectorAll('.plugin-card').length,
              names: Array.from(document.querySelectorAll('.plugin-name')).map((x) => x.textContent),
            }))()`,
            returnByValue: true,
          });
          sv = r.result && r.result.value;
          if (sv && sv.n === 1) break;
          await sleep(300);
        }
        ok(
          !!sv && sv.n === 1 && sv.names.includes('dsh-browser'),
          `搜索「dsh-browser」→ 命中 1 张卡片（实际 ${sv && sv.n}：[${sv && sv.names && sv.names.join(',')}]）`,
        );
        // 清空搜索恢复
        await mktCdp.send('Runtime.evaluate', {
          expression: `(() => {
            const input = document.getElementById('searchInput');
            input.value = '';
            const b = document.getElementById('searchBtn');
            if (b) b.click();
            return true;
          })()`,
          returnByValue: true,
        });
        let sv2 = null;
        const t5 = Date.now();
        while (Date.now() - t5 < 5000) {
          const r = await mktCdp.send('Runtime.evaluate', {
            expression: `(() => ({ n: document.querySelectorAll('.plugin-card').length }))()`,
            returnByValue: true,
          });
          sv2 = r.result && r.result.value;
          if (sv2 && sv2.n === 2) break;
          await sleep(300);
        }
        ok(!!sv2 && sv2.n === 2, '清空搜索 → 恢复全部卡片');

        // ⑦ v1.1.1：复制安装命令 → 先弹免责声明确认模态，确认后才复制（IPC 返回 true）
        // ⑦.1 点「复制安装命令」→ 模态出现（含免责声明文案）
        await mktCdp.send('Runtime.evaluate', {
          expression: `(() => {
            const btn = Array.from(document.querySelectorAll('.plugin-card .btn-secondary'))
              .find((b) => (b.textContent || '').includes('复制安装命令'));
            if (!btn) return { ok: false };
            btn.click();
            return { ok: true };
          })()`,
          returnByValue: true,
        });
        let modalV = null;
        const tModal = Date.now();
        while (Date.now() - tModal < 5000) {
          const r = await mktCdp.send('Runtime.evaluate', {
            expression: `(() => {
              const m = document.getElementById('confirm-modal');
              const dis = document.querySelector('.modal-disclaimer');
              return {
                shown: !!m && m.style.display === 'flex',
                text: (m && m.textContent) || '',
                cmd: (document.getElementById('confirm-cmd') || {}).textContent || '',
                notices: document.querySelectorAll('.modal-notices li').length,
                disWeight: dis ? getComputedStyle(dis).fontWeight : '',
                disColor: dis ? getComputedStyle(dis).color : '',
              };
            })()`,
            returnByValue: true,
          });
          modalV = r.result && r.result.value;
          if (modalV && modalV.shown) break;
          await sleep(300);
        }
        ok(!!modalV && modalV.shown, '点「复制安装命令」→ 弹出免责声明确认模态');
        ok(
          !!modalV && modalV.text.includes('后果自负') && modalV.text.includes('安装确认'),
          `模态含免责声明（「后果自负/安装确认」，实际「${modalV && modalV.text}」）`,
        );
        ok(
          !!modalV && modalV.cmd.includes('dsh plugin'),
          `模态显示完整安装命令（实际「${modalV && modalV.cmd}」）`,
        );
        // v1.1.1（26 方案八）：安装须知 4 条（人话版）+ QQ 群兜底
        ok(
          !!modalV && modalV.notices >= 4,
          `模态含安装须知 4 条（手机 App 类比，实际 ${modalV && modalV.notices} 条）`,
        );
        ok(
          !!modalV && modalV.text.includes('916607090') && modalV.text.includes('安装前须知'),
          `模态含 QQ 群兜底（916607090）与「安装前须知」标题`,
        );
        // v1.1.1 三轮（老大反馈）：免责声明红色加粗；去掉「像装手机App一样想清楚」
        ok(
          !!modalV && (modalV.disWeight === '700' || modalV.disWeight === 'bold'),
          `免责声明加粗（font-weight=${modalV && modalV.disWeight}）`,
        );
        ok(
          !!modalV && (modalV.disColor === 'rgb(198, 40, 40)' || modalV.disColor === 'rgb(255, 138, 128)'),
          `免责声明红色（实际 ${modalV && modalV.disColor}，深色 #ff8a80 / 浅色 #c62828）`,
        );
        ok(
          !!modalV && !modalV.text.includes('像装手机 App'),
          '安装须知已去掉「像装手机 App 一样想清楚」',
        );
        // ⑦.2 点「我已确认，复制」→ 模态关闭 + IPC 复制返回 true
        await mktCdp.send('Runtime.evaluate', {
          expression: `(() => { const b = document.getElementById('confirm-ok'); if (b) b.click(); return true; })()`,
          returnByValue: true,
        });
        let modalClosed = false;
        const tModal2 = Date.now();
        while (Date.now() - tModal2 < 5000) {
          const r = await mktCdp.send('Runtime.evaluate', {
            expression: `(() => {
              const m = document.getElementById('confirm-modal');
              return !m || m.style.display !== 'flex';
            })()`,
            returnByValue: true,
          });
          modalClosed = !!(r.result && r.result.value);
          if (modalClosed) break;
          await sleep(300);
        }
        ok(modalClosed, '确认后模态关闭（复制已执行）');

        // ⑦.3 v1.1.1（老大反馈）：插件市场适配深色模式 —— shared.css 主题 token
        // 生效：body 背景 = 主题 token（深色 #08090a / 浅色 #eef0f4），卡片/侧边栏
        // 随主题（深色 #191a1b / 浅色 #fff），不再是硬编码 #f5f5f5 浅色
        const dm = await mktCdp.send('Runtime.evaluate', {
          expression: `(() => {
            const dark = matchMedia('(prefers-color-scheme: dark)').matches;
            const bodyBg = getComputedStyle(document.body).backgroundColor;
            const sidebar = document.querySelector('.sidebar');
            const card = document.querySelector('.plugin-card');
            return {
              dark,
              bodyBg,
              sidebarBg: sidebar ? getComputedStyle(sidebar).backgroundColor : '',
              cardBg: card ? getComputedStyle(card).backgroundColor : '',
              expectedBody: dark ? 'rgb(8, 9, 10)' : 'rgb(238, 240, 244)',
              expectedSurface: dark ? 'rgb(25, 26, 27)' : 'rgb(255, 255, 255)',
            };
          })()`,
          returnByValue: true,
        });
        const dmv = dm.result && dm.result.value;
        ok(
          !!dmv && dmv.bodyBg === dmv.expectedBody,
          `插件市场 body 使用主题 token（${dmv && dmv.dark ? '深色' : '浅色'}：实际 ${dmv && dmv.bodyBg}，预期 ${dmv && dmv.expectedBody}，非硬编码 #f5f5f5）`,
        );
        ok(
          !!dmv && dmv.cardBg === dmv.expectedSurface && dmv.sidebarBg === dmv.expectedSurface,
          `插件卡片/侧边栏背景随主题（实际 卡片=${dmv && dmv.cardBg} 侧边栏=${dmv && dmv.sidebarBg}，预期 ${dmv && dmv.expectedSurface}）`,
        );

        // ⑦.4 v1.1.1 三轮（老大确认）：手动「刷新」按钮 —— 绕过 7 天缓存实时拉取
        const hasRefresh = await mktCdp.send('Runtime.evaluate', {
          expression: `!!document.getElementById('refreshBtn')`,
          returnByValue: true,
        });
        ok(hasRefresh.result && hasRefresh.result.value === true, '插件市场窗口含「刷新」按钮');
        await mktCdp.send('Runtime.evaluate', {
          expression: `(() => { const b = document.getElementById('refreshBtn'); if (b) b.click(); return true; })()`,
          returnByValue: true,
        });
        // 等待刷新完成：按钮恢复可用且列表重载（网络可用 → 实时全部插件；失败 → 缓存列表）
        let refreshDone = false;
        let refreshCards = 0;
        const tR = Date.now();
        while (Date.now() - tR < 30_000) {
          const r = await mktCdp.send('Runtime.evaluate', {
            expression: `(() => ({
              disabled: document.getElementById('refreshBtn').disabled,
              loading: !!document.querySelector('.loading'),
              cards: document.querySelectorAll('.plugin-card').length,
            }))()`,
            returnByValue: true,
          });
          const rv = r.result && r.result.value;
          if (rv && !rv.disabled && !rv.loading) {
            refreshDone = true;
            refreshCards = rv.cards;
            break;
          }
          await sleep(500);
        }
        ok(
          refreshDone && refreshCards >= 2,
          `点「刷新」→ 列表重载完成（卡片 ${refreshCards} 个：实时拉取成功=全部插件，失败=缓存兜底）`,
        );

        // ⑧ 打开插件 GitHub（白名单外链，主进程执行；返回 true）
        const repoR = await mktCdp.send('Runtime.evaluate', {
          expression: `window.dshDesktop.openPluginRepo('https://github.com/anil-matcha/dsh-browser')`,
          returnByValue: true,
          awaitPromise: true,
        });
        ok(repoR.result && repoR.result.value === true, '打开插件 GitHub IPC 返回 true（白名单 github.com）');
      } catch (err) {
        ok(false, '插件市场窗口断言异常：' + err.message);
      } finally {
        mktCdp.close();
      }
    }

    // ⑨ 提示词库回归：promptlib:data 返回内置 201 条（无 prompts 缓存 → 回退包内置）
    const pl = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        const d = await window.dshDesktop.getPrompts();
        const total = (d && d.categories || []).reduce((n, c) => n + (c.subs || []).reduce((m, s) => m + (s.items || []).length, 0), 0);
        return { hasData: !!d, version: d && d.version, total };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const plv = pl.result && pl.result.value;
    ok(!!plv && plv.hasData, 'promptlib:data 返回数据（提示词库远程更新不破坏内置回退）');
    ok(
      !!plv && plv.total === 201,
      `内置提示词库 201 条（v1.0.5 基线，实际 ${plv && plv.total}）`,
    );

    // ⑩ 提示词库窗口回归（openPromptLib 仍正常打开）
    await cdp.send('Runtime.evaluate', {
      expression: 'window.dshDesktop.openPromptLib()',
      returnByValue: true,
      awaitPromise: true,
    });
    const plibWin = await waitTarget(SIM_DEBUG_PORT, (t) => /promptlib\.html/.test(t.url), 15_000);
    ok(!!plibWin, '提示词库窗口仍正常打开（promptlib.html 回归）');

    // ⑩.5 v1.1.1：更新窗口新增「提示词库」卡片（prompts:query IPC + 卡片渲染）
    await cdp.send('Runtime.evaluate', {
      expression: 'window.dshDesktop.openUpdateWindow()',
      returnByValue: true,
      awaitPromise: true,
    });
    const updWin = await waitTarget(SIM_DEBUG_PORT, (t) => /update\.html/.test(t.url), 15_000);
    ok(!!updWin, '更新窗口已打开（update.html）');
    if (updWin && updWin.webSocketDebuggerUrl) {
      const updCdp = cdpConnect(updWin.webSocketDebuggerUrl);
      try {
        let uv = null;
        const tUpd = Date.now();
        while (Date.now() - tUpd < 10_000) {
          const r = await updCdp.send('Runtime.evaluate', {
            expression: `(() => ({
              hasCard: !!document.getElementById('prompts-current'),
              current: (document.getElementById('prompts-current') || {}).textContent || '',
              latest: (document.getElementById('prompts-latest') || {}).textContent || '',
              badge: (document.getElementById('prompts-badge') || {}).textContent || '',
              status: (document.getElementById('prompts-status') || {}).textContent || '',
              hasBtn: !!document.getElementById('prompts-update'),
            }))()`,
            returnByValue: true,
          });
          uv = r.result && r.result.value;
          if (uv && uv.hasCard && uv.current !== '-') break;
          await sleep(400);
        }
        ok(!!uv && uv.hasCard, '更新窗口含「提示词库」卡片（当前版本行）');
        ok(
          !!uv && uv.current && uv.current.startsWith('v'),
          `提示词库当前版本显示（实际 ${uv && uv.current}）`,
        );
        ok(
          !!uv && (uv.badge === '最新' || uv.badge === '可更新' || uv.badge === '未知'),
          `提示词库更新徽章显示（实际 ${uv && uv.badge}，查询失败时回退「未知」）`,
        );
        ok(
          !!uv && uv.status !== '查询中…',
          `提示词库查询状态已出结果（实际「${uv && uv.status}」）`,
        );
        // 断言查询结果形态（成功=最新/可更新+版本；失败=查询失败）至少其一成立
        ok(
          !!uv &&
            ((uv.badge === '最新' || uv.badge === '可更新') || uv.status.includes('查询失败')),
          '提示词库查询结果有效（最新/可更新 或 网络失败提示）',
        );
      } catch (err) {
        ok(false, '更新窗口提示词库卡片断言异常：' + err.message);
      } finally {
        updCdp.close();
      }
    }

    // ⑩.6 v1.1.1 三轮（老大反馈）：帮助文档 = 应用内窗口（本地优先 + 后台静默同步）
    await cdp.send('Runtime.evaluate', {
      expression: 'window.dshDesktop.openHelpDoc()',
      returnByValue: true,
      awaitPromise: true,
    });
    const helpWin = await waitTarget(SIM_DEBUG_PORT, (t) => /help\.html$/.test(t.url), 15_000);
    ok(!!helpWin, '帮助文档窗口已打开（应用内 help.html，非外部浏览器）');
    if (helpWin && helpWin.webSocketDebuggerUrl) {
      const helpCdp = cdpConnect(helpWin.webSocketDebuggerUrl);
      try {
        let hv = null;
        const tH = Date.now();
        while (Date.now() - tH < 10_000) {
          const r = await helpCdp.send('Runtime.evaluate', {
            expression: `(() => ({
              title: document.title || '',
              hasContent: (document.body && document.body.textContent || '').length > 100,
            }))()`,
            returnByValue: true,
          });
          hv = r.result && r.result.value;
          if (hv && hv.title.includes('帮助文档')) break;
          await sleep(400);
        }
        ok(!!hv && hv.title.includes('帮助文档'), `帮助文档窗口标题正确（实际「${hv && hv.title}」）`);
        ok(!!hv && hv.hasContent, '帮助文档内容已渲染（本地 html 正常加载）');
      } catch (err) {
        ok(false, '帮助文档窗口断言异常：' + err.message);
      } finally {
        helpCdp.close();
      }
    }

    // ⑪ 日志：提示词库缓存加载 + 启动阶段
    await sleep(1000);
    const logDir = path.join(userData, 'logs');
    let logText = '';
    if (fs.existsSync(logDir)) {
      const logs = fs.readdirSync(logDir).filter((f) => f.endsWith('.log'));
      for (const f of logs) logText += fs.readFileSync(path.join(logDir, f), 'utf8');
    }
    ok(logText.includes('提示词库缓存已加载') || logText.includes('加载提示词库缓存失败'), '日志：提示词库缓存加载已执行');
    ok(logText.includes('检查提示词库更新'), '日志：提示词库更新检查已启动（静默）');
    ok(logText.includes('检查帮助文档远程更新'), '日志：帮助文档后台静默同步已执行');
    ok(logText.includes('开始刷新插件市场'), '日志：插件市场手动刷新已执行');
    ok(logText.includes(`v1.1.3 启动`), `日志：v1.1.3 启动（实际含「${logText.match(/v[\d.]+ 启动/)}」）`);
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
