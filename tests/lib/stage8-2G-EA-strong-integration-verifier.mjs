import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createInitialState } from '../../js/state.js';
import { recalcDerived } from '../../js/economy.js';
import { createUnit } from '../../js/production.js';
import { createFormation, addUnit } from '../../js/formations.js';
import {
  dispatchFormation, tickActiveBattle, settleActiveBattle, finishBattleReturn,
  replayBattleSession, validateBattleReportForSettlement, THEATER_CODE
} from '../../js/theater.js';
import { migrate, serialize } from '../../js/save.js';
import {
  SESSION_ORIGIN, SESSION_LIFECYCLE, canonicalHash,
  validateSettlementLedger
} from '../../js/production-battle-session.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function newState() {
  const state = createInitialState();
  state.resources = { supply: 99999, alloy: 99999, intel: 99999 };
  state.command.capacity = 999;
  ['infantry', 'at_infantry', 'scout_car', 'repair_vehicle'].forEach((type, index) => {
    const unit = createUnit(type, `ea-verifier-${index}`);
    unit.id = `ea-verifier-unit-${index}`;
    state.units.push(unit);
  });
  const created = createFormation(state, 'E-A verifier formation');
  assert.equal(created.ok, true);
  state.units.forEach((unit) => assert.equal(addUnit(state, created.formation.id, unit.id).ok, true));
  recalcDerived(state);
  return state;
}

function launch(state, seed = 82001) {
  const result = dispatchFormation(state, state.formations[0].id, 'scrap_mine', 'cautious', seed);
  assert.equal(result.ok, true, result.reason);
  return result.activeBattle;
}

function settle(state) {
  const active = state.activeBattle || launch(state);
  tickActiveBattle(state, active.duration + 1);
  assert.equal(state.activeBattle?.settled, true);
  return state.activeBattle;
}

