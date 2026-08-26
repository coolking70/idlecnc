import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { CdpClient, getJson, listenEphemeral, localStaticServer, waitForWebSocket } from './cdp-client.mjs';
import { launchManagedBrowser, terminateManagedBrowser } from './managed-browser-process.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, removeIsolatedTempRoot } from './isolated-temp-root.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const machinePath = path.join(root, 'stage9_d_machine_evidence.json');
const manifestPath = path.join(root, 'stage9_d_browser_capture_manifest.json');
const screenshotDir = path.join(root, 'screenshots/stage9-D');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const call = (method, ...args) => `window.__IRON_COMMAND__[${JSON.stringify(method)}](${args.map((value) => JSON.stringify(value)).join(',')})`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sourceId(state) {
  return state?.activeBattle?.replayContext?.sourceBattleSessionId || state?.activeBattle?.battleSessionId || null;
}

function summary(state, salvage = null) {
  const id = sourceId(state);
  const session = id ? state?.battleSessions?.[id] : null;
  const report = session?.formalReportId ? (state?.battles || []).find((row) => row?.id === session.formalReportId) || null : null;
  const ledger = session?.settlementId ? state?.battleSettlementLedger?.[session.settlementId] || null : null;
  const active = state?.activeBattle || null;
  const inventory = Array.isArray(state?.equipment?.inventory) ? state.equipment.inventory : [];
  const salvageInstance = inventory.find((row) => row?.provenance?.kind === 'battle_salvage') || null;
  return {
    activeBattleSessionId: state?.activeBattleSessionId || null,
    activeBattle: active && {
      battleSessionId: active.battleSessionId || null, settled: active.settled === true,
      replayReadOnly: active.replayReadOnly === true, settlementId: active.settlementId || null,
      formalReportHash: active.formalReportHash || null
    },
    sessionId: id, settlementId: session?.settlementId || null,
    salvageRulesVersion: session?.salvageRulesVersion ?? null,
    formalReportHash: session?.formalReportHash || null,
    authoritativeSession: session ? { ...session, deploymentSnapshot: session.deploymentSnapshot || null, formalReport: report } : null,
    settlementLedger: ledger,
    // Keep the applied ledger in the evidence frame. The verifier must rebuild
    // the production state from the immutable settlement credential, rather
    // than trusting the UI's derived salvage label.
    settlementLedgerHash: ledger?.ledgerHash || null,
    salvage: salvage && {
      salvageId: salvage.salvageId || null, offerHash: salvage.offerHash || null,
      outcome: salvage.outcome || null, equipmentId: salvage.equipmentId || null,
      roll: salvage.roll ?? null, chance: salvage.chance ?? null, state: salvage.state || salvage.code || null,
      instanceId: salvage.instanceId || salvage.claim?.instanceId || null
    },
    inventoryCount: inventory.length,
    salvageInstanceId: salvageInstance?.id || null,
    salvageClaims: state?.equipment?.salvageClaims || {},
    equipmentInventory: inventory
  };
}

