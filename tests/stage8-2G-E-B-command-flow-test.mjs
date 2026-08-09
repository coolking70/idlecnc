import assert from 'node:assert/strict';

import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { createUnit } from '../js/production.js';
import { createFormation, addUnit } from '../js/formations.js';
import {
  buildDispatchSnapshot,
  canDispatch,
  canDispatchOperationMission,
  dispatchFormation,
  dispatchOperation,
  finishBattleReturn,
  replayBattleSession,
  settleActiveBattle,
  tickActiveBattle
} from '../js/theater.js';
import { getOperationCost } from '../js/operations.js';
import { getMissionCost } from '../js/theater.js';

const failures = [];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log('  PASS  ' + name);
  } catch (error) {
    failures.push({ name, message: error?.message || String(error) });
    console.log('  FAIL  ' + name + '\n        → ' + (error?.message || error));
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fresh({ captured = false, resources = null } = {}) {
  const state = createInitialState();
  state.resources = resources || { supply: 99999, alloy: 99999, intel: 99999 };
  state.command.capacity = 999;
  ['infantry', 'at_infantry', 'scout_car'].forEach((type, index) => {
    const unit = createUnit(type, 'eb-unit-' + index);
    unit.id = 'eb-unit-' + index;
    state.units.push(unit);
  });
  const formationResult = createFormation(state, 'E-B 指挥编队');
  assert.equal(formationResult.ok, true);
  state.units.forEach((unit) => assert.equal(addUnit(state, formationResult.formation.id, unit.id).ok, true));
  if (captured) state.theaters.scrap_mine.captured = true;
  recalcDerived(state);
  return state;
}

function formation(state) {
  return state.formations[0];
}

function noSideEffects(before, after) {
  assert.equal(JSON.stringify(before), JSON.stringify(after));
}

console.log('\n── Stage 8.2G-E-B mission / deployment command flow ──');

check('campaign eligibility and UI-facing cost source are deterministic', () => {
  const state = fresh();
  const id = formation(state).id;
  const cost = getMissionCost(state, id, 'scrap_mine', 'cautious');
  const eligibility = canDispatch(state, id, 'scrap_mine', 'cautious');
  assert.equal(eligibility.ok, true);
  assert.deepEqual(eligibility.cost, cost.cost);
  assert.equal(eligibility.missing.length, 0);
  assert.equal(cost.breakdown.unitCount, 3);
});

check('operation eligibility and cost come from operations authority', () => {
  const state = fresh({ captured: true });
  const id = formation(state).id;
  const cost = getOperationCost(state, id, 'salvage_run', 'cautious');
  const eligibility = canDispatchOperationMission(state, id, 'salvage_run', 'cautious');
  assert.equal(eligibility.ok, true);
  assert.deepEqual(eligibility.cost, cost.cost);
  assert.equal(cost.breakdown.supplyMultiplier, 4);
});

check('deployment review source equals the snapshot written to active battle', () => {
  const state = fresh();
  const current = formation(state);
  const expected = buildDispatchSnapshot(state, current, 'scrap_mine', 'cautious', 'campaign', 'scrap_mine');
  const result = dispatchFormation(state, current.id, 'scrap_mine', 'cautious', 82072);
  assert.equal(result.ok, true);
  assert.deepEqual(result.activeBattle.dispatchSnapshot, expected);
  assert.deepEqual(state.battleSessions[result.activeBattle.battleSessionId].deploymentSnapshot, expected);
});

check('operation deployment review source includes operation identity', () => {
  const state = fresh({ captured: true });
  const current = formation(state);
  const expected = buildDispatchSnapshot(state, current, 'scrap_mine', 'cautious', 'operation', 'salvage_run');
  const result = dispatchOperation(state, current.id, 'salvage_run', 'cautious', { seed: 82073 });
  assert.equal(result.ok, true);
  assert.equal(result.activeBattle.missionKind, 'operation');
  assert.deepEqual(result.activeBattle.dispatchSnapshot, expected);
  assert.equal(result.activeBattle.dispatchSnapshot.missionId, 'salvage_run');
});

check('captured campaign target is rejected with readable authority code', () => {
  const state = fresh({ captured: true });
  const before = clone(state);
  const result = dispatchFormation(state, formation(state).id, 'scrap_mine', 'cautious', 82074);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'captured');
  noSideEffects(before, state);
});

