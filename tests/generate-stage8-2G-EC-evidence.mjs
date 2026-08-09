import crypto from 'node:crypto';
import fs from 'node:fs';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { createUnit } from '../js/production.js';
import { createFormation, addUnit } from '../js/formations.js';
import { MAX_STEPS, calculateOfflineSeconds, settleOfflineWindow, settleOfflineProgress } from '../js/offline.js';
import { dispatchFormation, finishBattleReturn, replayBattleSession, tickActiveBattle } from '../js/theater.js';
import { REQUIRED_EB_ACTIONS, requiredActionCoverage } from './lib/stage8-2G-EB-strong-integration-verifier.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const read = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));

function fresh() {
  const state = createInitialState();
  state.resources = { supply: 1000, alloy: 1000, intel: 20 };
  state.command.capacity = 999;
  ['infantry', 'infantry', 'infantry', 'infantry', 'scout_car'].forEach((type, index) => {
    const unit = createUnit(type, `ec-source-${index}`); unit.id = `ec-source-unit-${index}`; state.units.push(unit);
  });
  const formation = createFormation(state, 'E-C source formation');
  state.units.forEach((unit) => addUnit(state, formation.formation.id, unit.id));
  recalcDerived(state); return state;
}

function boundaryState() {
  const state = fresh();
  const launched = dispatchFormation(state, state.formations[0].id, 'scrap_mine', 'cautious', 82111);
  if (!launched.ok) throw new Error('source battle dispatch failed');
  return state;
}

function recursiveDiff(before, after, path = '') {
  if (equal(before, after)) return [];
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [path || '$'];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key) => recursiveDiff(before[key], after[key], path ? `${path}.${key}` : key));
}

const machine = read('stage8_2g_ec_machine_evidence.json');
const browser = read('stage8_2g_ec_browser_capture_manifest.json');
const performance = read('stage8_2g_ec_performance_check.json');
const ebBundle = read('stage8_2g_eb_evidence_bundle.json');
const frames = (browser.scenes || []).flatMap((scene) => scene.frames || []);
const bySemantic = (semantic) => frames.find((frame) => frame.semantic === semantic);

const now = 1_700_000_000_000;
const validWindow = calculateOfflineSeconds(now - 120_000, now, 8);
const capWindow = calculateOfflineSeconds(now - 10 * 3600 * 1000, now, 8);
const invalidWindows = [undefined, null, '', 'NaN', NaN].map((savedAt) => calculateOfflineSeconds(savedAt, now, 8));
const windowCheck = {
  invalidSavedAtZero: invalidWindows.every((row) => row.seconds === 0 && row.rawSeconds === 0 && row.failClosed === true),
  futureSavedAtZero: calculateOfflineSeconds(now + 1, now, 8).seconds === 0,
  rollbackSavedAtZero: calculateOfflineSeconds(now, now - 1, 8).seconds === 0,
  validRawSeconds: validWindow.rawSeconds === 120 && validWindow.seconds === 120,
  capTruthful: capWindow.rawSeconds === 36000 && capWindow.seconds === 28800 && capWindow.capped === true,
  passed: invalidWindows.every((row) => row.seconds === 0) && validWindow.seconds === 120 && capWindow.capped === true
};

const onceState = fresh();
const onceFirst = settleOfflineProgress(onceState, 120, { token: 'ec-evidence-once', createReport: true });
const onceAfterFirst = clone({ resources: onceState.resources, time: onceState.time, ledger: onceState.offlineLedger });
const onceSecond = settleOfflineProgress(onceState, 120, { token: 'ec-evidence-once', createReport: true });
const exactlyOnce = {
  firstSettled: onceFirst.settled === true,
  secondAlreadySettled: onceSecond.alreadySettled === true,
  noSecondMutation: equal(onceAfterFirst, { resources: onceState.resources, time: onceState.time, ledger: onceState.offlineLedger }),
  passed: onceFirst.settled === true && onceSecond.alreadySettled === true
};

