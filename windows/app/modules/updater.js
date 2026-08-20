'use strict';

/**
 * DSH-Desktop — 更新检查 / 下载模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：
 *  - 壳（DSH-Desktop）版本检查：GitHub version.json 三源并发（jsDelivr/API/raw）
 *  - DSH 版本检查：npm registry dist-tags.latest
 *  - 语义化比较 / 展示值修正（T-028：latest ≤ current 显示 current）
 *  - 壳安装包下载：多镜像 fallback + SHA256 校验 + 断点续传 + 互斥锁（T0.5）
 *
 * 依赖注入（deps）：
 *  - app / shell / https / crypto / fs / path
 *  - appendLog                      日志模块
 *  - readShellConfig / installedDshVersion / updateDshVersion   运行时模块
 *  - getMainWindow                  主窗口 getter（下载完打开安装包/弹窗归属）
 *  - shellUpdateUrls                三源 URL 表（main.js 常量注入）
 *  （v0.9.5 T3：公告已独立到 modules/notice.js（notice.json 唯一源），
 *   本模块不再承载公告解析/缓存）
 *
 * 外审 zx(9) 2026-08-17 整改：
 *  - P1-1：版本比较收敛到 modules/semver.js（P3-3）；壳更新三源多数一致 +
 *    壳内置期望 hash 台账（modules/shell-hashes.js）双保险 —— 防「同一信任域
 *    投毒」（hash 与 URL 同源，单靠 SHA256 无法防）；版本比较不再内部实现。
 *  - P1-2：DSH 升级链路附带 registry 返回的 dist.integrity（sha512），由
 *    dsh-runtime 落盘核对（固定版本安装，不再无锁定 @latest）。
 *  - P3-5：下载首 URL 与重定向目标强制 https。
 */

const { compareSemver } = require('./semver');
const { verifyKnownHash } = require('./shell-hashes');

function createUpdater(deps) {
  const {
    app, shell, https, crypto, fs, path, rmQuiet,
    net, // v1.1.3（老大反馈：下载更新失败）：版本检查改用 Electron net
    appendLog,
    readShellConfig, installedDshVersion, updateDshVersion,
    shellUpdateUrls,
  } = deps;

  /**
   * GET 并解析 JSON；失败/超时返回 null（静默）。响应体超 maxBytes（默认 5MB）放弃。
   * v1.1.3（老大反馈：下载更新失败，日志「版本检查：1/3 源可达…拒绝自动下载」）：
   * 改用 Electron net.request（Chromium 网络栈 + 系统 CA + 自动跟随重定向）——
   * Node https.get 在真机 TLS 验证失败（api.github.com / raw.githubusercontent
   * "unable to verify the first certificate"），三源只有 jsDelivr 可达 →
   * sourcesAgree=false → 防投毒拒绝自动下载；与 help-doc.js / plugin-market.js
   * v1.1.1 同款修复（那两个模块当年已改 net 实测三源全通）。
   */
  function fetchJson(url, timeoutMs = 8000, headers = {}, maxBytes = 5 * 1024 * 1024) {
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
          let body = '';
          let aborted = false;
          const finish = (v) => {
            if (aborted) return;
            aborted = true;
            clearTimeout(timer);
            resolve(v);
          };
          res.on('data', (c) => {
            if (aborted) return;
            body += c;
            if (body.length > maxBytes) { // P2-4：防超大响应体耗尽内存
              aborted = true;
              try { req.abort(); } catch { /* ignore */ }
              clearTimeout(timer);
              resolve(null);
            }
          });
          res.on('end', () => {
            if (!aborted) {
              aborted = true;
              clearTimeout(timer);
              try { resolve(JSON.parse(body)); } catch { resolve(null); }
            }
          });
          res.on('error', () => finish(null));
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
   * 查询壳最新版本（三源并发：并发请求全部更新源）。
   * 返回 { version, download_urls, release_notes, force, hash, minVersion, sourcesAgree }
   * 或 null（全部失败/超时静默）。
   *  - sourcesAgree：是否存在「≥2 个源返回相同版本且 hash 一致」的多数一致组
   *    （P1-1：三源同属一个 GitHub repo 的三个镜像，不是独立信任域；多数一致
   *    才能防「单源投毒」。自动下载仅在 sourcesAgree=true 时允许，见 doShellDownload）。
   *  - 取版本号最高的**多数一致组**；若无任何多数一致组，退回版本号最高者
   *    但标记 sourcesAgree=false（可提示更新，但拒绝自动下载）。
   * v0.7.10（29 建议 A）：新增 minVersion 字段 —— 低于该版本的旧客户端启动时强制提示升级
   * v0.9.5（T3）：公告已独立到 notice.json（modules/notice.js），version.json 不再承载 notices
   */
  function fetchLatestShellVersion() {
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
    return Promise.all(shellUpdateUrls.map((s) => fetchJson(s.url, 8000, s.headers || {}).then(parse)))
      .then((results) => {
        const valid = results.filter(Boolean);
        if (valid.length === 0) return null;
        // P1-1：按版本分组，组内 hash 去重后唯一数 ≤1 且源数 ≥2 → 多数一致组
        const byVersion = new Map();
        for (const r of valid) {
          if (!byVersion.has(r.version)) byVersion.set(r.version, []);
          byVersion.get(r.version).push(r);
        }
        const pick = (group) => ({
          version: group[0].version,
          agree: group.length >= 2 && new Set(group.map((r) => r.hash).filter(Boolean)).size <= 1,
        });
        const groups = [...byVersion.entries()].map(([, list]) => pick(list));
        // 多数一致组中取版本最高者；无一致组 → 退回最高版本但 sourcesAgree=false
        const agreed = groups.filter((g) => g.agree).sort((a, b) => (compareSemver(a.version, b.version) < 0 ? 1 : -1));
        const chosen = agreed[0] || groups.sort((a, b) => (compareSemver(a.version, b.version) < 0 ? 1 : -1))[0];
        const best = byVersion.get(chosen.version)[0];
        best.sourcesAgree = !!chosen.agree;
        const detail = shellUpdateUrls.map((s, i) => `${s.name}=${results[i] ? results[i].version : '×'}`).join(', ');
        appendLog('info', `版本检查：${valid.length}/${shellUpdateUrls.length} 源可达（${detail}），取 v${best.version}${best.sourcesAgree ? '' : '（源不一致，仅提示不自动下载）'}`);
        return best;
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
          try { req.destroy(); } catch { /* ignore */ }
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
        req = https.get(target, { headers }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            req.destroy();
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
    // P1-1：多数一致信任门 —— 三源（jsDelivr/API/raw）同属一个 GitHub repo 镜像，
    // 无 ≥2 源一致时拒绝自动下载（可提示有新版，但不自动拉包），防单源/CDN 投毒
    if (!info.sourcesAgree) {
      appendLog('warn', `版本源不一致，拒绝自动下载 v${info.version}（防投毒：仅提示不下载）`);
      return {
        ok: false,
        reason: 'sources-disagree',
        message: '更新源返回的版本/hash 不一致，已阻止自动下载（可能为镜像缓存差异或被劫持）。请稍后重试或到 GitHub Releases 手动下载。',
      };
    }
    // P1-1：壳内置期望 hash 台账核对 —— 已发布版本 hash 必须与壳内置一致
    const hashCheck = verifyKnownHash(info.version, info.hash);
    if (!hashCheck.ok) {
      appendLog('warn', hashCheck.message);
      return { ok: false, reason: 'hash-mismatch', message: hashCheck.message };
    }

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
