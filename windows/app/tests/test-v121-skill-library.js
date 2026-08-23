'use strict';

/**
 * test-v121-skill-library.js — v1.2.1 T4 skill-library 模块行为测试
 *
 * 覆盖：frontmatter 解析 / 名称校验 / saveSkill（原子 + 大小上限 + 组装）/
 *       listInstalled（目录扫描 + dedup + level）/ readSkill / deleteSkill /
 *       市场 parseMarketList / installFromMarket（mock net）/ 非法路径防护。
 *
 * 用法：node tests/test-v121-skill-library.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSkillLibrary } = require('../modules/skill-library');

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}

// mock net.request 返回指定内容（供 installFromMarket / fetchMarketList）
function mockNet(routes) {
  return {
    request(url) {
      const body = routes[url] || '';
      const req = {
        setHeader: () => {},
        on(ev, fn) { if (ev === 'response') this._resp = fn; if (ev === 'error') this._err = fn; return this; },
        end() {
          const self = this;
          setImmediate(() => {
            if (typeof body === 'string' && self._resp) {
              const res = {
                statusCode: 200,
                setEncoding: () => {},
                on(ev, fn) {
                  if (ev === 'data') fn(body);
                  if (ev === 'end') fn();
                  return this;
                },
              };
              self._resp(res);
            } else if (self._err) {
              self._err(new Error('fetch fail'));
            }
          });
        },
        abort() {},
      };
      return req;
    },
  };
}

function makeEnv(routes) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-v121-sk-'));
  const userData = path.join(home, 'userData');
  fs.mkdirSync(userData, { recursive: true });
  const app = { getPath: () => userData };
  const net = routes ? mockNet(routes) : { request: () => { throw new Error('no net'); } };
  const realHomedir = os.homedir;
  const realDshHome = process.env.DSH_HOME;
  os.homedir = () => home;
  process.env.DSH_HOME = path.join(home, 'dsh'); // 隔离：技能写入测试目录，绝不碰真实 ~/.dsh
  const sk = createSkillLibrary({
    app, fs, os, path, net,
    appendLog: () => {},
    getWorkspacePath: async () => null,
  });
  return {
    sk, home, userData,
    dsh: process.env.DSH_HOME,
    restore: () => {
      os.homedir = realHomedir;
      if (realDshHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = realDshHome;
    },
  };
}

async function run() {
  console.log('[T4] frontmatter 解析 / 名称校验');
  {
    const e = makeEnv();
    const { sk } = e;
    const fm = sk.parseFrontmatter('---\nname: test-skill\ndescription: A test skill\nwhenToUse: When testing\n---\nbody here\n');
    ok(fm.name === 'test-skill' && fm.description === 'A test skill', '解析 name/description');
    ok(fm.whenToUse === 'When testing', '解析 whenToUse');
    const fm2 = sk.parseFrontmatter('---\nname: "quoted"\ndescription: >-\n  line1\n  line2\n---');
    ok(fm2.name === 'quoted' && fm2.description.includes('line1'), '解析引号值 + 续行描述');
    ok(sk.safeName('Good-Skill-2') === 'good-skill-2', 'safeName 小写 kebab');
    ok(sk.safeName('Bad name!') === '', 'safeName 非法字符返回空');
    ok(sk.safeName('../evil') === '', 'safeName 路径穿越返回空');
    e.restore();
  }

  console.log('[T4] saveSkill / readSkill');
  {
    const e = makeEnv();
    const { sk } = e;
    let r = sk.saveSkill({ name: 'My Skill!', description: 'desc', body: '# Content\n## 用法\n- 步骤' });
    ok(r.ok === false, '名称非法拒绝保存');
    r = sk.saveSkill({ name: 'test-skill', description: 'desc', body: 'body' });
    ok(r.ok === true, '合法技能保存成功');
    const file = r.path;
    ok(fs.existsSync(file), 'SKILL.md 已落盘');
    const content = fs.readFileSync(file, 'utf8');
    ok(content.startsWith('---\nname: test-skill'), 'frontmatter name 正确生成');
    ok(content.includes('description: desc'), 'frontmatter description 正确');
    ok(content.includes('body'), '正文保留');
    // readSkill
    const rd = sk.readSkill('test-skill');
    ok(rd.ok && rd.content.includes('body'), 'readSkill 读回全文');
    ok(sk.readSkill('nope').ok === false, 'readSkill 未找到返回失败');
    // 大小上限
    const huge = 'x'.repeat(501 * 1024);
    ok(sk.saveSkill({ name: 'big-skill', description: 'd', body: huge }).ok === false, '>500KB 拒绝保存');
    e.restore();
  }

  console.log('[T4] listInstalled 扫描 + dedup');
  {
    const e = makeEnv();
    const { sk } = e;
    const usk1 = path.join(e.dsh, 'skills', 'alpha');
    fs.mkdirSync(usk1, { recursive: true });
    fs.writeFileSync(path.join(usk1, 'SKILL.md'), '---\nname: alpha\ndescription: alpha skill\n---\nalpha body\n');
    // 用户 .agents/skills 直接 .md
    const usk2 = path.join(e.home, '.agents', 'skills', 'beta.md');
    fs.mkdirSync(path.dirname(usk2), { recursive: true });
    fs.writeFileSync(usk2, '---\nname: beta\ndescription: beta skill\n---\nbeta body\n');
    // 非法名技能 → 跳过
    const bad = path.join(e.dsh, 'skills', 'Bad Name');
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, 'SKILL.md'), '---\nname: Bad Name\ndescription: x\n---\n');
    const list = await sk.listInstalled();
    const names = list.map((s) => s.name);
    ok(names.includes('alpha') && names.includes('beta'), '扫描到 alpha + beta');
    ok(!names.includes('bad-name'), '非法名技能跳过（警告不崩）');
    ok(list.find((s) => s.name === 'alpha').level === 'user', '用户级技能 level=user');
    ok(list.find((s) => s.name === 'beta').path.endsWith('beta.md'), '直接 .md 技能识别');
    e.restore();
  }

  console.log('[T4] deleteSkill');
  {
    const e = makeEnv();
    const { sk } = e;
    sk.saveSkill({ name: 'del-skill', description: 'd', body: 'b' });
    let r = sk.deleteSkill('del-skill');
    ok(r.ok === true, '删除成功');
    ok(sk.readSkill('del-skill').ok === false, '删除后读不到');
    ok(sk.deleteSkill('../evil').ok === false, '非法名拒绝删除');
    e.restore();
  }

  console.log('[T4] 技能市场 parseMarketList / installFromMarket');
  {
    const skillMd = '---\nname: market-skill\ndescription: from market\n---\n# Market\nbody';
    const routes = {
      'https://raw.githubusercontent.com/owner/repo/main/skills/market-skill/SKILL.md': skillMd,
    };
    const e = makeEnv(routes);
    const { sk } = e;
    // parseMarketList 是内部函数，用 fetchMarketList 走三源（mock net 返回 [] 因为非 JSON）—— 这里直接测 installFromMarket
    const r = await sk.installFromMarket({ name: 'market-skill', repo: 'owner/repo', file: 'skills/market-skill/SKILL.md' });
    ok(r.ok === true && fs.existsSync(r.path), '安装成功 + 落盘');
    const installed = fs.readFileSync(r.path, 'utf8');
    ok(installed.includes('# Market') && installed.includes('from market'), '安装内容正确');
    // 非法 repo / path
    ok((await sk.installFromMarket({ name: 'x', repo: 'bad repo', file: 'a.md' })).ok === false, '非法 repo 拒绝');
    ok((await sk.installFromMarket({ name: 'x', repo: 'owner/repo', file: '../../evil' })).ok === false, '路径穿越 file 拒绝');
    e.restore();
  }

  console.log('[T4] 技能市场 parseMarketList 携带 install_req');
  {
    const listRaw = JSON.stringify({ version: 2, skills: [
      { name: 'skill-a', description: 'desc a', category: '开发', repo: 'r/a', file: 'skills/a/SKILL.md', install_req: '需 Python + Playwright' },
      { name: 'skill-b', description: 'desc b', category: '办公', repo: 'r/b', file: 'skills/b/SKILL.md' },
    ] });
    const routes = {
      'https://cdn.jsdelivr.net/gh/XWJ-z/dsh-Desktop@main/skills-list.json': listRaw,
      'https://api.github.com/repos/XWJ-z/dsh-Desktop/contents/skills-list.json?ref=main': listRaw,
      'https://raw.githubusercontent.com/XWJ-z/dsh-Desktop/main/skills-list.json': listRaw,
    };
    const e = makeEnv(routes);
    const { sk } = e;
    // 通过 getMarketList 触发 fetchMarketList（缓存空 → 拉取）→ parseMarketList
    const list = await sk.getMarketList();
    const a = list.find((s) => s.name === 'skill-a');
    const b = list.find((s) => s.name === 'skill-b');
    ok(!!a && a.installReq === '需 Python + Playwright', 'install_req 透传到 installReq');
    ok(!!b && !b.installReq, '无 install_req 时 installReq 为空');
    ok(list.length === 2, 'market 列表解析出 2 条');
    e.restore();
  }

  console.log(`\n${passed} 通过, ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => { console.error('执行抛错：', err); process.exit(1); });