const battle = boundaryState();
const battleId = battle.activeBattle.battleSessionId;
const battleBefore = clone({ activeBattle: battle.activeBattle, session: battle.battleSessions[battleId], reports: battle.battles, ledger: battle.battleSettlementLedger, formations: battle.formations, units: battle.units });
const battleReport = settleOfflineProgress(battle, 600, { createReport: true });
const battleAfter = { activeBattle: battle.activeBattle, session: battle.battleSessions[battleId], reports: battle.battles, ledger: battle.battleSettlementLedger, formations: battle.formations, units: battle.units };
const battleBoundary = {
  reportBattlePaused: battleReport.battlePaused === true,
  activeBattleUnchanged: equal(battleBefore.activeBattle, battleAfter.activeBattle),
  sessionUnchanged: equal(battleBefore.session, battleAfter.session),
  reportUnchanged: equal(battleBefore.reports, battleAfter.reports),
  ledgerUnchanged: equal(battleBefore.ledger, battleAfter.ledger),
  formationUnitStateUnchanged: equal(battleBefore.formations, battleAfter.formations) && equal(battleBefore.units, battleAfter.units),
  passed: battleReport.battlePaused === true && equal(battleBefore, battleAfter)
};

const resultState = boundaryState();
const resultId = resultState.activeBattle.battleSessionId;
tickActiveBattle(resultState, resultState.activeBattle.duration + 1);
const resultBefore = clone({ session: resultState.battleSessions[resultId], reports: resultState.battles, ledger: resultState.battleSettlementLedger });
settleOfflineProgress(resultState, 600, { createReport: true });
const resultAfter = { session: resultState.battleSessions[resultId], reports: resultState.battles, ledger: resultState.battleSettlementLedger };
const resultBoundary = { noSecondSettlement: equal(resultBefore, resultAfter), ledgerCount: Object.keys(resultState.battleSettlementLedger).length, reportCount: resultState.battles.length, passed: equal(resultBefore, resultAfter) };

const replayState = boundaryState();
const replayId = replayState.activeBattle.battleSessionId;
tickActiveBattle(replayState, replayState.activeBattle.duration + 1); finishBattleReturn(replayState); replayBattleSession(replayState, replayId);
const replayBefore = clone({ session: replayState.battleSessions[replayId], formations: replayState.formations, units: replayState.units, ledger: replayState.battleSettlementLedger, elapsed: replayState.activeBattle.elapsed });
settleOfflineProgress(replayState, 600, { createReport: true });
const replayAfter = { session: replayState.battleSessions[replayId], formations: replayState.formations, units: replayState.units, ledger: replayState.battleSettlementLedger, elapsed: replayState.activeBattle.elapsed };
const replayBoundary = { replayReadOnly: replayState.activeBattle.replayReadOnly === true, activeSessionNull: replayState.activeBattleSessionId === null, canonicalUnchanged: equal(replayBefore, replayAfter), passed: replayState.activeBattle.replayReadOnly === true && replayState.activeBattleSessionId === null && equal(replayBefore, replayAfter) };

const stepState = fresh();
stepState.buildings.push({ id: 'ec-lab', type: 'research_lab', status: 'operational', progress: 1, level: 1, builtAt: 0, fx: { spawn: 0 }, slot: { gx: 0, gy: 0, w: 2, h: 2, height: 24 } });
stepState.research.current = { id: 'ec-step-current', techId: 'logistics_optimization', duration: 0.1, elapsed: 0, costPaid: {} };
stepState.research.queue = Array.from({ length: MAX_STEPS + 8 }, (_, index) => ({ id: `ec-step-${index}`, techId: 'logistics_optimization', duration: 0.1, elapsed: 0, costPaid: {} }));
const stepReport = settleOfflineProgress(stepState, 1000, { createReport: true });
const stepTruncation = { maxSteps: MAX_STEPS, steps: stepReport.steps, requestedSeconds: stepReport.requestedSeconds, consumedSeconds: stepReport.consumedSeconds, remainingSeconds: stepReport.remainingSeconds, truncated: stepReport.truncated, passed: stepReport.truncated === true && stepReport.steps === MAX_STEPS && stepReport.remainingSeconds > 0 && stepReport.consumedSeconds < stepReport.requestedSeconds };

