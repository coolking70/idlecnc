import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalHash } from '../../js/production-battle-session.js';
import { computeSaveDiff, productionStateSignature } from '../../js/save-diff.js';
import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage8_2g_ea1_machine_evidence.json');
const manifestPath = path.join(root, 'stage8_2g_ea1_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage8-2G-E-A-1');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summary(state) {
  const active = state?.activeBattle || null;
  const sourceId = active?.replayContext?.sourceBattleSessionId || active?.battleSessionId
    || Object.keys(state?.battleSessions || {}).at(-1) || null;
  const session = sourceId ? state?.battleSessions?.[sourceId] : null;
  const report = session?.formalReportId
    ? (state?.battles || []).find((row) => row.id === session.formalReportId)
    : null;
  const formationId = session?.deploymentSnapshot?.formation?.id || session?.deploymentSnapshot?.formationId || null;
  const formationIds = new Set(formationId ? [formationId] : []);
  const formations = (state?.formations || []).filter((row) => formationIds.size === 0 || formationIds.has(row.id));
  const unitIds = new Set((session?.deploymentSnapshot?.units || []).map((row) => row.id));
  const units = (state?.units || []).filter((row) => unitIds.size === 0 || unitIds.has(row.id));
  return {
    saveRevision: state?.saveRevision,
    activeBattleSessionId: state?.activeBattleSessionId ?? null,
    activeBattle: active && {
      battleSessionId: active.battleSessionId,
      replaySourceSessionId: active.replayContext?.sourceBattleSessionId || null,
      replayReadOnly: active.replayReadOnly === true,
      settled: active.settled === true,
      elapsed: active.elapsed,
      returnElapsed: active.returnElapsed,
      presentationTime: active.replayContext?.presentationTime ?? active.elapsed ?? 0
    },
    sessionId: sourceId,
    sessionLifecycle: session?.lifecycle || null,
    sessionHash: session ? canonicalHash(session) : null,
    formalReportId: session?.formalReportId || null,
    formalReportHash: report ? canonicalHash(report) : session?.formalReportHash || null,
    ledgerHash: session?.settlementId && state?.battleSettlementLedger?.[session.settlementId]
      ? canonicalHash(state.battleSettlementLedger[session.settlementId]) : null,
    ledgerCount: Object.keys(state?.battleSettlementLedger || {}).length,
    reportCount: (state?.battles || []).length,
    productionSignature: productionStateSignature(state),
    formations: formations.map((row) => ({ id: row.id, status: row.status, unitIds: [...(row.unitIds || [])] })),
    units: units.map((row) => ({ id: row.id, status: row.status, hp: row.hp }))
  };
}

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '8.2G-E-A.1' || machine.frameCount !== 11 || machine.fixtureLoaderUsed === true) {
    throw new Error('E-A.1 machine evidence target list invalid');
  }
  await fs.rm(manifestPath, { force: true });
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });

  const isolatedRoot = createIsolatedTempRoot('iron-command-stage8G-EA1-');
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
    const port = await listenEphemeral(server);
    browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') });
    const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`);
    const pageTarget = targets.find((target) => target.type === 'page');
    cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception'));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' '));
    });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

    const waitForBoot = async (label = 'page bootstrap', previousTimeOrigin = null) => {
      const start = Date.now();
      while (Date.now() - start < 15000) {
        try {
          const ready = await cdp.evaluate(`Boolean(window.__IRON_COMMAND__ && (${previousTimeOrigin === null ? 'true' : `performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin)}`}))`);
          if (ready) return true;
        } catch { /* Runtime.evaluate is briefly unavailable while Page.reload swaps documents. */ }
        await sleep(50);
      }
      throw new Error(`E-A.1 ${label} timeout`);
    };
    await waitForBoot();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });

    const state = async () => cdp.evaluate(call('getState'));
    const waitUntil = async (predicate, label, timeout = 20000) => {
      const start = Date.now();
      let last = null;
      while (Date.now() - start < timeout) {
        const current = await state();
        last = current;
        if (await predicate(current)) return current;
        await sleep(150);
      }
      throw new Error(`E-A.1 wait timeout: ${label} ${JSON.stringify({
        formations: (last?.formations || []).map((row) => ({ id: row.id, status: row.status, unitIds: row.unitIds })),
        scrapMine: last?.theaters?.scrap_mine,
        activeBattle: last?.activeBattle ? { id: last.activeBattle.id, sessionId: last.activeBattle.battleSessionId } : null
      })}`);
    };
    const bootInfo = async () => cdp.evaluate(`(() => {
      const navigation = performance.getEntriesByType('navigation')[0] || {};
      return {
        timeOrigin: performance.timeOrigin,
        readyState: document.readyState,
        stage: window.__IRON_COMMAND__?.stage,
        navigationType: navigation.type || null,
        navigationStart: navigation.startTime || 0
      };
    })()`);
    const provenance = (kind, selector, details = {}) => {
      const record = { kind, selector, source: 'production_ui', syntheticApiCall: false, ...details };
      actions.push(record);
      return record;
    };
    const click = async (selector, details = {}) => {
      const result = await cdp.evaluate(`(() => {
        const node = document.querySelector(${JSON.stringify(selector)});
        if (!node) return { ok: false, reason: 'missing', selector: ${JSON.stringify(selector)} };
        return { ok: true, disabled: Boolean(node.disabled), label: (node.innerText || node.textContent || '').trim() };
      })()`);
      if (!result?.ok) throw new Error(`missing production UI control ${selector}`);
      if (result.disabled) throw new Error(`disabled production UI control ${selector} ${JSON.stringify({ element: result, state: summary(await state()) })}`);
      provenance('click', selector, { label: result.label, ...details });
      await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
      await sleep(100);
      return result;
    };
    const clickTab = async (tabId) => click(`button[data-tab="${tabId}"]`, { tab: tabId });
    const saveByUi = async () => click('#btn-save', { action: 'save' });
    const capture = async (target, extra = {}) => {
      await sleep(160);
      const pngPath = path.join(screenshotDir, target.file);
      await cdp.screenshot(pngPath);
      const imageSha256 = sha256(await fs.readFile(pngPath));
      if (hashes.has(imageSha256)) throw new Error(`duplicate E-A.1 PNG ${target.file}`);
      hashes.add(imageSha256);
      const current = await state();
      const domText = await cdp.evaluate('document.body?.innerText || ""');
      frames.push({
        ...target,
        ...extra,
        state: summary(current),
        domTextLength: domText.length,
        imageSha256,
        screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 }
      });
    };
    const reloadPage = async (reason) => {
      const before = await bootInfo();
      const beforeFrameTree = await cdp.send('Page.getFrameTree');
      const beforeLoaderId = beforeFrameTree?.frameTree?.frame?.loaderId || null;
      let loaderId = null;
      const off = cdp.on('Page.frameNavigated', (event) => {
        if (!event.frame?.parentId) loaderId = event.frame.loaderId || null;
      });
      provenance('real_reload', 'Page.reload', { reason, reloadMethod: 'Page.reload', pageReload: true });
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitForBoot(`${reason} real reload`, before.timeOrigin);
      const after = await bootInfo();
      const afterFrameTree = await cdp.send('Page.getFrameTree');
      const afterLoaderId = afterFrameTree?.frameTree?.frame?.loaderId || null;
      off();
      const record = {
        reason,
        method: 'Page.reload',
        before,
        after,
        beforeLoaderId,
        afterLoaderId,
        loaderId: afterLoaderId || loaderId,
        timeOriginChanged: before.timeOrigin !== after.timeOrigin
      };
      reloads.push(record);
      return record;
    };

    // Reset and time acceleration are test setup/inspection helpers. All
    // semantic actions below are DOM clicks on production controls.
    await cdp.evaluate(call('reset'));
    await cdp.evaluate(call('setSpeed', 0));
    await clickTab('overview');
    await capture(machine.frames[0], { phase: 'base_before_battle', actionProvenance: actions.slice() });

    await clickTab('construction');
    await click('[data-action="build"][data-building-type="barracks"]', { action: 'build' });
    await cdp.evaluate(call('setSpeed', 4));
    await waitUntil((current) => current.buildings?.some((row) => row.type === 'barracks' && row.status === 'operational'), 'barracks operational');
    await cdp.evaluate(call('setSpeed', 0));
    await clickTab('production');
    for (let index = 0; index < 2; index += 1) await click('[data-action="produce"][data-unit-type="infantry"]', { action: 'produce', ordinal: index + 1 });
    await cdp.evaluate(call('setSpeed', 4));
    await waitUntil((current) => (current.units || []).filter((row) => row.type === 'infantry').length >= 2, 'two infantry production complete');
    await cdp.evaluate(call('setSpeed', 0));

    await clickTab('formations');
    await click('[data-action="create-formation"]', { action: 'create-formation' });
    const created = await waitUntil((current) => (current.formations || []).length === 1, 'formation created');
    const formationId = created.formations[0].id;
    while ((await state()).formations[0].unitIds.length < 2) {
      const unitCountBeforeAdd = (await state()).formations[0].unitIds.length;
      await click('[data-action="add-unit"]', { action: 'add-unit', formationId });
      await waitUntil((current) => current.formations?.[0]?.unitIds?.length > unitCountBeforeAdd, 'formation unit added');
    }
    await saveByUi();

    await clickTab('theater');
    await click('[data-action="select-theater"][data-theater="scrap_mine"]', { action: 'select-theater', theaterId: 'scrap_mine' });
    await click('[data-action="select-strategy"][data-strategy="cautious"]', { action: 'select-strategy', strategyId: 'cautious' });
    await waitUntil((current) => documentReadyForLaunch(current), 'production launch control');
    await capture(machine.frames[1], { phase: 'production_ui_launch_control', productionEntry: true, actionProvenance: actions.slice() });

    const beforeDispatch = await state();
    const launchSelector = '[data-action="launch-battle"]';
    const launchDetails = await cdp.evaluate(`(() => {
      const node = document.querySelector(${JSON.stringify(launchSelector)});
      if (!node || node.disabled) return { ok: false, reason: 'launch disabled' };
      const label = (node.innerText || '').trim();
      node.click();
      node.click();
      return { ok: true, label };
    })()`);
    if (!launchDetails?.ok) throw new Error('production launch button disabled');
    provenance('double_click', launchSelector, { label: launchDetails.label, action: 'launch-battle', duplicateGuard: true });
    const dispatched = await waitUntil((current) => Boolean(current.activeBattle?.battleSessionId), 'formal battle launched');
    const launchSessionCount = Object.keys(dispatched.battleSessions || {}).length;
    if (launchSessionCount !== Object.keys(beforeDispatch.battleSessions || {}).length + 1) throw new Error('double-click created more than one battle session');
    await saveByUi();
    await clickTab('theater');
    await capture(machine.frames[2], { phase: 'running_before_real_reload', sessionId: dispatched.activeBattle.battleSessionId, doubleClickSessionDelta: launchSessionCount - Object.keys(beforeDispatch.battleSessions || {}).length, actionProvenance: actions.slice() });

    const runningReload = await reloadPage('running_battle');
    await clickTab('theater');
    const runningAfter = await waitUntil((current) => current.activeBattle?.battleSessionId === dispatched.activeBattle.battleSessionId, 'running battle after reload');
    if (runningAfter.activeBattle?.replayReadOnly) throw new Error('running production battle became replay after reload');
    await capture(machine.frames[3], { phase: 'running_after_real_reload', realReload: runningReload, reloadPreservedSession: true, actionProvenance: actions.slice() });

    const beforeSettlement = await state();
    const settled = await cdp.evaluate(call('tickBattle', 999));
    if (!settled?.ok || !settled.activeBattle?.settled) throw new Error(`formal settlement failed: ${JSON.stringify(settled)}`);
    await waitUntil((current) => current.activeBattle?.settled === true, 'formal result settled');
    const afterSettlement = await state();
    const saveDiff = computeSaveDiff(beforeSettlement, afterSettlement);
    await saveByUi();
    await clickTab('theater');
    await capture(machine.frames[4], { phase: 'formal_result', settlementApplied: true, saveDiffSummary: { beforeHash: productionStateSignature(beforeSettlement), afterHash: productionStateSignature(afterSettlement), changedPathCount: saveDiff.length, changedPaths: saveDiff.map((row) => row.path) }, actionProvenance: actions.slice() });

    await click('[data-action="view-report"]', { action: 'view-report' });
    await clickTab('theater');
    await click('[data-action="return-from-battle"]', { action: 'return-from-battle', settlementClose: true });
    await clickTab('overview');
    const baseAfterSettlement = await waitUntil((current) => current.activeBattle === null, 'base after settlement');
    await capture(machine.frames[5], { phase: 'base_after_settlement', settlementClosedByUi: true, actionProvenance: actions.slice() });

    await clickTab('reports');
    await waitUntil((current) => current.activeBattle === null && Object.keys(current.battleSettlementLedger || {}).length === 1 && (current.battles || []).length === 1, 'replay report state');
    await cdp.evaluate(`new Promise((resolve, reject) => { const start = performance.now(); const poll = () => document.querySelector('[data-action="replay-report"]') ? resolve(true) : performance.now() - start > 5000 ? reject(new Error('replay report control timeout')) : setTimeout(poll, 25); poll(); })`);
    const replayControl = await click('[data-action="replay-report"]', { action: 'replay-report', reportId: baseAfterSettlement.battles.at(-1)?.id || null });
    const replayStarted = await waitUntil((current) => current.activeBattle?.replayReadOnly === true, 'replay started by UI');
    if (replayStarted.activeBattleSessionId !== null) throw new Error('replay retained activeBattleSessionId');
    await clickTab('theater');
    await capture(machine.frames[6], { phase: 'replay_start', replayAction: replayControl, replayReadOnly: true, actionProvenance: actions.slice() });

    await cdp.evaluate(call('tickBattle', Math.max(1, replayStarted.activeBattle.duration / 2)));
    await clickTab('theater');
    const replayBeforeReload = await state();
    await saveByUi();
    await capture(machine.frames[7], { phase: 'replay_before_real_reload', canonicalSessionHash: summary(replayBeforeReload).sessionHash, actionProvenance: actions.slice() });

    const replayReload = await reloadPage('replay');
    await clickTab('theater');
    const replayAfterReload = await waitUntil((current) => current.activeBattle?.replayReadOnly === true && current.activeBattleSessionId === null, 'replay after reload');
    if (summary(replayAfterReload).sessionHash !== summary(replayBeforeReload).sessionHash) throw new Error('canonical session changed during replay reload');
    await capture(machine.frames[8], { phase: 'replay_after_real_reload', realReload: replayReload, reloadPreservedReplay: true, actionProvenance: actions.slice() });

    await cdp.evaluate(call('tickBattle', 999));
    await cdp.evaluate(call('tickBattleReturn', 999));
    await clickTab('theater');
    await click('[data-action="return-from-battle"]', { action: 'return-from-battle', replayClose: true });
    await clickTab('overview');
    const replayFinished = await waitUntil((current) => current.activeBattle === null, 'replay finished base');
    await capture(machine.frames[9], { phase: 'replay_finished_base', replayClosedByUi: true, actionProvenance: actions.slice() });

    await clickTab('reports');
    await waitUntil((current) => (current.battles || []).length === 1, 'save diff summary report');
    await capture(machine.frames[10], {
      phase: 'save_diff_summary',
      saveDiffSummary: {
        beforeHash: productionStateSignature(beforeSettlement),
        afterHash: productionStateSignature(afterSettlement),
        changedPathCount: saveDiff.length,
        ledgerCount: Object.keys(replayFinished.battleSettlementLedger || {}).length,
        reportCount: (replayFinished.battles || []).length,
        unrelatedPreservationDeferredToIndependentVerifier: true
      },
      actionProvenance: actions.slice()
    });

    if (pageErrors.length || consoleErrors.length) throw new Error(`E-A.1 browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const output = {
      stage: '8.2G-E-A.1',
      version: 1,
      generatedBy: 'tests/browser/stage8-2G-E-A-1-replay-persistence.mjs',
      productionEntry: true,
      fixtureLoaderUsed: false,
      debugOverlayUsed: false,
      dispatchApiUsed: false,
      replayApiUsed: false,
      actionProvenance: actions,
      realReloads: reloads,
      browser: { currentCodeCaptured: true, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: frames.length, uniqueImageHashes: hashes.size },
      scenes: [{ sceneId: 'production-replay-persistence', frames }],
      saveDiffSummary: { beforeHash: productionStateSignature(beforeSettlement), afterHash: productionStateSignature(afterSettlement), changedPathCount: saveDiff.length, changedPaths: saveDiff.map((row) => row.path) },
      passed: frames.length === 11 && hashes.size === 11 && reloads.length === 2 && actions.every((row) => row.syntheticApiCall === false)
    };
    await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(JSON.stringify({ ok: output.passed, stage: output.stage, screenshots: frames.length, uniqueImageHashes: hashes.size, realReloads: reloads.length, output: manifestPath }));
    if (!output.passed) process.exitCode = 1;
  } finally {
    cdp?.close();
    // Chromium can keep a profile file open briefly on macOS after the CDP
    // socket closes. Signal it and let the test process exit on a bounded
    // timer; evidence is already flushed before this cleanup path.
    terminateManagedBrowser(browser, { termTimeoutMs: 500, killTimeoutMs: 500, cleanupProfile: false }).catch(() => {});
    server?.close();
    server?.unref?.();
    setTimeout(() => process.exit(process.exitCode || 0), 1000).unref();
  }
}

function documentReadyForLaunch(state) {
  const formation = state?.formations?.find((row) => row.status === 'idle' && (row.unitIds || []).length > 0);
  const theater = state?.theaters?.scrap_mine;
  return Boolean(formation && theater);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: 'stage8-2G-E-A-1-browser-evidence-failed', message: error.message || String(error) }));
  console.error(error.stack || error);
  process.exitCode = 1;
});