export function runProductionIntegrationProbe() {
  const checks = {};
  const tamperCases = [];

  const state = newState();
  const active = launch(state);
  const session = state.battleSessions[active.battleSessionId];
  checks.productionEntry = session?.sessionOrigin === SESSION_ORIGIN.PRODUCTION;
  checks.stableSessionShape = Boolean(session
    && session.battleSessionId && session.missionId && session.deploymentSnapshotId
    && session.sourceSaveRevision !== undefined && session.formalReportId
    && session.formalReportHash && session.sourceReportHash
    && session.presentationState && session.settlementState && session.returnState);
  checks.deploymentCanonical = session && session.deploymentHash === canonicalHash(session.deploymentSnapshot);
  const snapshotHash = session ? session.deploymentHash : null;
  state.units[0].hp = 1;
  active.dispatchSnapshot.units[0].hp = 1;
  checks.deploymentImmutable = session && session.deploymentHash === snapshotHash
    && validateBattleReportForSettlement(state, active).ok === false;

  const reportSwap = newState();
  const reportSwapActive = launch(reportSwap);
  reportSwapActive.report = clone(reportSwapActive.report);
  reportSwapActive.report.summary = `${reportSwapActive.report.summary || ''} [swap]`;
  const reportSwapResult = settleActiveBattle(reportSwap);
  checks.formalReportBinding = reportSwapResult.ok === false && reportSwapResult.code === THEATER_CODE.REPORT_INVALID;
  tamperCases.push({ case: 'formal_report_swap', rejected: checks.formalReportBinding });

  const normal = newState();
  const normalActive = settle(normal);
  const normalSession = normal.battleSessions[normalActive.battleSessionId];
  const ledger = normal.battleSettlementLedger[normalSession.settlementId];
  checks.formalReportConsumed = normal.battles.some((report) => report.id === normalActive.report.id);
  checks.exactlyOnceLedger = Boolean(ledger && validateSettlementLedger(ledger, normalSession).ok);
  const beforeReplay = JSON.stringify({ resources: normal.resources, stats: normal.stats, units: normal.units, ledger: normal.battleSettlementLedger });
  const second = clone(normalActive);
  second.settled = false;
  normal.activeBattle = second;
  const duplicate = settleActiveBattle(normal);
  checks.duplicateSettlementBlocked = duplicate.ok === false && duplicate.code === THEATER_CODE.SETTLEMENT_BLOCKED
    && JSON.stringify({ resources: normal.resources, stats: normal.stats, units: normal.units, ledger: normal.battleSettlementLedger }) === beforeReplay;
  tamperCases.push({ case: 'replay_settlement', rejected: checks.duplicateSettlementBlocked });

  const resume = newState();
  const resumeActive = launch(resume);
  tickActiveBattle(resume, resumeActive.duration / 2);
  const loadedRunning = migrate(clone(serialize(resume)), {});
  checks.runningResume = loadedRunning.activeBattle?.battleSessionId === resumeActive.battleSessionId
    && loadedRunning.activeBattle?.elapsed === resumeActive.duration / 2;
  const loadedFinished = newState();
  const loadedFinishedActive = launch(loadedFinished);
  loadedFinishedActive.elapsed = loadedFinishedActive.duration;
  loadedFinishedActive.playing = false;
  const reloadedFinished = migrate(clone(serialize(loadedFinished)), {});
  tickActiveBattle(reloadedFinished, 0);
  checks.formalCompletionResume = reloadedFinished.activeBattle?.settled === true
    && Object.keys(reloadedFinished.battleSettlementLedger).length === 1;

  const replayState = newState();
  const replayActive = settle(replayState);
  const replayId = replayActive.battleSessionId;
  finishBattleReturn(replayState);
  const replay = replayBattleSession(replayState, replayId);
  const replayBefore = JSON.stringify({ resources: replayState.resources, stats: replayState.stats, units: replayState.units, ledger: replayState.battleSettlementLedger });
  tickActiveBattle(replayState, replayState.activeBattle.duration + 1);
  const replayDenied = settleActiveBattle(replayState);
  checks.readOnlyReplay = replay.ok && replay.readOnly === true
    && replayDenied.ok === false && replayDenied.code === THEATER_CODE.SETTLEMENT_BLOCKED
    && JSON.stringify({ resources: replayState.resources, stats: replayState.stats, units: replayState.units, ledger: replayState.battleSettlementLedger }) === replayBefore;

  const tamper = (name, mutate, expectedCode = THEATER_CODE.REPORT_INVALID) => {
    const candidate = newState();
    const candidateActive = launch(candidate);
    mutate(candidate, candidateActive, candidate.battleSessions[candidateActive.battleSessionId]);
    const result = settleActiveBattle(candidate);
    const rejected = result.ok === false && result.code === expectedCode;
    tamperCases.push({ case: name, rejected, code: result.code, reason: result.reason });
    return rejected;
  };
  checks.tamperSettlementId = tamper('settlement_id', (_state, activeRow, sessionRow) => { activeRow.settlementId = `${sessionRow.settlementId}-x`; });
  checks.tamperDeploymentHash = tamper('deployment_hash', (_state, activeRow) => { activeRow.deploymentHash = 'tampered'; });
  checks.tamperSourceRevision = tamper('stale_save_revision', (_state, activeRow, sessionRow) => { activeRow.sourceSaveRevision = sessionRow.sourceSaveRevision + 1; });
  checks.tamperDebugOrigin = tamper('debug_settlement', (_state, _activeRow, sessionRow) => { sessionRow.sessionOrigin = SESSION_ORIGIN.DEBUG; });
  checks.tamperSessionSwap = tamper('session_swap', (candidate, activeRow) => { candidate.battleSessions[activeRow.battleSessionId] = { ...candidate.battleSessions[activeRow.battleSessionId], battleSessionId: 'fake-session', sessionOrigin: SESSION_ORIGIN.PRODUCTION }; });
  checks.tamperDeploymentSnapshot = tamper('deployment_snapshot', (_state, activeRow) => { activeRow.dispatchSnapshot.units[0].hp = 1; });

  const ledgerTamper = newState();
  const ledgerActive = settle(ledgerTamper);
  const ledgerSession = ledgerTamper.battleSessions[ledgerActive.battleSessionId];
  ledgerTamper.battleSettlementLedger[ledgerSession.settlementId].reward.alloy = 999999;
  finishBattleReturn(ledgerTamper);
  const ledgerReplay = replayBattleSession(ledgerTamper, ledgerSession.battleSessionId);
  checks.tamperRewardLedger = ledgerReplay.ok === false;
  tamperCases.push({ case: 'reward_ledger', rejected: checks.tamperRewardLedger });

  const theaterSource = fs.readFileSync(path.resolve(process.cwd(), 'js/theater.js'), 'utf8');
  const sessionSource = fs.readFileSync(path.resolve(process.cwd(), 'js/production-battle-session.js'), 'utf8');
  checks.authorityFrozen = theaterSource.includes('simulateBattle({')
    && !sessionSource.includes('damage =') && !sessionSource.includes('reward =')
    && !sessionSource.includes('Math.random') && !sessionSource.includes('Date.now');

  return {
    stage: '8.2G-E-A',
    checks,
    tamper: { cases: tamperCases, rejectionCount: tamperCases.filter((item) => item.rejected).length },
    passed: Object.values(checks).every(Boolean) && tamperCases.every((item) => item.rejected)
  };
}

