import assert from 'node:assert/strict';

import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { createUnit } from '../js/production.js';
import { createFormation, addUnit } from '../js/formations.js';
import {
  dispatchFormation, tickActiveBattle, tickBattleReturn, settleActiveBattle,
  finishBattleReturn, replayBattleSession, buildSettlementPlan, THEATER_CODE
} from '../js/theater.js';
import { migrate, serialize } from '../js/save.js';
import {
  SESSION_ORIGIN, SESSION_LIFECYCLE, canonicalHash
} from '../js/production-battle-session.js';
import {
  computeSaveDiff, productionStateSignature, recomputeSettlementSaveDiff
} from '../js/save-diff.js';

const failures = [];
let passed = 0;
const clone = (value) => JSON.parse(JSON.stringify(value));
const check = (name, fn) => {
  try { fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (error) { failures.push({ name, message: error?.message || String(error) }); console.log(`  FAIL  ${name}\n        → ${error?.message || error}`); }
};

function fresh() {
  const state = createInitialState();
  state.resources = { supply: 99999, alloy: 99999, intel: 99999 };
  state.command.capacity = 999;
  ['infantry', 'at_infantry', 'scout_car', 'repair_vehicle'].forEach((type, index) => {
    const unit = createUnit(type, `ea1-building-${index}`);
    unit.id = `ea1-unit-${index}`;
    state.units.push(unit);
  });
  const formation = createFormation(state, 'E-A.1 Replay Formation');
  assert.equal(formation.ok, true);
  state.units.forEach((unit) => assert.equal(addUnit(state, formation.formation.id, unit.id).ok, true));
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

function replayStages(state, sessionId) {
  // Browser boot migrates a persisted save before exposing it to the UI.
  // Apply that same normalization to the model fixture before comparing
  // production signatures across the replay lifecycle.
  state = migrate(clone(serialize(state)), {});
  const source = state.battleSessions[sessionId];
  const formation = state.formations[0];
  const sourceUnits = state.units.filter((unit) => source.deploymentSnapshot.units.some((row) => row.id === unit.id));
  const productionBefore = productionStateSignature(state);
  const sessionBefore = canonicalHash(source);
  const ledgerBefore = canonicalHash(state.battleSettlementLedger);
  const reportBefore = canonicalHash(state.battles.find((row) => row.id === source.formalReportId));
  const statuses = () => sourceUnits.map((unit) => ({ id: unit.id, status: unit.status }));
  const beforeStatuses = statuses();
  assert.equal(formation.status, 'idle');

  const opened = replayBattleSession(state, sessionId);
  assert.equal(opened.ok, true);
  assert.equal(state.activeBattle.replayReadOnly, true);
  assert.equal(state.activeBattle.replayContext.sourceBattleSessionId, sessionId);
  assert.equal(state.activeBattleSessionId, null);
  assert.equal(state.battleSessions[sessionId].lifecycle, SESSION_LIFECYCLE.RETURNED);
  assert.equal(canonicalHash(state.battleSessions[sessionId]), sessionBefore);
  assert.deepEqual(statuses(), beforeStatuses);
  assert.equal(formation.status, 'idle');
  assert.equal(settleActiveBattle(state).code, THEATER_CODE.SETTLEMENT_BLOCKED);

  const savedReplay = clone(serialize(state));
  const loaded = migrate(savedReplay, {});
  assert.equal(loaded.activeBattle.replayReadOnly, true);
  assert.equal(loaded.activeBattle.replayContext.sourceBattleSessionId, sessionId);
  assert.equal(loaded.activeBattleSessionId, null);
  assert.equal(loaded.formations[0].status, 'idle');
  assert.deepEqual(loaded.units.filter((unit) => beforeStatuses.some((row) => row.id === unit.id)).map((unit) => ({ id: unit.id, status: unit.status })), beforeStatuses);
  assert.equal(canonicalHash(loaded.battleSessions[sessionId]), sessionBefore);
  assert.equal(canonicalHash(loaded.battleSettlementLedger), ledgerBefore);
  assert.equal(canonicalHash(loaded.battles.find((row) => row.id === source.formalReportId)), reportBefore);
  assert.equal(settleActiveBattle(loaded).code, THEATER_CODE.SETTLEMENT_BLOCKED);

  tickActiveBattle(loaded, loaded.activeBattle.duration / 2);
  assert.equal(canonicalHash(loaded.battleSessions[sessionId]), sessionBefore);
  const reloadedReplay = migrate(clone(serialize(loaded)), {});
  assert.equal(reloadedReplay.activeBattle.replayReadOnly, true);
  assert.equal(reloadedReplay.activeBattle.replayContext.sourceBattleSessionId, sessionId);
  assert.equal(canonicalHash(reloadedReplay.battleSessions[sessionId]), sessionBefore);
  tickActiveBattle(reloadedReplay, reloadedReplay.activeBattle.duration + 1);
  tickBattleReturn(reloadedReplay, reloadedReplay.activeBattle.returnDuration + 1);
  assert.equal(reloadedReplay.activeBattle, null);
  assert.equal(canonicalHash(reloadedReplay.battleSessions[sessionId]), sessionBefore);
  assert.equal(canonicalHash(reloadedReplay.battleSettlementLedger), ledgerBefore);
  assert.equal(productionStateSignature(reloadedReplay), productionBefore);
  return { sessionBefore, ledgerBefore, reportBefore, beforeStatuses, sourceFormationId: formation.id };
}

console.log('\n── Stage 8.2G-E-A.1 Replay persistence, UI/save-diff model gates ──');

check('canonical ProductionBattleSession stays settled/returned and immutable across replay', () => {
  const state = fresh();
  const active = settle(state);
  const sessionId = active.battleSessionId;
  finishBattleReturn(state);
  const result = replayStages(state, sessionId);
  assert.equal(result.sessionBefore.length, 64);
});

check('result reload preserves one settlement ledger and one formal report', () => {
  const state = fresh();
  const active = settle(state);
  const sessionId = active.battleSessionId;
  const beforeLedger = clone(state.battleSettlementLedger);
  const beforeResources = clone(state.resources);
  const loaded = migrate(clone(serialize(state)), {});
  assert.equal(loaded.activeBattle.settled, true);
  assert.deepEqual(loaded.battleSettlementLedger, beforeLedger);
  assert.deepEqual(loaded.resources, beforeResources);
  assert.equal(loaded.battles.filter((row) => row.id === active.report.id).length, 1);
  assert.equal(settleActiveBattle(loaded).ok, true);
  assert.deepEqual(loaded.battleSettlementLedger, beforeLedger);
  assert.equal(canonicalHash(loaded.battleSessions[sessionId]), canonicalHash(state.battleSessions[sessionId]));
});

check('double dispatch increments battle session sequence exactly once', () => {
  const state = fresh();
  const before = state.battleSessionSequence;
  const first = launch(state, 82002);
  const second = dispatchFormation(state, state.formations[0].id, 'scrap_mine', 'cautious', 82003);
  assert.equal(first.battleSessionId !== undefined, true);
  assert.equal(second.ok, false);
  assert.equal(state.battleSessionSequence - before, 1);
});

check('recursive save diff recomputes formal settlement and preserves unrelated state', () => {
  const state = fresh();
  state.buildings.push({ id: 'unrelated-building', type: 'barracks', status: 'operational', level: 1 });
  state.research.current = { id: 'unrelated-tech', elapsed: 3 };
  state.theaters.border_road.captured = true;
  const active = launch(state, 82004);
  const before = clone(state);
  const plan = buildSettlementPlan(state, active);
  tickActiveBattle(state, active.duration + 1);
  const after = clone(state);
  const diff = recomputeSettlementSaveDiff(before, after, plan);
  assert.equal(diff.passed, true, JSON.stringify(diff));
  assert.equal(diff.unexpectedChangedPaths.length, 0);
  assert.equal(diff.unrelatedStatePreserved, true);
  assert.ok(diff.changedPaths.length > 0);
  assert.ok(diff.allowedChangedPaths.includes('saveRevision'));
  const tampered = clone(after);
  tampered.buildings[0].level += 1;
  assert.equal(recomputeSettlementSaveDiff(before, tampered, plan).passed, false);
});

check('save diff rejects unrelated unit, research and theater mutations even when evidence says passed', () => {
  const state = fresh();
  const active = launch(state, 82005);
  const before = clone(state);
  const plan = buildSettlementPlan(state, active);
  tickActiveBattle(state, active.duration + 1);
  for (const mutate of [
    (candidate) => { candidate.units.push({ ...candidate.units[0], id: 'unrelated-unit' }); },
    (candidate) => { candidate.research.current = { id: 'tampered-research', elapsed: 999 }; },
    (candidate) => { candidate.theaters.border_road.captured = !candidate.theaters.border_road.captured; }
  ]) {
    const tampered = clone(state);
    mutate(tampered);
    const result = recomputeSettlementSaveDiff(before, tampered, plan);
    const fakeEvidence = { ...result, passed: true };
    assert.equal(fakeEvidence.passed, true);
    assert.equal(recomputeSettlementSaveDiff(before, tampered, plan).passed, false);
  }
});

const summary = { stage: '8.2G-E-A.1', passed, failed: failures.length, failures };
console.log(`\nStage 8.2G-E-A.1 result: ${passed} passed / ${failures.length} failed / ${passed + failures.length} total`);
if (failures.length) { console.error(JSON.stringify(summary, null, 2)); process.exitCode = 1; }
