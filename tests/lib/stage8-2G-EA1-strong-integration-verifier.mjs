import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createInitialState } from '../../js/state.js';
import { recalcDerived } from '../../js/economy.js';
import { createUnit } from '../../js/production.js';
import { createFormation, addUnit } from '../../js/formations.js';
import {
  dispatchFormation, tickActiveBattle, tickBattleReturn, settleActiveBattle,
  finishBattleReturn, replayBattleSession, buildSettlementPlan, THEATER_CODE
} from '../../js/theater.js';
import { migrate, serialize } from '../../js/save.js';
import { canonicalHash } from '../../js/production-battle-session.js';
import { computeSaveDiff, productionStateSignature, recomputeSettlementSaveDiff } from '../../js/save-diff.js';
import { runProductionIntegrationProbe } from './stage8-2G-EA-strong-integration-verifier.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function fresh() {
  const state = createInitialState();
  state.resources = { supply: 99999, alloy: 99999, intel: 99999 };
  state.command.capacity = 999;
  ['infantry', 'at_infantry', 'scout_car', 'repair_vehicle'].forEach((type, index) => {
    const unit = createUnit(type, `ea1-strong-${index}`);
    unit.id = `ea1-strong-unit-${index}`;
    state.units.push(unit);
  });
  const unrelated = createUnit('infantry', 'ea1-strong-unrelated');
  unrelated.id = 'ea1-strong-unrelated-unit';
  state.units.push(unrelated);
  const formation = createFormation(state, 'E-A.1 strong verifier formation');
  assert.equal(formation.ok, true);
  state.units.filter((unit) => unit.id !== unrelated.id).forEach((unit) => assert.equal(addUnit(state, formation.formation.id, unit.id).ok, true));
  recalcDerived(state);
  return state;
}

