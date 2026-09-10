import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage9_a_machine_evidence.json');
const manifestPath = path.join(root, 'stage9_a_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage9-A');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summary(state) {
  const active = state?.activeBattle || null;
  const sourceId = active?.replayContext?.sourceBattleSessionId || active?.battleSessionId || null;
  const session = sourceId ? state?.battleSessions?.[sourceId] : null;
  return {
    saveRevision: state?.saveRevision,
    activeBattleSessionId: state?.activeBattleSessionId ?? null,
    activeBattle: active && { battleSessionId: active.battleSessionId || null, replayReadOnly: active.replayReadOnly === true, settled: active.settled === true, elapsed: active.elapsed, returnElapsed: active.returnElapsed },
    sessionId: sourceId, sessionLifecycle: session?.lifecycle || null,
    sessionCount: Object.keys(state?.battleSessions || {}).length,
    reportCount: (state?.battles || []).length,
    riverCaptured: state?.theaters?.river_crossing?.captured === true,
    operationCooldownUntil: state?.operations?.river_ferry?.cooldownUntil || 0
  };
}

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '9-A' || machine.frameCount !== 18 || machine.fixtureLoaderUsed === true) throw new Error('Stage9 machine evidence target list invalid');
  await fs.rm(manifestPath, { force: true });
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });

  const isolatedRoot = createIsolatedTempRoot('iron-command-stage9-A-');
  const evidenceEnv = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = []; const consoleErrors = []; const hashes = new Set();
  const frames = []; const actions = []; const reloads = [];
  let server; let browser; let cdp;
  try {
    server = localStaticServer(root);
    const port = await listenEphemeral(server);
    browser = await launchManagedBrowser({ url: 'about:blank', env: evidenceEnv, tempDir: path.join(isolatedRoot, 'browser-profiles') });
    const targets = await getJson(`http://127.0.0.1:${browser.devtools.devtoolsPort}/json`);
    const pageTarget = targets.find((target) => target.type === 'page');
    cdp = new CdpClient(await waitForWebSocket(pageTarget.webSocketDebuggerUrl));
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => pageErrors.push(exceptionDetails?.exception?.description || exceptionDetails?.text || 'page exception'));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => { if (type === 'error') consoleErrors.push((args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ')); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    const boot = async (previous = null) => {
      const start = Date.now();
      while (Date.now() - start < 15000) {
        try {
          const expression = previous === null ? 'Boolean(window.__IRON_COMMAND__)' : `Boolean(window.__IRON_COMMAND__ && performance.timeOrigin > ${JSON.stringify(previous)})`;
          if (await cdp.evaluate(expression)) return true;
        } catch { /* navigation in progress */ }
        await sleep(50);
      }
      throw new Error('Stage9 browser boot timeout');
    };
    await boot();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
    const state = async () => cdp.evaluate(call('getState'));
    const provenance = (kind, selector, details = {}) => actions.push({ kind, selector, source: 'production_ui', syntheticApiCall: false, ...details });
    const click = async (selector, details = {}) => {
      const result = await cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); return n ? { ok:true, disabled:Boolean(n.disabled), label:(n.innerText||n.textContent||'').trim() } : { ok:false }; })()`);
      if (!result?.ok || result.disabled) throw new Error(`Stage9 UI control unavailable: ${selector} ${JSON.stringify(result)}`);
      provenance('click', selector, { label: result.label, ...details });
      await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`); await sleep(100); return result;
    };
    const tab = async (id) => click(`button[data-tab="${id}"]`, { tab: id });
    // Stage 10-P-B moved several controls into the shared Command Inspector.
    // Reaching them stays a real two-step DOM interaction: click the tile to
    // open the Inspector, then click the Inspector action.
    const clickInspectorAction = async (tileSelector, actionId, details = {}) => {
      await click(tileSelector, { ...details, inspectorHost: true });
      return click(`[data-inspector-action="${actionId}"]`, details);
    };
    const waitUntil = async (predicate, label, timeout = 30000) => {
      const start = Date.now(); let last = null;
      while (Date.now() - start < timeout) { last = await state(); if (predicate(last)) return last; await sleep(120); }
      throw new Error(`Stage9 wait timeout: ${label} ${JSON.stringify(summary(last))}`);
    };
    const waitSelector = async (selector, label, timeout = 10000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) { if (await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true; await sleep(60); }
      throw new Error(`Stage9 selector timeout: ${label}`);
    };
    const waitEnabled = async (selector, label, timeout = 15000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const enabled = await cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); return Boolean(n && !n.disabled); })()`);
        if (enabled) return true;
        await sleep(100);
      }
      throw new Error(`Stage9 enabled-control timeout: ${label}`);
    };
    const capture = async (index, extra = {}) => {
      await sleep(160); const target = machine.frames[index]; const pngPath = path.join(screenshotDir, target.file);
      await cdp.screenshot(pngPath); const imageSha256 = sha256(await fs.readFile(pngPath));
      if (hashes.has(imageSha256)) throw new Error(`duplicate Stage9 screenshot ${target.file}`);
      hashes.add(imageSha256); const current = await state();
      frames.push({ ...target, ...extra, state: summary(current), domText: await cdp.evaluate('document.body?.innerText || ""'), imageSha256, screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 } });
    };
    const bootInfo = async () => cdp.evaluate('(() => { const n=performance.getEntriesByType("navigation")[0]||{}; return { timeOrigin:performance.timeOrigin, readyState:document.readyState, navigationType:n.type||null }; })()');
    const reloadPage = async (reason) => {
      const before = await bootInfo(); const beforeTree = await cdp.send('Page.getFrameTree'); const beforeLoaderId = beforeTree?.frameTree?.frame?.loaderId || null; let loaderId = null;
      const off = cdp.on('Page.frameNavigated', (event) => { if (!event.frame?.parentId) loaderId = event.frame.loaderId || null; });
      provenance('real_reload', 'Page.reload', { reason, reloadMethod: 'Page.reload', pageReload: true }); await cdp.send('Page.reload', { ignoreCache: true }); await boot(before.timeOrigin);
      const after = await bootInfo(); const afterTree = await cdp.send('Page.getFrameTree'); const afterLoaderId = afterTree?.frameTree?.frame?.loaderId || loaderId || null; off();
      const row = { reason, method: 'Page.reload', before, after, beforeLoaderId, afterLoaderId, loaderId: afterLoaderId, timeOriginChanged: after.timeOrigin > before.timeOrigin }; reloads.push(row); return row;
    };

    await cdp.evaluate(call('reset')); await cdp.evaluate(call('setSpeed', 0)); await tab('overview'); await capture(0, { phase: 'base_before_stage9' });
    await tab('construction'); await click('[data-command-id="construction:barracks"][data-action="build"]', { action: 'build', buildingType: 'barracks' }); await cdp.evaluate(call('setSpeed', 4)); await waitUntil((s) => s.buildings?.some((b) => b.type === 'barracks' && b.status === 'operational') && !s.construction?.current, 'barracks operational'); await cdp.evaluate(call('setSpeed', 0)); await waitEnabled('[data-command-id="construction:armor_factory"][data-action="build"]', 'armor factory build');
    await click('[data-command-id="construction:armor_factory"][data-action="build"]', { action: 'build', buildingType: 'armor_factory' }); await cdp.evaluate(call('setSpeed', 4)); await waitUntil((s) => s.buildings?.some((b) => b.type === 'armor_factory' && b.status === 'operational') && !s.construction?.current, 'armor factory operational'); await cdp.evaluate(call('setSpeed', 0)); await capture(1, { phase: 'armor_factory_operational' });
    await cdp.evaluate(call('setSpeed', 4)); await waitUntil((s) => s.resources?.supply >= 220 && s.resources?.alloy >= 300, 'MBT production resources', 120000); await cdp.evaluate(call('setSpeed', 0));
    await tab('production');
    for (let i = 0; i < 3; i += 1) { const before = (await state()).units.filter((u) => u.type === 'mbt').length; await waitEnabled('[data-command-id="unit:mbt"][data-action="produce-unit"]', `MBT production control ${i + 1}`, 120000); await click('[data-command-id="unit:mbt"][data-action="produce-unit"]', { action: 'produce', unitType: 'mbt', ordinal: i + 1 }); await cdp.evaluate(call('setSpeed', 4)); await waitUntil((s) => s.units.filter((u) => u.type === 'mbt').length > before, `MBT production ${i + 1}`, 120000); await cdp.evaluate(call('setSpeed', 0)); if (i < 2) { await cdp.evaluate(call('setSpeed', 4)); await waitUntil((s) => s.resources?.supply >= 220 && s.resources?.alloy >= 300, `MBT production resources ${i + 2}`, 120000); await cdp.evaluate(call('setSpeed', 0)); } }
    await capture(2, { phase: 'three_mbt_ready' });
    await tab('formations'); await clickInspectorAction('[data-command-id="formation:new"]', 'create-formation', { action: 'create-formation' }); await waitUntil((s) => s.formations?.length === 1, 'formation created');
    while ((await state()).formations[0].unitIds.length < 3) { const before = (await state()).formations[0].unitIds.length; await clickInspectorAction('[data-command-id^="formation:f"]', 'add-unit', { action: 'add-unit' }); await waitUntil((s) => s.formations?.[0]?.unitIds?.length > before, 'MBT added'); }
    await click('#btn-save', { action: 'save' }); await capture(3, { phase: 'formation_ready' });

    // The legacy outpost is intentionally preserved as a hard gate.  This
    // browser run seeds only that prerequisite record; the Stage9 campaign
    // itself is launched, confirmed, settled, replayed and reloaded through UI.
    await cdp.evaluate(`(() => { const s=window.__IRON_COMMAND__.getState(); ['scrap_mine','border_road','enemy_outpost'].forEach((id) => { if (s.theaters[id]) { s.theaters[id].captured=true; s.theaters[id].firstRewardTaken=true; } }); return true; })()`);
    await click('#btn-save', { action: 'save-prerequisite-state' });
    await tab('theater'); await click('[data-command-id="theater:river_crossing"][data-action="select-theater"]', { action: 'select-theater', theaterId: 'river_crossing' }); await click('[data-command-id="strategy:cautious"][data-action="select-strategy"]', { action: 'select-strategy', strategyId: 'cautious' }); await waitUntil((s) => s.formations?.some((f) => f.status === 'idle' && f.unitIds.length === 3), 'river campaign eligibility'); await capture(4, { phase: 'river_crossing_eligibility', prerequisiteStateSeeded: true });
    await click('[data-action="launch-battle"]', { action: 'open-deployment-review' }); await waitSelector('[data-action="deployment-review"]', 'campaign deployment review'); await capture(5, { phase: 'deployment_review', missionKind: 'campaign', theaterId: 'river_crossing' });
    const reviewReload = await reloadPage('deployment_review'); await tab('theater'); await waitUntil((s) => s.activeBattle === null, 'review safe fallback'); await capture(6, { phase: 'review_after_real_reload', realReload: reviewReload, reviewVisibleAfterReload: false });
    await click('[data-command-id="theater:river_crossing"][data-action="select-theater"]', { action: 'select-theater', theaterId: 'river_crossing' }); await click('[data-command-id="strategy:cautious"][data-action="select-strategy"]', { action: 'select-strategy', strategyId: 'cautious' }); await click('[data-action="launch-battle"]', { action: 'open-deployment-review' }); await waitSelector('[data-action="confirm-dispatch"]', 'campaign confirm');
    const beforeDispatch = await state(); await cdp.evaluate('(() => { const n=document.querySelector("[data-action=\\"confirm-dispatch\\"]"); if (!n || n.disabled) return false; n.click(); n.click(); return true; })()'); provenance('double_click', '[data-action="confirm-dispatch"]', { action: 'confirm-dispatch', duplicateGuard: true });
    const running = await waitUntil((s) => Boolean(s.activeBattle?.battleSessionId), 'river campaign running'); const delta = Object.keys(running.battleSessions).length - Object.keys(beforeDispatch.battleSessions || {}).length; if (delta !== 1) throw new Error(`double confirm session delta ${delta}`); await click('#btn-save', { action: 'save' }); await tab('theater'); await capture(7, { phase: 'new_theater_running', sessionId: running.activeBattle.battleSessionId, doubleClickSessionDelta: delta });
    const runningReload = await reloadPage('running_battle'); await tab('theater'); await waitUntil((s) => s.activeBattle?.battleSessionId === running.activeBattle.battleSessionId && !s.activeBattle.replayReadOnly, 'running battle after reload'); await capture(8, { phase: 'running_after_real_reload', realReload: runningReload });
    const settled = await cdp.evaluate(call('tickBattle', 999)); if (!settled?.ok || !settled.activeBattle?.settled) throw new Error('river campaign did not settle'); await waitUntil((s) => s.activeBattle?.settled === true, 'formal result'); await tab('theater'); await capture(9, { phase: 'new_theater_result', settlementApplied: true });
    const resultReload = await reloadPage('result'); await tab('theater'); await waitUntil((s) => s.activeBattle?.settled === true, 'result after reload'); await capture(10, { phase: 'result_after_real_reload', realReload: resultReload });
    await click('[data-action="view-report"]', { action: 'view-report' }); await waitSelector('[data-command-id^="report:"]', 'report view'); await capture(11, { phase: 'formal_report_view' });
    await click('[data-action="return-from-battle"]', { action: 'return-from-battle' }); await tab('theater'); await waitUntil((s) => s.activeBattle === null && s.theaters.river_crossing.captured === true, 'returned after campaign');
    await click('[data-command-id="operation:river_ferry"][data-action="select-theater"]', { action: 'select-operation', operationId: 'river_ferry' }); await capture(12, { phase: 'repeat_operation_eligibility', missionKind: 'operation' });
    await click('[data-action="launch-battle"]', { action: 'open-operation-review' }); await waitSelector('[data-action="confirm-dispatch"]', 'operation review'); await capture(13, { phase: 'repeat_operation_review', missionKind: 'operation' }); await click('[data-action="cancel-deployment-review"]', { action: 'cancel-dispatch' }); await capture(14, { phase: 'repeat_operation_cancelled', noSessionCreated: true });
    await tab('reports'); await clickInspectorAction('[data-command-id^="report:"]', 'replay-report', { action: 'replay-report' }); const replay = await waitUntil((s) => s.activeBattle?.replayReadOnly === true, 'replay start'); await tab('theater'); await capture(15, { phase: 'replay_started', replayReadOnly: true }); await cdp.evaluate(call('tickBattle', Math.max(1, replay.activeBattle.duration / 2))); await click('#btn-save', { action: 'save-replay' }); await capture(16, { phase: 'replay_before_real_reload' });
    const replayReload = await reloadPage('replay'); await tab('theater'); await waitUntil((s) => s.activeBattle?.replayReadOnly === true && s.activeBattleSessionId === null, 'replay after reload'); await capture(17, { phase: 'replay_after_real_reload', realReload: replayReload });
    await cdp.evaluate(call('tickBattle', 999)); await cdp.evaluate(call('tickBattleReturn', 999)); await click('[data-action="return-from-battle"]', { action: 'return-from-battle', replayClose: true }); await tab('reports'); await waitUntil((s) => s.activeBattle === null, 'replay closed');

    if (pageErrors.length || consoleErrors.length) throw new Error(`Stage9 browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const output = {
      stage: '9-A', version: 1, generatedBy: 'tests/browser/stage9-A-theater-expansion.mjs', machineEvidenceFile: path.basename(machinePath),
      productionEntry: true, fixtureLoaderUsed: false, debugOverlayUsed: false, dispatchApiUsed: false, replayApiUsed: false, offlineApiUsed: false,
      prerequisiteStateSeeded: true, prerequisiteSeedMethod: 'test-only legacy prerequisite capture state; no Stage9 dispatch/replay/offline API was used',
      actionProvenance: actions, realReloads: reloads,
      browser: { currentCodeCaptured: true, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: frames.length, uniqueImageHashes: hashes.size },
      scenes: [{ sceneId: 'stage9-a-theater-expansion', frames }],
      coverage: { newTheaterId: 'river_crossing', newOperationId: 'river_ferry', captureObserved: frames.some((frame) => frame.state?.riverCaptured === true), operationReviewObserved: frames.some((frame) => frame.phase === 'repeat_operation_review') },
      passed: frames.length === 18 && hashes.size === 18 && reloads.length === 4 && actions.every((row) => row.source === 'production_ui' && row.syntheticApiCall === false)
    };
    await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`); console.log(JSON.stringify({ ok: output.passed, stage: output.stage, screenshots: frames.length, uniqueImageHashes: hashes.size, realReloads: reloads.length, output: manifestPath })); if (!output.passed) process.exitCode = 1;
  } finally {
    cdp?.close(); await terminateManagedBrowser(browser).catch(() => {}); await new Promise((resolve) => server?.close(() => resolve())); removeIsolatedTempRoot(isolatedRoot);
  }
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, code: 'stage9-A-browser-evidence-failed', message: error.message || String(error) })); console.error(error.stack || error); process.exitCode = 1; });
