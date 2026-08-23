'use strict';
/** cdp-v121-check.js — v1.2.1 CDP 仿真：验证 ① 宠物菜单「记忆管理/技能库」入口 ② 记忆管理窗口双 Tab
 *  ③ 项目记忆经 IPC 写入 <工作区>/AGENTS.md ④ 技能 saveSkill/listInstalled 生效
 *  ⑤ 技能库窗口 ⑥ 设置默认（lanAccess=false / taskNotify=true）⑦ lan 模块在位 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_ROOT = 'D:/00xm/x-app/dsh-Desktop/windows/app';
const PACKED_EXE = path.join(APP_ROOT, 'dist', 'DSH-Desktop-win32-x64', 'DSH-Desktop.exe');
const SIM_ROOT = path.join(os.tmpdir(), 'dsh-sim-v121');
const SIM_PORT = 3121;
const SIM_DEBUG_PORT = 9261;

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function httpGet(url, timeoutMs = 6000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try { const res = await fetch(url, { signal: controller.signal }); return { status: res.status, body: await res.text() }; }
  finally { clearTimeout(t); }
}
function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1; const pending = new Map();
  const ready = new Promise((res, rej) => { ws.addEventListener('open', () => res()); ws.addEventListener('error', () => rej(new Error('ws fail'))); });
  ws.addEventListener('message', (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error('CDP: ' + JSON.stringify(m.error))) : resolve(m.result); } });
  return {
    ws,
    async send(method, params = {}) { await ready; const id = nextId++; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); },
    async eval(expression) { const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r && r.result ? r.result.value : undefined; },
    close() { try { ws.close(); } catch {} },
  };
}
async function waitTarget(port, pred, timeoutMs = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const r = await httpGet(`http://127.0.0.1:${port}/json`, 2000); const ts = JSON.parse(r.body); const t = ts.find(pred); if (t) return t; } catch {}
    await sleep(600);
  }
  return null;
}
let child;
function killSim() { try { if (child && child.pid) require('node:child_process').execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' }); } catch {} }
async function waitReady(cdp, retries = 90) {
  for (let i = 0; i < retries; i++) { try { const v = await cdp.eval('!!window && !!document.body'); if (v) return true; } catch {} await sleep(1000); }
  return false;
}

async function main() {
  if (!fs.existsSync(PACKED_EXE)) throw new Error('打包产物不存在：' + PACKED_EXE);
  fs.rmSync(SIM_ROOT, { recursive: true, force: true });
  const userData = path.join(SIM_ROOT, 'userdata');
  const dshHome = path.join(SIM_ROOT, 'dshhome');
  const workspace = path.join(SIM_ROOT, 'workspace');
  fs.mkdirSync(path.join(userData, 'dshenv'), { recursive: true });
  fs.mkdirSync(path.join(dshHome, 'storages'), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  const src = path.join(os.tmpdir(), 'dsh-sim-v095', 'userdata', 'dshenv');
  if (fs.existsSync(path.join(src, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
    fs.cpSync(src, path.join(userData, 'dshenv'), { recursive: true });
    console.log('[0] dshenv 复用 v095 仿真');
  } else { throw new Error('dshenv 源缺失'); }
  fs.writeFileSync(path.join(dshHome, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n', 'utf8');
  // 预置合法 credentials（version 必须是字符串，否则 dsh-credentials-local 启动失败）
  fs.writeFileSync(path.join(dshHome, '.credentials.yaml'), 'version: "2026-08-22.1"\n', 'utf8');
  fs.writeFileSync(path.join(dshHome, 'storages', 'workspace.json'), JSON.stringify({ unit: { name: 'workspace', version: 2 }, global: { initialized: true, workspaceIds: ['sim-ws'] }, tables: { workspaces: { 'sim-ws': { path: workspace, title: 'v121-sim', sessionIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } } } }, null, 2), 'utf8');

  console.log('[1] 启动 dist 包 --port=' + SIM_PORT + ' --remote-debugging-port=' + SIM_DEBUG_PORT);
  child = spawn(PACKED_EXE, [`--user-data-dir=${userData}`, `--port=${SIM_PORT}`, `--remote-debugging-port=${SIM_DEBUG_PORT}`], { env: { ...process.env, DSH_HOME: dshHome, USERPROFILE: SIM_ROOT, HOME: SIM_ROOT }, stdio: 'ignore', detached: true, windowsHide: true });
  child.unref();

  const target = await waitTarget(SIM_DEBUG_PORT, (t) => t.type === 'page' && new RegExp(`^http://127\\.0\\.0\\.1:${SIM_PORT}`).test(t.url));
  ok(!!target, 'DSH 主页面 target 就绪');
  if (!target) { killSim(); process.exit(1); }
  const cdp = cdpConnect(target.webSocketDebuggerUrl);
  ok(await waitReady(cdp), 'DSH 页面渲染就绪');

  // ① 宠物菜单文案（记忆管理 / 技能库）—— 轮询等待宠物注入
  console.log('[2] 宠物菜单入口');
  let pet = null;
  for (let i = 0; i < 30; i++) {
    pet = await cdp.eval(`(() => {
      const p = document.getElementById('dsh-pet');
      if (!p) return { ok:false, reason:'no pet' };
      const items = Array.from(p.querySelectorAll('.pet-item')).map((i) => i.textContent.trim());
      return { ok:true, items };
    })()`);
    if (pet && pet.ok) break;
    await sleep(1000);
  }
  ok(!!pet && pet.ok, '宠物菜单存在');
  ok(!!pet && pet.ok && pet.items.includes('🧠 记忆管理'), '宠物菜单含「🧠 记忆管理」');
  ok(!!pet && pet.ok && pet.items.includes('🛠️ 技能库'), '宠物菜单含「🛠️ 技能库」');

  // ② 记忆管理窗口双 Tab
  console.log('[3] 记忆管理窗口（双 Tab）');
  await cdp.eval(`window.dshDesktop && window.dshDesktop.openGlobalMemory()`);
  const gmWin = await waitTarget(SIM_DEBUG_PORT, (t) => /global-memory\.html/.test(t.url), 20000);
  ok(!!gmWin, '打开记忆管理窗口（global-memory.html）');
  if (gmWin) {
    const gmc = cdpConnect(gmWin.webSocketDebuggerUrl);
    await sleep(800);
    const tabOk = await gmc.eval(`(() => {
      const g = document.getElementById('tab-global');
      const p = document.getElementById('tab-project');
      const pg = document.getElementById('panel-global');
      const pp = document.getElementById('panel-project');
      return { hasGlobal: !!g, hasProject: !!p, globalHidden: pg ? pg.hidden : null, projectHidden: pp ? pp.hidden : null };
    })()`);
    ok(!!tabOk && tabOk.hasGlobal && tabOk.hasProject, '记忆管理窗口含「全局记忆/项目记忆」双 Tab');
    gmc.close();
  }

  // ③ 项目记忆：经 IPC 写入 <工作区>/AGENTS.md
  console.log('[4] 项目记忆写入');
  const pmData = await cdp.eval(`(async () => {
    if (!window.dshDesktop || !window.dshDesktop.getProjectMemory) return { ok:false, reason:'no api' };
    const d = await window.dshDesktop.getProjectMemory();
    return { ok:true, workspace:d.workspace, path:d.path };
  })()`);
  console.log('  pmData:', JSON.stringify(pmData));
  ok(!!pmData && pmData.ok && !!pmData.workspace, '项目记忆能定位当前工作区（' + (pmData && pmData.workspace) + '）');
  if (pmData && pmData.workspace) {
    const save = await cdp.eval(`(async () => {
      const r = await window.dshDesktop.saveProjectMemory(${JSON.stringify(pmData.workspace)}, '# CDP项目记忆\\n\\n## 背景\\n\\nCDP 仿真验证\\n');
      return r;
    })()`);
    console.log('  save:', JSON.stringify(save));
    ok(!!save && save.ok, '保存项目记忆成功');
    const pmFile = path.join(pmData.workspace, 'AGENTS.md');
    const written = fs.existsSync(pmFile) ? fs.readFileSync(pmFile, 'utf8') : '';
    ok(written.includes('CDP 仿真验证'), '项目记忆文件已写入 <工作区>/AGENTS.md');
  }

  // ④ 技能：saveSkill + listInstalled
  console.log('[5] 技能库 saveSkill/listInstalled');
  const skSave = await cdp.eval(`(async () => {
    const r = await window.dshDesktop.saveSkill({ name:'cdp-test-skill', description:'CDP 测试技能', body:'# 指令\\n- 步骤1\\n' });
    return r;
  })()`);
  console.log('  saveSkill:', JSON.stringify(skSave));
  ok(!!skSave && skSave.ok, 'saveSkill 成功');
  const skillFile = path.join(dshHome, 'skills', 'cdp-test-skill', 'SKILL.md');
  ok(fs.existsSync(skillFile), 'SKILL.md 已写入 ~/.dsh/skills/cdp-test-skill/');
  const list = await cdp.eval(`(async () => { return await window.dshDesktop.listInstalledSkills(); })()`);
  const lis = await cdp.eval(`(async () => { const l = await window.dshDesktop.listInstalledSkills(); return l.map((s)=>s.name).join(','); })()`);
  ok(!!lis && lis.includes('cdp-test-skill'), 'listInstalledSkills 能发现新技能');

  // ⑤ 技能库窗口
  console.log('[6] 技能库窗口');
  const skOpen = await cdp.eval(`(async () => {
    try {
      if (!window.dshDesktop || !window.dshDesktop.openSkillLibrary) return { ok:false, reason:'no api' };
      const r = await window.dshDesktop.openSkillLibrary();
      return { ok:true, r };
    } catch (e) { return { ok:false, err:String(e) }; }
  })()`);
  console.log('  openSkillLibrary result:', JSON.stringify(skOpen));
  const skWin = await waitTarget(SIM_DEBUG_PORT, (t) => /skill-library\.html/.test(t.url), 20000);
  if (!skWin) {
    try {
      const r = await httpGet(`http://127.0.0.1:${SIM_DEBUG_PORT}/json`, 2000);
      console.log('  [debug] targets:', r.body);
    } catch (e) { console.log('  [debug] targets err:', e.message); }
  }
  ok(!!skWin, '打开技能库窗口（skill-library.html）');

  // ⑥ 设置默认（settings.json 落盘）
  console.log('[7] 设置默认值');
  let settingFile = null;
  try { const s = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')); settingFile = s; } catch {}
  ok(!!settingFile && settingFile.lanAccess === false, 'settings.lanAccess 默认 false');
  ok(!!settingFile && settingFile.taskNotify === true, 'settings.taskNotify 默认 true');

  // ⑦ 局域网二维码 IPC 在位
  console.log('[8] 局域网模块在位');
  const lan = await cdp.eval(`(async () => {
    if (!window.dshDesktop || !window.dshDesktop.getLanQrData) return { ok:false, reason:'no api' };
    const d = await window.dshDesktop.getLanQrData();
    return { ok:true, enabled:d.enabled, port:d.port, ips:(d.ips||[]).length };
  })()`);
  console.log('  lan:', JSON.stringify(lan));
  ok(!!lan && lan.ok && !lan.enabled, 'lan:qr-data 可用 + 默认未开启');

  // ⑨ 局域网开关切换（回归：开启后不崩溃、DSH 仍 127.0.0.1、代理启动、关闭恢复）
  console.log('[9] 局域网开关切换');
  const lanOn = await cdp.eval(`(async () => {
    try { const r = await window.dshDesktop.setLanAccess(true); return { ok: !!r && r.ok !== false, r }; }
    catch (e) { return { ok:false, err:String(e) }; }
  })()`);
  console.log('  lanOn:', JSON.stringify(lanOn));
  ok(!!lanOn && lanOn.ok, '开启局域网访问成功（不崩溃）');
  const alive = await cdp.eval('!!document.body');
  ok(alive === true, '开启后 DSH 主页面仍活跃（未被重启/未崩溃）');
  const lanOnData = await cdp.eval(`(async () => { const d = await window.dshDesktop.getLanQrData(); return { enabled:d.enabled, port:d.port, ips:(d.ips||[]).length }; })()`);
  console.log('  lanOnData:', JSON.stringify(lanOnData));
  ok(!!lanOnData && lanOnData.enabled === true, '开启后 lan:qr-data enabled=true');
  ok(!!lanOnData && lanOnData.port > SIM_PORT, '代理端口 > DSH 端口（' + (lanOnData && lanOnData.port) + '）');
  // 通过代理端口 HTTP 访问 DSH UI（真实验证代理转发）
  const pageViaProxy = await httpGet(`http://127.0.0.1:${lanOnData.port}/`, 8000);
  ok(pageViaProxy && pageViaProxy.status === 200 && /DeepSeek Harness/i.test(String(pageViaProxy.body || '')), '通过代理端口可访问 DSH 页面（HTTP 转发成功，status=' + (pageViaProxy && pageViaProxy.status) + ')');
  const lanOff = await cdp.eval(`(async () => {
    try { const r = await window.dshDesktop.setLanAccess(false); return { ok: !!r && r.ok !== false }; }
    catch (e) { return { ok:false, err:String(e) }; }
  })()`);
  ok(!!lanOff && lanOff.ok, '关闭局域网访问成功');

  killSim();
  console.log(`\nRESULT: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => { console.error('执行抛错：', err); try { killSim(); } catch {} process.exit(1); });
