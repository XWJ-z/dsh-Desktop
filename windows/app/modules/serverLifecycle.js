'use strict';

/**
 * DSH-Desktop — DSH 服务子进程生命周期模块（优化方案 2026-08-16 阶段一：从 main.js 拆分）
 *
 * 职责：
 *  - spawnServer：确保 DSH 运行时后以子进程启动 `dsh web`，处理退出/意外退出弹窗
 *  - stopServer：应用退出时统一清理派生子进程（npm install + dsh 服务）
 *  - stopServerOnly：恢复数据前只停 DSH 服务（壳保持运行），不触发「服务意外退出」
 *
 * 依赖注入（deps）：
 *  - app / dialog / spawn
 *  - appendLog / logPath                   日志模块
 *  - ensureDshRuntime / resolveRunner / readShellConfig / installedDshVersion   运行时与 Node 解析
 *  - trackChild / killTrackedChildren / trackedChildren    子进程跟踪（main.js 基础设施）
 *  - waitForServer                         端口模块
 *  - defaultHost / childGraceMs / serverReadyTimeoutMs     常量
 *  - getQuitting/setQuitting / getServerChild/setServerChild
 *  - getServerStopRequested/setServerStopRequested / getMainWindow / getWebUrl / getResolvedPort
 */

function createServerLifecycle(deps) {
  const {
    app, dialog, spawn, appName,
    appendLog, logPath,
    ensureDshRuntime, resolveRunner, readShellConfig, installedDshVersion,
    trackChild, killTrackedChildren, trackedChildren,
    waitForServer,
    defaultHost, childGraceMs, serverReadyTimeoutMs,
    getQuitting, setQuitting,
    getServerChild, setServerChild,
    getServerStopRequested, setServerStopRequested,
    getMainWindow, getWebUrl, getResolvedPort,
  } = deps;

  /** 应用退出：统一清理所有派生子进程，宽限期后强制结束 */
  function stopServer() {
    if (getQuitting()) return;
    setQuitting(true);
    appendLog('info', '正在关闭 DSH 服务…');
    killTrackedChildren();
    setTimeout(() => {
      // 宽限期后仍未退出的子进程强制结束
      for (const child of trackedChildren) {
        try {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        } catch { /* ignore */ }
      }
    }, childGraceMs);
  }

  /**
   * v0.7.10（用户反馈）：仅停止 DSH 服务子进程，应用（壳）保持运行。
   * 场景：恢复数据前释放 ~/.dsh 占用 —— 原先要求用户「退出整个应用」，但壳重启
   * 又会自动拉起服务，导致永远无法恢复。本函数只 kill serverChild（不退出应用），
   * 恢复完成后用户重启应用即重新拉起服务。
   * @returns {Promise<void>} 服务已停止（或原本就没在跑）时 resolve
   */
  function stopServerOnly() {
    return new Promise((resolve) => {
      const child = getServerChild();
      if (!child || child.exitCode !== null) { setServerChild(null); resolve(); return; }
      setServerStopRequested(true); // 避免 exit 事件误判「服务意外退出」弹窗
      appendLog('info', '正在停止 DSH 服务（恢复数据前释放占用）…');
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      const forceKill = setTimeout(() => {
        try { if (child.exitCode === null) child.kill('SIGKILL'); } catch { /* ignore */ }
      }, childGraceMs);
      const done = () => { clearTimeout(forceKill); resolve(); };
      if (child.exitCode !== null) { done(); return; }
      child.once('exit', done);
      child.once('error', done);
      // 兜底：事件万一未触发，宽限期后强制结束并返回
      setTimeout(done, childGraceMs + 500);
    });
  }

  function spawnServer(port) {
    return new Promise((resolve, reject) => {
      ensureDshRuntime()
        .then((dshBin) => {
          // v1.1.1（Issue #1 修复，26 方案 A）：DSH 运行时同样建议新 Node
          // （npm 12 需 ≥20），系统 Node 过旧时回落 Electron 内置 Node
          const runner = resolveRunner(20);
          // 仅 Electron-as-Node 兜底时需要 --expose-internals（DSH HMR 需要 Node
          // 内部模块 loader）；真实 Node（内置/系统）下经 node-addon-require-builtin
          // 原生插件获取，无需该参数。
          const runnerArgs = runner.env.ELECTRON_RUN_AS_NODE === '1' ? ['--expose-internals'] : [];
          // DSH 永远绑定 127.0.0.1（v1.2.1 局域网访问用壳的 TCP 代理暴露，见 lan-access.js）
          const host = defaultHost;
          const args = [
            ...runnerArgs,
            dshBin,
            'web',
            '--host', host,
            '--port', String(port),
          ];
          const cfg = readShellConfig();
          appendLog('info', `DSH 入口：${dshBin}（${cfg.dshPackage}@${installedDshVersion() ?? '?'}）`);
          appendLog('info', `DSH 运行器：${runner.label}`);
          appendLog('info', `启动命令：${runner.execPath} ${args.join(' ')}`);

          const env = { ...process.env, ...runner.env };
          if (!process.env.DSH_TELEMETRY_DISABLED) env.DSH_TELEMETRY_DISABLED = '1';

          let child;
          try {
            child = trackChild(
              spawn(runner.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
              'dsh-server',
            );
          } catch (err) {
            reject(err);
            return;
          }
          setServerChild(child);

          child.stdout.on('data', (chunk) => {
            for (const line of chunk.toString().split(/\r?\n/)) {
              if (line.trim()) appendLog('dsh', line.trimEnd());
            }
          });
          child.stderr.on('data', (chunk) => {
            for (const line of chunk.toString().split(/\r?\n/)) {
              if (line.trim()) appendLog('dsh:err', line.trimEnd());
            }
          });
          child.on('error', (err) => {
            appendLog('error', `DSH 进程启动失败：${err.message}`);
            reject(err);
          });
          child.on('exit', (code, signal) => {
            appendLog('warn', `DSH 进程退出 code=${code} signal=${signal}`);
            if (getQuitting()) return;
            // v0.7.10：主动停止（恢复数据前停服务）不视为异常，不弹「服务意外退出」
            if (getServerStopRequested()) { setServerStopRequested(false); setServerChild(null); return; }
            // 服务意外退出：提示用户
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              const message = `DSH 服务意外退出（code=${code}, signal=${signal}）。\n\n详细日志：${logPath()}`;
              dialog.showMessageBox(mainWindow, { type: 'error', title: appName, message, buttons: ['重新加载', '退出'] })
                .then(({ response }) => {
                  if (response === 0) {
                    spawnServer(getResolvedPort()).then(() => {
                      waitForServer(defaultHost, getResolvedPort(), serverReadyTimeoutMs)
                        .then(() => {
                          const mw = getMainWindow();
                          if (mw && !mw.isDestroyed()) mw.loadURL(getWebUrl());
                        })
                        .catch((err2) => appendLog('error', String(err2)));
                    }).catch((err2) => appendLog('error', String(err2)));
                  } else {
                    app.quit();
                  }
                });
            }
          });

          resolve(child);
        })
        .catch(reject);
    });
  }

  return { stopServer, stopServerOnly, spawnServer };
}

module.exports = { createServerLifecycle };
