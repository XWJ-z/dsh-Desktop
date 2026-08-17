'use strict';

/**
 * DSH-Desktop — DSH 运行时管理模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：壳配置读取（config.json）、DSH 运行时安装/版本检查（npx 机制）。
 *
 * 依赖注入（deps）：
 *  - app / fs / path / os         Node 与 Electron 模块
 *  - spawn                        node:child_process
 *  - appendLog / pushStage / pushProgress / dirSizeMB / logPath   日志模块
 *  - resolveRunner                Node 运行时解析（node-resolver 模块）
 *  - trackChild                   子进程跟踪（main.js 基础设施）
 *  - npmInstallTimeoutMs          安装超时上限（10 分钟）
 *  - fetchLatestDshInfo           晚绑定注入（updater.js）：registry 最新版本 +
 *    dist.integrity（P1-2：config dshVersion='latest' 时解析为精确版本安装）
 *
 * 外审 zx(9) 2026-08-17 P1-2 整改：
 *  - 不再「无锁定安装 @latest」：dshVersion='latest' 时先查 registry 解析精确
 *    版本，npm install 永远用 <pkg>@<精确版本>（依赖树可复现）；
 *  - 安装完成后把 { version, integrity } 落盘 <dshenv>/.installed.json，
 *    下次启动 readDshInstallRecord() 核对已装版本与记录一致（检测目录被替换/
 *    篡改，不一致记日志告警）；
 *  - updateDshVersion(newVersion, integrity) 一并落盘目标版本与 integrity。
 */

