'use strict';

/**
 * DSH-Desktop — 插件市场模块（v1.1.1）
 *
 * 职责：连接官方 awesome-dsh-plugin 社区，提供插件浏览、分类查找、搜索、安装引导：
 *  - 数据源：awesome-dsh-plugin README.md 解析（三源 + 7 天缓存）
 *  - 18 官方分类 + 全部插件中文描述（内置随包 + 远程可更新）
 *  - 安装引导：复制安装命令（免责确认）/ 查看 GitHub
 *  - 安全提示：顶部红色醒目常驻
 *
 * 依赖注入（deps）：
 *  - app / fs / path
 *  - shell / clipboard
 *  - net            Electron net 模块（Chromium 网络栈/系统 CA）
 *  - appendLog
 *  - isAllowedExternalUrl   external-links 模块（URL 白名单校验）
 *
 * 注意：网络拉取用 Electron net（net.request）—— Node https.get 在此环境 TLS 验证
 * 失败（raw.githubusercontent 证书不在 Node 内置 CA），且 jsDelivr @main 会 301 到 raw；
 * net 走 Chromium 网络栈（系统 CA）且自动跟随重定向（实测全部 200）。
 */

// 数据源：官方 awesome-dsh-plugin（Anil-matcha，README 按「### 分类 + - [name](url) — desc」组织）
const PLUGIN_README_URLS = [
  {
    name: 'jsDelivr',
    url: 'https://cdn.jsdelivr.net/gh/Anil-matcha/awesome-dsh-plugin@main/README.md',
  },
  {
    name: 'GitHub API',
    url: 'https://api.github.com/repos/Anil-matcha/awesome-dsh-plugin/contents/README.md?ref=main',
    headers: { 'User-Agent': 'DSH-Desktop', Accept: 'application/vnd.github.raw+json' },
  },
  {
    name: 'raw.githubusercontent',
    url: 'https://raw.githubusercontent.com/Anil-matcha/awesome-dsh-plugin/main/README.md',
  },
];

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天缓存

// v1.1.3 重构：本仓库下发源 URL 集中到 remote-sources.js（plugin-desc-zh.json）
// 注意：PLUGIN_README_URLS 是第三方仓库（Anil-matcha/awesome-dsh-plugin）数据源，不属于本仓库下发源，保留原位
const { PLUGIN_DESC_URLS } = require('./remote-sources');

// 官方分类（README「## Plugin Categories」18 类 + 兜底其他）；match 用于标题匹配
// v1.1.1：去掉 icon 表情符号（用户指令：插件市场不显示表情）
const PLUGIN_CATEGORIES = [
  { id: 'ui-enhance', name: 'UI增强', match: 'ui enhancements' },
  { id: 'usage-billing', name: '用量与计费', match: 'usage & billing' },
  { id: 'theme', name: '主题外观', match: 'themes & appearance' },
  { id: 'model', name: '模型提供方', match: 'models & providers' },
  { id: 'session', name: '会话与消息', match: 'sessions & messages' },
  { id: 'memory', name: '记忆', match: 'memory' },
  { id: 'tool', name: '工具能力', match: 'tools & capabilities' },
  { id: 'visual', name: '视觉多模态', match: 'vision & multimodal' },
  { id: 'skills', name: 'Skills', match: 'skills' },
  { id: 'workflow', name: '工作流自动化', match: 'workflow & automation' },
  { id: 'notifications', name: '通知与集成', match: 'notifications & integrations' },
  { id: 'git', name: 'Git与工程', match: 'git & engineering' },
  { id: 'security', name: '安全与治理', match: 'security & governance' },
  { id: 'output', name: '输出与交付', match: 'output & deliverables' },
  { id: 'domain', name: '领域专家', match: 'domain & specialist' },
  { id: 'dev-tools', name: '开发与运行时', match: 'development & runtime' },
  { id: 'market', name: '插件市场', match: 'plugin markets & managers' },
  { id: 'fun', name: '娱乐', match: 'just for fun' },
  { id: 'other', name: '其他', match: '' },
];

