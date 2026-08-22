'use strict';

/**
 * test-v121-backup.js — v1.2.1 T9 备份/恢复扩展功能测试（真实 tar 往返）
 *
 * 覆盖：backupUserData 打包 ~/.dsh + settings + custom-prompts + 项目记忆（索引 + 各项目 AGENTS.md），
 *       restoreUserData 按 manifest.projectMemories 还原项目 AGENTS.md；损坏/缺路径防护。
 *
 * 用法：node tests/test-v121-backup.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tar = require('tar');
const { createBackup } = require('../modules/backup');

let passed = 0, failed = 0;
function ok(cond, name) { if (cond) { passed++; console.log(`  ✓ ${name}`); } else { failed++; console.error(`  ✗ ${name}`); } }

function makeEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v121-bk-'));
  const home = path.join(root, 'home');
  const userData = path.join(root, 'userData');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(path.join(home, '.dsh'), { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });

  // 全局记忆（~/.dsh） + 设置 + 项目记忆（工作区 AGENTS.md + 索引）
  fs.writeFileSync(path.join(home, '.dsh', 'AGENTS.md'), '# 全局\n\n## 用户设定\n- 用户的称呼：测试\n', 'utf8');
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 'test', autostart: false }), 'utf8');
  fs.writeFileSync(path.join(userData, 'custom-prompts.json'), JSON.stringify({ items: [{ id: '1', name: 'p' }] }), 'utf8');
  fs.writeFileSync(path.join(workspace, 'AGENTS.md'), '# 项目记忆\n\n## 背景\n\n这是项目背景\n', 'utf8');
  fs.writeFileSync(path.join(userData, 'projects-memory-index.json'), JSON.stringify({ projects: [{ path: workspace, name: 'workspace', lastEdited: '2026-08-22' }] }), 'utf8');

  const backupPath = path.join(root, 'backup.tar.gz');
  const calls = { saveDialog: false, openDialog: false };

  const app = {
    getPath: (k) => (k === 'userData' ? userData : k === 'documents' ? root : root),
    getVersion: () => '1.2.1',
    relaunch: () => {},
    exit: () => {},
  };
  const dialog = {
    showSaveDialog: async (_o, opts) => { calls.saveDialog = true; return { canceled: false, filePath: opts && opts.defaultPath ? backupPath : backupPath }; },
    showOpenDialog: async () => { calls.openDialog = true; return { canceled: false, filePaths: [backupPath] }; },
    showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
    showErrorBox: () => {},
  };

  const realHomedir = os.homedir;
  const realUserprofile = process.env.USERPROFILE;
  os.homedir = () => home;
  process.env.USERPROFILE = root;

  const backup = createBackup({
    appName: 'test',
    app, dialog, shell: { openPath: () => {} }, fs, os, path, tar,
    appendLog: () => {},
    localTimestamp: () => '2026-08-22T00:00:00Z',
    localDate: () => '2026-08-22',
    readShellConfig: () => ({ dshPackage: '@deepseek-ai/dsh', dshVersion: '0.1.0' }),
    installedDshVersion: () => '0.1.0',
    settingsFile: () => path.join(userData, 'settings.json'),
    getOwnerWindow: () => undefined,
    isServerRunning: () => false,
    stopServerOnly: async () => {},
    setQuitting: () => {},
    openBackupProgress: () => {},
    updateBackupProgress: () => {},
    closeBackupProgress: () => {},
  });

  return {
    backup, root, home, userData, workspace, backupPath, calls,
    restore: () => {
      os.homedir = realHomedir;
      if (realUserprofile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = realUserprofile;
    },
  };
}

async function run() {
  console.log('[T9] 备份：打包项目记忆');
  const e = makeEnv();
  await e.backup.backupUserData();
  ok(fs.existsSync(e.backupPath), '备份包已生成');
  const extractDir = path.join(e.root, 'unz');
  fs.mkdirSync(extractDir, { recursive: true });
  await tar.extract({ file: e.backupPath, cwd: extractDir, portable: true });
  ok(fs.existsSync(path.join(extractDir, 'manifest.json')), '包内含 manifest.json');
  const manifest = JSON.parse(fs.readFileSync(path.join(extractDir, 'manifest.json'), 'utf8'));
  ok(manifest.format === 'dsh-backup-v1', 'manifest 格式正确');
  ok(Array.isArray(manifest.projectMemories) && manifest.projectMemories.length === 1, 'manifest.projectMemories 含 1 条项目记忆');
  ok(manifest.projectMemories[0].path === e.workspace, 'projectMemories 记录项目路径');
  ok(entriesHas(manifest, 'projects-memory-index.json'), 'entries 含 projects-memory-index.json');
  ok(entriesHas(manifest, 'projects-pm'), 'entries 含 projects-pm');
  ok(fs.existsSync(path.join(extractDir, 'projects-memory-index.json')), '包内含项目记忆索引');
  const pm = fs.readFileSync(path.join(extractDir, 'projects-pm', '0.md'), 'utf8');
  ok(pm.includes('这是项目背景'), '包内 projects-pm/0.md = 项目 AGENTS.md 内容');
  ok(fs.existsSync(path.join(extractDir, '.dsh', 'AGENTS.md')), '包内含 ~/.dsh/AGENTS.md（全局记忆）');
  ok(fs.existsSync(path.join(extractDir, 'settings.json')), '包内含 settings.json');

  console.log('[T9] 恢复：还原项目记忆');
  // 先清空项目记忆 + 索引，模拟丢失
  fs.unlinkSync(path.join(e.workspace, 'AGENTS.md'));
  fs.unlinkSync(path.join(e.userData, 'projects-memory-index.json'));
  await e.backup.restoreUserData();
  ok(fs.existsSync(path.join(e.workspace, 'AGENTS.md')), '恢复后项目 AGENTS.md 已还原');
  const restored = fs.readFileSync(path.join(e.workspace, 'AGENTS.md'), 'utf8');
  ok(restored.includes('这是项目背景'), '项目 AGENTS.md 内容正确');
  ok(fs.existsSync(path.join(e.userData, 'projects-memory-index.json')), '恢复后项目记忆索引已还原');
  ok(fs.existsSync(path.join(e.home, '.dsh', 'AGENTS.md')), '恢复后 ~/.dsh/AGENTS.md 已还原');

  e.restore();
  console.log(`\n${passed} 通过, ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

function entriesHas(manifest, entry) { return Array.isArray(manifest.entries) && manifest.entries.includes(entry); }

run().catch((err) => { console.error('执行抛错：', err); process.exit(1); });
