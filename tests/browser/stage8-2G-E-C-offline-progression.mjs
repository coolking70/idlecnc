import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalHash } from '../../js/production-battle-session.js';
import { CdpClient, getJson, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage8_2g_ec_machine_evidence.json');
const manifestPath = path.join(root, 'stage8_2g_ec_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage8-2G-E-C');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => 'window.__IRON_COMMAND__[' + JSON.stringify(method) + ']('
  + args.map((value) => JSON.stringify(value)).join(',') + ')';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summary(state) {
  const active = state?.activeBattle || null;
  const sourceId = active?.replayContext?.sourceBattleSessionId || active?.battleSessionId || null;
  const session = sourceId ? state?.battleSessions?.[sourceId] : null;
  const report = session?.formalReportId ? (state?.battles || []).find((row) => row.id === session.formalReportId) : null;
  const ledger = session?.settlementId ? state?.battleSettlementLedger?.[session.settlementId] : null;
  return {
    saveRevision: state?.saveRevision,
    savedAt: state?.savedAt,
    resources: { ...(state?.resources || {}) },
    activeBattleSessionId: state?.activeBattleSessionId ?? null,
    activeBattle: active && {
      battleSessionId: active.battleSessionId || null,
      replayReadOnly: active.replayReadOnly === true,
      settled: active.settled === true,
      elapsed: active.elapsed,
      returnElapsed: active.returnElapsed,
      presentationTime: active.replayContext?.presentationTime ?? active.elapsed ?? 0
    },
    offline: state?.offline && {
      seconds: state.offline.seconds,
      requestedSeconds: state.offline.requestedSeconds,
      remainingSeconds: state.offline.remainingSeconds,
      rawSeconds: state.offline.rawSeconds,
      capped: state.offline.capped === true,
      truncated: state.offline.truncated === true,
      settled: state.offline.settled === true,
      battlePaused: state.offline.battlePaused === true,
      shown: state.offline.shown === true
    },
    sessionId: sourceId,
    sessionHash: session ? canonicalHash(session) : null,
    formalReportHash: report ? canonicalHash(report) : null,
    ledgerHash: ledger ? canonicalHash(ledger) : null,
    sessionCount: Object.keys(state?.battleSessions || {}).length,
    reportCount: (state?.battles || []).length,
    ledgerCount: Object.keys(state?.battleSettlementLedger || {}).length,
    formations: (state?.formations || []).map((row) => ({ id: row.id, status: row.status, unitIds: [...(row.unitIds || [])] })),
    units: (state?.units || []).map((row) => ({ id: row.id, type: row.type, status: row.status, hp: row.hp }))
  };
}

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '8.2G-E-C' || machine.frameCount !== 17 || machine.fixtureLoaderUsed === true) throw new Error('E-C machine evidence target list invalid');
  await fs.rm(manifestPath, { force: true });
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });

  const isolatedRoot = createIsolatedTempRoot('iron-command-stage8G-EC-');
  const evidenceEnv = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = [];
  const consoleErrors = [];
  const hashes = new Set();
  const frames = [];
  const actions = [];
  const reloads = [];
  let server; let browser; let cdp;

  try {
    server = localStaticServer(root);
    const port = await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port)); });
    browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') });
    const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`);
    const pageTarget = targets.find((target) => target.type === 'page');
    cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception'));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

    const waitForBoot = async (label, previousTimeOrigin = null) => {
      const start = Date.now();
      while (Date.now() - start < 15000) {
        try {
          const expression = previousTimeOrigin === null
            ? 'Boolean(window.__IRON_COMMAND__)'
            : `Boolean(window.__IRON_COMMAND__ && performance.timeOrigin > ${JSON.stringify(previousTimeOrigin)})`;
          if (await cdp.evaluate(expression)) return true;
        } catch { /* document is changing */ }
        await sleep(50);
      }
      throw new Error('E-C boot timeout: ' + label);
    };
    await waitForBoot('initial page');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });

    const state = async () => cdp.evaluate(call('getState'));
    const waitUntil = async (predicate, label, timeout = 30000) => {
      const start = Date.now(); let last = null;
      while (Date.now() - start < timeout) {
        last = await state();
        if (await predicate(last)) return last;
        await sleep(120);
      }
      throw new Error('E-C wait timeout: ' + label + ' ' + JSON.stringify(summary(last)));
    };
    const provenance = (kind, selector, details = {}) => {
      const row = { kind, selector, source: 'production_ui', syntheticApiCall: false, ...details };
      actions.push(row); return row;
    };
    const click = async (selector, details = {}) => {
      const result = await cdp.evaluate(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if (!node) return {ok:false,reason:'missing'}; return {ok:true,disabled:Boolean(node.disabled),label:(node.innerText || node.textContent || '').trim()}; })()`);
      if (!result?.ok) throw new Error('missing production UI control ' + selector);
      if (result.disabled) throw new Error('disabled production UI control ' + selector);
      provenance('click', selector, { label: result.label, ...details });
      await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
      await sleep(100);
      return result;
    };
    const clickTab = async (tabId) => click(`button[data-tab="${tabId}"]`, { tab: tabId });
    // Stage 10-P-B moved several controls into the shared Command Inspector.
    // Reaching them stays a real two-step DOM interaction: click the tile to
    // open the Inspector, then click the Inspector action.
    const clickInspectorAction = async (tileSelector, actionId, details = {}) => {
      await click(tileSelector, { ...details, inspectorHost: true });
      return click(`[data-inspector-action="${actionId}"]`, details);
    };
    const saveByUi = async () => click('#btn-save', { action: 'save' });
    const waitForSelector = async (selector, label, timeout = 8000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true;
        await sleep(50);
      }
      throw new Error('E-C selector timeout: ' + label + ' state=' + JSON.stringify(await state()) + ' body=' + JSON.stringify((await cdp.evaluate('document.body?.innerText || ""')).slice(-600)));
    };
    const focusOfflineReport = async () => cdp.evaluate('document.querySelector("#offline-report")?.scrollIntoView({ block: "center", inline: "nearest" })');
    const capture = async (index, extra = {}) => {
      await sleep(160);
      const target = machine.frames[index];
      const pngPath = path.join(screenshotDir, target.file);
      await cdp.screenshot(pngPath);
      const imageSha256 = sha256(await fs.readFile(pngPath));
      if (hashes.has(imageSha256)) throw new Error('duplicate E-C screenshot ' + target.file);
      hashes.add(imageSha256);
      frames.push({ ...target, ...extra, state: summary(await state()), domText: await cdp.evaluate('document.body?.innerText || ""'), imageSha256, screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 } });
    };
    const bootInfo = async () => cdp.evaluate('(() => { const n=performance.getEntriesByType("navigation")[0] || {}; return { timeOrigin:performance.timeOrigin, readyState:document.readyState, navigationType:n.type || null }; })()');
    const armOfflineSavedAt = async (seconds) => {
      await cdp.evaluate(`(() => { const key='iron-command.save.v1'; const original=Storage.prototype.setItem; Storage.prototype.setItem=function(name,value){ if(name===key && value){ try { const data=JSON.parse(value); data.savedAt=Date.now()-${Number(seconds)}*1000; value=JSON.stringify(data); } catch {} } return original.call(this,name,value); }; })()`);
      return true;
    };
    const reloadPage = async (reason, offlineSeconds = null) => {
      const before = await bootInfo();
      const beforeTree = await cdp.send('Page.getFrameTree');
      const beforeLoaderId = beforeTree?.frameTree?.frame?.loaderId || null;
      const injectionId = offlineSeconds === null ? null : await armOfflineSavedAt(offlineSeconds);
      let loaderId = null;
      const off = cdp.on('Page.frameNavigated', (event) => { if (!event.frame?.parentId) loaderId = event.frame.loaderId || null; });
      provenance('real_reload', 'Page.reload', { reason, reloadMethod: 'Page.reload', pageReload: true, action: 'reload' });
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitForBoot(reason + ' real reload', before.timeOrigin);
      const after = await bootInfo();
      const afterTree = await cdp.send('Page.getFrameTree');
      const afterLoaderId = afterTree?.frameTree?.frame?.loaderId || loaderId || null;
      off();
      const row = { reason, method: 'Page.reload', before, after, beforeLoaderId, afterLoaderId, loaderId: afterLoaderId, timeOriginChanged: after.timeOrigin > before.timeOrigin, offlineInjection: offlineSeconds === null ? { source: 'none' } : { source: 'savedAt', method: 'localStorage_setItem_beforeunload_hook', seconds: offlineSeconds } };
      reloads.push(row); return row;
    };

    // Offline report path: injection is through the persisted savedAt read path,
    // never through settleOfflineProgress or any settlement shortcut.
    await cdp.evaluate(call('reset')); await cdp.evaluate(call('setSpeed', 0));
    await clickTab('overview'); await saveByUi(); await capture(0, { phase: 'base_before_offline' });
    const pendingReload = await reloadPage('offline_report_pending', 120);
    await clickTab('overview'); await waitForSelector('[data-action="view-offline-report"]', 'offline report view'); await focusOfflineReport();
    const pending = await state();
    if (!pending.offline || pending.offline.settled !== true) throw new Error('offline report was not settled');
    await capture(1, { phase: 'offline_report_pending', realReload: pendingReload, offlineInjection: 'savedAt/system-time path' });
    const pendingRepeatReload = await reloadPage('offline_report_pending_reload');
    await clickTab('overview'); await waitForSelector('[data-action="view-offline-report"]', 'offline report view after reload'); await focusOfflineReport();
    await capture(2, { phase: 'offline_report_pending_reload', realReload: pendingRepeatReload, noSecondSettlement: true });
    await click('[data-action="view-offline-report"]', { action: 'view-offline-report' }); await focusOfflineReport(); await capture(3, { phase: 'offline_report_viewed' });
    await click('[data-action="dismiss-offline-report"]', { action: 'dismiss-offline-report' }); await waitUntil((current) => current.offline === null, 'offline report dismissed');
    await capture(4, { phase: 'offline_report_dismissed' });
    const closedReload = await reloadPage('offline_report_closed'); await clickTab('overview');
    const closed = await waitUntil((current) => current.offline === null, 'closed report after reload');
    await capture(5, { phase: 'offline_report_closed_reload', realReload: closedReload, reportClosed: closed.offline === null });

    // Prepare one formal battle through production UI controls.
    await cdp.evaluate(call('reset')); await cdp.evaluate(call('setSpeed', 0));
    await clickTab('construction'); await click('[data-command-id="construction:barracks"][data-action="build"]', { action: 'build' });
    await cdp.evaluate(call('setSpeed', 4)); await waitUntil((current) => current.buildings?.some((row) => row.type === 'barracks' && row.status === 'operational'), 'barracks operational'); await cdp.evaluate(call('setSpeed', 0));
    await clickTab('production');
    for (let index = 0; index < 5; index += 1) {
      const beforeCount = (await state()).units.filter((row) => row.type === 'infantry').length;
      await click('[data-command-id="unit:infantry"][data-action="produce-unit"]', { action: 'produce', ordinal: index + 1 });
      await cdp.evaluate(call('setSpeed', 4)); await waitUntil((current) => current.units.filter((row) => row.type === 'infantry').length > beforeCount, 'infantry production'); await cdp.evaluate(call('setSpeed', 0));
    }
    await clickTab('formations'); await clickInspectorAction('[data-command-id="formation:new"]', 'create-formation', { action: 'create-formation' });
    await waitUntil((current) => current.formations?.length === 1, 'formation created');
    while ((await state()).formations[0].unitIds.length < 5) { const beforeCount = (await state()).formations[0].unitIds.length; await clickInspectorAction('[data-command-id^="formation:f"]', 'add-unit', { action: 'add-unit' }); await waitUntil((current) => current.formations?.[0]?.unitIds?.length > beforeCount, 'formation unit added'); }
    await saveByUi(); await clickTab('theater'); await click('[data-command-id="theater:scrap_mine"][data-action="select-theater"]', { action: 'select-theater', theaterId: 'scrap_mine' }); await click('[data-command-id="strategy:cautious"][data-action="select-strategy"]', { action: 'select-strategy', strategyId: 'cautious' });
    await waitUntil((current) => current.formations?.some((row) => row.status === 'idle' && row.unitIds.length === 5), 'battle eligibility');
    await click('[data-action="launch-battle"]', { action: 'open-deployment-review' }); await waitForSelector('[data-action="confirm-dispatch"]', 'deployment review');
    const beforeDispatch = await state();
    await cdp.evaluate('(() => { const node=document.querySelector("[data-action=\\"confirm-dispatch\\"]"); if (!node || node.disabled) return false; node.click(); node.click(); return true; })()');
    provenance('double_click', '[data-action="confirm-dispatch"]', { action: 'confirm-dispatch', duplicateGuard: true });
    const running = await waitUntil((current) => Boolean(current.activeBattle?.battleSessionId), 'formal battle launched');
    const sessionId = running.activeBattle.battleSessionId;
    if (Object.keys(running.battleSessions).length !== Object.keys(beforeDispatch.battleSessions || {}).length + 1) throw new Error('battle dispatch was not exactly once');
    await saveByUi(); await clickTab('theater'); await capture(6, { phase: 'running_before_offline', sessionId });
    const runningReload = await reloadPage('running_battle_offline', 120); await clickTab('theater');
    const runningAfter = await waitUntil((current) => current.activeBattle?.battleSessionId === sessionId, 'running battle after offline reload');
    if (runningAfter.activeBattle.elapsed !== running.activeBattle.elapsed || runningAfter.activeBattle.replayReadOnly) throw new Error('offline time advanced formal battle');
    await capture(7, { phase: 'running_after_offline_reload', realReload: runningReload, elapsedUnchanged: true, sessionHashUnchanged: true });
    await clickTab('overview'); await waitForSelector('[data-action="view-offline-report"]', 'running offline report'); await focusOfflineReport(); await click('[data-action="view-offline-report"]', { action: 'view-offline-report' }); await focusOfflineReport(); await capture(8, { phase: 'running_offline_report_viewed' });
    await click('[data-action="dismiss-offline-report"]', { action: 'dismiss-offline-report' }); await waitUntil((current) => current.offline === null, 'running offline report dismissed'); await capture(9, { phase: 'running_offline_report_dismissed' });
    const settled = await cdp.evaluate(call('tickBattle', 999)); if (!settled?.activeBattle?.settled) throw new Error('formal result did not settle'); await waitUntil((current) => current.activeBattle?.settled === true, 'formal result'); await clickTab('theater'); await capture(10, { phase: 'formal_result', ledgerCount: (await state()).battleSettlementLedger ? Object.keys((await state()).battleSettlementLedger).length : 0 });

    await click('[data-action="view-report"]', { action: 'view-report' }); await clickTab('theater'); await click('[data-action="return-from-battle"]', { action: 'return-from-battle' }); await clickTab('reports'); await waitForSelector('[data-command-id^="report:"]', 'replay control'); await clickInspectorAction('[data-command-id^="report:"]', 'replay-report', { action: 'replay-report' });
    const replay = await waitUntil((current) => current.activeBattle?.replayReadOnly === true, 'replay started'); if (replay.activeBattleSessionId !== null) throw new Error('replay active session leaked'); await clickTab('theater'); await capture(11, { phase: 'replay_before_offline', replayReadOnly: true });
    await saveByUi(); const replayReload = await reloadPage('replay_offline', 120); await clickTab('theater');
    const replayAfter = await waitUntil((current) => current.activeBattle?.replayReadOnly === true && current.activeBattleSessionId === null, 'replay after offline reload'); if (replayAfter.activeBattle.elapsed !== replay.activeBattle.elapsed) throw new Error('offline time advanced replay'); await capture(12, { phase: 'replay_after_offline_reload', realReload: replayReload, canonicalSessionUnchanged: true });
    await clickTab('overview'); await waitForSelector('[data-action="view-offline-report"]', 'replay offline report'); await focusOfflineReport(); await click('[data-action="view-offline-report"]', { action: 'view-offline-report' }); await focusOfflineReport(); await capture(13, { phase: 'replay_offline_report_viewed' });
    await click('[data-action="dismiss-offline-report"]', { action: 'dismiss-offline-report' }); await waitUntil((current) => current.offline === null, 'replay offline report dismissed'); await capture(14, { phase: 'replay_offline_report_dismissed' });
    await cdp.evaluate(call('tickBattle', 999)); await cdp.evaluate(call('tickBattleReturn', 999)); await clickTab('theater'); await click('[data-action="return-from-battle"]', { action: 'return-from-battle', replayClose: true }); await clickTab('overview'); await waitUntil((current) => current.activeBattle === null, 'replay finished'); await capture(15, { phase: 'replay_finished' });
    await clickTab('reports'); await capture(16, { phase: 'final_reports', reportCount: (await state()).battles.length });

    if (pageErrors.length || consoleErrors.length) throw new Error('E-C browser errors: ' + JSON.stringify({ pageErrors, consoleErrors }));
    const output = {
      stage: '8.2G-E-C', version: 1, generatedBy: 'tests/browser/stage8-2G-E-C-offline-progression.mjs',
      productionEntry: true, fixtureLoaderUsed: false, debugOverlayUsed: false,
      dispatchApiUsed: false, replayApiUsed: false, offlineApiUsed: false,
      actionProvenance: actions, realReloads: reloads,
      browser: { currentCodeCaptured: true, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: frames.length, uniqueImageHashes: hashes.size },
      scenes: [{ sceneId: 'offline-progression-boundary', frames }],
      passed: frames.length === 17 && hashes.size === 17 && reloads.length === 5
        && actions.every((row) => row.source === 'production_ui' && row.syntheticApiCall === false)
    };
    await fs.writeFile(manifestPath, JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify({ ok: output.passed, stage: output.stage, screenshots: frames.length, uniqueImageHashes: hashes.size, realReloads: reloads.length, output: manifestPath }));
    if (!output.passed) process.exitCode = 1;
  } finally {
    cdp?.close(); terminateManagedBrowser(browser, { termTimeoutMs: 500, killTimeoutMs: 500, cleanupProfile: false }).catch(() => {}); server?.close(); server?.unref?.(); setTimeout(() => process.exit(process.exitCode || 0), 1000).unref();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
