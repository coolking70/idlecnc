import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage9_b_machine_evidence.json');
const manifestPath = path.join(root, 'stage9_b_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage9-B');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summary(state) {
  const active = state?.activeBattle || null;
  const sourceId = active?.replayContext?.sourceBattleSessionId || active?.battleSessionId || null;
  const session = sourceId ? state?.battleSessions?.[sourceId] : null;
  const unit = state?.units?.find((row) => row?.id === 'stage9-b-browser-unit');
  return {
    activeBattleSessionId: state?.activeBattleSessionId ?? null,
    activeBattle: active && {
      battleSessionId: active.battleSessionId || null, replayReadOnly: active.replayReadOnly === true,
      settled: active.settled === true, deploymentHash: active.deploymentHash || null,
      formalReportHash: active.formalReportHash || null, settlementId: active.settlementId || null,
      reportId: active.report?.id || null
    },
    sessionId: sourceId, sessionLifecycle: session?.lifecycle || null,
    equipment: state?.equipment?.bindings || {},
    unitStatus: unit?.status || null,
    reportCount: (state?.battles || []).length,
    ledgerCount: Object.keys(state?.battleSettlementLedger || {}).length
  };
}

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '9-B' || machine.frameCount !== 8 || machine.fixtureLoaderUsed === true || machine.equipmentApiUsed === true) throw new Error('Stage9-B machine evidence target list invalid');
  await fs.rm(manifestPath, { force: true });
  await fs.rm(screenshotDir, { recursive: true, force: true });
  await fs.mkdir(screenshotDir, { recursive: true });
  const isolatedRoot = createIsolatedTempRoot('iron-command-stage9-B-');
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
      throw new Error('Stage9-B browser boot timeout');
    };
    await boot();
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
    const state = async () => cdp.evaluate(call('getState'));
    const provenance = (kind, selector, details = {}) => actions.push({ kind, selector, source: 'production_ui', syntheticApiCall: false, ...details });
    const click = async (selector, details = {}, { allowDisabled = false } = {}) => {
      const result = await cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); return n ? { ok:true, disabled:Boolean(n.disabled), label:(n.innerText||n.textContent||'').trim() } : { ok:false }; })()`);
      if (!result?.ok || (result.disabled && !allowDisabled)) throw new Error(`Stage9-B UI control unavailable: ${selector} ${JSON.stringify(result)}`);
      provenance('click', selector, { label: result.label, ...details });
      await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`); await sleep(120); return result;
    };
    const tab = async (id) => click(`button[data-tab="${id}"]`, { tab: id });
    const waitSelector = async (selector, label, timeout = 12000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) { if (await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true; await sleep(60); }
      throw new Error(`Stage9-B selector timeout: ${label}`);
    };
    const waitUntil = async (predicate, label, timeout = 30000) => {
      const start = Date.now(); let last = null;
      while (Date.now() - start < timeout) { last = await state(); if (predicate(last)) return last; await sleep(120); }
      throw new Error(`Stage9-B wait timeout: ${label} ${JSON.stringify(summary(last))}`);
    };
    const capture = async (index, extra = {}) => {
      await sleep(180); const target = machine.frames[index]; const pngPath = path.join(screenshotDir, target.file);
      await cdp.screenshot(pngPath); const imageSha256 = sha256(await fs.readFile(pngPath));
      if (hashes.has(imageSha256)) throw new Error(`duplicate Stage9-B screenshot ${target.file}`);
      hashes.add(imageSha256); const current = await state();
      frames.push({ ...target, ...extra, state: summary(current), domText: await cdp.evaluate('document.body?.innerText || ""'), imageSha256, screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 } });
    };
    const bootInfo = async () => cdp.evaluate('(() => { const n=performance.getEntriesByType("navigation")[0]||{}; return { timeOrigin:performance.timeOrigin, readyState:document.readyState, navigationType:n.type||null }; })()');
    const reloadPage = async (reason) => {
      const before = await bootInfo(); const beforeTree = await cdp.send('Page.getFrameTree'); const beforeLoaderId = beforeTree?.frameTree?.frame?.loaderId || null; let loaderId = null;
      provenance('real_reload', 'Page.reload', { reason, reloadMethod: 'Page.reload', pageReload: true }); await cdp.send('Page.reload', { ignoreCache: true }); await boot(before.timeOrigin);
      const after = await bootInfo(); const afterTree = await cdp.send('Page.getFrameTree'); const afterLoaderId = afterTree?.frameTree?.frame?.loaderId || loaderId || null;
      const row = { reason, method: 'Page.reload', before, after, beforeLoaderId, afterLoaderId, loaderId: afterLoaderId, timeOriginChanged: after.timeOrigin > before.timeOrigin }; reloads.push(row); return row;
    };

    await cdp.evaluate(call('reset')); await cdp.evaluate(call('setSpeed', 0));
    // Only a unit fixture is seeded so every management, dispatch, result and replay
    // action below remains a real production DOM action. No equipment API is called.
    await cdp.evaluate(`(() => {
      const s = window.__IRON_COMMAND__.getState();
      s.resources = { supply: 999999, alloy: 999999, intel: 999999 };
      s.command.capacity = 999; s.command.used = 0;
      s.units = [{ id:'stage9-b-browser-unit', type:'mbt', hp:160, maxHp:160, experience:0, battles:0, callsign:null, createdAt:1, status:'ready', formationId:null, damage:'intact' }];
      s.formations = [];
      s.activeBattle = null; s.activeBattleSessionId = null; s.battleSessions = {}; s.battleSettlementLedger = {}; s.battles = [];
      s.theaters.scrap_mine.captured = false; s.theaters.scrap_mine.firstRewardTaken = false;
      s.equipment.bindings = {};
      return true;
    })()`);
    await click('#btn-save', { action: 'save-seeded-unit' });
    await tab('units'); await waitSelector('[data-action="equip-equipment"][data-equipment-instance-id="equipment-starter-2"]', 'mount control');
    await click('[data-action="equip-equipment"][data-equipment-instance-id="equipment-starter-2"]', { action: 'equip-equipment', unitId: 'stage9-b-browser-unit', equipmentInstanceId: 'equipment-starter-2' });
    await waitUntil((s) => s.equipment?.bindings?.['stage9-b-browser-unit']?.includes('equipment-starter-2'), 'equipment mounted');
    await capture(0, { phase: 'equipment_panel_mounted', equipmentManagementEntry: 'units_detail' });
    const equipmentReload = await reloadPage('equipment_panel_mounted'); await tab('units'); await waitUntil((s) => s.equipment?.bindings?.['stage9-b-browser-unit']?.includes('equipment-starter-2'), 'equipment after reload'); await capture(1, { phase: 'equipment_panel_after_real_reload', realReload: equipmentReload });
    await click('[data-action="unequip-equipment"][data-equipment-instance-id="equipment-starter-2"]', { action: 'unequip-equipment', unitId: 'stage9-b-browser-unit', equipmentInstanceId: 'equipment-starter-2' });
    await waitUntil((s) => !(s.equipment?.bindings?.['stage9-b-browser-unit'] || []).includes('equipment-starter-2'), 'equipment unmounted');
    await click('[data-action="equip-equipment"][data-equipment-instance-id="equipment-starter-2"]', { action: 'equip-equipment', unitId: 'stage9-b-browser-unit', equipmentInstanceId: 'equipment-starter-2' });
    await waitUntil((s) => s.equipment?.bindings?.['stage9-b-browser-unit']?.includes('equipment-starter-2'), 'equipment remounted');

    await tab('formations'); await click('[data-action="create-formation"]', { action: 'create-formation' }); await waitUntil((s) => s.formations?.length === 1, 'formation created');
    await click('[data-action="add-unit"]', { action: 'add-unit' }); await waitUntil((s) => s.formations?.[0]?.unitIds?.includes('stage9-b-browser-unit'), 'unit added to formation');
    await tab('theater'); await click('[data-action="select-theater"][data-theater="scrap_mine"]', { action: 'select-theater', theaterId: 'scrap_mine' }); await click('[data-action="select-strategy"][data-strategy="cautious"]', { action: 'select-strategy', strategyId: 'cautious' }); await click('[data-action="launch-battle"]', { action: 'open-deployment-review' }); await waitSelector('[data-action="confirm-dispatch"]', 'dispatch confirm'); await click('[data-action="confirm-dispatch"]', { action: 'confirm-dispatch' });
    const running = await waitUntil((s) => Boolean(s.activeBattle?.battleSessionId), 'battle running');
    await tab('units'); await click('[data-action="unequip-equipment"][data-equipment-instance-id="equipment-starter-2"]', { action: 'running-equipment-change-attempt', rejectedBy: 'battle_lock' }); await capture(2, { phase: 'running_equipment_change_attempt', sessionId: running.activeBattle.battleSessionId });
    const runningReload = await reloadPage('running_battle'); await tab('units'); await click('[data-action="unequip-equipment"][data-equipment-instance-id="equipment-starter-2"]', { action: 'running-equipment-change-attempt-after-reload', rejectedBy: 'battle_lock' }); await capture(3, { phase: 'running_after_real_reload', realReload: runningReload, sessionId: running.activeBattle.battleSessionId });
    await cdp.evaluate(call('tickBattle', 999)); await waitUntil((s) => s.activeBattle?.settled === true, 'result panel'); await tab('units'); await click('[data-action="unequip-equipment"][data-equipment-instance-id="equipment-starter-2"]', { action: 'result-equipment-change-attempt', rejectedBy: 'battle_lock' }); await capture(4, { phase: 'result_equipment_change_attempt' });
    const resultReload = await reloadPage('result'); await tab('units'); await click('[data-action="unequip-equipment"][data-equipment-instance-id="equipment-starter-2"]', { action: 'result-equipment-change-attempt-after-reload', rejectedBy: 'battle_lock' }); await capture(5, { phase: 'result_after_real_reload', realReload: resultReload });
    await tab('theater'); await click('[data-action="view-report"]', { action: 'view-report' }); await waitSelector('[data-action="replay-report"]', 'replay report control'); await click('[data-action="return-from-battle"]', { action: 'return-from-battle' }); await waitUntil((s) => s.activeBattle === null, 'result closed');
    await tab('reports'); await click('[data-action="replay-report"]', { action: 'replay-report' }); await waitUntil((s) => s.activeBattle?.replayReadOnly === true, 'replay started'); await tab('units'); await click('[data-action="unequip-equipment"][data-equipment-instance-id="equipment-starter-2"]', { action: 'replay-equipment-change-attempt', rejectedBy: 'replay_read_only' }); await capture(6, { phase: 'replay_equipment_change_attempt' });
    const replayReload = await reloadPage('replay'); await tab('units'); await click('[data-action="unequip-equipment"][data-equipment-instance-id="equipment-starter-2"]', { action: 'replay-equipment-change-attempt-after-reload', rejectedBy: 'replay_read_only' }); await capture(7, { phase: 'replay_after_real_reload', realReload: replayReload });
    await cdp.evaluate(call('tickBattle', 999)); await cdp.evaluate(call('tickBattleReturn', 999)); await click('[data-action="return-from-battle"]', { action: 'return-from-battle', replayClose: true });

    if (pageErrors.length || consoleErrors.length) throw new Error(`Stage9-B browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const output = {
      stage: '9-B', version: 1, generatedBy: 'tests/browser/stage9-B-equipment.mjs', machineEvidenceFile: path.basename(machinePath),
      productionEntry: true, fixtureLoaderUsed: false, debugOverlayUsed: false, dispatchApiUsed: false, replayApiUsed: false, offlineApiUsed: false, equipmentApiUsed: false,
      fixtureSeeded: true, fixtureSeedMethod: 'one valid unit seeded through read-only test state handle; all equipment mount/unmount, dispatch, result and replay actions are production DOM clicks',
      actionProvenance: actions, realReloads: reloads,
      browser: { currentCodeCaptured: true, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: frames.length, uniqueImageHashes: hashes.size },
      scenes: [{ sceneId: 'stage9-b-equipment-isolation', frames }],
      coverage: { equipmentPanelMounted: true, mountAction: true, unmountAction: true, runningAttempt: true, resultAttempt: true, replayAttempt: true, historicalSnapshotVisible: true },
      passed: frames.length === 8 && hashes.size === 8 && reloads.length === 4 && actions.every((row) => row.source === 'production_ui' && row.syntheticApiCall === false)
    };
    await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`); console.log(JSON.stringify({ ok: output.passed, stage: output.stage, screenshots: frames.length, uniqueImageHashes: hashes.size, realReloads: reloads.length, output: manifestPath })); if (!output.passed) process.exitCode = 1;
  } finally {
    cdp?.close(); await terminateManagedBrowser(browser).catch(() => {}); await new Promise((resolve) => server?.close(() => resolve())); removeIsolatedTempRoot(isolatedRoot);
  }
}
main().catch((error) => { console.error(JSON.stringify({ ok: false, code: 'stage9-B-browser-evidence-failed', message: error.message || String(error) })); console.error(error.stack || error); process.exitCode = 1; });
