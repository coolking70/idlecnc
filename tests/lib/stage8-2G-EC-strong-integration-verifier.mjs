import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createInitialState } from '../../js/state.js';
import { recalcDerived } from '../../js/economy.js';
import { createUnit } from '../../js/production.js';
import { createFormation, addUnit } from '../../js/formations.js';
import { MAX_STEPS, calculateOfflineSeconds, settleOfflineWindow, settleOfflineProgress } from '../../js/offline.js';
import { dispatchFormation, finishBattleReturn, replayBattleSession, tickActiveBattle } from '../../js/theater.js';
import { REQUIRED_EB_ACTIONS, requiredActionCoverage } from './stage8-2G-EB-strong-integration-verifier.mjs';
import { verifyEBEvidenceBundle } from './stage8-2G-EB-strong-integration-verifier.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const bySemanticFromFrames = (frames, semantic) => frames.find((frame) => frame.semantic === semantic);

export const FORBIDDEN_AUTHORITY_PATHS = Object.freeze([
  'js/battle.js',
  'js/battle-targeting.js',
  'js/save-diff.js',
  'js/production-battle-session.js',
  'js/theater.js',
  'experiments/battle-sandbox/universal-planner/universal-presentation-planner.js',
  'experiments/battle-sandbox/universal-planner/universal-spatial-planner.js',
  'js/battle-presentation/universal/universal-engagement-choreographer.js'
]);

function currentAuthorityHashes(root) {
  return Object.fromEntries(FORBIDDEN_AUTHORITY_PATHS
    .filter((relative) => fs.existsSync(path.resolve(root, relative)))
    .map((relative) => [relative, sha256(fs.readFileSync(path.resolve(root, relative)))]));
}

export const REQUIRED_EC_ACTIONS = Object.freeze([
  ...REQUIRED_EB_ACTIONS, 'view-offline-report', 'dismiss-offline-report'
]);

function fresh() {
  const state = createInitialState();
  state.resources = { supply: 1000, alloy: 1000, intel: 20 };
  state.command.capacity = 999;
  ['infantry', 'infantry', 'infantry', 'infantry', 'scout_car'].forEach((type, index) => {
    const unit = createUnit(type, `ec-verifier-${index}`); unit.id = `ec-verifier-unit-${index}`; state.units.push(unit);
  });
  const formation = createFormation(state, 'E-C verifier formation');
  state.units.forEach((unit) => addUnit(state, formation.formation.id, unit.id));
  recalcDerived(state); return state;
}

function recursiveDiff(before, after, current = '') {
  if (equal(before, after)) return [];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [current || '$'];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => recursiveDiff(before[key], after[key], current ? `${current}.${key}` : key));
}

