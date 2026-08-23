'use strict';
// check-v121-pack.js — v1.2.1 打包内容核对：新模块/渲染器进包 + 版本一致 + 代码接线
const fs = require('node:fs');
const path = require('node:path');
const winApp = 'dist/installer/win-unpacked/resources/app/';
const read = (p) => fs.readFileSync(winApp + p, 'utf8');
const exists = (p) => fs.existsSync(winApp + p);

let failed = 0;
function ok(cond, name) { if (cond) { console.log('  ✓ ' + name); } else { failed++; console.error('  ✗ ' + name); } }

function run() {
  const pkg = JSON.parse(read('package.json'));
  const changelog = JSON.parse(read('CHANGELOG.json'));
  const rootV = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'version.json'), 'utf8'));
  const main = read('main.js');
  const ipc = read('modules/ipc.js');
  const preload = read('preload.js');
  const pet = read('modules/pet.js');
  const menu = read('modules/menu.js');
  const qrhtml = read('renderer/lan-qr.html');
  // skills-list.json 在仓库根（远程三源下发，不进安装包）—— 从仓库根读
  const skillsList = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'skills-list.json'), 'utf8'));
  const skrender = read('renderer/skill-library.js');
  const skillmodule = read('modules/skill-library.js');

  console.log('[版本一致]');
  ok(pkg.version === '1.2.2', 'package.json version = 1.2.2（实际 ' + pkg.version + '）');
  ok(rootV.version === '1.2.2', 'version.json version = 1.2.2（实际 ' + rootV.version + '）');
  ok(changelog.versions[0].version === '1.2.2', 'CHANGELOG 首条 = 1.2.2');

  console.log('[新模块/渲染器进包]');
  ['modules/project-memory.js', 'modules/skill-library.js', 'modules/lan-access.js', 'modules/task-notify.js'].forEach((f) => ok(exists(f), f + ' 进包'));
  ['renderer/memory-project.js', 'renderer/skill-library.html', 'renderer/skill-library.js', 'renderer/lan-qr.html', 'renderer/lan-qr.js'].forEach((f) => ok(exists(f), f + ' 进包'));

  console.log('[主进程接线]');
  ok(main.includes('createProjectMemory'), 'main 组装 createProjectMemory');
  ok(main.includes('createSkillLibrary'), 'main 组装 createSkillLibrary');
  ok(main.includes('createLanAccess'), 'main 组装 createLanAccess');
  ok(main.includes('createTaskNotify'), 'main 组装 createTaskNotify');
  ok(main.includes('openSkillLibraryWindow'), 'main 有 openSkillLibraryWindow');
  ok(main.includes('openLanQrWindow'), 'main 有 openLanQrWindow');

  console.log('[IPC 接线]');
  ['project-memory:data', 'project-memory:save', 'project-memory:delete', 'project-memory:read',
    'skill:list-installed', 'skill:save', 'skill:delete', 'skill:market-list', 'skill:install',
    'lan:qr-data', 'lan:set', 'toolbox:open-skill-library'].forEach((ch) => ok(ipc.includes(ch), 'ipc ' + ch));

  console.log('[preload 接线]');
  ['getProjectMemory', 'saveProjectMemory', 'deleteProjectMemory', 'listInstalledSkills', 'saveSkill', 'deleteSkill', 'getSkillMarket', 'installSkill', 'getLanQrData', 'setLanAccess', 'openSkillLibrary'].forEach((api) => ok(preload.includes(api), 'preload ' + api));

  console.log('[菜单/入口文案]');
  ok(pet.includes('🧠 记忆管理'), '宠物菜单「🧠 记忆管理」');
  ok(pet.includes('🛠️ 技能库'), '宠物菜单「🛠️ 技能库」');
  ok(pet.includes('data-action="lan"') && pet.includes('📱 手机访问'), '宠物菜单「📱 手机访问」入口（开关在弹窗内）');
  ok(!menu.includes("label: '手机访问'") && !menu.includes("label: '局域网访问'"), '设置菜单不再含「手机访问/局域网访问」');
  ok(menu.includes("label: '任务完成通知'"), '设置菜单「任务完成通知」');
  ok(qrhtml.includes('id="lan-switch"'), '手机访问弹窗含药丸开关');
  ok(qrhtml.includes('overflow: hidden'), '手机访问弹窗禁止滚动（说明完整展示）');

  console.log('[技能市场]');
  ok(skillsList.version === 2, 'skills-list.json version=2');
  ok(Array.isArray(skillsList.skills) && skillsList.skills.length >= 6, '技能市场 ≥ 6 条');
  ok(skillsList.skills.every((s) => s.repo && s.file), '每条含 repo + file');
  ok(skillsList.skills.some((s) => s.repo === 'anthropics/skills'), '含 Anthropic 官方来源（多来源）');
  ok(skillsList.skills.some((s) => s.install_req), '含安装要求 install_req 字段');
  ok(skrender.includes('skill-card-req'), '市场 UI 展示安装要求区');
  ok(skrender.includes('act-copy-req') && skrender.includes('安装指令已复制'), '市场 UI 含「复制安装指令」');
  ok(skillmodule.includes('installReq'), 'skill-library 透传 installReq');

  console.log('[' + (failed ? 'FAIL' : 'OK') + ']');
  process.exit(failed ? 1 : 0);
}

run();