check('uncaptured operation target is rejected without consuming resources', () => {
  const state = fresh();
  const before = clone(state);
  const result = dispatchOperation(state, formation(state).id, 'salvage_run', 'cautious', { seed: 82075 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'theater_not_captured');
  noSideEffects(before, state);
});

check('cooldown rejection has no session or resource side effect', () => {
  const state = fresh({ captured: true });
  state.operations.salvage_run.cooldownUntil = state.time.game + 100;
  const before = clone(state);
  const result = dispatchOperation(state, formation(state).id, 'salvage_run', 'cautious', { seed: 82076 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'cooldown');
  noSideEffects(before, state);
});

check('resource rejection has no session, deployment, or partial write', () => {
  const state = fresh({ resources: { supply: 0, alloy: 0, intel: 0 } });
  const before = clone(state);
  const result = dispatchFormation(state, formation(state).id, 'scrap_mine', 'cautious', 82077);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'insufficient');
  noSideEffects(before, state);
});

check('double dispatch produces exactly one battle session', () => {
  const state = fresh();
  const id = formation(state).id;
  const beforeSequence = state.battleSessionSequence;
  const first = dispatchFormation(state, id, 'scrap_mine', 'cautious', 82078);
  const second = dispatchFormation(state, id, 'scrap_mine', 'cautious', 82078);
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'battle_active');
  assert.equal(state.battleSessionSequence, beforeSequence + 1);
  assert.equal(Object.keys(state.battleSessions).length, 1);
});

check('failed solver path rolls back cost and leaves no active session', () => {
  const state = fresh();
  const before = clone(state);
  const original = state.formations[0].unitIds.slice();
  state.formations[0].unitIds = ['missing-unit'];
  const result = dispatchFormation(state, formation(state).id, 'scrap_mine', 'cautious', 82079);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'unknown_unit');
  state.formations[0].unitIds = original;
  assert.equal(state.activeBattle, null);
  assert.equal(state.battleSessionSequence, before.battleSessionSequence);
  assert.deepEqual(state.resources, before.resources);
});

check('replay remains read-only and blocks a new dispatch', () => {
  const state = fresh();
  const launched = dispatchFormation(state, formation(state).id, 'scrap_mine', 'cautious', 82080);
  assert.equal(launched.ok, true);
  tickActiveBattle(state, launched.activeBattle.duration + 1);
  const sessionId = launched.activeBattle.battleSessionId;
  finishBattleReturn(state);
  assert.equal(replayBattleSession(state, sessionId).ok, true);
  const beforeSequence = state.battleSessionSequence;
  const blocked = dispatchFormation(state, formation(state).id, 'scrap_mine', 'cautious', 82081);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'battle_active');
  assert.equal(state.battleSessionSequence, beforeSequence);
  assert.equal(settleActiveBattle(state).ok, false);
});

check('operation result enters cooldown only after the authoritative battle settles', () => {
  const state = fresh({ captured: true });
  const launched = dispatchOperation(state, formation(state).id, 'salvage_run', 'cautious', { seed: 82082 });
  assert.equal(launched.ok, true);
  assert.equal(state.operations.salvage_run.cooldownUntil, 0);
  tickActiveBattle(state, launched.activeBattle.duration + 1);
  assert.ok(state.operations.salvage_run.cooldownUntil > state.time.game);
});

console.log('\\nStage 8.2G-E-B result: ' + passed + ' passed / ' + failures.length + ' failed / ' + (passed + failures.length) + ' total');
if (failures.length) {
  console.error(JSON.stringify({ stage: '8.2G-E-B', failures }, null, 2));
  process.exitCode = 1;
}
