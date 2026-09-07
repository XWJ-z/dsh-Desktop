'use strict';

/**
 * DSH-Desktop — 更新检查 / 下载模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：
 *  - 壳（DSH-Desktop）版本检查：自家服务器接口（config.json shellUpdate.apiUrl，MySQL dsh.shell_version）
 *  - DSH 版本检查：npm registry dist-tags.latest
 *  - 语义化比较 / 展示值修正（T-028：latest ≤ current 显示 current）
 *  - 壳安装包下载：多镜像 fallback + SHA256 校验 + 断点续传 + 互斥锁（T0.5）
 *
 * 依赖注入（deps）：
 *  - app / shell / https / crypto / fs / path
 *  - appendLog                      日志模块
 *  - readShellConfig / installedDshVersion / updateDshVersion   运行时模块
 *  - getMainWindow                  主窗口 getter（下载完打开安装包/弹窗归属）
 *  （v0.9.5 T3：公告已独立到 modules/notice.js（notice.json 唯一源），
 *   本模块不再承载公告解析/缓存）
 *
 * v2.0.2（需求1）：壳版本检测/校验改走自家服务器接口（唯一权威源，MySQL 存储），
 * 去掉原「GitHub 三源多数一致（sourcesAgree）+ 壳内置期望 hash 台账（shell-hashes.js）」，
 * 解耦 GitHub 网络问题；hash 校验以服务器下发为准，下载安装包仍走 GitHub Releases。
 *
 * 外审 zx(9) 2026-08-17 整改（历史保留）：
 *  - P1-1：版本比较收敛到 modules/semver.js（P3-3）。
 *  - P1-2：DSH 升级链路附带 registry 返回的 dist.integrity（sha512），由
 *    dsh-runtime 落盘核对（固定版本安装，不再无锁定 @latest）。
 *  - P3-5：下载首 URL 与重定向目标强制 https。
 */

const { compareSemver } = require('./semver');
const { createNetCommon } = require('./net-common'); // 2.0.1 去重：统一 Electron net 拉取