function verifyPngManifest(manifest, root, errors) {
  const frames = (manifest?.scenes || []).flatMap((scene) => scene.frames || []);
  if (manifest?.browser?.captureCount !== 11 || frames.length !== 11) errors.push('browser_frame_count');
  if (manifest?.browser?.uniqueImageHashes !== 11) errors.push('browser_unique_hashes');
  const seen = new Set();
  frames.forEach((frame) => {
    if (!frame.file || seen.has(frame.file)) errors.push(`browser_duplicate_file:${frame.file}`);
    seen.add(frame.file);
    const relative = frame.screenshot?.path;
    if (!relative || path.isAbsolute(relative) || relative.includes('..')) { errors.push(`browser_path:${frame.file}`); return; }
    const absolute = path.resolve(root, relative);
    if (!fs.existsSync(absolute)) { errors.push(`browser_missing_png:${frame.file}`); return; }
    const hash = sha256(fs.readFileSync(absolute));
    if (hash !== frame.imageSha256 || hash !== frame.screenshot?.sha256) errors.push(`browser_png_hash:${frame.file}`);
  });
  if (manifest?.browser?.pageErrors?.length || manifest?.browser?.consoleErrors?.length) errors.push('browser_runtime_errors');
}

export function verifyEAEvidenceBundle(bundle = {}, { root = process.cwd() } = {}) {
  const errors = [];
  const probe = runProductionIntegrationProbe();
  if (!probe.passed) errors.push('independent_probe');
  Object.entries(probe.checks).forEach(([name, value]) => { if (value !== true) errors.push(`probe:${name}`); });
  if (probe.tamper.rejectionCount < 8 || probe.tamper.cases.some((item) => item.rejected !== true)) errors.push('probe:tamper');
  if (bundle.stage !== '8.2G-E-A') errors.push('bundle_stage');
  for (const key of ['battleSession', 'deploymentBinding', 'formalReportBinding', 'settlement', 'saveDiff', 'resume', 'replayProtection', 'authority', 'tamper', 'developerSelfcheck']) {
    if (bundle[key]?.passed !== true) errors.push(`evidence:${key}`);
  }
  verifyPngManifest(bundle.browser, root, errors);
  if (bundle.browser?.productionEntry !== true || bundle.browser?.fixtureLoaderUsed === true || bundle.browser?.debugOverlayUsed === true) errors.push('browser_production_entry');
  if (bundle.authority?.formalRepairAuthorityModified === true || bundle.authority?.formalSolverModified === true || bundle.authority?.settlementCalculationModified === true) errors.push('authority_scope');
  return { ok: errors.length === 0, errors: [...new Set(errors)], probe, screenshots: 11 };
}