function sourceProbe() {
  const now = 1_700_000_000_000;
  const valid = calculateOfflineSeconds(now - 120_000, now, 8);
  const capped = calculateOfflineSeconds(now - 10 * 3600 * 1000, now, 8);
  const invalid = [undefined, null, '', 'NaN', NaN].map((savedAt) => calculateOfflineSeconds(savedAt, now, 8));
  const windowState = fresh();
  const windowResult = settleOfflineWindow(windowState, now - 120_000, now, { createReport: true });

  const onceState = fresh();
  const first = settleOfflineProgress(onceState, 120, { token: 'ec-verifier-once', createReport: true });
  const onceBeforeSecond = clone(onceState);
  const second = settleOfflineProgress(onceState, 120, { token: 'ec-verifier-once', createReport: true });

  const battle = fresh();
  const launched = dispatchFormation(battle, battle.formations[0].id, 'scrap_mine', 'cautious', 82121);
  const battleId = launched.activeBattle.battleSessionId;
  const battleBefore = clone({ activeBattle: battle.activeBattle, session: battle.battleSessions[battleId], reports: battle.battles, ledger: battle.battleSettlementLedger, formations: battle.formations, units: battle.units });
  const pausedReport = settleOfflineProgress(battle, 600, { createReport: true });
  const battleAfter = { activeBattle: battle.activeBattle, session: battle.battleSessions[battleId], reports: battle.battles, ledger: battle.battleSettlementLedger, formations: battle.formations, units: battle.units };

  const result = fresh();
  const resultLaunch = dispatchFormation(result, result.formations[0].id, 'scrap_mine', 'cautious', 82122);
  const resultId = resultLaunch.activeBattle.battleSessionId;
  tickActiveBattle(result, result.activeBattle.duration + 1);
  const resultBefore = clone({ session: result.battleSessions[resultId], reports: result.battles, ledger: result.battleSettlementLedger });
  settleOfflineProgress(result, 600, { createReport: true });
  const resultAfter = { session: result.battleSessions[resultId], reports: result.battles, ledger: result.battleSettlementLedger };

  const replay = fresh();
  const replayLaunch = dispatchFormation(replay, replay.formations[0].id, 'scrap_mine', 'cautious', 82123);
  const replayId = replayLaunch.activeBattle.battleSessionId;
  tickActiveBattle(replay, replay.activeBattle.duration + 1); finishBattleReturn(replay); replayBattleSession(replay, replayId);
  const replayBefore = clone({ session: replay.battleSessions[replayId], formations: replay.formations, units: replay.units, ledger: replay.battleSettlementLedger, elapsed: replay.activeBattle.elapsed });
  settleOfflineProgress(replay, 600, { createReport: true });
  const replayAfter = { session: replay.battleSessions[replayId], formations: replay.formations, units: replay.units, ledger: replay.battleSettlementLedger, elapsed: replay.activeBattle.elapsed };

  const step = fresh();
  step.buildings.push({ id: 'ec-verifier-lab', type: 'research_lab', status: 'operational', progress: 1, level: 1, builtAt: 0, fx: { spawn: 0 }, slot: { gx: 0, gy: 0, w: 2, h: 2, height: 24 } });
  step.research.current = { id: 'ec-verifier-current', techId: 'logistics_optimization', duration: 0.1, elapsed: 0, costPaid: {} };
  step.research.queue = Array.from({ length: MAX_STEPS + 8 }, (_, index) => ({ id: `ec-verifier-${index}`, techId: 'logistics_optimization', duration: 0.1, elapsed: 0, costPaid: {} }));
  const stepReport = settleOfflineProgress(step, 1000, { createReport: true });

  const diffState = fresh(); const diffBefore = clone(diffState); settleOfflineProgress(diffState, 120, { createReport: true });
  const forbiddenPrefixes = ['battleSessions', 'battleSettlementLedger', 'battles', 'formations', 'units', 'settings', 'theaters'];
  const changedPaths = recursiveDiff(diffBefore, diffState);
  const forbiddenChangedPaths = changedPaths.filter((row) => forbiddenPrefixes.some((prefix) => row === prefix || row.startsWith(`${prefix}.`)));

  return {
    window: { invalid, valid, capped, helper: windowResult, passed: invalid.every((row) => row.seconds === 0 && row.failClosed === true) && valid.seconds === 120 && capped.capped === true && windowResult.nextSavedAt === now },
    exactlyOnce: { first, second, noSecondMutation: equal(onceBeforeSecond, onceState), passed: first.settled === true && second.alreadySettled === true && equal(onceBeforeSecond, onceState) },
    battle: { pausedReport, unchanged: equal(battleBefore, battleAfter), passed: pausedReport.battlePaused === true && equal(battleBefore, battleAfter) },
    result: { unchanged: equal(resultBefore, resultAfter), ledgerCount: Object.keys(result.battleSettlementLedger).length, reportCount: result.battles.length, passed: equal(resultBefore, resultAfter) },
    replay: { activeBattle: replay.activeBattle, unchanged: equal(replayBefore, replayAfter), passed: replay.activeBattle.replayReadOnly === true && replay.activeBattleSessionId === null && equal(replayBefore, replayAfter) },
    step: { report: stepReport, passed: stepReport.truncated === true && stepReport.steps === MAX_STEPS && stepReport.remainingSeconds > 0 && stepReport.consumedSeconds < stepReport.requestedSeconds },
    saveDiff: { changedPaths, forbiddenChangedPaths, passed: forbiddenChangedPaths.length === 0 }
  };
}