function createUpdater(deps) {
  // 2.0.1 去重：fetchJson 改用公共 net-common 实现（原先此模块内联了一份同款逻辑）
  const { fetchJson } = createNetCommon(deps);
  const {
    app, shell, crypto, fs, path, rmQuiet,   // O2 v1.1.6：移除不再使用的 https（downloadFile 已改 Electron net）
    net, // v1.1.3（用户反馈：下载更新失败）：版本检查改用 Electron net
    appendLog,
    readShellConfig, installedDshVersion, updateDshVersion,
  } = deps;

  /**
   * 查询 npm registry 上 DSH 最新版本信息（dist-tags.latest + dist.integrity）。
   * 返回 { version, integrity } 或 null（失败/超时/无 latest）。
   *  - integrity：registry 下发的 tarball sha512（P1-2：供 dsh-runtime 固定版本
   *    安装时落盘核对，避免「无版本锁定 + 不记录完整性」的供应链风险）；
   *  - 注：Accept 精简头（install-v1）响应中每个版本均带 dist.integrity。
   */
  function fetchLatestDshInfo() {
    const cfg = readShellConfig();
    const pkgPath = cfg.dshPackage.replace('/', '%2f'); // scoped 包需编码 /
    const base = (cfg.registry || 'https://registry.npmmirror.com').replace(/\/$/, '');
    // P1-3：Accept 精简头只拉 dist-tags+版本摘要（几十 KB），避免全量元数据（5-20MB）
    return fetchJson(`${base}/${pkgPath}`, 8000, { Accept: 'application/vnd.npm.install-v1+json' })
      .then((pkg) => {
        const v = pkg?.['dist-tags']?.latest;
        if (!v || typeof v !== 'string' || !pkg?.versions?.[v]) return null;
        const dist = pkg.versions[v].dist || {};
        return { version: v, integrity: String(dist.integrity || '') };
      });
  }

  /** 查询 npm registry 上 DSH 最新版本号（dist-tags.latest）；失败返回 null */
  function fetchLatestDshVersion() {
    return fetchLatestDshInfo().then((info) => (info ? info.version : null));
  }

  /**
   * v0.6.2（T-028）：最新版本展示值 —— 获取到的 latest ≤ 当前版本时显示当前版本。
   * 场景：CDN/镜像缓存旧版（latest < current）或本地版本比源新时，避免「最新版本」
   * 一栏显示比当前更小的版本号（显得"降级"）；latest 为 null 原样返回（显示未知）。
   */
  function effectiveLatest(current, latest) {
    if (latest == null) return null;
    return compareSemver(String(current), String(latest)) >= 0 ? String(current) : String(latest);
  }

  /**
   * 查询壳+DSH 两侧更新信息（并发，各自静默）。
   * 返回 { dsh: { current, latest, notes, updatable, updating }, shell: { current, latest, notes, updatable, force, downloading } }
   *  - latest 为 null 表示查询失败/无源
   *  - updatable 用语义化比较（避免字符串比较：最新<当前（如 CDN 缓存旧版）时误提示更新）
   */
  async function queryUpdateInfo() {
    const cfg = readShellConfig();
    const [dshLatest, shellLatest] = await Promise.all([
      fetchLatestDshVersion(),
      fetchLatestShellVersion(),
    ]);
    const dshCurrent = installedDshVersion() ?? cfg.dshVersion;
    const dshUpdatable = !!dshLatest && compareSemver(dshCurrent, dshLatest) < 0;
    const dshNotes = dshUpdatable ? `可升级到 ${dshLatest}（重启自动安装）` : '';
    const shellUpdatable = !!shellLatest && compareSemver(app.getVersion(), shellLatest.version) < 0;
    return {
      dsh: {
        current: dshCurrent,
        // T-028：latest ≤ current 时显示 current（防 CDN 缓存旧版导致"降级"显示）
        latest: effectiveLatest(dshCurrent, dshLatest),
        notes: dshNotes,
        updatable: dshUpdatable,
        updating: false,
      },
      shell: {
        current: app.getVersion(),
        latest: shellLatest ? effectiveLatest(app.getVersion(), shellLatest.version) : null,
        notes: shellLatest ? shellLatest.releaseNotes : '',
        updatable: shellUpdatable,
        force: shellLatest ? shellLatest.force : false,
        downloading: false,
      },
    };
  }

  /** DSH 升级：备份+改写 config.json 的 dshVersion → relaunch 重启安装 */
  function upgradeDshVersion() {
    const cfg = readShellConfig();
    const current = installedDshVersion() ?? cfg.dshVersion;
    return fetchLatestDshInfo().then((info) => {
      const latest = info ? info.version : null;
      if (!latest || compareSemver(current, latest) >= 0) return { ok: false, reason: 'no-update' };
      // P1-2：连同 registry 返回的 integrity 一并交给 updateDshVersion ——
      // dsh-runtime 落盘记录，重启安装时核对（固定版本安装，不信任无锁定的 @latest）
      if (updateDshVersion(latest, info.integrity)) {
        // 延迟 relaunch，给渲染端"已更新配置"提示留出展示时间（审查 v12 P0：恢复重启逻辑）
        setTimeout(() => { app.relaunch(); app.exit(0); }, 1500);
        return { ok: true, from: current, to: latest };
      }
      // P1-4：附带 config 路径，便于提示用户手动处理（如安装目录为受保护路径 EACCES）
      return { ok: false, reason: 'write-failed', configPath: path.join(app.getAppPath(), 'config.json') };
    });
  }

  /**
   * 查询壳最新版本（v2.0.2：单一权威源 = 自家服务器接口）。
   * 返回 { version, downloadUrls, releaseNotes, force, hash, minVersion } 或 null（失败/超时/无源）。
   *  - 源地址读取 config.json 的 shellUpdate.apiUrl（数据存服务器 MySQL dsh.shell_version）——
   *    改服务器地址只需改 config.json，壳无需重打包。
   *  - 失败/超时/非 2xx/无效返回 → null，调用处提示「网络错误，请稍后重试」
   *    （不再回退 GitHub 三源；服务器为唯一权威源）。
   *  - 下载安装包仍在 doShellDownload 走 GitHub Releases（download_urls），v2.0.2 起
   *    hash 校验以服务器下发为准（去掉壳内置台账 verifyKnownHash）。
   */
  function fetchLatestShellVersion() {
    const cfg = readShellConfig();
    const url = cfg.shellUpdate && cfg.shellUpdate.apiUrl;
    if (!url) {
      appendLog('warn', '缺少 shellUpdate.apiUrl 配置，跳过壳更新检查');
      return Promise.resolve(null);
    }
    const parse = (info) => {
      if (!info || typeof info.version !== 'string') return null;
      return {
        version: String(info.version),
        downloadUrls: Array.isArray(info.download_urls) ? info.download_urls.map(String) : [],
        releaseNotes: String(info.release_notes || ''),
        force: !!info.force,
        hash: String(info.hash || '').toLowerCase(),
        minVersion: String(info.minVersion || ''), // v0.7.10：最低支持版本（空 = 不限制）
      };
    };
    return fetchJson(url, 8000).then((raw) => {
      if (!raw) {
        appendLog('warn', `壳版本检查失败（服务器不可达或返回异常）：${url}`);
        return null;
      }
      const r = parse(raw);
      if (!r) {
        appendLog('warn', `壳版本检查：服务器返回数据无效（${url}）`);
        return null;
      }
      appendLog('info', `壳版本检查：服务器返回 v${r.version}`);
      return r;
    });
  }

  /** 下载文件到 dest，带进度回调（0~1）；自动跟随重定向（≤5 次）。 */
  /**
   * 下载文件到 dest，带进度回调（0~1）；自动跟随重定向（≤5 次）。
   * v0.7.2（T-033）：断点续传 —— 下载写入 <dest>.part，中断/网络错误保留 .part，
   * 同 URL 自动重试（≤3 次）时发 Range 续传（206 追加）；服务器忽略 Range（200）
   * 则从头覆盖；416（.part 无效）删 .part 重来。完成后原子 rename 为 dest。
   * 进度：有总大小 → 0~1（含续传起点）；无（chunked）→ 负值 = 累计字节数。
   */
  function downloadFile(url, dest, onProgress) {
    const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000; // P2-1：单次尝试总超时 10 分钟
    const MAX_REDIRECTS = 5;                    // P2-1：重定向上限
    const MAX_ATTEMPTS = 3;                     // v0.7.2：同 URL 自动重试（含续传）次数
    const part = `${dest}.part`;
    return new Promise((resolve, reject) => {
      let req;
      let file = null;
      let redirects = 0;
      let attempts = 0;
      let retried416 = false;
      let resumeFrom = 0; // 本次请求的续传起点（.part 已有字节数）
      const resumeSize = () => {
        try { return fs.statSync(part).size; } catch { return 0; }
      };
      const start = (target) => {
        let done = false;
        resumeFrom = resumeSize();
        const timer = setTimeout(() => {         // P2-1：超时中止（保留 .part 供续传）
          try { req.abort(); } catch { /* ignore */ } // O2：net.request 用 abort
          if (file) { try { file.destroy(); } catch { /* ignore */ } }
          onFail(new Error('下载超时'));
        }, DOWNLOAD_TIMEOUT_MS);
        const cleanupTimer = () => clearTimeout(timer);
        const onFail = (err) => {                // 网络错误/超时：保留 .part，同 URL 自动重试续传
          if (done) return;
          done = true;
          cleanupTimer();
          // v0.7.10（v18.0 L1 遗留修复）：显式销毁旧写入流 —— 不关的话重试时旧流
          // 仍持有 .part 句柄，新流打开可能失败/残留文件，且断点续传的旧流永远不回收
          if (file) { try { file.destroy(); } catch { /* ignore */ } }
          if (attempts < MAX_ATTEMPTS) {
            attempts++;
            setTimeout(() => start(target), 500);
            return;
          }
          reject(err);
        };
        // v0.6.7（T-031）：写入失败走业务兜底（删 .part 重来），不冒泡成系统级错误
        const openStream = (flags) => {
          file = fs.createWriteStream(part, { flags });
          file.on('error', (err) => { if (!done) { done = true; cleanupTimer(); rmQuiet(part); reject(err); } });
          return file;
        };
        const headers = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : undefined;
        // O2 v1.1.6：downloadFile 请求层改用 Electron net（Chromium 网络栈 + 系统 CA），
        // 根治 Node https 在真机 TLS 验证失败的隐患；保留断点续传/Range/重定向/416 逻辑。
        req = net.request({ url: target, headers: headers || {} });
        req.on('response', (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            req.abort(); // O2：net.request 用 abort（原 https.get 用 destroy）
            // P3-5：重定向目标强制 https（防 https→http 降级投毒）
            if (!/^https:\/\//i.test(res.headers.location)) {
              cleanupTimer();
              rmQuiet(part);
              reject(new Error('重定向目标非 https，已拒绝'));
              return;
            }
            if (++redirects > MAX_REDIRECTS) {
              cleanupTimer();
              rmQuiet(part);
              reject(new Error('重定向次数过多'));
              return;
            }
            start(res.headers.location); // 续传起点不变，.part 不变
            return;
          }
          if (res.statusCode === 416) {
            // .part 已完整或与源不一致：删掉从头重来一次
            res.resume();
            cleanupTimer();
            rmQuiet(part);
            if (retried416) { reject(new Error('HTTP 416')); return; }
            retried416 = true;
            start(target);
            return;
          }
          if (res.statusCode !== 200 && res.statusCode !== 206) {
            res.resume(); // 消费响应体，让流正常结束
            cleanupTimer();
            rmQuiet(part); // 其他错误码（404 等）：.part 无意义，删掉
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          // 200 = 服务器忽略 Range（或首次下载），从头覆盖；206 = 续传追加
          if (res.statusCode === 200) resumeFrom = 0;
          const stream = openStream(resumeFrom > 0 ? 'a' : 'w');
          // v0.7.2（T-033）：响应流中途断开（网络中断/服务端掐断）→ 保留 .part 走续传重试。
          // 不监听的话 pipe 写失败会走 file 'error' 删 .part（续传失效），或永远 pending。
          res.on('error', (err) => onFail(err));
          res.on('close', () => { if (!done && !res.complete) onFail(new Error('连接中断')); });
          // 总大小：206 时 content-length 是剩余字节，完整大小在 Content-Range 里
          let total = Number(res.headers['content-length']) || 0;
          if (res.statusCode === 206 && res.headers['content-range']) {
            const m = /\/\s*(\d+)\s*$/.exec(res.headers['content-range']);
            if (m) total = Number(m[1]);
          }
          let received = 0;
          res.on('data', (c) => {
            received += c.length;
            if (onProgress) {
              const base = resumeFrom;
              onProgress(total ? (base + received) / total : -(base + received));
            }
          });
          res.pipe(stream);
          stream.on('finish', () => {
            if (done) return;
            done = true;
            cleanupTimer();
            stream.close(() => {
              try {
                fs.renameSync(part, dest); // 原子落位
                resolve(dest);
              } catch (err) {
                rmQuiet(part);
                reject(err);
              }
            });
          });
        });
        req.on('error', (err) => onFail(err)); // 保留 .part 供续传
        req.end(); // O2：net.request 需显式 end 发起请求
      };
      start(url);
    });
  }

  /** 计算文件 SHA256（hex） */
  function sha256File(file) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      fs.createReadStream(file)
        .on('data', (d) => hash.update(d))
        .on('end', () => resolve(hash.digest('hex')))
        .on('error', reject);
    });
  }

  /** 下载安装包到用户数据目录 updates/ 下，返回本地路径；先清理该目录旧版本安装包（P2-2） */
  function shellDownloadDest(info) {
    const dir = path.join(app.getPath('userData'), 'updates');
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
    try {
      for (const old of fs.readdirSync(dir)) {
        if (/^DSH-Desktop-Setup-.*\.exe$/.test(old) && old !== `DSH-Desktop-Setup-${info.version}.exe`) {
          rmQuiet(path.join(dir, old));
        }
      }
    } catch { /* ignore */ }
    const file = path.join(dir, `DSH-Desktop-Setup-${info.version}.exe`);
    // v0.7.2（T-033）：只清正式文件（需重新下载完整版）；.part 保留作为断点续传基础
    rmQuiet(file);
    return file;
  }

  // v0.8.11（T0.5）：壳更新下载互斥锁 —— 启动弹窗「立即更新」与更新窗口「下载」两个入口
  // 并发触发会写同一 .part 冲突；锁持有期间复用同一 Promise（不重复下载），完成/失败后释放。
  let shellDownloadPromise = null;

  /** 壳更新下载（互斥入口）：已有下载在进行 → 返回同一 Promise（不重复下载） */
  function downloadShellUpdate(win, onProgress) {
    if (shellDownloadPromise) {
      appendLog('info', '壳更新下载已在进行中，忽略重复触发');
      return shellDownloadPromise;
    }
    shellDownloadPromise = doShellDownload(win, onProgress)
      .finally(() => { shellDownloadPromise = null; }); // 完成/失败后释放锁
    return shellDownloadPromise;
  }

  /** 壳更新下载本体：多镜像逐个 fallback → SHA256 校验（循环内）→ 打开安装包；进度经 onProgress(0~100) 回调 */
  async function doShellDownload(win, onProgress) {
    const info = await fetchLatestShellVersion();
    if (!info) return { ok: false, reason: 'fetch-failed' };
    const current = app.getVersion();
    if (compareSemver(current, info.version) >= 0) return { ok: false, reason: 'no-update' };
    // v2.0.2：版本信息由自家服务器接口提供（唯一权威源），不再做「三源多数一致」信任门与
    // 壳内置 hash 台账核对；下载仍走 GitHub（download_urls），下载后按服务器下发 hash 做 SHA256 校验。
    const dest = shellDownloadDest(info);
    // P3-5：下载 URL 强制 https（防 version.json 被投毒塞 http:// 明文下载）
    let urls = (info.downloadUrls.length > 0 ? info.downloadUrls : [])
      .filter((u) => /^https:\/\//i.test(String(u)));
    if (urls.length === 0) {
      urls = [`https://ghfast.top/https://github.com/XWJ-z/dsh-Desktop/releases/download/v${info.version}/DSH-Desktop-Setup-${info.version}.exe`];
    }
    let lastErr = null;
    let lastUrl = null;
    for (const url of urls) {
      try {
        // v0.7.2（T-033）：换镜像 = 换数据源，.part 内容不兼容，删除避免混合续传
        if (lastUrl && url !== lastUrl) rmQuiet(`${dest}.part`);
        lastUrl = url;
        appendLog('info', `开始下载 DSH-Desktop v${info.version}：${url}${fs.existsSync(`${dest}.part`) ? '（续传）' : ''}`);
        await downloadFile(url, dest, (ratio) => {
          // 有总量 → 0~100；无总量（chunked）→ 负值 = 已下载字节数
          if (onProgress) onProgress(ratio > 0 ? Math.round(ratio * 100) : -ratio);
          if (ratio > 0) appendLog('info', `下载进度：${Math.round(ratio * 100)}%`);
        });
        // v0.8.9：SHA256 校验放在循环内 —— 校验失败 = .part 续传基础已损坏，
        // 删除 dest+.part（强制下次从头下载）并回退下一个镜像，不再"一直校验失败"
        if (info.hash) {
          const actual = await sha256File(dest);
          if (actual !== info.hash) {
            rmQuiet(dest);
            rmQuiet(`${dest}.part`);
            lastErr = new Error(`SHA256 校验失败（期望 ${info.hash}，实际 ${actual}）`);
            appendLog('warn', `安装包 SHA256 校验失败：期望 ${info.hash}，实际 ${actual}；已删除续传缓存，尝试下一个镜像…`);
            continue;
          }
          appendLog('info', '安装包 SHA256 校验通过');
        }
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        appendLog('warn', `下载失败（${url}）：${err.message}，尝试下一个镜像…`);
      }
    }
    if (lastErr) {
      return {
        ok: false,
        reason: String(lastErr.message || '').includes('SHA256') ? 'hash-mismatch' : 'download-failed',
        message: lastErr.message,
      };
    }

    // v0.8.11（T0.7）：SHA256 校验已在镜像循环内完成（0.8.9 起），删除循环外残留的重复校验
    appendLog('info', `DSH-Desktop v${info.version} 下载完成：${dest}`);
    shell.openPath(dest);
    return { ok: true, version: info.version, path: dest };
  }

  return {
    fetchJson,
    fetchLatestDshInfo,       // P1-2：registry 最新版本 + integrity（供 dsh-runtime 固定版本安装）
    fetchLatestDshVersion,
    compareSemver,
    effectiveLatest,
    queryUpdateInfo,
    upgradeDshVersion,
    fetchLatestShellVersion,
    downloadShellUpdate,
    sha256File,
  };
}

module.exports = { createUpdater };