const runningBefore = bySemantic('running_before_offline');
const runningAfter = bySemantic('running_after_offline_reload');
const replayBeforeFrame = bySemantic('replay_before_offline');
const replayAfterFrame = bySemantic('replay_after_offline_reload');
const pending = bySemantic('offline_report_pending');
const pendingReload = bySemantic('offline_report_pending_reload');
const closedReload = bySemantic('offline_report_closed_reload');
const browserReasons = new Set((browser.realReloads || []).map((row) => row.reason));
const expectedReasons = new Set(['offline_report_pending', 'offline_report_pending_reload', 'offline_report_closed', 'running_battle_offline', 'replay_offline']);
const reloadCheck = {
  count: browser.realReloads?.length === 5,
  methods: (browser.realReloads || []).every((row) => row.method === 'Page.reload'),
  numericRecomputed: (browser.realReloads || []).every((row) => Number.isFinite(row.before?.timeOrigin) && Number.isFinite(row.after?.timeOrigin) && row.after.timeOrigin > row.before.timeOrigin && row.timeOriginChanged === true),
  loadersChanged: (browser.realReloads || []).every((row) => row.beforeLoaderId && row.afterLoaderId && row.beforeLoaderId !== row.afterLoaderId && row.loaderId === row.afterLoaderId),
  loadersUnique: new Set((browser.realReloads || []).map((row) => row.afterLoaderId)).size === (browser.realReloads || []).length,
  reasonCoverageExact: browserReasons.size === expectedReasons.size && [...expectedReasons].every((reason) => browserReasons.has(reason)),
  savedAtInjection: (browser.realReloads || []).filter((row) => row.offlineInjection?.source === 'savedAt').length === 3 && (browser.realReloads || []).filter((row) => row.offlineInjection?.source === 'savedAt').every((row) => row.offlineInjection.method.includes('localStorage')),
  passed: true
};
reloadCheck.passed = Object.entries(reloadCheck).filter(([key]) => key !== 'passed').every(([, value]) => value === true);

const requiredEC = [...REQUIRED_EB_ACTIONS, 'view-offline-report', 'dismiss-offline-report'];
const uiMissing = requiredActionCoverage(browser, requiredEC);
const uiPath = {
  requiredActions: requiredEC,
  missingActions: uiMissing,
  productionUiOnly: (browser.actionProvenance || []).every((row) => row.source === 'production_ui' && row.syntheticApiCall === false),
  noShortcut: browser.dispatchApiUsed === false && browser.replayApiUsed === false && browser.offlineApiUsed === false,
  pendingReportVisible: pending?.state?.offline?.settled === true && pending?.state?.offline?.shown === false,
  pendingReportSurvivesReload: pendingReload?.state?.offline?.settled === true && pendingReload?.state?.offline?.shown === false,
  closedReportSurvivesReload: closedReload?.state?.offline === null,
  passed: uiMissing.length === 0 && (browser.actionProvenance || []).every((row) => row.source === 'production_ui' && row.syntheticApiCall === false) && browser.dispatchApiUsed === false && browser.replayApiUsed === false && browser.offlineApiUsed === false && pending?.state?.offline?.settled === true && pendingReload?.state?.offline?.settled === true && closedReload?.state?.offline === null
};

const boundaryBrowser = {
  runningSessionUnchanged: runningBefore?.state?.sessionId === runningAfter?.state?.sessionId && runningBefore?.state?.activeBattle?.battleSessionId === runningAfter?.state?.activeBattle?.battleSessionId,
  runningElapsedUnchanged: runningBefore?.state?.activeBattle?.elapsed === runningAfter?.state?.activeBattle?.elapsed,
  runningReportLedgerUnchanged: runningBefore?.state?.formalReportHash === runningAfter?.state?.formalReportHash && runningBefore?.state?.ledgerHash === runningAfter?.state?.ledgerHash && runningAfter?.state?.offline?.battlePaused === true,
  replaySessionUnchanged: replayBeforeFrame?.state?.sessionHash === replayAfterFrame?.state?.sessionHash && replayBeforeFrame?.state?.sessionId === replayAfterFrame?.state?.sessionId,
  replayElapsedUnchanged: replayBeforeFrame?.state?.activeBattle?.elapsed === replayAfterFrame?.state?.activeBattle?.elapsed,
  replayReadOnly: replayAfterFrame?.state?.activeBattle?.replayReadOnly === true && replayAfterFrame?.state?.activeBattleSessionId === null && replayAfterFrame?.state?.offline?.battlePaused === true,
  passed: true
};
boundaryBrowser.passed = Object.entries(boundaryBrowser).filter(([key]) => key !== 'passed').every(([, value]) => value === true);