function verifyBrowserManifest(manifest, root, errors, source) {
  const frames = (manifest?.scenes || []).flatMap((scene) => scene.frames || []);
  const bySemantic = (semantic) => frames.find((frame) => frame.semantic === semantic);
  const expectedReasons = new Set(['offline_report_pending', 'offline_report_pending_reload', 'offline_report_closed', 'running_battle_offline', 'replay_offline']);
  if (manifest?.stage !== '8.2G-E-C') errors.push('browser_stage');
  if (manifest?.productionEntry !== true || manifest?.fixtureLoaderUsed === true || manifest?.debugOverlayUsed === true) errors.push('browser_production_entry');
  if (manifest?.dispatchApiUsed !== false || manifest?.replayApiUsed !== false || manifest?.offlineApiUsed !== false) errors.push('browser_api_shortcut');
  if (frames.length !== 17 || manifest?.browser?.captureCount !== 17 || manifest?.browser?.uniqueImageHashes !== 17) errors.push('browser_frame_count_or_hashes');
  if (manifest?.browser?.pageErrors?.length || manifest?.browser?.consoleErrors?.length) errors.push('browser_runtime_errors');
  const reloads = manifest?.realReloads || [];
  if (reloads.length !== 5) errors.push('browser_real_reload_count');
  const afterLoaders = [];
  const reasons = new Set();
  reloads.forEach((row, index) => {
    const before = row?.before?.timeOrigin; const after = row?.after?.timeOrigin;
    const beforeLoader = typeof row?.beforeLoaderId === 'string' ? row.beforeLoaderId.trim() : '';
    const afterLoader = typeof row?.afterLoaderId === 'string' ? row.afterLoaderId.trim() : '';
    if (row?.method !== 'Page.reload') errors.push('browser_reload_method:' + index);
    const timeOriginChanged = Number.isFinite(before) && Number.isFinite(after) && after > before;
    if (!timeOriginChanged) errors.push('browser_reload_time_origin:' + index);
    if (row?.timeOriginChanged !== timeOriginChanged) errors.push('browser_reload_declaration:' + index);
    if (!beforeLoader || !afterLoader || beforeLoader === afterLoader || row?.loaderId !== afterLoader) errors.push('browser_reload_loader:' + index);
    if (row?.offlineInjection?.source === 'savedAt' && !String(row.offlineInjection.method || '').includes('localStorage')) errors.push('browser_saved_at_injection:' + index);
    reasons.add(row?.reason); afterLoaders.push(afterLoader);
  });
  if (new Set(afterLoaders).size !== afterLoaders.length) errors.push('browser_reload_loader_uniqueness');
  for (const reason of expectedReasons) if (!reasons.has(reason)) errors.push('browser_reload_reason:' + reason);
  if (reasons.size !== expectedReasons.size) errors.push('browser_reload_unexpected_reason');
  const savedAtReloads = reloads.filter((row) => row?.offlineInjection?.source === 'savedAt');
  if (savedAtReloads.length !== 3 || savedAtReloads.some((row) => !String(row.offlineInjection.method || '').includes('localStorage') || row.offlineInjection.seconds !== 120)) errors.push('browser_saved_at_injection');
  frames.forEach((frame) => {
    const relative = frame.screenshot?.path;
    if (!relative || path.isAbsolute(relative) || relative.includes('..')) { errors.push('browser_path:' + frame.file); return; }
    const absolute = path.resolve(root, relative);
    if (!fs.existsSync(absolute)) { errors.push('browser_missing_png:' + frame.file); return; }
    const hash = sha256(fs.readFileSync(absolute));
    if (hash !== frame.imageSha256 || hash !== frame.screenshot?.sha256) errors.push('browser_png_hash:' + frame.file);
  });
  const requiredMissing = requiredActionCoverage(manifest, REQUIRED_EC_ACTIONS);
  requiredMissing.forEach((action) => errors.push('browser_required_action:' + action));
  if ((manifest?.actionProvenance || []).some((row) => row.source !== 'production_ui' || row.syntheticApiCall !== false)) errors.push('browser_action_provenance');
  const pending = bySemantic('offline_report_pending');
  const pendingReload = bySemantic('offline_report_pending_reload');
  const closed = bySemantic('offline_report_closed_reload');
  const running = bySemantic('running_before_offline');
  const runningAfter = bySemantic('running_after_offline_reload');
  const replay = bySemantic('replay_before_offline');
  const replayAfter = bySemantic('replay_after_offline_reload');
  if (pending?.state?.offline?.settled !== true || pending?.state?.offline?.shown !== false) errors.push('browser_pending_report');
  if (pendingReload?.state?.offline?.settled !== true || pendingReload?.state?.offline?.shown !== false || !equal(pending.state.resources, pendingReload.state.resources)) errors.push('browser_pending_report_reload');
  if (closed?.state?.offline !== null) errors.push('browser_closed_report_reload');
  if (running?.state?.activeBattle?.battleSessionId !== runningAfter?.state?.activeBattle?.battleSessionId || running?.state?.activeBattle?.elapsed !== runningAfter?.state?.activeBattle?.elapsed || runningAfter?.state?.offline?.battlePaused !== true || runningAfter?.state?.activeBattle?.replayReadOnly === true) errors.push('browser_running_boundary');
  if (running?.state?.sessionHash !== runningAfter?.state?.sessionHash || running?.state?.formalReportHash !== runningAfter?.state?.formalReportHash || running?.state?.ledgerHash !== runningAfter?.state?.ledgerHash) errors.push('browser_running_authority_identity');
  if (replay?.state?.sessionHash !== replayAfter?.state?.sessionHash || replay?.state?.activeBattle?.elapsed !== replayAfter?.state?.activeBattle?.elapsed || replayAfter?.state?.activeBattle?.replayReadOnly !== true || replayAfter?.state?.activeBattleSessionId !== null || replayAfter?.state?.offline?.battlePaused !== true) errors.push('browser_replay_boundary');
  if (!source.window.passed || !source.exactlyOnce.passed || !source.battle.passed || !source.replay.passed || !source.step.passed) errors.push('source_probe_contract');
}

