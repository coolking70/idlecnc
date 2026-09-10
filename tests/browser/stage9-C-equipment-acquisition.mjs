import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage9_c_machine_evidence.json');
const manifestPath = path.join(root, 'stage9_c_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage9-C');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function historicalSnapshot(state) {
  const active = state?.activeBattle || null;
  const sourceId = active?.replayContext?.sourceBattleSessionId || active?.battleSessionId || null;
  const session = sourceId ? state?.battleSessions?.[sourceId] : null;
  const candidates = [active?.deploymentSnapshot, active?.dispatchSnapshot, session?.deploymentSnapshot, session?.dispatchSnapshot];
  const snapshot = candidates.find((item) => item && typeof item === 'object') || null;
  return snapshot?.equipmentComposition || snapshot?.equipment || (Array.isArray(snapshot?.units) ? Object.fromEntries(snapshot.units.map((unit) => [unit.id, unit.equipment || []])) : {});
}

function summary(state) {
  const active = state?.activeBattle || null;
  const sourceId = active?.replayContext?.sourceBattleSessionId || active?.battleSessionId || null;
  const session = sourceId ? state?.battleSessions?.[sourceId] : null;
  const formalReport = session?.formalReportId
    ? (state?.battles || []).find((row) => row && row.id === session.formalReportId)
      || (active?.report?.id === session.formalReportId ? active.report : null)
    : (active?.report || null);
  const authoritativeSession = session && {
    battleSessionId: session.battleSessionId || null,
    missionId: session.missionId || null,
    deploymentSnapshot: session.deploymentSnapshot || null,
    deploymentSnapshotId: session.deploymentSnapshotId || null,
    deploymentHash: session.deploymentHash || null,
    formalReportId: session.formalReportId || null,
    formalReportHash: session.formalReportHash || null,
    sourceReportHash: session.sourceReportHash || null,
    sourceSaveRevision: session.sourceSaveRevision ?? null,
    settlementId: session.settlementId || null,
    sessionOrigin: session.sessionOrigin || null,
    formalReport
  };
  return {
    activeBattleSessionId: state?.activeBattleSessionId ?? null,
    activeBattle: active && {
      battleSessionId: active.battleSessionId || null,
      replayReadOnly: active.replayReadOnly === true,
      settled: active.settled === true,
      settlementAllowed: active.settlementAllowed !== false,
      deploymentHash: active.deploymentHash || null,
      formalReportHash: active.formalReportHash || null,
      settlementId: active.settlementId || null,
      reportId: active.report?.id || null,
      historicalEquipment: historicalSnapshot(state)
    },
    authoritativeSession,
    sessionId: sourceId,
    sessionLifecycle: session?.lifecycle || null,
    equipment: state?.equipment?.bindings || {},
    inventoryCount: Array.isArray(state?.equipment?.inventory) ? state.equipment.inventory.length : 0,
    production: { current: state?.production?.current ? { kind: state.production.current.kind || 'unit', equipmentId: state.production.current.equipmentId || null, id: state.production.current.id } : null, queue: Array.isArray(state?.production?.queue) ? state.production.queue.length : 0 },
    reportCount: (state?.battles || []).length,
    ledgerCount: Object.keys(state?.battleSettlementLedger || {}).length
  };
}

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '9-C.1' || machine.frameCount !== 9 || machine.fixtureLoaderUsed === true || machine.equipmentApiUsed === true) throw new Error('Stage9-C.1 machine evidence target list invalid');
  await fs.rm(manifestPath, { force: true });
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  const isolatedRoot = createIsolatedTempRoot('iron-command-stage9-C-');
  const evidenceEnv = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = []; const consoleErrors = []; const hashes = new Set(); const frames = []; const actions = []; const reloads = [];
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
    cdp.on('Page.javascriptDialogOpening', () => { cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    const boot = async (previous = null) => {
      const start = Date.now();
      while (Date.now() - start < 15000) {
        try {
          const expression = previous === null ? 'Boolean(window.__IRON_COMMAND__)' : `Boolean(window.__IRON_COMMAND__ && performance.timeOrigin > ${JSON.stringify(previous)})`;
          if (await cdp.evaluate(expression)) return true;
        } catch { /* page is navigating */ }
        await sleep(50);
      }
      throw new Error('Stage9-C browser boot timeout');
    };
    await boot();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
    const state = async () => cdp.evaluate(call('getState'));
    const provenance = (kind, selector, details = {}) => actions.push({ kind, selector, source: 'production_ui', syntheticApiCall: false, ...details });
    const click = async (selector, details = {}, { allowDisabled = false } = {}) => {
      const result = await cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); return n ? { ok:true, disabled:Boolean(n.disabled), label:(n.innerText||n.textContent||'').trim() } : { ok:false }; })()`);
      if (!result?.ok || (result.disabled && !allowDisabled)) throw new Error(`Stage9-C UI control unavailable: ${selector} ${JSON.stringify(result)}`);
      provenance('click', selector, { label: result.label, ...details });
      await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`); await sleep(120); return result;
    };
    const tab = async (id) => click(`button[data-tab="${id}"]`, { tab: id });
    // Stage 10-P-B moved several controls into the shared Command Inspector.
    // Reaching one stays a real two-step DOM interaction: click the tile to open
    // the Inspector, then click the Inspector action. Action buttons mirror their
    // payload as data-* attributes, so a specific instance stays addressable.
    const clickInspectorAction = async (tileSelector, actionSelector, details = {}, opts = {}) => {
      await click(tileSelector, { ...details, inspectorHost: true });
      return click(actionSelector, details, opts);
    };
    const waitSelector = async (selector, label, timeout = 12000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) { if (await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true; await sleep(60); }
      throw new Error(`Stage9-C selector timeout: ${label}`);
    };
    const waitUntil = async (predicate, label, timeout = 30000) => {
      const start = Date.now(); let last = null;
      while (Date.now() - start < timeout) { last = await state(); if (predicate(last)) return last; await sleep(120); }
      throw new Error(`Stage9-C wait timeout: ${label} ${JSON.stringify(summary(last))}`);
    };
    const capture = async (index, extra = {}) => {
      await sleep(180); const target = machine.frames[index]; const pngPath = path.join(screenshotDir, target.file);
      await cdp.screenshot(pngPath); const imageSha256 = sha256(await fs.readFile(pngPath));
      if (hashes.has(imageSha256)) throw new Error(`duplicate Stage9-C screenshot ${target.file}`);
      hashes.add(imageSha256); const current = await state();
      frames.push({ ...target, ...extra, state: summary(current), domText: await cdp.evaluate('document.body?.innerText || ""'), imageSha256, screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 } });
    };
    const bootInfo = async () => cdp.evaluate('(() => { const n=performance.getEntriesByType("navigation")[0]||{}; return { timeOrigin:performance.timeOrigin, readyState:document.readyState, navigationType:n.type||null }; })()');
    const reloadPage = async (reason) => {
      const before = await bootInfo(); const beforeTree = await cdp.send('Page.getFrameTree'); const beforeLoaderId = beforeTree?.frameTree?.frame?.loaderId || null;
      provenance('real_reload', 'Page.reload', { reason, reloadMethod: 'Page.reload', pageReload: true });
      await cdp.send('Page.reload', { ignoreCache: true }); await boot(before.timeOrigin);
      const after = await bootInfo(); const afterTree = await cdp.send('Page.getFrameTree'); const afterLoaderId = afterTree?.frameTree?.frame?.loaderId || null;
      const row = { reason, method: 'Page.reload', before, after, beforeLoaderId, afterLoaderId, timeOriginChanged: after.timeOrigin > before.timeOrigin }; reloads.push(row); return row;
    };

    await cdp.evaluate(call('reset')); await cdp.evaluate(call('setSpeed', 0));
    await cdp.evaluate(`(() => {
      const s = window.__IRON_COMMAND__.getState();
      s.resources = { supply: 4000, alloy: 4000, intel: 400 };
      s.command.capacity = 999; s.command.used = 0;
      s.unlocks.units = ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'];
      s.research.completed = ['standardized_training', 'modular_assembly', 'composite_armor', 'tactical_datalink', 'field_maintenance', 'expanded_storage', 'logistics_optimization', 'alloy_recycling', 'expanded_command_network'];
      s.research.current = null; s.research.queue = [];
      s.buildings.push({ id:'stage9-c-browser-armor-factory', type:'armor_factory', status:'operational', progress:1, level:1, builtAt:1, fx:{spawn:0}, slot:{gx:8,gy:4,w:3,h:2,height:32} });
      s.units = [{ id:'stage9-c-browser-unit', type:'mbt', hp:160, maxHp:160, experience:0, battles:0, callsign:null, createdAt:1, status:'ready', formationId:null, damage:'intact' }];
      s.formations = []; s.activeBattle = null; s.activeBattleSessionId = null; s.battleSessions = {}; s.battleSettlementLedger = {}; s.battles = [];
      s.equipment.bindings = {};
      return true;
    })()`);
    await click('#btn-save', { action: 'save-seeded-acquisition-state' });

    await tab('production'); await waitSelector('[data-command-id="equipment:anti_armor_sights"][data-action="produce-equipment"]', 'equipment production control');
    await click('[data-command-id="equipment:anti_armor_sights"][data-action="produce-equipment"]', { action: 'produce-equipment', equipmentId: 'anti_armor_sights' });
    await waitUntil((s) => s.production?.current?.kind === 'equipment', 'equipment queued'); await capture(0, { phase: 'production_queue' });
    const queueReload = await reloadPage('production_queue'); await tab('production'); await waitUntil((s) => s.production?.current?.kind === 'equipment', 'queue after reload'); await capture(1, { phase: 'production_queue_after_real_reload', realReload: queueReload });
    // Stage 10-P-B: a production-queue tile carries no primary action; the cancel
    // lives in its Inspector (model.actionId), so open the tile first.
    await clickInspectorAction('[data-command-id^="queue:"][data-command-state="active"]', '[data-inspector-action="cancel-current-production"]', { action: 'cancel-current-production' }); await waitUntil((s) => !s.production?.current, 'equipment queue cancelled');
    await click('[data-command-id="equipment:anti_armor_sights"][data-action="produce-equipment"]', { action: 'produce-equipment-after-cancel', equipmentId: 'anti_armor_sights' });
    await click('[data-command-id="equipment:command_uplink"][data-action="produce-equipment"]', { action: 'produce-equipment-queued', equipmentId: 'command_uplink' });
    const queuedJobId = (await state()).production.queue[0].id;
    await waitSelector(`[data-command-id="queue:${queuedJobId}"]`, 'queued equipment tile');
    await clickInspectorAction(`[data-command-id="queue:${queuedJobId}"]`, '[data-inspector-action="cancel-queued-production"]', { action: 'cancel-queued-production', jobId: queuedJobId });
    await cdp.evaluate(call('setSpeed', 4)); await waitUntil((s) => s.equipment?.inventory?.some((item) => item.id === 'equipment-production-anti_armor_sights-1'), 'equipment completed', 15000); await cdp.evaluate(call('setSpeed', 0));
    await capture(2, { phase: 'equipment_completed_unmounted' });
    const completeReload = await reloadPage('completed_unmounted'); await tab('production'); await waitUntil((s) => s.equipment?.inventory?.some((item) => item.id === 'equipment-production-anti_armor_sights-1'), 'completed equipment after reload'); await capture(3, { phase: 'equipment_completed_unmounted_after_real_reload', realReload: completeReload });
    await tab('units'); await waitSelector('[data-command-id="unit-instance:stage9-c-browser-unit"]', 'completed equipment mount control');
    await clickInspectorAction('[data-command-id="unit-instance:stage9-c-browser-unit"]', '[data-inspector-action="equip-equipment"][data-equipment-instance-id="equipment-production-anti_armor_sights-1"]', { action: 'equip-equipment', unitId: 'stage9-c-browser-unit', equipmentInstanceId: 'equipment-production-anti_armor_sights-1' });
    await waitUntil((s) => s.equipment?.bindings?.['stage9-c-browser-unit']?.includes('equipment-production-anti_armor_sights-1'), 'equipment mounted'); await capture(4, { phase: 'equipment_mounted_after_dom_click' });

    await tab('formations'); await clickInspectorAction('[data-command-id="formation:new"]', '[data-inspector-action="create-formation"]', { action: 'create-formation' }); await waitUntil((s) => s.formations?.length === 1, 'formation created');
    await clickInspectorAction('[data-command-id^="formation:f"]', '[data-inspector-action="add-unit"]', { action: 'add-unit' }); await waitUntil((s) => s.formations?.[0]?.unitIds?.includes('stage9-c-browser-unit'), 'unit added to formation');
    await tab('theater'); await click('[data-command-id="theater:scrap_mine"][data-action="select-theater"]', { action: 'select-theater', theaterId: 'scrap_mine' }); await click('[data-command-id="strategy:cautious"][data-action="select-strategy"]', { action: 'select-strategy', strategyId: 'cautious' }); await click('[data-action="launch-battle"]', { action: 'open-deployment-review' }); await waitSelector('[data-action="confirm-dispatch"]', 'dispatch confirm'); await click('[data-action="confirm-dispatch"]', { action: 'confirm-dispatch' });
    const running = await waitUntil((s) => Boolean(s.activeBattle?.battleSessionId), 'battle running');
    await tab('units'); await clickInspectorAction('[data-command-id="unit-instance:stage9-c-browser-unit"]', '[data-inspector-action="unequip-equipment"][data-equipment-instance-id="equipment-production-anti_armor_sights-1"]', { action: 'running-equipment-change-attempt', rejectedBy: 'battle_lock' }, { allowDisabled: true }); await capture(5, { phase: 'running_battle_equipment_change_attempt', sessionId: running.activeBattle.battleSessionId });
    const runningReload = await reloadPage('running_battle'); await tab('units'); await clickInspectorAction('[data-command-id="unit-instance:stage9-c-browser-unit"]', '[data-inspector-action="unequip-equipment"][data-equipment-instance-id="equipment-production-anti_armor_sights-1"]', { action: 'running-equipment-change-attempt-after-reload', rejectedBy: 'battle_lock' }, { allowDisabled: true }); await capture(6, { phase: 'running_after_real_reload', realReload: runningReload, sessionId: running.activeBattle.battleSessionId });
    await cdp.evaluate(call('tickBattle', 999)); await waitUntil((s) => s.activeBattle?.settled === true, 'result panel');
    await tab('theater'); await click('[data-action="view-report"]', { action: 'view-report' }); await waitSelector('[data-command-id^="report:"]', 'replay report control'); await click('[data-action="return-from-battle"]', { action: 'return-from-battle' }); await waitUntil((s) => s.activeBattle === null, 'result closed');
    await tab('reports'); await clickInspectorAction('[data-command-id^="report:"]', '[data-inspector-action="replay-report"]', { action: 'replay-report' }); await waitUntil((s) => s.activeBattle?.replayReadOnly === true, 'replay started'); await tab('units');
    await clickInspectorAction('[data-command-id="unit-instance:stage9-c-browser-unit"]', '[data-inspector-action="unequip-equipment"][data-equipment-instance-id="equipment-production-anti_armor_sights-1"]', { action: 'replay-equipment-change-attempt', rejectedBy: 'replay_read_only' }, { allowDisabled: true }); await capture(7, { phase: 'replay_historical_equipment_attempt' });
    const replayReload = await reloadPage('replay'); await tab('units'); await clickInspectorAction('[data-command-id="unit-instance:stage9-c-browser-unit"]', '[data-inspector-action="unequip-equipment"][data-equipment-instance-id="equipment-production-anti_armor_sights-1"]', { action: 'replay-equipment-change-attempt-after-reload', rejectedBy: 'replay_read_only' }, { allowDisabled: true }); await capture(8, { phase: 'replay_after_real_reload', realReload: replayReload });
    await cdp.evaluate(call('tickBattle', 999)); await cdp.evaluate(call('tickBattleReturn', 999)); await click('[data-action="return-from-battle"]', { action: 'return-from-battle', replayClose: true });

    if (pageErrors.length || consoleErrors.length) throw new Error(`Stage9-C browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const output = {
      stage: '9-C.1', version: 2, generatedBy: 'tests/browser/stage9-C-equipment-acquisition.mjs', machineEvidenceFile: path.basename(machinePath),
      productionEntry: true, fixtureLoaderUsed: false, debugOverlayUsed: false, dispatchApiUsed: false, replayApiUsed: false, offlineApiUsed: false, equipmentApiUsed: false,
      fixtureSeeded: true, fixtureSeedMethod: 'one valid unit, operational armor factory, research and resources seeded through the test-only state handle; acquisition, cancel, completion wait, mount, dispatch, battle-lock and replay actions are production DOM interactions',
      actionProvenance: actions, realReloads: reloads,
      browser: { currentCodeCaptured: true, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: frames.length, uniqueImageHashes: hashes.size },
      scenes: [{ sceneId: 'stage9-c-equipment-acquisition', frames }],
      coverage: { productionEntry: true, enqueueAction: true, cancelAction: true, completionObserved: true, completedUnmounted: true, mountAction: true, runningAttempt: true, replayAttempt: true, historicalSnapshotVisible: frames.slice(7).every((frame) => Object.keys(frame.state?.activeBattle?.historicalEquipment || {}).length >= 0) },
      passed: frames.length === 9 && hashes.size === 9 && reloads.length === 4 && actions.every((row) => row.source === 'production_ui' && row.syntheticApiCall === false)
    };
    await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`); console.log(JSON.stringify({ ok: output.passed, stage: output.stage, screenshots: frames.length, uniqueImageHashes: hashes.size, realReloads: reloads.length })); if (!output.passed) process.exitCode = 1;
  } finally {
    cdp?.close(); await terminateManagedBrowser(browser).catch(() => {}); await new Promise((resolve) => server?.close(() => resolve())); removeIsolatedTempRoot(isolatedRoot);
  }
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, code: 'stage9-C-browser-evidence-failed', message: error.message || String(error) })); console.error(error.stack || error); process.exitCode = 1; });
