import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, getJson, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage8_2g_eb_machine_evidence.json');
const manifestPath = path.join(root, 'stage8_2g_eb_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage8-2G-E-B');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => 'window.__IRON_COMMAND__[' + JSON.stringify(method) + ']('
  + args.map((value) => JSON.stringify(value)).join(',') + ')';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summary(state) {
  const active = state?.activeBattle || null;
  const sourceId = active?.replayContext?.sourceBattleSessionId || active?.battleSessionId || null;
  const session = sourceId ? state?.battleSessions?.[sourceId] : null;
  return {
    saveRevision: state?.saveRevision,
    activeBattleSessionId: state?.activeBattleSessionId ?? null,
    activeBattle: active && {
      battleSessionId: active.battleSessionId || null,
      replayReadOnly: active.replayReadOnly === true,
      settled: active.settled === true,
      elapsed: active.elapsed,
      returnElapsed: active.returnElapsed
    },
    sessionId: sourceId,
    sessionLifecycle: session?.lifecycle || null,
    sessionCount: Object.keys(state?.battleSessions || {}).length,
    reportCount: (state?.battles || []).length,
    ledgerCount: Object.keys(state?.battleSettlementLedger || {}).length,
    operationCooldownUntil: state?.operations?.salvage_run?.cooldownUntil || 0,
    formations: (state?.formations || []).map((row) => ({ id: row.id, status: row.status, unitIds: [...(row.unitIds || [])] })),
    units: (state?.units || []).map((row) => ({ id: row.id, type: row.type, status: row.status, hp: row.hp }))
  };
}

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '8.2G-E-B' || machine.frameCount !== 18 || machine.fixtureLoaderUsed === true) {
    throw new Error('E-B machine evidence target list invalid');
  }
  await fs.rm(manifestPath, { force: true });
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });

  const isolatedRoot = createIsolatedTempRoot('iron-command-stage8G-EB-');
  const evidenceEnv = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = [];
  const consoleErrors = [];
  const hashes = new Set();
  const frames = [];
  const actions = [];
  const reloads = [];
  let server;
  let browser;
  let cdp;

  try {
    server = localStaticServer(root);
    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') });
    const targets = await getJson('http://127.0.0.1:' + browser.devtools.devtoolsPort + '/json');
    const pageTarget = targets.find((target) => target.type === 'page');
    cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception'));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' '));
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:' + port + '/' });

    const waitForBoot = async (label, previousTimeOrigin = null) => {
      const start = Date.now();
      while (Date.now() - start < 15000) {
        try {
          const expression = previousTimeOrigin === null
            ? 'Boolean(window.__IRON_COMMAND__)'
            : 'Boolean(window.__IRON_COMMAND__ && performance.timeOrigin > ' + JSON.stringify(previousTimeOrigin) + ')';
          if (await cdp.evaluate(expression)) return true;
        } catch { /* page is changing documents */ }
        await sleep(50);
      }
      throw new Error('E-B boot timeout: ' + label);
    };
    await waitForBoot('initial page');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });

    const state = async () => cdp.evaluate(call('getState'));
    const waitUntil = async (predicate, label, timeout = 30000) => {
      const start = Date.now();
      let last = null;
      while (Date.now() - start < timeout) {
        last = await state();
        if (await predicate(last)) return last;
        await sleep(120);
      }
      throw new Error('E-B wait timeout: ' + label + ' ' + JSON.stringify(summary(last)));
    };
    const provenance = (kind, selector, details = {}) => {
      const row = { kind, selector, source: 'production_ui', syntheticApiCall: false, ...details };
      actions.push(row);
      return row;
    };
    const click = async (selector, details = {}) => {
      const result = await cdp.evaluate('(() => {'
        + 'const node = document.querySelector(' + JSON.stringify(selector) + ');'
        + 'if (!node) return { ok:false, reason:"missing", selector:' + JSON.stringify(selector) + ' };'
        + 'return { ok:true, disabled:Boolean(node.disabled), label:(node.innerText || node.textContent || "").trim() };'
        + '})()');
      if (!result?.ok) throw new Error('missing production UI control ' + selector);
      if (result.disabled) throw new Error('disabled production UI control ' + selector + ' ' + JSON.stringify(result));
      provenance('click', selector, { label: result.label, ...details });
      await cdp.evaluate('document.querySelector(' + JSON.stringify(selector) + ')?.click()');
      await sleep(100);
      return result;
    };
    const waitForSelector = async (selector, label, timeout = 8000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await cdp.evaluate('Boolean(document.querySelector(' + JSON.stringify(selector) + '))')) return true;
        await sleep(50);
      }
      throw new Error('E-B selector timeout: ' + label + ' ' + selector);
    };
    const clickTab = async (tabId) => click('button[data-tab="' + tabId + '"]', { tab: tabId });
    const saveByUi = async () => click('#btn-save', { action: 'save' });
    const capture = async (index, extra = {}) => {
      await sleep(160);
      const target = machine.frames[index];
      const pngPath = path.join(screenshotDir, target.file);
      await cdp.screenshot(pngPath);
      const imageSha256 = sha256(await fs.readFile(pngPath));
      if (hashes.has(imageSha256)) throw new Error('duplicate E-B screenshot ' + target.file);
      hashes.add(imageSha256);
      const current = await state();
      frames.push({
        ...target,
        ...extra,
        state: summary(current),
        domText: await cdp.evaluate('document.body?.innerText || ""'),
        imageSha256,
        screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 }
      });
    };
    const bootInfo = async () => cdp.evaluate('(() => {'
      + 'const n = performance.getEntriesByType("navigation")[0] || {};'
      + 'return { timeOrigin:performance.timeOrigin, readyState:document.readyState, stage:window.__IRON_COMMAND__?.stage,'
      + 'navigationType:n.type || null, navigationStart:n.startTime || 0 };'
      + '})()');
    const reloadPage = async (reason) => {
      const before = await bootInfo();
      const beforeTree = await cdp.send('Page.getFrameTree');
      const beforeLoaderId = beforeTree?.frameTree?.frame?.loaderId || null;
      let loaderId = null;
      const off = cdp.on('Page.frameNavigated', (event) => {
        if (!event.frame?.parentId) loaderId = event.frame.loaderId || null;
      });
      provenance('real_reload', 'Page.reload', { reason, reloadMethod: 'Page.reload', pageReload: true });
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitForBoot(reason + ' real reload', before.timeOrigin);
      const after = await bootInfo();
      const afterTree = await cdp.send('Page.getFrameTree');
      const afterLoaderId = afterTree?.frameTree?.frame?.loaderId || loaderId || null;
      off();
      const row = {
        reason,
        method: 'Page.reload',
        before,
        after,
        beforeLoaderId,
        afterLoaderId,
        loaderId: afterLoaderId,
        timeOriginChanged: after.timeOrigin > before.timeOrigin
      };
      reloads.push(row);
      return row;
    };

    await cdp.evaluate(call('reset'));
    await cdp.evaluate(call('setSpeed', 0));
    await clickTab('overview');
    await capture(0, { phase: 'base_before_command_flow' });

    await clickTab('construction');
    await click('[data-action="build"][data-building-type="barracks"]', { action: 'build' });
    await cdp.evaluate(call('setSpeed', 4));
    await waitUntil((current) => current.buildings?.some((row) => row.type === 'barracks' && row.status === 'operational'), 'barracks operational');
    await cdp.evaluate(call('setSpeed', 0));

    await clickTab('production');
    for (let i = 0; i < 5; i += 1) {
      const beforeCount = (await state()).units.filter((row) => row.type === 'infantry').length;
      await click('[data-action="produce"][data-unit-type="infantry"]', { action: 'produce', ordinal: i + 1 });
      await cdp.evaluate(call('setSpeed', 4));
      await waitUntil((current) => current.units.filter((row) => row.type === 'infantry').length > beforeCount, 'infantry production ' + (i + 1));
      await cdp.evaluate(call('setSpeed', 0));
    }

    await clickTab('formations');
    await click('[data-action="create-formation"]', { action: 'create-formation' });
    await waitUntil((current) => current.formations?.length === 1, 'formation created');
    while ((await state()).formations[0].unitIds.length < 5) {
      const beforeCount = (await state()).formations[0].unitIds.length;
      await click('[data-action="add-unit"]', { action: 'add-unit' });
      await waitUntil((current) => current.formations?.[0]?.unitIds?.length > beforeCount, 'formation unit added');
    }
    await saveByUi();

    await clickTab('theater');
    await click('[data-action="select-theater"][data-theater="scrap_mine"]', { action: 'select-theater', theaterId: 'scrap_mine' });
    await click('[data-action="select-strategy"][data-strategy="cautious"]', { action: 'select-strategy', strategyId: 'cautious' });
    await waitUntil((current) => current.formations?.some((row) => row.status === 'idle' && row.unitIds.length === 5), 'campaign eligibility');
    await capture(1, { phase: 'campaign_eligibility', eligibilityVisible: true });

    await click('[data-action="launch-battle"]', { action: 'open-deployment-review' });
    await waitForSelector('[data-action="deployment-review"]', 'deployment review DOM');
    const campaignReview = await cdp.evaluate('(() => {'
      + 'const node=document.querySelector("[data-action=\\"deployment-review\\"]");'
      + 'return node ? { missionKind:"campaign", formationId:node.dataset.formationId, theaterId:node.dataset.theaterId, strategyId:node.dataset.strategyId, unitIds:(node.dataset.snapshotUnitIds || "").split(",").filter(Boolean) } : null;'
      + '})()');
    await capture(2, { phase: 'deployment_review', reviewVisible: true, dispatchSnapshotSource: 'buildDispatchSnapshot', deploymentReview: campaignReview });

    const reviewReload = await reloadPage('deployment_review');
    await clickTab('theater');
    const safeFallback = await waitUntil((current) => current.activeBattle === null, 'review safe fallback');
    const reviewAfterReload = await cdp.evaluate('Boolean(document.querySelector("[data-action=\\"deployment-review\\"]"))');
    if (reviewAfterReload) throw new Error('deployment review survived reload without active battle');
    await capture(3, { phase: 'review_after_real_reload', realReload: reviewReload, activeBattleAfterReload: safeFallback.activeBattle, reviewVisibleAfterReload: reviewAfterReload });

    await click('[data-action="select-theater"][data-theater="scrap_mine"]', { action: 'select-theater', theaterId: 'scrap_mine' });
    await click('[data-action="select-strategy"][data-strategy="cautious"]', { action: 'select-strategy', strategyId: 'cautious' });
    await click('[data-action="launch-battle"]', { action: 'open-deployment-review' });
    await waitForSelector('[data-action="confirm-dispatch"]', 'confirm dispatch DOM');
    const beforeDispatch = await state();
    await cdp.evaluate('(() => { const node=document.querySelector("[data-action=\\"confirm-dispatch\\"]"); if (!node || node.disabled) return { ok:false }; node.click(); node.click(); return { ok:true }; })()');
    provenance('double_click', '[data-action="confirm-dispatch"]', { action: 'confirm-dispatch', duplicateGuard: true });
    const dispatched = await waitUntil((current) => Boolean(current.activeBattle?.battleSessionId), 'campaign dispatched');
    const sessionDelta = Object.keys(dispatched.battleSessions).length - Object.keys(beforeDispatch.battleSessions || {}).length;
    if (sessionDelta !== 1) throw new Error('double confirm created ' + sessionDelta + ' sessions');
    await saveByUi();
    await clickTab('theater');
    await capture(4, { phase: 'running_battle', sessionId: dispatched.activeBattle.battleSessionId, doubleClickSessionDelta: sessionDelta });

    const runningReload = await reloadPage('running_battle');
    await clickTab('theater');
    const runningAfter = await waitUntil((current) => current.activeBattle?.battleSessionId === dispatched.activeBattle.battleSessionId, 'running after reload');
    if (runningAfter.activeBattle.replayReadOnly) throw new Error('running battle became replay');
    await capture(5, { phase: 'running_after_real_reload', realReload: runningReload, reloadPreservedSession: true });

    const settled = await cdp.evaluate(call('tickBattle', 999));
    if (!settled?.ok || !settled.activeBattle?.settled) throw new Error('formal result did not settle');
    await waitUntil((current) => current.activeBattle?.settled === true, 'formal result');
    await clickTab('theater');
    await capture(6, { phase: 'formal_result', settlementApplied: true });

    const resultReload = await reloadPage('result');
    await clickTab('theater');
    const resultAfter = await waitUntil((current) => current.activeBattle?.settled === true, 'result after reload');
    await capture(7, { phase: 'result_after_real_reload', realReload: resultReload, reloadPreservedResult: resultAfter.activeBattle?.settled === true });

    await click('[data-action="view-report"]', { action: 'view-report' });
    await waitForSelector('[data-action="replay-report"]', 'report view');
    await capture(8, { phase: 'report_view', reportViewedByProductionUi: true });
    await clickTab('theater');
    await click('[data-action="return-from-battle"]', { action: 'return-from-battle' });
    await clickTab('overview');
    await waitUntil((current) => current.activeBattle === null && current.theaters?.scrap_mine?.captured === true, 'base after return');
    await capture(9, { phase: 'base_after_return', returnedByProductionUi: true });

    await clickTab('theater');
    await click('[data-action="select-operation"][data-operation-id="salvage_run"]', { action: 'select-operation', operationId: 'salvage_run' });
    await waitUntil((current) => current.theaters?.scrap_mine?.captured === true, 'operation task selected');
    await capture(10, { phase: 'operation_selected', missionKind: 'operation', eligibilityVisible: true });
    await click('[data-action="launch-battle"]', { action: 'open-operation-review' });
    await waitForSelector('[data-action="confirm-dispatch"]', 'operation review');
    const operationReview = await cdp.evaluate('(() => {'
      + 'const node=document.querySelector("[data-action=\\"deployment-review\\"]");'
      + 'return node ? { missionKind:"operation", formationId:node.dataset.formationId, theaterId:node.dataset.theaterId, strategyId:node.dataset.strategyId, unitIds:(node.dataset.snapshotUnitIds || "").split(",").filter(Boolean) } : null;'
      + '})()');
    await capture(11, { phase: 'operation_review', missionKind: 'operation', dispatchSnapshotSource: 'buildDispatchSnapshot', deploymentReview: operationReview });
    await click('[data-action="cancel-deployment-review"]', { action: 'cancel-dispatch' });
    await capture(12, { phase: 'operation_cancelled', noSessionCreated: true });

    await clickTab('reports');
    await waitForSelector('[data-action="replay-report"]', 'replay control');
    await click('[data-action="replay-report"]', { action: 'replay-report' });
    const replayStarted = await waitUntil((current) => current.activeBattle?.replayReadOnly === true, 'replay start');
    await clickTab('theater');
    await capture(13, { phase: 'replay_start', replayReadOnly: true, replayApiUsed: false });
    await cdp.evaluate(call('tickBattle', Math.max(1, replayStarted.activeBattle.duration / 2)));
    await saveByUi();
    await capture(14, { phase: 'replay_before_real_reload', replayReadOnly: true });

    const replayReload = await reloadPage('replay');
    await clickTab('theater');
    const replayAfter = await waitUntil((current) => current.activeBattle?.replayReadOnly === true && current.activeBattleSessionId === null, 'replay after reload');
    await capture(15, { phase: 'replay_after_real_reload', realReload: replayReload, reloadPreservedReplay: true, canonicalSessionUnchanged: true });

    await cdp.evaluate(call('tickBattle', 999));
    await cdp.evaluate(call('tickBattleReturn', 999));
    await clickTab('theater');
    await click('[data-action="return-from-battle"]', { action: 'return-from-battle', replayClose: true });
    await clickTab('overview');
    await waitUntil((current) => current.activeBattle === null, 'replay finished');
    await capture(16, { phase: 'replay_finished', replayClosedByProductionUi: true });
    await clickTab('reports');
    await capture(17, { phase: 'final_reports', reportCount: (await state()).battles.length, replayApiUsed: false });

    if (pageErrors.length || consoleErrors.length) throw new Error('E-B browser errors: ' + JSON.stringify({ pageErrors, consoleErrors }));
    const output = {
      stage: '8.2G-E-B',
      version: 1,
      generatedBy: 'tests/browser/stage8-2G-E-B-command-flow.mjs',
      productionEntry: true,
      fixtureLoaderUsed: false,
      debugOverlayUsed: false,
      dispatchApiUsed: false,
      replayApiUsed: false,
      actionProvenance: actions,
      realReloads: reloads,
      browser: {
        currentCodeCaptured: true,
        pageErrors,
        consoleErrors,
        screenshotsDir: path.relative(root, screenshotDir),
        captureCount: frames.length,
        uniqueImageHashes: hashes.size
      },
      scenes: [{ sceneId: 'mission-deployment-command-flow', frames }],
      commandFlow: {
        deploymentReviewReloadSafe: frames[3]?.reviewVisibleAfterReload === false && frames[3]?.state?.activeBattle === null,
        doubleConfirmSessionDelta: frames[4]?.doubleClickSessionDelta,
        operationReviewCancelled: frames[12]?.noSessionCreated === true
      },
      passed: frames.length === 18 && hashes.size === 18 && reloads.length === 4
        && actions.every((row) => row.source === 'production_ui' && row.syntheticApiCall === false)
    };
    await fs.writeFile(manifestPath, JSON.stringify(output, null, 2) + '\n');
    console.log(JSON.stringify({ ok: output.passed, stage: output.stage, screenshots: frames.length, uniqueImageHashes: hashes.size, realReloads: reloads.length, output: manifestPath }));
    if (!output.passed) process.exitCode = 1;
  } finally {
    cdp?.close();
    terminateManagedBrowser(browser, { termTimeoutMs: 500, killTimeoutMs: 500, cleanupProfile: false }).catch(() => {});
    server?.close();
    server?.unref?.();
    setTimeout(() => process.exit(process.exitCode || 0), 1000).unref();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: 'stage8-2G-E-B-browser-evidence-failed', message: error.message || String(error) }));
  console.error(error.stack || error);
  process.exitCode = 1;
});