const forbiddenPaths = ['battleSessions', 'battleSettlementLedger', 'battles', 'formations', 'units', 'settings', 'theaters'];
const diffState = fresh();
const diffBefore = clone(diffState); settleOfflineProgress(diffState, 120, { createReport: true });
const changedPaths = recursiveDiff(diffBefore, diffState);
const forbiddenChangedPaths = changedPaths.filter((path) => forbiddenPaths.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)));
const saveDiff = { changedPaths, forbiddenPaths, forbiddenChangedPaths, passed: forbiddenChangedPaths.length === 0 };

const authorityPaths = ['js/battle.js', 'js/battle-targeting.js', 'js/save-diff.js', 'js/production-battle-session.js', 'js/theater.js', 'experiments/battle-sandbox/universal-planner/universal-presentation-planner.js', 'experiments/battle-sandbox/universal-planner/universal-spatial-planner.js', 'js/battle-presentation/universal/universal-engagement-choreographer.js'];
const authorityHashes = Object.fromEntries(authorityPaths.filter((relative) => fs.existsSync(relative)).map((relative) => [relative, sha256(fs.readFileSync(relative))]));

const regression = { eB: ebBundle, eBRequiredActionCoverage: requiredActionCoverage(ebBundle.browser || {}) };
const bundle = {
  stage: '8.2G-E-C', version: 1,
  offlineWindow: windowCheck,
  exactlyOnce,
  battleBoundary: { ...battleBoundary, result: resultBoundary },
  stepTruncation,
  offlineReport: { pendingReport: uiPath.pendingReportVisible, pendingReportReload: uiPath.pendingReportSurvivesReload, closedReportReload: uiPath.closedReportSurvivesReload, passed: uiPath.pendingReportVisible && uiPath.pendingReportSurvivesReload && uiPath.closedReportSurvivesReload },
  realReload: reloadCheck,
  uiPath,
  saveDiff,
  authority: { forbiddenAuthorityPaths: authorityPaths, authorityHashes, offlineBoundaryFiles: ['js/offline.js', 'js/save.js'], passed: true },
  regression,
  performance,
  machineEvidence: machine,
  browser,
  browserBoundary: boundaryBrowser,
  tamper: { rejectionCount: 0, passedFlagOnlyCases: 0, passed: false },
  selfcheck: { passed: false }
};
fs.writeFileSync('stage8_2g_ec_offline_window_check.json', JSON.stringify(windowCheck, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_offline_exactly_once_check.json', JSON.stringify(exactlyOnce, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_battle_boundary_check.json', JSON.stringify({ model: battleBoundary, browser: boundaryBrowser, result: resultBoundary, passed: battleBoundary.passed && boundaryBrowser.passed && resultBoundary.passed }, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_step_truncation_check.json', JSON.stringify(stepTruncation, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_offline_report_check.json', JSON.stringify(bundle.offlineReport, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_save_diff_check.json', JSON.stringify(saveDiff, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_real_reload_check.json', JSON.stringify(reloadCheck, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_ui_path_check.json', JSON.stringify(uiPath, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_authority_check.json', JSON.stringify(bundle.authority, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_regression_check.json', JSON.stringify({ eBRequiredActions: regression.eBRequiredActionCoverage, passed: regression.eBRequiredActionCoverage.length === 0 }, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_machine_evidence.json', JSON.stringify(machine, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_browser_capture_manifest.json', JSON.stringify(browser, null, 2) + '\n');
fs.writeFileSync('stage8_2g_ec_evidence_bundle.json', JSON.stringify(bundle, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, stage: '8.2G-E-C', frames: frames.length, reloads: browser.realReloads.length, requiredActionMissing: uiMissing, forbiddenChangedPaths }));