export function runECStrongProbe({ root = process.cwd(), manifest = null, ebBundle = null } = {}) {
  const source = sourceProbe();
  const browserErrors = [];
  verifyBrowserManifest(manifest || {}, root, browserErrors, source);
  const regression = ebBundle ? verifyEBEvidenceBundle(ebBundle, { root }) : { ok: false, errors: ['missing_eb_bundle'] };
  const checks = {
    offlineWindow: source.window.passed,
    exactlyOnce: source.exactlyOnce.passed,
    battleBoundary: source.battle.passed && source.result.passed,
    replayBoundary: source.replay.passed,
    stepTruncation: source.step.passed,
    saveDiff: source.saveDiff.passed,
    browserEvidenceRecomputed: browserErrors.length === 0,
    eBRegression: regression.ok,
    performance: fs.existsSync(path.join(root, 'stage8_2g_ec_performance_check.json')) && (() => { const value = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_ec_performance_check.json'), 'utf8')); return value.warmupSamples === 20 && value.sampleCount === 120 && value.p95BudgetMs === 16.7 && value.scenarios.every((row) => row.p95Ms < 16.7); })()
  };
  return { stage: '8.2G-E-C', source, regression, browserErrors: [...new Set(browserErrors)], checks, passed: Object.values(checks).every(Boolean) };
}

export function verifyECEvidenceBundle(bundle = {}, { root = process.cwd() } = {}) {
  const browser = bundle.browser || (fs.existsSync(path.join(root, 'stage8_2g_ec_browser_capture_manifest.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_ec_browser_capture_manifest.json'), 'utf8')) : {});
  const frames = (browser?.scenes || []).flatMap((scene) => scene.frames || []);
  const ebBundle = bundle.regression?.eB || (fs.existsSync(path.join(root, 'stage8_2g_eb_evidence_bundle.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_eb_evidence_bundle.json'), 'utf8')) : null);
  const probe = runECStrongProbe({ root, manifest: browser, ebBundle });
  const errors = [...probe.browserErrors];
  if (bundle.stage !== '8.2G-E-C') errors.push('bundle_stage');
  const validRawSeconds = probe.source.window.valid.rawSeconds === 120 && probe.source.window.valid.seconds === 120;
  const capTruthful = probe.source.window.capped.rawSeconds === 36000 && probe.source.window.capped.seconds === 28800 && probe.source.window.capped.capped === true;
  const expectedOfflineWindow = {
    invalidSavedAtZero: probe.source.window.invalid.every((row) => row.seconds === 0 && row.rawSeconds === 0 && row.failClosed === true),
    futureSavedAtZero: calculateOfflineSeconds(1_700_000_000_001, 1_700_000_000_000, 8).seconds === 0,
    rollbackSavedAtZero: calculateOfflineSeconds(1_700_000_000_000, 1_699_999_999_999, 8).seconds === 0,
    validRawSeconds,
    capTruthful,
    passed: probe.source.window.passed
  };
  if (!equal(bundle.offlineWindow, expectedOfflineWindow)) errors.push('evidence:offlineWindow');
  const expectedExactlyOnce = {
    firstSettled: probe.source.exactlyOnce.first.settled === true,
    secondAlreadySettled: probe.source.exactlyOnce.second.alreadySettled === true,
    noSecondMutation: probe.source.exactlyOnce.noSecondMutation,
    passed: probe.source.exactlyOnce.passed
  };
  if (!equal(bundle.exactlyOnce, expectedExactlyOnce)) errors.push('evidence:exactlyOnce');
  const expectedBattleBoundary = {
    reportBattlePaused: probe.source.battle.pausedReport.battlePaused === true,
    activeBattleUnchanged: probe.source.battle.unchanged,
    sessionUnchanged: probe.source.battle.unchanged,
    reportUnchanged: probe.source.battle.unchanged,
    ledgerUnchanged: probe.source.battle.unchanged,
    formationUnitStateUnchanged: probe.source.battle.unchanged,
    passed: probe.source.battle.passed
  };
  const expectedResultBoundary = {
    noSecondSettlement: probe.source.result.unchanged,
    ledgerCount: probe.source.result.ledgerCount,
    reportCount: probe.source.result.reportCount,
    passed: probe.source.result.passed
  };
  if (!equal(bundle.battleBoundary, { ...expectedBattleBoundary, result: expectedResultBoundary })) errors.push('evidence:battleBoundary');
  const expectedStep = {
    maxSteps: MAX_STEPS,
    steps: probe.source.step.report.steps,
    requestedSeconds: probe.source.step.report.requestedSeconds,
    consumedSeconds: probe.source.step.report.consumedSeconds,
    remainingSeconds: probe.source.step.report.remainingSeconds,
    truncated: probe.source.step.report.truncated,
    passed: probe.source.step.passed
  };
  if (!equal(bundle.stepTruncation, expectedStep)) errors.push('evidence:stepTruncation');
  if (!equal(bundle.saveDiff?.changedPaths, probe.source.saveDiff.changedPaths) || !equal(bundle.saveDiff?.forbiddenPaths, ['battleSessions', 'battleSettlementLedger', 'battles', 'formations', 'units', 'settings', 'theaters']) || !equal(bundle.saveDiff?.forbiddenChangedPaths, probe.source.saveDiff.forbiddenChangedPaths) || bundle.saveDiff?.passed !== probe.source.saveDiff.passed) errors.push('evidence:saveDiff');
  if (bundle.saveDiff?.passed === true && Array.isArray(bundle.saveDiff?.unexpectedChangedPaths) && bundle.saveDiff.unexpectedChangedPaths.length > 0) errors.push('evidence:saveDiff_self_contradiction');
  const actualAuthorityHashes = currentAuthorityHashes(root);
  if (bundle.authority?.passed !== true || !equal(bundle.authority?.forbiddenAuthorityPaths, [...FORBIDDEN_AUTHORITY_PATHS]) || !equal(bundle.authority?.authorityHashes, actualAuthorityHashes)) errors.push('evidence:authority_hashes');
  const machinePath = path.join(root, 'stage8_2g_ec_machine_evidence.json');
  if (!fs.existsSync(machinePath) || !equal(bundle.machineEvidence, JSON.parse(fs.readFileSync(machinePath, 'utf8')))) errors.push('evidence:machineEvidence');
  const expectedUi = {
    requiredActions: REQUIRED_EC_ACTIONS,
    missingActions: requiredActionCoverage(browser, REQUIRED_EC_ACTIONS),
    productionUiOnly: (browser.actionProvenance || []).every((row) => row.source === 'production_ui' && row.syntheticApiCall === false),
    noShortcut: browser.dispatchApiUsed === false && browser.replayApiUsed === false && browser.offlineApiUsed === false,
    pendingReportVisible: bySemanticFromFrames(frames, 'offline_report_pending')?.state?.offline?.settled === true && bySemanticFromFrames(frames, 'offline_report_pending')?.state?.offline?.shown === false,
    pendingReportSurvivesReload: bySemanticFromFrames(frames, 'offline_report_pending_reload')?.state?.offline?.settled === true && bySemanticFromFrames(frames, 'offline_report_pending_reload')?.state?.offline?.shown === false,
    closedReportSurvivesReload: bySemanticFromFrames(frames, 'offline_report_closed_reload')?.state?.offline === null,
    passed: requiredActionCoverage(browser, REQUIRED_EC_ACTIONS).length === 0 && (browser.actionProvenance || []).every((row) => row.source === 'production_ui' && row.syntheticApiCall === false) && browser.dispatchApiUsed === false && browser.replayApiUsed === false && browser.offlineApiUsed === false && bySemanticFromFrames(frames, 'offline_report_pending')?.state?.offline?.settled === true && bySemanticFromFrames(frames, 'offline_report_pending_reload')?.state?.offline?.settled === true && bySemanticFromFrames(frames, 'offline_report_closed_reload')?.state?.offline === null
  };
  if (!equal(bundle.uiPath, expectedUi)) errors.push('evidence:uiPath');
  const performancePath = path.join(root, 'stage8_2g_ec_performance_check.json');
  if (!fs.existsSync(performancePath) || !equal(bundle.performance, JSON.parse(fs.readFileSync(performancePath, 'utf8')))) errors.push('evidence:performance');
  const runningFrame = bySemanticFromFrames(frames, 'running_before_offline');
  const runningAfterFrame = bySemanticFromFrames(frames, 'running_after_offline_reload');
  const replayFrame = bySemanticFromFrames(frames, 'replay_before_offline');
  const replayAfterFrame = bySemanticFromFrames(frames, 'replay_after_offline_reload');
  const expectedBoundary = {
    runningSessionUnchanged: runningFrame?.state?.sessionId === runningAfterFrame?.state?.sessionId && runningFrame?.state?.activeBattle?.battleSessionId === runningAfterFrame?.state?.activeBattle?.battleSessionId,
    runningElapsedUnchanged: runningFrame?.state?.activeBattle?.elapsed === runningAfterFrame?.state?.activeBattle?.elapsed,
    runningReportLedgerUnchanged: runningFrame?.state?.formalReportHash === runningAfterFrame?.state?.formalReportHash && runningFrame?.state?.ledgerHash === runningAfterFrame?.state?.ledgerHash && runningAfterFrame?.state?.offline?.battlePaused === true,
    replaySessionUnchanged: replayFrame?.state?.sessionHash === replayAfterFrame?.state?.sessionHash && replayFrame?.state?.sessionId === replayAfterFrame?.state?.sessionId,
    replayElapsedUnchanged: replayFrame?.state?.activeBattle?.elapsed === replayAfterFrame?.state?.activeBattle?.elapsed,
    replayReadOnly: replayAfterFrame?.state?.activeBattle?.replayReadOnly === true && replayAfterFrame?.state?.activeBattleSessionId === null && replayAfterFrame?.state?.offline?.battlePaused === true,
    passed: true
  };
  expectedBoundary.passed = Object.entries(expectedBoundary).filter(([key]) => key !== 'passed').every(([, value]) => value === true);
  if (!equal(bundle.browserBoundary, expectedBoundary)) errors.push('evidence:browserBoundary');
  if (bundle.tamper?.rejectionCount < 50 || bundle.tamper?.passedFlagOnlyCases !== 0 || bundle.tamper?.passed !== true) errors.push('evidence:tamper_gate');
  if (!probe.passed) errors.push('independent_probe');
  return { ok: errors.length === 0, errors: [...new Set(errors)], probe };
}