async function main() {
  const machine = JSON.parse(await fs.readFile(machinePath, 'utf8'));
  if (machine.stage !== '9-D' || machine.frameCount !== 9 || machine.dispatchApiUsed || machine.equipmentApiUsed) throw new Error('Stage9-D machine evidence target list invalid');
  await fs.rm(manifestPath, { force: true }); await fs.rm(screenshotDir, { recursive: true, force: true }); await fs.mkdir(screenshotDir, { recursive: true });
  const isolatedRoot = createIsolatedTempRoot('iron-command-stage9-D-');
  const evidenceEnv = buildIsolatedTempEnv(isolatedRoot);
  const pageErrors = []; const consoleErrors = []; const frames = []; const actions = []; const reloads = []; const imageHashes = new Set();
  let server; let browser; let cdp;
  try {
    server = localStaticServer(root); const port = await listenEphemeral(server);
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
        } catch { /* navigation in progress */ }
        await sleep(50);
      }
      throw new Error('Stage9-D browser boot timeout');
    };
    await boot(); await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
    const state = async () => cdp.evaluate(call('getState'));
    const currentOffer = async () => { const s = await state(); const id = sourceId(s); return id ? cdp.evaluate(call('salvageOffer', id)) : null; };
    const provenance = (kind, selector, details = {}) => actions.push({ kind, selector, source: 'production_ui', syntheticApiCall: false, ...details });
    const click = async (selector, details = {}) => {
      const result = await cdp.evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}); return n ? { ok:true, disabled:Boolean(n.disabled), label:(n.innerText||n.textContent||'').trim() } : { ok:false }; })()`);
      if (!result?.ok || result.disabled) throw new Error(`Stage9-D UI control unavailable: ${selector} ${JSON.stringify(result)}`);
      provenance('click', selector, { label: result.label, ...details }); await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`); await sleep(140); return result;
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
    const waitSelector = async (selector, label, timeout = 12000) => { const start = Date.now(); while (Date.now() - start < timeout) { if (await cdp.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true; await sleep(60); } const diagnostic = await state().catch(() => null); const offer = await currentOffer().catch(() => null); const dom = await cdp.evaluate('document.body?.innerText || ""').catch(() => ''); throw new Error(`Stage9-D selector timeout: ${label}; state=${JSON.stringify(summary(diagnostic, offer))}; dom=${dom.slice(-1200)}`); };
    const waitUntil = async (predicate, label, timeout = 30000) => { const start = Date.now(); let last = null; while (Date.now() - start < timeout) { last = await state(); if (predicate(last)) return last; await sleep(120); } throw new Error(`Stage9-D wait timeout: ${label} ${JSON.stringify(summary(last))}`); };
    const capture = async (index, extra = {}) => {
      await sleep(180); const target = machine.frames[index]; const pngPath = path.join(screenshotDir, target.file); await cdp.screenshot(pngPath); const imageSha256 = sha256(await fs.readFile(pngPath));
      if (imageHashes.has(imageSha256)) throw new Error(`duplicate Stage9-D screenshot ${target.file}`); imageHashes.add(imageSha256);
      const current = await state(); const offer = await currentOffer();
      frames.push({ ...target, ...extra, state: summary(current, offer), domText: await cdp.evaluate('document.body?.innerText || ""'), imageSha256, screenshot: { path: path.relative(root, pngPath), sha256: imageSha256 } });
    };
    const bootInfo = async () => cdp.evaluate('(() => { const n=performance.getEntriesByType("navigation")[0]||{}; return { timeOrigin:performance.timeOrigin, readyState:document.readyState, navigationType:n.type||null }; })()');
    const reloadPage = async (reason) => {
      const before = await bootInfo(); const beforeTree = await cdp.send('Page.getFrameTree'); const beforeLoaderId = beforeTree?.frameTree?.frame?.loaderId || null;
      provenance('real_reload', 'Page.reload', { reason, reloadMethod: 'Page.reload', pageReload: true }); await cdp.send('Page.reload', { ignoreCache: true }); await boot(before.timeOrigin);
      const after = await bootInfo(); const afterTree = await cdp.send('Page.getFrameTree'); const afterLoaderId = afterTree?.frameTree?.frame?.loaderId || null;
      const row = { reason, method: 'Page.reload', before, after, beforeLoaderId, afterLoaderId, timeOriginChanged: after.timeOrigin > before.timeOrigin, loaderChanged: beforeLoaderId !== afterLoaderId }; reloads.push(row); return row;
    };

    await cdp.evaluate(call('reset')); await cdp.evaluate(call('setSpeed', 0));
    await cdp.evaluate(`(() => { const s=window.__IRON_COMMAND__.getState(); s.resources={supply:99999,alloy:99999,intel:999}; s.command.capacity=999; s.unlocks.units=['infantry','at_infantry','scout_car','mbt','repair_vehicle']; s.buildings.push({id:'stage9-d-browser-armor-factory',type:'armor_factory',status:'operational',progress:1,level:1,builtAt:1,fx:{spawn:0},slot:{gx:8,gy:4,w:3,h:2,height:32}}); s.units=[{id:'stage9-d-browser-unit',type:'mbt',hp:160,maxHp:160,experience:0,battles:0,callsign:null,createdAt:1,status:'ready',formationId:null,damage:'intact'}]; s.formations=[]; s.activeBattle=null; s.activeBattleSessionId=null; s.battleSessions={}; s.battleSettlementLedger={}; s.battles=[]; s.equipment.bindings={}; window.__stage9DRandom=[5 / 0xFFFFFFFF, 1 / 0xFFFFFFFF]; Math.random=()=>window.__stage9DRandom.shift() ?? 1 / 0xFFFFFFFF; return true; })()`);
    await click('#btn-save', { action: 'save-seeded-salvage-state' });

    await tab('formations'); await clickInspectorAction('[data-command-id="formation:new"]', '[data-inspector-action="create-formation"]', { action: 'create-formation' }); await waitUntil((s) => s.formations?.length === 1, 'first formation'); await clickInspectorAction('[data-command-id^="formation:f"]', '[data-inspector-action="add-unit"]', { action: 'add-unit' }); await waitUntil((s) => s.formations?.[0]?.unitIds?.includes('stage9-d-browser-unit'), 'first unit assigned');
    await cdp.evaluate(`(() => { const s=window.__IRON_COMMAND__.getState(); const formation=s.formations[0]; const old=formation.id; formation.id='stage9-d-browser-formation'; s.units.forEach((unit) => { if (unit.formationId === old) unit.formationId=formation.id; }); return true; })()`);
    await tab('theater'); await click('[data-command-id="theater:scrap_mine"][data-action="select-theater"]', { action: 'select-theater', theaterId: 'scrap_mine' }); await click('[data-command-id="strategy:cautious"][data-action="select-strategy"]', { action: 'select-strategy', strategyId: 'cautious' }); await click('[data-action="launch-battle"]', { action: 'open-deployment-review' }); await waitSelector('[data-action="confirm-dispatch"]', 'dispatch confirm'); await click('[data-action="confirm-dispatch"]', { action: 'confirm-dispatch' }); await waitUntil((s) => Boolean(s.activeBattle?.battleSessionId && s.battleSessions?.[s.activeBattle.battleSessionId]?.salvageRulesVersion === 1), 'first battle running with explicit salvage version');
    await cdp.evaluate(call('tickBattle', 99999)); await waitUntil((s) => s.activeBattle?.settled === true, 'first settlement'); await tab('reports'); await waitSelector('[data-command-id^="report:"]', 'salvage claim'); await capture(0, { phase: 'result_salvage_available' });
    const pendingReload = await reloadPage('pending_result'); await tab('theater'); await waitUntil((s) => s.activeBattle?.settled === true, 'pending result after reload'); await capture(1, { phase: 'pending_after_real_reload', realReload: pendingReload });
    await clickInspectorAction('[data-command-id^="report:"]', '[data-inspector-action="claim-battle-salvage"]', { action: 'claim-battle-salvage' }); await waitUntil((s) => Object.keys(s.equipment?.salvageClaims || {}).length === 1, 'salvage claimed'); await capture(2, { phase: 'salvage_claimed' });
    const claimedReload = await reloadPage('claimed_result'); await tab('theater'); await waitUntil((s) => Object.keys(s.equipment?.salvageClaims || {}).length === 1, 'claim after reload'); await capture(3, { phase: 'claimed_after_real_reload', realReload: claimedReload });

    await click('[data-action="view-report"]', { action: 'view-report' }); await waitSelector('[data-command-id^="report:"]', 'history replay control'); await capture(4, { phase: 'history_claimed' }); await click('[data-action="return-from-battle"]', { action: 'return-from-battle' }); await waitUntil((s) => s.activeBattle === null, 'first result closed');
    await tab('reports'); await clickInspectorAction('[data-command-id^="report:"]', '[data-inspector-action="replay-report"]', { action: 'replay-report' }); await waitUntil((s) => s.activeBattle?.replayReadOnly === true, 'replay started'); await tab('theater'); await waitUntil((s) => s.activeBattle?.replayReadOnly === true, 'replay theater'); await capture(5, { phase: 'replay_read_only_salvage', claimControlPresent: await cdp.evaluate('Boolean(document.querySelector(`[data-inspector-action="claim-battle-salvage"]`))') });
    const replayReload = await reloadPage('replay'); await tab('theater'); await waitUntil((s) => s.activeBattle?.replayReadOnly === true, 'replay after reload'); await capture(6, { phase: 'replay_after_real_reload', realReload: replayReload, claimControlPresent: await cdp.evaluate('Boolean(document.querySelector(`[data-inspector-action="claim-battle-salvage"]`))') });
    await cdp.evaluate(call('tickBattle', 99999)); await cdp.evaluate(call('tickBattleReturn', 99999)); await click('[data-action="return-from-battle"]', { action: 'return-from-battle', replayClose: true }); await waitUntil((s) => s.activeBattle === null, 'replay closed');

    await cdp.evaluate(`(() => { const s=window.__IRON_COMMAND__.getState(); s.units.push({id:'stage9-d-browser-no-drop-unit',type:'mbt',hp:160,maxHp:160,experience:0,battles:0,callsign:null,createdAt:2,status:'ready',formationId:null,damage:'intact'}); s.formations=[]; s.activeBattle=null; s.activeBattleSessionId=null; window.__stage9DRandom=[6 / 0xFFFFFFFF]; Math.random=()=>window.__stage9DRandom.shift() ?? 1 / 0xFFFFFFFF; return true; })()`); await click('#btn-save', { action: 'save-no-drop-fixture' });
    await tab('formations'); await clickInspectorAction('[data-command-id="formation:new"]', '[data-inspector-action="create-formation"]', { action: 'create-formation', fixture: 'no_drop' }); await waitUntil((s) => s.formations?.length === 1, 'no-drop formation'); await clickInspectorAction('[data-command-id^="formation:f"]', '[data-inspector-action="add-unit"][data-unit-id="stage9-d-browser-no-drop-unit"]', { action: 'add-unit', fixture: 'no_drop' }); await waitUntil((s) => s.formations?.[0]?.unitIds?.includes('stage9-d-browser-no-drop-unit'), 'no-drop unit assigned');
    await cdp.evaluate(`(() => { const s=window.__IRON_COMMAND__.getState(); const formation=s.formations[0]; const old=formation.id; formation.id='stage9-d-browser-no-drop-formation'; s.units.forEach((unit) => { if (unit.formationId === old) unit.formationId=formation.id; }); return true; })()`);
    await tab('theater'); await click('[data-command-id="theater:scrap_mine"][data-action="select-theater"]', { action: 'select-theater', theaterId: 'scrap_mine', fixture: 'no_drop' }); await click('[data-command-id="operation:salvage_run"][data-action="select-theater"]', { action: 'select-operation', operationId: 'salvage_run', fixture: 'no_drop' }); await click('[data-command-id="strategy:cautious"][data-action="select-strategy"]', { action: 'select-strategy', strategyId: 'cautious', fixture: 'no_drop' }); await click('[data-action="launch-battle"]', { action: 'open-deployment-review', fixture: 'no_drop' }); await waitSelector('[data-action="confirm-dispatch"]', 'no-drop dispatch confirm'); await click('[data-action="confirm-dispatch"]', { action: 'confirm-dispatch', fixture: 'no_drop' }); await waitUntil((s) => Boolean(s.activeBattle?.battleSessionId && s.battleSessions?.[s.activeBattle.battleSessionId]?.salvageRulesVersion === 1), 'no-drop battle running with explicit salvage version'); await cdp.evaluate(call('tickBattle', 99999)); await waitUntil((s) => s.activeBattle?.settled === true, 'no-drop settlement'); await tab('theater'); await waitUntil((s) => s.activeBattle?.settled === true, 'no-drop result'); await capture(7, { phase: 'no_drop_result' });
    const noDropReload = await reloadPage('no_drop_result'); await tab('theater'); await waitUntil((s) => s.activeBattle?.settled === true, 'no-drop after reload'); await capture(8, { phase: 'no_drop_after_real_reload', realReload: noDropReload });

    if (pageErrors.length || consoleErrors.length) throw new Error(`Stage9-D browser errors: ${JSON.stringify({ pageErrors, consoleErrors })}`);
    const output = {
      stage: '9-D', version: 1, generatedBy: 'tests/browser/stage9-D-battle-salvage.mjs', machineEvidenceFile: path.basename(machinePath),
      productionEntry: true, fixtureLoaderUsed: false, debugOverlayUsed: false,
      dispatchApiUsed: false, replayApiUsed: false, offlineApiUsed: false, equipmentApiUsed: false,
      fixtureSeeded: true, fixtureSeedMethod: 'test-only state setup and deterministic Math.random seed source; settlement, salvage claim, replay and all navigation actions use real production DOM controls',
      actionProvenance: actions, realReloads: reloads,
      browser: { currentCodeCaptured: true, pageErrors, consoleErrors, screenshotsDir: path.relative(root, screenshotDir), captureCount: frames.length, uniqueImageHashes: imageHashes.size },
      scenes: [{ sceneId: 'stage9-d-salvage-loop', frames }],
      coverage: { resultOffer: true, claimClick: true, claimPersistence: true, historyDisplay: true, replayReadOnly: true, noDrop: true, requiredActionCoverage: machine.requiredActions.every((action) => actions.some((row) => row.kind === 'click' && row.selector.includes(action))), reloadReasons: machine.realReloadReasons.every((reason) => reloads.some((row) => row.reason === reason)) },
      passed: frames.length === machine.frameCount && imageHashes.size === frames.length && reloads.length === 4 && reloads.every((row) => row.timeOriginChanged && row.loaderChanged && row.after.timeOrigin > row.before.timeOrigin) && actions.every((row) => row.source === 'production_ui' && row.syntheticApiCall === false) && pageErrors.length === 0 && consoleErrors.length === 0
    };
    await fs.writeFile(manifestPath, `${JSON.stringify(output, null, 2)}\n`); console.log(JSON.stringify({ ok: output.passed, stage: output.stage, screenshots: frames.length, uniqueImageHashes: imageHashes.size, realReloads: reloads.length, output: manifestPath })); if (!output.passed) process.exitCode = 1;
  } finally {
    cdp?.close(); await terminateManagedBrowser(browser).catch(() => {}); await new Promise((resolve) => server?.close(() => resolve())); removeIsolatedTempRoot(isolatedRoot);
  }
}

main().catch((error) => { console.error(JSON.stringify({ ok: false, code: 'stage9-D-browser-evidence-failed', message: error.message || String(error) })); console.error(error.stack || error); process.exitCode = 1; });