function createPluginMarket(deps) {
  const { app, fs, path, shell, clipboard, net, appendLog, isAllowedExternalUrl, os, spawnSync } = deps;

  let cachedPlugins = null;
  let cacheTimestamp = 0;
  let cachedDescMap = null; // v1.1.1：中文描述映射

  function cacheFile() {
    return path.join(app.getPath('userData'), 'plugin-market-cache.json');
  }

  /**
   * 加载本地缓存
   * @returns {Array|null}
   */
  function loadCache() {
    try {
      const file = cacheFile();
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.plugins) && parsed.timestamp) {
          // 检查缓存是否过期
          if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
            cachedPlugins = parsed.plugins;
            cacheTimestamp = parsed.timestamp;
            cachedDescMap = parsed.descMap || null; // v1.1.1
            appendLog('info', `插件市场缓存已加载：${parsed.plugins.length} 个插件`);
            return cachedPlugins;
          }
        }
      }
    } catch (err) {
      appendLog('warn', `加载插件市场缓存失败：${err.message}`);
    }
    return null;
  }

  /**
   * 保存缓存
   * @param {Array} plugins
   * @param {object} descMap 中文描述映射（v1.1.1）
   */
  function saveCache(plugins, descMap) {
    try {
      const file = cacheFile();
      const tempFile = file + '.tmp';
      const content = JSON.stringify({ plugins, descMap: descMap || {}, timestamp: Date.now() }, null, 2);

      fs.writeFileSync(tempFile, content, 'utf8');
      fs.renameSync(tempFile, file);

      cachedPlugins = plugins;
      cachedDescMap = descMap || {};
      cacheTimestamp = Date.now();
      appendLog('info', `插件市场缓存已保存：${plugins.length} 个插件`);
    } catch (err) {
      appendLog('error', `保存插件市场缓存失败：${err.message}`);
    }
  }

  /**
   * GET 并返回响应文本（Electron net.request，Chromium 网络栈 + 系统 CA + 自动跟随重定向；
   * 失败/超时返回 null）
   * @param {string} url
   * @param {number} timeoutMs
   * @param {object} headers
   * @param {number} maxBytes
   * @returns {Promise<string|null>}
   */
  function fetchText(url, timeoutMs = 8000, headers = {}, maxBytes = 5 * 1024 * 1024) {
    return new Promise((resolve) => {
      let req;
      try {
        req = net.request(url);
        Object.keys(headers || {}).forEach((k) => req.setHeader(k, headers[k]));
        if (!headers || !headers['User-Agent']) req.setHeader('User-Agent', 'DSH-Desktop');
        const timer = setTimeout(() => {
          try {
            req.abort();
          } catch {
            /* ignore */
          }
          resolve(null);
        }, timeoutMs);
        req.on('response', (res) => {
          const code = res.statusCode;
          if (code < 200 || code >= 300) {
            clearTimeout(timer);
            resolve(null);
            return;
          }
          res.setEncoding('utf8'); // P2-1 v1.1.6：跨 chunk 不拆断 UTF-8，中文插件描述无乱码
          let body = '';
          let aborted = false;
          res.on('data', (c) => {
            if (aborted) return;
            body += c;
            if (body.length > maxBytes) {
              aborted = true;
              clearTimeout(timer);
              try {
                req.abort();
              } catch {
                /* ignore */
              }
              resolve(null);
            }
          });
          res.on('end', () => {
            clearTimeout(timer);
            if (!aborted) resolve(body);
          });
        });
        req.on('error', () => {
          clearTimeout(timer);
          resolve(null);
        });
        req.end();
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * 拉取中文描述映射（plugin-desc-zh.json，JSON 对象：{ repo名: 中文描述 }）
   * v1.1.1：三源并发取最快成功（Promise.any，不等慢源）；全部失败 → 回退包内置
   * plugin-desc-zh.json（随包分发，本地立即有中文；远程成功以远程为准，push 即更新）
   * @returns {Promise<object|null>}
   */
  async function fetchDescMap() {
    const TIMEOUT_MS = 8000;
    try {
      const obj = await Promise.any(
        PLUGIN_DESC_URLS.map(async (source) => {
          const text = await fetchText(source.url, TIMEOUT_MS, source.headers || {});
          if (!text) throw new Error('fetch fail');
          const data = JSON.parse(text);
          if (!data || typeof data !== 'object') throw new Error('bad json');
          return data;
        }),
      );
      return obj;
    } catch {
      // 全部失败 → 回退：包内置中文描述（随包分发基线）
      try {
        const builtin = require(path.join(app.getAppPath(), 'plugin-desc-zh.json'));
        if (builtin && typeof builtin === 'object') {
          appendLog('info', `中文描述回退包内置（${Object.keys(builtin).length} 条）`);
          return builtin;
        }
      } catch {
        /* ignore */
      }
      return null;
    }
  }

  /**
   * 从 URL 列表中拉取数据（三源并发取最快成功，不等慢源）
   * @param {Array<{name: string, url: string, headers?: object}>} urls
   * @returns {Promise<string|null>}
   */
  async function fetchFromUrls(urls) {
    const TIMEOUT_MS = 8000;
    try {
      // README.md 是纯文本：https.get 拉文本（与 updater 同机制，全局 fetch 在此环境 TLS 失败）
      const text = await Promise.any(
        urls.map(async (source) => {
          const t = await fetchText(source.url, TIMEOUT_MS, source.headers || {});
          if (!t) throw new Error('fetch fail');
          return t;
        }),
      );
      return text;
    } catch {
      return null;
    }
  }

  /**
   * 解析 README.md 中的插件列表
   * 官方格式（实测 Anil-matcha/awesome-dsh-plugin）：非表格，而是
   *   ### UI Enhancements                     ← 分类标题（###）
   *   - [0xsline/dsh-spotlight](https://github.com/0xsline/dsh-spotlight) — Keyboard-first command palette… ← 列表项
   * @param {string} readme
   * @param {object|null} descMap 中文描述映射（{ repo名: 中文描述 }，v1.1.1）
   * @returns {Array}
   */
  function parseReadme(readme, descMap) {
    const plugins = [];
    const lines = readme.split('\n');
    const zh = descMap || cachedDescMap || {};

    let currentCategory = 'other';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 分类标题：### xxx（内容目录里的二级标题）
      const catMatch = trimmed.match(/^###\s+(.+)$/);
      if (catMatch) {
        currentCategory = categoryIdForHeading(catMatch[1]);
        continue;
      }

      // 列表项：- [name](url) — description
      const itemMatch = trimmed.match(/^-\s+\[([^\]]+)\]\((https?:\/\/[^)]+)\)\s*[—–-]\s*(.+)$/);
      if (!itemMatch) continue;

      const name = itemMatch[1].trim();
      const url = itemMatch[2].trim();
      const description = itemMatch[3].trim();

      // 仓库名：URL 最后一段（去掉 .git）
      let repoName = name;
      try {
        repoName = new URL(url).pathname.split('/').filter(Boolean).pop() || name;
      } catch {
        /* keep name */
      }
      if (repoName.endsWith('.git')) repoName = repoName.slice(0, -4);
      // O1 v1.1.6：安装命令用 repoName 拼 shell，字符白名单校验（恶意 README 项可能注入命令）
      if (!/^[\w.-]+$/.test(repoName)) continue;

      plugins.push({
        name,
        description,
        descriptionZh: (zh && zh[repoName]) || '', // v1.1.1：中文描述（无则空，前端回退英文）
        // 官方安装方式（README Getting Started）：dsh plugin --profile web add <插件名>
        command: `dsh plugin --profile web add ${repoName}`,
        repo: url,
        category: currentCategory,
        repoUrl: url,
        installCmd: repoName,
      });
    }

    return plugins;
  }

  /**
   * README 分类标题 → PLUGIN_CATEGORIES.id（大小写不敏感，含匹配）
   * @param {string} heading
   * @returns {string}
   */
  function categoryIdForHeading(heading) {
    const h = heading.toLowerCase().trim();
    for (const c of PLUGIN_CATEGORIES) {
      if (c.match && (h === c.match || h.includes(c.match))) return c.id;
    }
    return 'other';
  }

  /**
   * 刷新插件列表（拉取 README + 中文描述，并行；解析 + 缓存）
   */
  async function refreshPlugins() {
    try {
      appendLog('info', '开始刷新插件市场...');

      // v1.1.1：README 与中文描述并行拉取（desc 失败不影响列表）
      const [readme, descMap] = await Promise.all([
        fetchFromUrls(PLUGIN_README_URLS),
        fetchDescMap(),
      ]);
      if (!readme) {
        appendLog('warn', '无法获取插件列表');
        return false;
      }

      const plugins = parseReadme(readme, descMap);
      if (plugins.length === 0) {
        appendLog('warn', '解析插件列表为空');
        return false;
      }

      saveCache(plugins, descMap);
      const zhCount = plugins.filter((p) => p.descriptionZh).length;
      appendLog('info', `插件市场已刷新：${plugins.length} 个插件（中文描述 ${zhCount} 个）`);
      return true;
    } catch (err) {
      appendLog('error', `刷新插件市场失败：${err.message}`);
      return false;
    }
  }

  /**
   * v1.1.1：旧缓存中文补全 —— 升级用户的缓存（7 天内不过期）里插件没有 descriptionZh 字段，
   * 从描述映射（远程或内置回退）补全，避免升级后仍显示英文
   */
  async function ensureDescZh() {
    if (!cachedPlugins || cachedPlugins.length === 0) return;
    const needZh = cachedPlugins.some((p) => !p.descriptionZh);
    if (!needZh) return;
    let map = cachedDescMap;
    if (!map) {
      map = await fetchDescMap(); // 远程三源 → 失败回退包内置
      cachedDescMap = map;
    }
    if (!map) return;
    let changed = false;
    cachedPlugins.forEach((p) => {
      if (!p.descriptionZh && map[p.installCmd || p.repoName]) {
        p.descriptionZh = map[p.installCmd || p.repoName];
        changed = true;
      }
    });
    if (changed) saveCache(cachedPlugins, cachedDescMap); // 补全后落盘，下次直接生效
  }

  /**
   * 获取插件列表（优先缓存，过期则刷新；v1.1.1 兼补旧缓存中文）
   * @returns {Promise<Array>}
   */
  async function getPlugins() {
    // 尝试加载缓存
    if (!cachedPlugins) {
      loadCache();
    }

    // 缓存为空或过期 → 刷新
    if (!cachedPlugins || Date.now() - cacheTimestamp >= CACHE_TTL_MS) {
      await refreshPlugins();
    }

    // 旧缓存补全中文描述（升级用户立即生效，无需等 7 天缓存过期）
    await ensureDescZh();

    return cachedPlugins || [];
  }

  /**
   * 搜索插件
   * @param {string} query
   * @returns {Promise<Array>}
   */
  async function searchPlugins(query) {
    const plugins = await getPlugins();
    if (!query) return plugins;

    const lower = query.toLowerCase();
    return plugins.filter(
      (p) =>
        (p.name && p.name.toLowerCase().includes(lower)) ||
        (p.description && p.description.toLowerCase().includes(lower)),
    );
  }

  /**
   * 按分类筛选插件
   * @param {string} categoryId
   * @returns {Promise<Array>}
   */
  async function getPluginsByCategory(categoryId) {
    const plugins = await getPlugins();
    if (!categoryId || categoryId === 'all') return plugins;

    return plugins.filter((p) => p.category === categoryId);
  }

  /**
   * 复制安装命令到剪贴板
   * @param {string} command
   */
  function copyInstallCommand(command) {
    if (command) {
      clipboard.writeText(command);
      appendLog('info', `已复制安装命令：${command}`);
    }
  }

  /**
   * 打开插件 GitHub 页面
   * @param {string} repoUrl
   */
  function openPluginRepo(repoUrl) {
    if (repoUrl && isAllowedExternalUrl(repoUrl)) {
      shell.openExternal(repoUrl);
      appendLog('info', `已打开插件仓库：${repoUrl}`);
    }
  }

  /**
   * 打开官方插件社区列表（awesome-dsh-plugin，白名单 github.com）
   */
  function openOfficialMarket() {
    const url = 'https://github.com/Anil-matcha/awesome-dsh-plugin';
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
      appendLog('info', '已打开官方 awesome-dsh-plugin 列表');
    }
  }

  // ── v1.2.6：插件库「已装插件」（dsh plugin list CLI）+「自建插件」（纯文本封装）──

  /** DSH home 根目录（$DSH_HOME 优先，否则 ~/.dsh） */
  function dshHome() {
    const env = process.env.DSH_HOME;
    if (env && env.trim().length > 0) return path.resolve(env.trim());
    return path.join(os.homedir(), '.dsh');
  }

  /** 默认 profile 目录（应用以 `dsh web` 启动 → profile=web） */
  function profileDir() {
    return path.join(dshHome(), 'profiles', 'web');
  }

  /** DSH CLI 入口候选（profile 共享 node_modules 优先；应用自装运行时兜底） */
  function dshBinCandidates() {
    const home = dshHome();
    return [
      path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      path.join(app.getPath('userData'), 'dshenv', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    ];
  }

  function runSync(cmd, args, opts) {
    try {
      return spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...(opts || {}) });
    } catch {
      return null;
    }
  }

  /**
   * 确保 pnpm 在 PATH（dsh plugin 会在 profile 目录跑 pnpm）：
   *  ① PATH 上已有 pnpm → 直接用；
   *  ② 没有但 corepack 可用（其 `pnpm --version` 成功）→ 造一个临时 pnpm.cmd 垫片垫进 PATH；
   *  ③ 都没有 → 返回 { ok:false }。
   * 垫片只依赖 PATH 上的 corepack 命令，不依赖 nodejs 安装位置，跨机健壮。
   * 注意：Windows 上 pnpm/corepack 是 .cmd，spawnSync 需 shell:true 才能解析到。
   */
  function ensurePnpmPath() {
    const probe = runSync('pnpm', ['--version'], { shell: true });
    if (probe && probe.status === 0) return { ok: true, needShim: false };

    const cp = runSync('corepack', ['pnpm', '--version'], { shell: true });
    if (cp && cp.status === 0) {
      const shimDir = path.join(app.getPath('userData'), 'plugin-pnpm-shim');
      try {
        fs.mkdirSync(shimDir, { recursive: true });
        const shim = path.join(shimDir, 'pnpm.cmd');
        fs.writeFileSync(shim, '@echo off\r\ncorepack pnpm %*\r\n', 'ascii');
        return { ok: true, needShim: true, shimDir };
      } catch (err) {
        appendLog('warn', `创建 pnpm 垫片失败：${err.message}`);
        return { ok: false };
      }
    }
    return { ok: false };
  }

  /** 解析 `dsh plugin --profile web list --json` 输出为插件名数组（容错：JSON / 行文本） */
  function parsePluginOutput(stdout) {
    if (!stdout) return [];
    // 去掉 ANSI 颜色码
    const clean = String(stdout).replace(/\x1b\[[0-9;]*m/g, '');
    const names = new Set();
    const addName = (n) => {
      const nm = String(n || '').trim();
      if (!nm) return;
      // 排除 profile 根项目与 DSH 运行时内件（@deepseek-ai/* 全部是运行时 bundle）
      if (nm === 'dsh-profile-web') return;
      if (/^@deepseek-ai\//.test(nm)) return;
      names.add(nm);
    };
    const walk = (node) => {
      if (node == null) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (typeof node === 'object') {
        if (node.name) addName(node.name);
        if (node.dependencies && typeof node.dependencies === 'object') Object.keys(node.dependencies).forEach(addName);
        if (node.children) walk(node.children);
      }
    };
    try {
      walk(JSON.parse(clean));
      if (names.size) return Array.from(names);
    } catch { /* JSON 失败 → 走行解析 */ }
    // 行解析：每行一个包名（去树形符号）
    clean.split(/\r?\n/).forEach((l) => {
      const m = /^\s*(?:[├└│┌┐┘─\s+-]*)\s*([\w@./-]+)(?:\s+[a-z0-9.]+\s*)?$/.exec(l);
      if (m) addName(m[1]);
    });
    return Array.from(names);
  }

  /**
   * 枚举已装插件：执行 `dsh plugin --profile web list --json`（DSH CLI，内部为 pnpm ls）。
   * @returns {Promise<{ ok:boolean, plugins?:Array<{name:string}>, message?:string, fallback?:boolean }>}
   */
  async function listInstalledPlugins() {
    const bin = dshBinCandidates().find((p) => fs.existsSync(p));
    if (!bin) {
      appendLog('warn', '未找到 DSH CLI 入口，无法枚举已装插件');
      return { ok: false, message: '未找到 DSH 运行时，无法枚举已装插件' };
    }
    const pnpm = ensurePnpmPath();
    if (!pnpm.ok) {
      appendLog('warn', '枚举已装插件失败：需要 pnpm 才能列出 DSH 插件');
      return { ok: false, message: '需要 pnpm（或 corepack）才能枚举已装插件', fallback: true };
    }
    const env = { ...process.env };
    if (pnpm.needShim) env.PATH = `${pnpm.shimDir};${env.PATH || ''}`;
    // 用应用自带 electron 运行时作 node（ELECTRON_RUN_AS_NODE），不依赖 PATH 上的 node
    const nodeExe = process.execPath;
    env.ELECTRON_RUN_AS_NODE = '1';
    const r = runSync(nodeExe, [bin, 'plugin', '--profile', 'web', 'list', '--json'], {
      cwd: profileDir(),
      env,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (!r || r.status !== 0 || !r.stdout) {
      appendLog('warn', '枚举已装插件命令失败');
      return { ok: false, message: '枚举已装插件失败（请确认 DSH 运行时就绪）', fallback: true };
    }
    const plugins = parsePluginOutput(r.stdout).map((name) => ({ name }));
    appendLog('info', `已装插件枚举：${plugins.length} 个`);
    return { ok: true, plugins };
  }

  // ── 自建插件（纯文本封装，无代码执行）──
  function builtPluginsFile() {
    return path.join(app.getPath('userData'), 'self-built-plugins.json');
  }
  function listBuiltPlugins() {
    try {
      const raw = fs.readFileSync(builtPluginsFile(), 'utf8');
      const d = JSON.parse(raw);
      return Array.isArray(d.plugins) ? d.plugins : [];
    } catch {
      return [];
    }
  }
  function saveBuiltPlugin(payload) {
    const p = payload || {};
    const name = String(p.name || '').trim();
    if (!name) return { ok: false, message: '请填写插件名称' };
    const plugins = listBuiltPlugins();
    const idx = plugins.findIndex((x) => x.name === name);
    const item = {
      name,
      description: String(p.description || '').trim(),
      command: String(p.command || '').trim(),
      hint: String(p.hint || '').trim(),
      updatedAt: Date.now(),
    };
    try {
      fs.mkdirSync(path.dirname(builtPluginsFile()), { recursive: true });
      if (idx >= 0) plugins[idx] = item;
      else plugins.push(item);
      const f = builtPluginsFile();
      fs.writeFileSync(`${f}.tmp`, JSON.stringify({ plugins }, null, 2), 'utf8');
      fs.renameSync(`${f}.tmp`, f);
      appendLog('info', `自建插件已保存：${name}`);
      return { ok: true };
    } catch (err) {
      appendLog('error', `保存自建插件失败：${err.message}`);
      return { ok: false, message: err.message };
    }
  }
  function deleteBuiltPlugin(name) {
    const plugins = listBuiltPlugins().filter((x) => x.name !== name);
    try {
      const f = builtPluginsFile();
      fs.writeFileSync(`${f}.tmp`, JSON.stringify({ plugins }, null, 2), 'utf8');
      fs.renameSync(`${f}.tmp`, f);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  return {
    loadCache,
    getPlugins,
    searchPlugins,
    getPluginsByCategory,
    refreshPlugins,
    copyInstallCommand,
    openPluginRepo,
    openOfficialMarket,
    getCategories: () => PLUGIN_CATEGORIES,
    listInstalledPlugins,
    listBuiltPlugins,
    saveBuiltPlugin,
    deleteBuiltPlugin,
    parsePluginOutput,
  };
}

module.exports = { createPluginMarket };
