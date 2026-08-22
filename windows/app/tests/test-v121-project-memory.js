'use strict';

/**
 * test-v121-project-memory.js — v1.2.1 T1 project-memory 模块行为测试
 *
 * 覆盖：路径解析 / 索引增删 / 原子写盘 + .bak / 目录校验 / 大小上限 /
 *       区块解析重组 / 损坏容错 / 当前工作区。
 *
 * 用法：node tests/test-v121-project-memory.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProjectMemory } = require('../modules/project-memory');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

function makeEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v121-pm-'));
  const userData = path.join(root, 'userData');
  const ws = path.join(root, 'workspace');
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(ws, { recursive: true });
  const app = { getPath: () => userData };
  let currentWs = ws;
  const pm = createProjectMemory({
    fs, path, app,
    appendLog: () => {},
    getWorkspacePath: async () => currentWs,
  });
  return { pm, root, userData, ws, setWorkspace: (p) => { currentWs = p; } };
}

async function run() {
  console.log('[T1] 基础函数');
  {
    const e = makeEnv();
    const { pm, ws } = e;
    ok(pm.getProjectMemoryPath(ws) === path.join(ws, 'AGENTS.md'), 'getProjectMemoryPath = <ws>/AGENTS.md');
    ok(pm.validateWorkspace(ws) === ws, 'validateWorkspace 对已存在目录返回路径');
    ok(pm.validateWorkspace(path.join(ws, 'nope')) === null, 'validateWorkspace 对不存在目录返回 null');
    ok(pm.validateWorkspace('') === null, 'validateWorkspace 对空路径返回 null');
  }

  console.log('[T1] 保存 + 索引');
  {
    const e = makeEnv();
    const { pm, ws } = e;
    let r = pm.saveProjectMemory(ws, '# 项目\n\n## 背景\n\n这是项目背景\n');
    ok(r.ok === true && fs.existsSync(path.join(ws, 'AGENTS.md')), '保存成功 + 文件落盘');
    ok(fs.existsSync(path.join(e.userData, 'projects-memory-index.json')), '索引文件已写入 userData');
    const projects = pm.listProjects();
    ok(projects.length === 1 && projects[0].path === ws && projects[0].name === 'workspace', '索引含 1 项（path + name）');
    ok(projects[0].lastEdited, '索引含 lastEdited');
    // 再次保存（有旧文件 → 生成 .bak）
    r = pm.saveProjectMemory(ws, '# 项目改\n\n## 背景\n\n内容改\n');
    ok(r.ok === true, '再次保存成功');
    ok(fs.existsSync(path.join(ws, 'AGENTS.md.bak')), '再次保存（有旧文件）生成 .bak');
    ok(fs.readFileSync(path.join(ws, 'AGENTS.md.bak'), 'utf8').includes('这是项目背景'), '.bak = 上一次版本');
  }

  console.log('[T1] 目录校验 + 大小上限');
  {
    const e = makeEnv();
    const { pm, ws } = e;
    ok(pm.saveProjectMemory(path.join(ws, 'not-a-dir'), '# x').ok === false, '不存在目录拒绝保存');
    const huge = 'x'.repeat(1024 * 1024 + 10);
    const r = pm.saveProjectMemory(ws, huge);
    ok(r.ok === false && /过大/.test(r.message), '>1MB 内容拒绝保存');
  }

  console.log('[T1] 区块解析 / 重组');
  {
    const e = makeEnv();
    const { pm } = e;
    const parsed = pm.parseProjectMemory('# 项目\n\n## 背景\n\n内容A\n\n## 环境\n\n- node\n');
    ok(parsed.head.includes('# 项目'), 'head 提取正确');
    ok(parsed.sections.length === 2 && parsed.sections[0].title === '背景', '两个区块，第一个标题=背景');
    ok(parsed.sections[1].body.join('\n').includes('- node'), '区块 body 保留原格式');
    const out = pm.renderProjectMemory(parsed.head, parsed.sections);
    ok(out.includes('# 项目') && out.includes('## 背景') && out.includes('## 环境'), '重组包含 head + 两区块');
    ok(!out.includes('undefined'), '重组无 undefined');
  }

  console.log('[T1] 删除');
  {
    const e = makeEnv();
    const { pm, ws } = e;
    pm.saveProjectMemory(ws, '# x\n');
    let r = pm.deleteProjectMemory(ws);
    ok(r.ok === true && r.removed === true, '删除成功');
    ok(!fs.existsSync(path.join(ws, 'AGENTS.md')), '文件已删除');
    ok(pm.listProjects().length === 0, '索引已清空该项目');
  }

  console.log('[T1] data() + 当前工作区');
  {
    const e = makeEnv();
    const { pm, ws } = e;
    pm.saveProjectMemory(ws, '# 项目\n');
    const d = await pm.data();
    ok(d.workspace === ws, 'data().workspace = 当前工作区');
    ok(d.exists === true && d.content.includes('# 项目'), 'data() 读到内容');
    ok(d.projects.length === 1, 'data().projects = 索引');
  }

  console.log(`\n${passed} 通过, ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error('执行抛错：', err); process.exit(1); });