function createDshRuntime(deps) {
  const {
    app, fs, path, os, spawn,
    appendLog, pushStage, pushProgress, dirSizeMB, logPath,
    resolveRunner, trackChild, npmInstallTimeoutMs,
    fetchLatestDshInfo, // P1-2：晚绑定（main.js 组装，updaterApi 就绪后可调用）
  } = deps;

  /** 读取壳配置（app/config.json）：DSH 包名 + 版本号，用户改版本号即升级 DSH */
  function readShellConfig() {
    const file = path.join(app.getAppPath(), 'config.json');
    try {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        dshPackage: String(cfg.dshPackage || '@deepseek-ai/dsh'),
        dshVersion: String(cfg.dshVersion || 'latest'),
        registry: String(cfg.registry || 'https://registry.npmmirror.com'),
        qqGroup: cfg.qqGroup && typeof cfg.qqGroup === 'object'
          ? { number: String(cfg.qqGroup.number || ''), qrImage: String(cfg.qqGroup.qrImage || '') }
          : null,
      };
    } catch {
      return {
        dshPackage: '@deepseek-ai/dsh',
        dshVersion: 'latest',
        registry: 'https://registry.npmmirror.com',
        qqGroup: null,
      };
    }
  }

  /** DSH 运行时装在用户数据目录下（%APPDATA%\DSH-Desktop\dshenv） */
  function dshRuntimeDir() {
    return path.join(app.getPath('userData'), 'dshenv');
  }

  /** 内置 npm-cli.js（npm 是纯 JS 包，随壳分发，供 npx 使用） */
  function npmCliJs() {
    return path.join(app.getAppPath(), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  }

  /** 目标 DSH 版本规格：`@deepseek-ai/dsh` 或 `@deepseek-ai/dsh@x.y.z` */
  function dshSpec(cfg) {
    return cfg.dshVersion === 'latest' ? cfg.dshPackage : `${cfg.dshPackage}@${cfg.dshVersion}`;
  }

  /** 已安装 DSH 包目录：<dshenv>/node_modules/<scope>/<name>（P2-3 抽取公共函数） */
  function dshPkgDir() {
    const cfg = readShellConfig();
    const [scope, name] = cfg.dshPackage.startsWith('@')
      ? cfg.dshPackage.split('/')
      : ['', cfg.dshPackage];
    return scope
      ? path.join(dshRuntimeDir(), 'node_modules', scope, name)
      : path.join(dshRuntimeDir(), 'node_modules', name);
  }

  /** 已安装到运行时的 DSH 入口（不存在返回 null） */
  function installedDshBin() {
    return path.join(dshPkgDir(), 'lib', 'bin.js');
  }

  /** 已安装 DSH 的实际版本（未安装返回 null） */
  function installedDshVersion() {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dshPkgDir(), 'package.json'), 'utf8'));
      return pkg.version ?? null;
    } catch {
      return null;
    }
  }

  /** 判断已安装版本是否满足配置要求 */
  function dshUpToDate(cfg) {
    if (!fs.existsSync(installedDshBin())) return false;
    const installed = installedDshVersion();
    if (installed == null) return false;
    if (cfg.dshVersion === 'latest') return true; // latest：不主动降级/升级，用现有安装
    return installed === cfg.dshVersion;
  }

  /** P1-2：安装记录文件（<dshenv>/.installed.json）—— 版本 + integrity 落盘 */
  function installRecordFile() {
    return path.join(dshRuntimeDir(), '.installed.json');
  }

  /** P1-2：读取安装记录 { version, integrity, installedAt }；无记录返回 null */
  function readDshInstallRecord() {
    try {
      return JSON.parse(fs.readFileSync(installRecordFile(), 'utf8'));
    } catch {
      return null;
    }
  }

  /** P1-2：核对已装版本与安装记录一致（检测 dshenv 目录被替换/篡改） */
  function verifyInstallRecord() {
    const rec = readDshInstallRecord();
    const installed = installedDshVersion();
    if (!rec) return { ok: false, reason: 'no-record', installed };
    if (installed !== rec.version) {
      return { ok: false, reason: 'version-mismatch', installed, recorded: rec.version };
    }
    return { ok: true, installed, recorded: rec.version, integrity: rec.integrity || '' };
  }

  /**
   * 确保 DSH 运行时已安装且版本匹配：缺失或版本不符时用内置 npm 执行
   * `npm install --prefix <dshenv> <pkg>@<精确版本>`（等价于 npx 拉取机制）。
   * 首次运行需要联网；安装完成后即离线可用。
   * P1-2：config dshVersion='latest' 时先查 registry 解析精确版本（不无锁定
   * @latest 安装），安装完成/升级目标均落盘 .installed.json 供启动核对。
   * @returns 安装后的 DSH 入口 bin.js
   */
  async function ensureDshRuntime() {
    const cfg = readShellConfig();
    if (dshUpToDate(cfg)) {
      appendLog('info', `DSH 运行时已就绪：${cfg.dshPackage}@${installedDshVersion()}`);
      pushStage('start');
      // P1-2：启动核对安装记录（不一致记日志告警，不阻断启动）
      const v = verifyInstallRecord();
      if (!v.ok && v.reason === 'version-mismatch') {
        appendLog('warn', `安装记录异常：已装 v${v.installed} ≠ 记录 v${v.recorded}（目录可能被替换，建议重新安装）`);
      }
      return installedDshBin();
    }
    // P1-2：latest → 解析精确版本 + integrity（固定版本安装，依赖树可复现）
    let spec = dshSpec(cfg);
    let targetIntegrity = '';
    if (cfg.dshVersion === 'latest') {
      const info = fetchLatestDshInfo ? await fetchLatestDshInfo() : null;
      if (!info) {
        appendLog('error', 'DSH 运行时未安装且无法解析 registry 最新版本（网络不可达？）');
        pushStage('install');
        throw new Error('无法解析 DSH 最新版本（registry 不可达）。请检查网络后重试。');
      }
      spec = `${cfg.dshPackage}@${info.version}`;
      targetIntegrity = info.integrity || '';
      appendLog('info', `DSH 配置为 latest，已解析为精确版本 ${info.version} 安装（P1-2 固定版本）`);
    }
    return new Promise((resolve, reject) => {
      const runner = resolveRunner();
      const cli = npmCliJs();
      appendLog('info', `DSH 运行时未满足要求（配置 ${spec}，实际 ${installedDshVersion() ?? '未安装'}）`);
      appendLog('info', '首次运行需要联网下载 DSH 运行时，请稍候…');
      pushStage('install');

      // npm 12 默认阻止生命周期脚本。project-scoped 安装下不允许 `--allow-scripts`
      // CLI 参数（会直接报 EALLOWSCRIPTS 退出），正确做法是在项目 .npmrc 里配置
      // `allow-scripts`。我们在运行时目录预置 .npmrc，放行 DSH 依赖中的原生模块
      // 脚本（均自带 N-API 预编译，放行仅为保险）。
      // 同时写入 registry 配置：默认 npmmirror 镜像（国内可达），可被 config.json
      // 的 registry 字段覆盖；写 .npmrc 可让 npm 每次安装都命中同一镜像。
      // 外审 zx(9) P1-2 评估：allow-scripts 保持白名单放行（非全开）—— koffi /
      // node-pty 等原生依赖需 install 脚本落地预编译产物，白名单 5 个包均为
      // DSH 官方依赖链，无法整体关闭；继续白名单是「可安装」与「最小放行」的平衡。
      const registry = cfg.registry || 'https://registry.npmmirror.com';
      try {
        // v0.7.3（T-034）：目录可能尚不存在（npm --prefix 安装时才创建），先建再写，
        // 否则首次运行 .npmrc 写失败 → allow-scripts 不生效 → 原生模块脚本被 npm 12 拦截
        fs.mkdirSync(dshRuntimeDir(), { recursive: true });
        fs.writeFileSync(
          path.join(dshRuntimeDir(), '.npmrc'),
          `allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs\nregistry=${registry}\n`,
          'utf8',
        );
      } catch (err) {
        appendLog('warn', `写入 .npmrc 失败（不影响安装）：${err.message}`);
      }

      const args = [
        cli,
        'install',
        '--prefix', dshRuntimeDir(),
        // v0.7.4（T-035）：registry 直接走 CLI 参数，不依赖 .npmrc 写入成败 ——
        // .npmrc 写失败（如权限）时若回落官方源 registry.npmjs.org，国内网络
        // 下载会卡死（600s 超时），CLI 参数保证始终命中配置/默认镜像
        '--registry', registry,
        '--no-save',
        '--no-audit',
        '--no-fund',
        '--no-progress',
        '--loglevel', 'warn',
        spec,
      ];
      appendLog('info', `npm 命令：${runner.execPath} ${args.join(' ')}`);

      const env = {
        ...process.env,
        ...runner.env,
        // v0.7.3（T-034）：内置 Node 目录加入 PATH —— 无系统 Node 的机器上，
        // koffi 等依赖的 install 脚本（cmd /c node ./cnoke.cjs）才能找到 node 命令
        PATH: `${path.dirname(runner.execPath)}${path.delimiter}${process.env.PATH || ''}`,
        // npm 需要知道用户级目录；确保缓存落在用户可写位置
        npm_config_cache: path.join(os.homedir(), 'AppData', 'Local', 'npm-cache'),
        npm_config_update_notifier: 'false',
      };

      let child;
      try {
        child = trackChild(
          spawn(runner.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
          'npm-install',
        );
      } catch (err) {
        reject(err);
        return;
      }

      // 任务D2：安装期间每 2 秒统计"dshenv + npm 缓存"总量并推送到加载页
      // （下载进度可视化：npm 先写缓存、解压才写 dshenv，仅统计 dshenv 会恒为 0）
      const npmCacheDir = process.env.npm_config_cache || path.join(os.homedir(), 'AppData', 'Local', 'npm-cache');
      const installTotalMB = () =>
        (parseFloat(dirSizeMB(dshRuntimeDir())) + parseFloat(dirSizeMB(npmCacheDir))).toFixed(1);
      pushProgress(installTotalMB());
      const progressTimer = setInterval(() => {
        pushProgress(installTotalMB());
      }, 2000);

      const onData = (label) => (chunk) => {
        for (const line of chunk.toString().split(/\r?\n/)) {
          if (line.trim()) appendLog(label, line.trimEnd());
        }
      };
      child.stdout.on('data', onData('npm'));
      child.stderr.on('data', onData('npm:err'));

      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
        reject(new Error(`DSH 运行时下载超时（${npmInstallTimeoutMs / 1000}s）。请检查网络后重试。`));
      }, npmInstallTimeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        clearInterval(progressTimer);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        clearInterval(progressTimer);
        if (code !== 0) {
          reject(new Error(`DSH 运行时安装失败（npm 退出码 ${code}）。请检查网络/源后重试。日志：${logPath()}`));
          return;
        }
        const bin = installedDshBin();
        if (!fs.existsSync(bin)) {
          reject(new Error('npm 安装成功但未找到 DSH 入口 bin.js，请检查配置的包名/版本。'));
          return;
        }
        // P1-2：落盘安装记录（版本 + integrity），下次启动核对
        try {
          const rec = {
            version: installedDshVersion(),
            integrity: targetIntegrity,
            installedAt: new Date().toISOString(),
          };
          fs.writeFileSync(installRecordFile(), JSON.stringify(rec, null, 2), 'utf8');
        } catch (err) {
          appendLog('warn', `写入安装记录失败（不影响运行）：${err.message}`);
        }
        appendLog('info', `DSH 运行时安装完成：${cfg.dshPackage}@${installedDshVersion()}`);
        pushStage('start');
        resolve(bin);
      });
    });
  }

  /** 备份并改写 config.json 的 dshVersion；成功返回 true。P1-2：一并落盘目标版本 + integrity */
  function updateDshVersion(newVersion, integrity) {
    const file = path.join(app.getAppPath(), 'config.json');
    try {
      fs.copyFileSync(file, `${file}.bak`);          // 先备份
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
      cfg.dshVersion = newVersion;
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
      // P1-2：目标版本 + integrity 落盘（重启安装完成后与 .installed.json 核对）
      try {
        fs.mkdirSync(dshRuntimeDir(), { recursive: true });
        fs.writeFileSync(installRecordFile(), JSON.stringify({
          version: newVersion,
          integrity: String(integrity || ''),
          targetAt: new Date().toISOString(),
        }, null, 2), 'utf8');
      } catch (err) {
        appendLog('warn', `写入安装目标记录失败（不影响配置更新）：${err.message}`);
      }
      return true;
    } catch { return false; }
  }

  return {
    readShellConfig,
    dshRuntimeDir,
    npmCliJs,
    dshSpec,
    dshPkgDir,
    installedDshBin,
    installedDshVersion,
    dshUpToDate,
    ensureDshRuntime,
    updateDshVersion,
    readDshInstallRecord,   // P1-2：安装记录读取/核对（诊断/启动告警用）
    verifyInstallRecord,
  };
}

module.exports = { createDshRuntime };