function launch(state, seed = 82101) {
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

function productionSettlementProbe() {
  const state = fresh();
  state.buildings.push({ id: 'ea1-unrelated-building', type: 'barracks', status: 'operational', level: 1 });
  state.research.current = { id: 'ea1-unrelated-research', elapsed: 4 };
  state.theaters.border_road.captured = true;
  const active = launch(state);
  const before = clone(state);
  const plan = buildSettlementPlan(state, active);
  const beforeSignature = productionStateSignature(before);
  tickActiveBattle(state, active.duration + 1);
  const after = clone(state);
  const afterSignature = productionStateSignature(after);
  const diff = recomputeSettlementSaveDiff(before, after, plan);
  const result = {
    beforeHash: diff.beforeHash,
    afterHash: diff.afterHash,
    beforeProductionSignature: beforeSignature,
    afterProductionSignature: afterSignature,
    changedPaths: diff.changedPaths,
    allowedChangedPaths: diff.allowedChangedPaths,
    unexpectedChangedPaths: diff.unexpectedChangedPaths,
    ignoredSaveDiffPaths: diff.ignoredSaveDiffPaths,
    formalPlanProblems: diff.formalPlanProblems,
    unrelatedStatePreserved: diff.unrelatedStatePreserved,
    passed: diff.passed
  };

  const tamperCases = [];
  const checkTamper = (name, mutate, expected = false) => {
    const candidate = clone(after);
    mutate(candidate);
    const recomputed = recomputeSettlementSaveDiff(before, candidate, plan);
    const rejected = recomputed.passed === expected;
    tamperCases.push({ case: name, rejected, recomputedPassed: recomputed.passed, unexpectedChangedPaths: recomputed.unexpectedChangedPaths });
    return rejected;
  };
  const buildingRejected = checkTamper('unrelated_building_mutation', (candidate) => { candidate.buildings[0].level += 1; });
  const unitRejected = checkTamper('unrelated_unit_mutation', (candidate) => { const row = candidate.units.find((unit) => unit.id === 'ea1-strong-unrelated-unit'); row.hp -= 1; });
  const researchRejected = checkTamper('unrelated_research_mutation', (candidate) => { candidate.research.current.elapsed += 99; });
  const theaterRejected = checkTamper('unrelated_theater_mutation', (candidate) => { candidate.theaters.border_road.captured = !candidate.theaters.border_road.captured; });
  const fakePassedRejected = checkTamper('fake_save_diff_passed', (candidate) => { candidate.buildings[0].level += 1; });
  const fakeAllowedRejected = checkTamper('fake_save_diff_allowed_path', (candidate) => { candidate.buildings[0].level += 1; });
  const primitiveRejected = checkTamper('primitive_unexpected_mutation', (candidate) => { candidate.resources.intel += 1; });
  const arrayRejected = checkTamper('array_report_insertion_mutation', (candidate) => { candidate.battles.push({ ...candidate.battles[0], id: 'fake-report' }); });
  result.tamperCases = tamperCases;
  result.tamperRejectionCount = tamperCases.filter((item) => item.rejected).length;
  result.unrelatedMutationsRejected = [buildingRejected, unitRejected, researchRejected, theaterRejected, fakePassedRejected, fakeAllowedRejected, primitiveRejected, arrayRejected].every(Boolean);
  return result;
}

function replayInvariant(state, sessionId, expectedSessionHash, expectedLedgerHash) {
  const active = state.activeBattle;
  const session = state.battleSessions?.[sessionId];
  const sourceUnits = new Set((session?.deploymentSnapshot?.units || []).map((row) => row.id));
  const formation = (state.formations || []).find((row) => row.id === (session?.deploymentSnapshot?.formation?.id || session?.deploymentSnapshot?.formationId));
  const units = (state.units || []).filter((row) => sourceUnits.has(row.id));
  const ledger = session?.settlementId ? state.battleSettlementLedger?.[session.settlementId] : null;
  return Boolean(
    active?.replayReadOnly === true
    && active?.settlementAllowed === false
    && active?.replayContext?.readOnly === true
    && active?.replayContext?.sourceBattleSessionId === sessionId
    && Number(active?.replayContext?.presentationTime) >= 0
    && state.activeBattleSessionId === null
    && session?.lifecycle === 'returned'
    && canonicalHash(session) === expectedSessionHash
    && canonicalHash(ledger) === expectedLedgerHash
    && formation?.status === 'idle'
    && units.every((row) => ['assigned', 'ready'].includes(row.status))
    && !Object.prototype.hasOwnProperty.call(active, 'productionSession')
  );
}

function replayPersistenceProbe() {
  const state = fresh();
  const active = settle(state);
  const sessionId = active.battleSessionId;
  const ledgerHash = canonicalHash(state.battleSettlementLedger[state.battleSessions[sessionId].settlementId]);
  const reportId = state.battleSessions[sessionId].formalReportId;
  finishBattleReturn(state);
  const sessionHash = canonicalHash(state.battleSessions[sessionId]);
  const opened = replayBattleSession(state, sessionId);
  assert.equal(opened.ok, true);
  const startInvariant = replayInvariant(state, sessionId, sessionHash, ledgerHash);
  const before = clone({ session: state.battleSessions[sessionId], ledger: state.battleSettlementLedger, report: state.battles.find((row) => row.id === reportId), formations: state.formations, units: state.units });
  tickActiveBattle(state, state.activeBattle.duration / 2);
  const midInvariant = replayInvariant(state, sessionId, sessionHash, ledgerHash);
  const reloaded = migrate(clone(serialize(state)), {});
  const reloadInvariant = replayInvariant(reloaded, sessionId, sessionHash, ledgerHash);
  tickActiveBattle(reloaded, reloaded.activeBattle.duration + 1);
  tickBattleReturn(reloaded, reloaded.activeBattle.returnDuration + 1);
  const finishInvariant = !reloaded.activeBattle
    && canonicalHash(reloaded.battleSessions[sessionId]) === sessionHash
    && canonicalHash(reloaded.battleSettlementLedger[reloaded.battleSessions[sessionId].settlementId]) === ledgerHash
    && reloaded.battles.filter((row) => row.id === reportId).length === 1;
  const after = clone({ session: reloaded.battleSessions[sessionId], ledger: reloaded.battleSettlementLedger, report: reloaded.battles.find((row) => row.id === reportId), formations: reloaded.formations, units: reloaded.units });
  const readonlyStateUnchanged = canonicalHash(before.session) === canonicalHash(after.session)
    && canonicalHash(before.ledger) === canonicalHash(after.ledger)
    && canonicalHash(before.report) === canonicalHash(after.report);
  const duplicateSettlement = settleActiveBattle(state);
  return {
    sourceSessionId: sessionId,
    sessionHash,
    ledgerHash,
    formalReportId: reportId,
    startInvariant,
    midInvariant,
    reloadInvariant,
    finishInvariant,
    readonlyStateUnchanged,
    duplicateSettlementBlocked: duplicateSettlement.ok === false && duplicateSettlement.code === THEATER_CODE.SETTLEMENT_BLOCKED,
    passed: startInvariant && midInvariant && reloadInvariant && finishInvariant && readonlyStateUnchanged
      && duplicateSettlement.ok === false && duplicateSettlement.code === THEATER_CODE.SETTLEMENT_BLOCKED
  };
}

function expandedReplayTamperCases() {
  const cases = [];
  const make = () => {
    const state = fresh();
    const active = settle(state);
    const id = active.battleSessionId;
    const ledgerHash = canonicalHash(state.battleSettlementLedger[state.battleSessions[id].settlementId]);
    finishBattleReturn(state);
    const sessionHash = canonicalHash(state.battleSessions[id]);
    assert.equal(replayBattleSession(state, id).ok, true);
    return { state, id, sessionHash, ledgerHash };
  };
  const tamper = (name, mutate) => {
    const candidate = make();
    mutate(candidate.state, candidate.id);
    const rejected = !replayInvariant(candidate.state, candidate.id, candidate.sessionHash, candidate.ledgerHash);
    cases.push({ case: name, rejected });
  };
  tamper('replay_canonical_lifecycle', (state, id) => { state.battleSessions[id].lifecycle = 'running'; });
  tamper('replay_presentation_time', (state) => { state.activeBattle.replayContext.presentationTime = -1; });
  tamper('replay_formation_status', (state, id) => { state.formations.find((row) => row.id === state.battleSessions[id].deploymentSnapshot.formation.id).status = 'fighting'; });
  tamper('replay_unit_status', (state, id) => { const unitId = state.battleSessions[id].deploymentSnapshot.units[0].id; state.units.find((row) => row.id === unitId).status = 'deployed'; });
  tamper('replay_ledger_hash', (state, id) => { state.battleSettlementLedger[state.battleSessions[id].settlementId].reward.supply += 1; });
  tamper('replay_source_binding', (state) => { state.activeBattle.replayContext.sourceBattleSessionId = 'fake-session'; });
  tamper('replay_settlement_permission', (state) => { state.activeBattle.settlementAllowed = true; });
  return cases;
}

function verifyBrowserManifest(manifest, root, errors) {
  const frames = (manifest?.scenes || []).flatMap((scene) => scene.frames || []);
  if (manifest?.stage !== '8.2G-E-A.1') errors.push('browser_stage');
  if (manifest?.productionEntry !== true || manifest?.fixtureLoaderUsed === true || manifest?.debugOverlayUsed === true) errors.push('browser_production_entry');
  if (manifest?.dispatchApiUsed === true || manifest?.replayApiUsed === true) errors.push('browser_api_shortcut');
  if (manifest?.browser?.captureCount !== 11 || frames.length !== 11 || manifest?.browser?.uniqueImageHashes !== 11) errors.push('browser_frame_count_or_hashes');
  const realReloads = manifest?.realReloads || [];
  if (realReloads.length !== 2) {
    errors.push('browser_real_reload_count');
  } else {
    const afterLoaderIds = [];
    realReloads.forEach((row, index) => {
      const beforeTimeOrigin = row?.before?.timeOrigin;
      const afterTimeOrigin = row?.after?.timeOrigin;
      const timeOriginsValid = typeof beforeTimeOrigin === 'number'
        && Number.isFinite(beforeTimeOrigin)
        && typeof afterTimeOrigin === 'number'
        && Number.isFinite(afterTimeOrigin);
      const recomputedTimeOriginChanged = timeOriginsValid
        && beforeTimeOrigin !== afterTimeOrigin;
      const beforeLoaderId = typeof row?.beforeLoaderId === 'string' ? row.beforeLoaderId.trim() : '';
      const afterLoaderId = typeof row?.afterLoaderId === 'string'
        ? row.afterLoaderId.trim()
        : (typeof row?.loaderId === 'string' ? row.loaderId.trim() : '');

      if (row?.method !== 'Page.reload') errors.push(`browser_real_reload_method:${index}`);
      if (!timeOriginsValid || !recomputedTimeOriginChanged) errors.push(`browser_real_reload_time_origin:${index}`);
      if (row?.timeOriginChanged !== recomputedTimeOriginChanged) errors.push(`browser_real_reload_time_origin_declaration:${index}`);
      if (!beforeLoaderId || !afterLoaderId || beforeLoaderId === afterLoaderId) errors.push(`browser_real_reload_loader:${index}`);
      if (typeof row?.afterLoaderId === 'string' && row.afterLoaderId.trim() !== row.loaderId) errors.push(`browser_real_reload_loader_declaration:${index}`);
      afterLoaderIds.push(afterLoaderId);
    });
    if (afterLoaderIds.some((loaderId) => !loaderId) || new Set(afterLoaderIds).size !== afterLoaderIds.length) {
      errors.push('browser_real_reload_loader_uniqueness');
    }
  }
  if ((manifest?.actionProvenance || []).some((row) => row.source !== 'production_ui' || row.syntheticApiCall !== false)) errors.push('browser_action_provenance');
  const seen = new Set();
  frames.forEach((frame) => {
    if (seen.has(frame.file)) errors.push(`browser_duplicate_file:${frame.file}`);
    seen.add(frame.file);
    const relative = frame.screenshot?.path;
    if (!relative || path.isAbsolute(relative) || relative.includes('..')) { errors.push(`browser_path:${frame.file}`); return; }
    const absolute = path.resolve(root, relative);
    if (!fs.existsSync(absolute)) { errors.push(`browser_missing_png:${frame.file}`); return; }
    const hash = sha256(fs.readFileSync(absolute));
    if (hash !== frame.imageSha256 || hash !== frame.screenshot?.sha256) errors.push(`browser_png_hash:${frame.file}`);
  });
  if (manifest?.browser?.pageErrors?.length || manifest?.browser?.consoleErrors?.length) errors.push('browser_runtime_errors');
  return errors;
}

export function runEA1StrongProbe({ root = process.cwd(), manifest = null } = {}) {
  const base = runProductionIntegrationProbe();
  const settlement = productionSettlementProbe();
  const replay = replayPersistenceProbe();
  const tamper = [
    ...base.tamper.cases.map((row) => ({ ...row, source: 'E-A regression' })),
    ...settlement.tamperCases.map((row) => ({ ...row, source: 'recursive save diff' })),
    ...expandedReplayTamperCases().map((row) => ({ ...row, source: 'replay persistence' }))
  ];
  const browserErrors = [];
  verifyBrowserManifest(manifest || {}, root, browserErrors);
  const checks = {
    originalEATestCoverage: base.passed,
    productionEntry: base.checks.productionEntry,
    settlementSaveDiffRecomputed: settlement.passed,
    unrelatedStatePreserved: settlement.unrelatedStatePreserved,
    replayReadOnlyPersistence: replay.passed,
    replayCanonicalImmutable: replay.readonlyStateUnchanged,
    replayFormationRestored: replay.startInvariant && replay.reloadInvariant,
    duplicateSettlementBlocked: replay.duplicateSettlementBlocked,
    browserEvidenceRecomputed: browserErrors.length === 0,
    noAuthorityScopeExpansion: base.checks.authorityFrozen
  };
  return {
    stage: '8.2G-E-A.1',
    checks,
    settlement,
    replay,
    browserErrors: [...new Set(browserErrors)],
    tamper: { cases: tamper, rejectionCount: tamper.filter((row) => row.rejected === true).length },
    passed: Object.values(checks).every(Boolean) && tamper.length >= 20 && tamper.every((row) => row.rejected === true)
  };
}

export function verifyEA1EvidenceBundle(bundle = {}, { root = process.cwd() } = {}) {
  const manifest = bundle.browser || (fs.existsSync(path.join(root, 'stage8_2g_ea1_browser_capture_manifest.json'))
    ? JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_ea1_browser_capture_manifest.json'), 'utf8')) : {});
  const probe = runEA1StrongProbe({ root, manifest });
  const errors = [...probe.browserErrors];
  if (bundle.stage !== '8.2G-E-A.1') errors.push('bundle_stage');
  for (const key of ['replayPersistence', 'replayFormation', 'realReload', 'uiPath', 'saveDiff', 'settlementReload', 'authority', 'tamper', 'machineEvidence']) {
    if (bundle[key]?.passed !== true) errors.push(`evidence:${key}`);
  }
  if (bundle.saveDiff?.passed === true
    && Array.isArray(bundle.saveDiff.unexpectedChangedPaths)
    && bundle.saveDiff.unexpectedChangedPaths.length > 0) {
    errors.push('evidence:saveDiffUnexpectedPaths');
  }
  if (probe.tamper.rejectionCount < 20) errors.push('tamper_count');
  if (!probe.passed) errors.push('independent_probe');
  return { ok: errors.length === 0, errors: [...new Set(errors)], probe, screenshots: 11 };
}
