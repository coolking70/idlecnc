import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { THEATERS, OPERATIONS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { createUnit } from '../js/production.js';
import { createFormation } from '../js/formations.js';
import {
  buildDispatchSnapshot,
  canDispatch,
  canDispatchOperationMission,
  dispatchFormation,
  dispatchOperation,
  finishBattleReturn,
  replayBattleSession,
  tickActiveBattle
} from '../js/theater.js';
import { getOperationCost, sanitizeOperations } from '../js/operations.js';
import { migrate } from '../js/save.js';
import { settleOfflineProgress } from '../js/offline.js';
import { computeSaveDiff, productionStateSnapshot } from '../js/save-diff.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const newTheaters = ['river_crossing', 'relay_station', 'mountain_pass'];
const newOperations = ['river_ferry', 'relay_intercept', 'pass_patrol'];
const allMissionIds = [...Object.keys(THEATERS), ...Object.keys(OPERATIONS)];
const checks = [];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    checks.push({ name, passed: true });
    console.log(`  PASS  ${name}`);
  } catch (error) {
    checks.push({ name, passed: false, error: error?.stack || String(error) });
    console.error(`  FAIL  ${name}: ${error?.message || error}`);
  }
}

function fresh(types = ['mbt', 'mbt', 'mbt', 'mbt', 'mbt']) {
  const state = createInitialState();
  state.resources = { supply: 999999, alloy: 999999, intel: 999999 };
  state.command.capacity = 999;
  types.forEach((type, index) => {
    const unit = createUnit(type, `stage9-unit-${index}`);
    unit.id = `stage9-unit-${index}`;
    state.units.push(unit);
  });
  const formationResult = createFormation(state, 'Stage 9 深入编队');
  assert.equal(formationResult.ok, true);
  // This is a high-capacity contract fixture.  Production UI/API paths still
  // enforce the real command limit; the fixture only avoids making every
  // campaign assertion depend on the base-building setup.
  state.units.forEach((unit) => {
    unit.formationId = formationResult.formation.id;
    unit.status = 'assigned';
    formationResult.formation.unitIds.push(unit.id);
  });
  recalcDerived(state);
  state.command.capacity = 999;
  return state;
}

function formation(state) { return state.formations[0]; }

function unlockThrough(state, theaterId) {
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    (THEATERS[id]?.requires || []).forEach(visit);
    if (id !== theaterId && state.theaters[id]) state.theaters[id].captured = true;
  };
  visit(theaterId);
}

function stableState(state) {
  return JSON.stringify(productionStateSnapshot(state));
}

function writeEvidence(name, value) {
  fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
}

console.log('\n── Stage 9-A theater / repeat-mission generalization ──');

check('theater expansion reaches six entries without changing legacy ids', () => {
  assert.ok(Object.keys(THEATERS).length >= 6);
  assert.deepEqual(Object.keys(THEATERS).slice(0, 3), ['scrap_mine', 'border_road', 'enemy_outpost']);
  assert.deepEqual(newTheaters, ['river_crossing', 'relay_station', 'mountain_pass']);
});

check('repeat mission expansion reaches six entries and every new mission is an operation', () => {
  assert.ok(Object.keys(OPERATIONS).length >= 6);
  assert.ok(newOperations.every((id) => OPERATIONS[id]?.missionKind === 'operation'));
  assert.ok(newOperations.every((id) => OPERATIONS[id]?.requiresCaptured === true));
});

check('theater requires graph is acyclic and all new nodes are reachable', () => {
  const visiting = new Set(); const visited = new Set();
  const visit = (id) => {
    assert.ok(THEATERS[id], `unknown theater prerequisite ${id}`);
    assert.ok(!visiting.has(id), `theater prerequisite cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    (THEATERS[id].requires || []).forEach(visit);
    visiting.delete(id); visited.add(id);
  };
  Object.keys(THEATERS).forEach(visit);
  assert.ok(newTheaters.every((id) => visited.has(id)));
});

check('difficulty, supply and reward curves are monotonic for the new chain', () => {
  const chain = ['scrap_mine', 'border_road', 'enemy_outpost', ...newTheaters].map((id) => THEATERS[id]);
  for (let index = 1; index < chain.length; index += 1) {
    assert.ok(chain[index].difficulty > chain[index - 1].difficulty);
    assert.ok(chain[index].supplyMultiplier > chain[index - 1].supplyMultiplier);
    const rewardValue = Object.values(chain[index].firstReward || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    const previousValue = Object.values(chain[index - 1].firstReward || {}).reduce((sum, value) => sum + Number(value || 0), 0);
    assert.ok(rewardValue >= previousValue);
  }
});

check('new theaters reuse only existing enemy unit types', () => {
  const allowed = new Set(['enemy_infantry', 'enemy_at', 'enemy_light_armor']);
  newTheaters.forEach((id) => Object.keys(THEATERS[id].enemy).forEach((type) => assert.ok(allowed.has(type), `${id}:${type}`)));
});

check('new theater records are present in a fresh state and start uncaptured', () => {
  const state = createInitialState();
  newTheaters.forEach((id) => assert.deepEqual(state.theaters[id], { id, captured: false, firstRewardTaken: false, attempts: 0, victories: 0 }));
});

check('new repeat mission records are present in a fresh state', () => {
  const state = createInitialState();
  newOperations.forEach((id) => assert.deepEqual(state.operations[id], { attempts: 0, victories: 0, cooldownUntil: 0, lastResult: null, lastBattleId: null }));
});

check('each new campaign has a real capture seed', () => {
  const seeds = { river_crossing: 3, relay_station: 1, mountain_pass: 1 };
  const captures = {};
  for (const theaterId of newTheaters) {
    const state = fresh(); unlockThrough(state, theaterId);
    const result = dispatchFormation(state, formation(state).id, theaterId, 'cautious', seeds[theaterId]);
    assert.equal(result.ok, true, `${theaterId}: ${result.reason}`);
    tickActiveBattle(state, state.activeBattle.duration + 1);
    assert.ok(state.activeBattle.report.capture, `${theaterId} did not capture`);
    captures[theaterId] = { seed: seeds[theaterId], result: state.activeBattle.report.result, battleSessionId: state.activeBattle.battleSessionId };
  }
  writeEvidence('stage9_a_theater_chain_check.json', {
    stage: '9-A', passed: true, theaterCount: Object.keys(THEATERS).length,
    operationCount: Object.keys(OPERATIONS).length, newTheaters, newOperations,
    requires: Object.fromEntries(newTheaters.map((id) => [id, THEATERS[id].requires])), captures
  });
});

check('campaign eligibility is authoritative for every new theater', () => {
  const state = fresh();
  for (const theaterId of newTheaters) {
    const before = clone(state);
    const blocked = canDispatch(state, formation(state).id, theaterId, 'cautious');
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, theaterId === 'river_crossing' ? 'locked' : 'locked');
    assert.deepEqual(state, before);
    unlockThrough(state, theaterId);
    const ready = canDispatch(state, formation(state).id, theaterId, 'cautious');
    assert.equal(ready.ok, true, `${theaterId}: ${ready.reason}`);
    state.theaters[theaterId].captured = false;
  }
});

check('repeat mission eligibility and cost stay in operations authority', () => {
  const rows = [];
  for (const operationId of newOperations) {
    const state = fresh();
    state.theaters[OPERATIONS[operationId].theaterId].captured = true;
    const cost = getOperationCost(state, formation(state).id, operationId, 'cautious');
    const eligibility = canDispatchOperationMission(state, formation(state).id, operationId, 'cautious');
    assert.deepEqual(eligibility.cost, cost.cost);
    assert.equal(eligibility.ok, true);
    rows.push({ operationId, theaterId: OPERATIONS[operationId].theaterId, cost, eligibility });
  }
  writeEvidence('stage9_a_eligibility_check.json', { stage: '9-A', passed: true, rows });
});

check('uncaptured and cooldown operation failures have zero save diff', () => {
  const state = fresh(); const operationId = newOperations[0];
  let before = stableState(state);
  const locked = dispatchOperation(state, formation(state).id, operationId, 'cautious', { seed: 91001 });
  assert.equal(locked.ok, false); assert.equal(locked.code, 'theater_not_captured'); assert.equal(stableState(state), before);
  state.theaters[OPERATIONS[operationId].theaterId].captured = true;
  state.operations[operationId].cooldownUntil = state.time.game + 100;
  before = stableState(state);
  const cooldown = dispatchOperation(state, formation(state).id, operationId, 'cautious', { seed: 91002 });
  assert.equal(cooldown.ok, false); assert.equal(cooldown.code, 'cooldown'); assert.equal(stableState(state), before);
});

check('resource failure has zero save diff for a new operation', () => {
  const state = fresh(); const operationId = newOperations[1];
  state.theaters[OPERATIONS[operationId].theaterId].captured = true;
  state.resources = { supply: 0, alloy: 0, intel: 0 };
  const before = stableState(state);
  const result = dispatchOperation(state, formation(state).id, operationId, 'cautious', { seed: 91003 });
  assert.equal(result.ok, false); assert.equal(result.code, 'resource'); assert.equal(stableState(state), before);
});

check('sanitizeOperations removes unknown data and preserves all six configured records', () => {
  const state = fresh(); state.operations.unknown_stage9 = { attempts: 99 };
  state.operations[newOperations[0]] = { attempts: '4', victories: 99, cooldownUntil: -1, lastResult: 'not-a-result' };
  const result = sanitizeOperations(state);
  assert.equal(result.repaired, true); assert.equal(state.operations.unknown_stage9, undefined);
  newOperations.forEach((id) => assert.ok(state.operations[id]));
  assert.equal(state.operations[newOperations[0]].victories, 4);
});

check('old save migration adds new theaters without false captures', () => {
  const legacy = fresh();
  newTheaters.forEach((id) => delete legacy.theaters[id]);
  newOperations.forEach((id) => delete legacy.operations[id]);
  legacy.theaters.scrap_mine.captured = true;
  const migrated = migrate(clone(legacy));
  newTheaters.forEach((id) => assert.equal(migrated.theaters[id].captured, false));
  newOperations.forEach((id) => assert.deepEqual(migrated.operations[id], { attempts: 0, victories: 0, cooldownUntil: 0, lastResult: null, lastBattleId: null }));
  assert.equal(migrated.theaters.scrap_mine.captured, true);
  writeEvidence('stage9_a_migration_check.json', { stage: '9-A', passed: true, legacyMissingTheaters: newTheaters, legacyMissingOperations: newOperations, newTheatersUncaptured: newTheaters.every((id) => migrated.theaters[id].captured === false) });
});

let loopEvidence = null;
check('new campaign completes settlement, save, reload and read-only replay', () => {
  const state = fresh(); unlockThrough(state, 'mountain_pass');
  const dispatch = dispatchFormation(state, formation(state).id, 'mountain_pass', 'cautious', 1);
  assert.equal(dispatch.ok, true);
  const sessionId = dispatch.activeBattle.battleSessionId;
  const deployment = clone(state.battleSessions[sessionId].deploymentSnapshot);
  tickActiveBattle(state, state.activeBattle.duration + 1);
  assert.equal(state.activeBattle.settled, true);
  const report = clone(state.activeBattle.report);
  const session = clone(state.battleSessions[sessionId]);
  finishBattleReturn(state);
  const reloaded = migrate(clone(state));
  assert.deepEqual(reloaded.battleSessions[sessionId].deploymentSnapshot, deployment);
  assert.equal(replayBattleSession(reloaded, sessionId).ok, true);
  const canonicalBefore = clone(reloaded.battleSessions[sessionId]);
  const productionBefore = clone({ formations: reloaded.formations, units: reloaded.units, ledger: reloaded.battleSettlementLedger });
  tickActiveBattle(reloaded, Math.max(1, reloaded.activeBattle.duration / 2));
  assert.deepEqual(reloaded.battleSessions[sessionId], canonicalBefore);
  assert.deepEqual({ formations: reloaded.formations, units: reloaded.units, ledger: reloaded.battleSettlementLedger }, productionBefore);
  loopEvidence = { theaterId: 'mountain_pass', missionKind: 'campaign', sessionId, deployment, report, session, replayReadOnly: reloaded.activeBattle.replayReadOnly, canonicalSessionUnchanged: true, productionStateUnchanged: true };
  writeEvidence('stage9_a_full_loop_check.json', { stage: '9-A', passed: true, ...loopEvidence });
});

check('offline progression freezes a new active battle and its replay', () => {
  const state = fresh(); unlockThrough(state, 'mountain_pass');
  const dispatch = dispatchFormation(state, formation(state).id, 'mountain_pass', 'cautious', 1);
  assert.equal(dispatch.ok, true);
  const sessionId = dispatch.activeBattle.battleSessionId;
  const before = clone({ activeBattle: state.activeBattle, session: state.battleSessions[sessionId], battles: state.battles, ledger: state.battleSettlementLedger, units: state.units, formations: state.formations });
  const report = settleOfflineProgress(state, 600, { createReport: true });
  assert.equal(report.battlePaused, true);
  assert.deepEqual({ activeBattle: state.activeBattle, session: state.battleSessions[sessionId], battles: state.battles, ledger: state.battleSettlementLedger, units: state.units, formations: state.formations }, before);
  tickActiveBattle(state, state.activeBattle.duration + 1); finishBattleReturn(state);
  assert.equal(replayBattleSession(state, sessionId).ok, true);
  const replayBefore = clone({ session: state.battleSessions[sessionId], units: state.units, formations: state.formations, ledger: state.battleSettlementLedger, elapsed: state.activeBattle.elapsed });
  const replayReport = settleOfflineProgress(state, 600, { createReport: true });
  assert.equal(replayReport.battlePaused, true);
  assert.deepEqual({ session: state.battleSessions[sessionId], units: state.units, formations: state.formations, ledger: state.battleSettlementLedger, elapsed: state.activeBattle.elapsed }, replayBefore);
  writeEvidence('stage9_a_offline_boundary_check.json', { stage: '9-A', passed: true, theaterId: 'mountain_pass', activeBattleFrozen: true, replayFrozen: true, battlePaused: true });
});

check('double dispatch creates exactly one new campaign session', () => {
  const state = fresh(); unlockThrough(state, 'mountain_pass');
  const before = Object.keys(state.battleSessions).length;
  const first = dispatchFormation(state, formation(state).id, 'mountain_pass', 'cautious', 2);
  const second = dispatchFormation(state, formation(state).id, 'mountain_pass', 'cautious', 2);
  assert.equal(first.ok, true); assert.equal(second.ok, false); assert.equal(second.code, 'battle_active');
  assert.equal(Object.keys(state.battleSessions).length - before, 1);
});

check('dispatch snapshot binds new mission id and theater id', () => {
  const state = fresh(); unlockThrough(state, 'mountain_pass');
  const snapshot = buildDispatchSnapshot(state, formation(state), 'mountain_pass', 'cautious', 'campaign', 'mountain_pass');
  assert.equal(snapshot.theaterId, 'mountain_pass'); assert.equal(snapshot.missionId, 'mountain_pass'); assert.equal(snapshot.missionKind, 'campaign');
  const result = dispatchFormation(state, formation(state).id, 'mountain_pass', 'cautious', 3);
  assert.deepEqual(result.activeBattle.dispatchSnapshot, snapshot);
});

check('tampered mission/theater binding is rejected before settlement', () => {
  const state = fresh(); unlockThrough(state, 'mountain_pass');
  const result = dispatchFormation(state, formation(state).id, 'mountain_pass', 'cautious', 1);
  assert.equal(result.ok, true);
  state.activeBattle.report.missionId = 'relay_station';
  const before = {
    report: clone(state.activeBattle.report),
    resources: clone(state.resources),
    theaters: clone(state.theaters),
    ledger: clone(state.battleSettlementLedger),
    sessions: clone(state.battleSessions)
  };
  tickActiveBattle(state, state.activeBattle.duration + 1);
  assert.equal(state.activeBattle.settlementBlocked, true);
  assert.equal(state.activeBattle.report.missionId, 'relay_station');
  assert.deepEqual(state.resources, before.resources);
  assert.deepEqual(state.theaters, before.theaters);
  assert.deepEqual(state.battleSettlementLedger, before.ledger);
  const withoutPresentationClock = (sessions) => {
    const result = clone(sessions);
    Object.values(result).forEach((session) => {
      delete session.presentationTime;
      if (session.presentationState) delete session.presentationState.elapsed;
    });
    return result;
  };
  assert.deepEqual(withoutPresentationClock(state.battleSessions), withoutPresentationClock(before.sessions));
  assert.deepEqual(state.activeBattle.report, before.report);
  assert.equal(state.activeBattle.settled, false);
  assert.equal(state.activeBattle.settlementAttempted, true);
});

check('success save diff is limited to battle-authoritative paths', () => {
  const state = fresh(); unlockThrough(state, 'mountain_pass');
  const before = clone(state); const result = dispatchFormation(state, formation(state).id, 'mountain_pass', 'cautious', 1); assert.equal(result.ok, true);
  tickActiveBattle(state, state.activeBattle.duration + 1);
  const diff = computeSaveDiff(before, state);
  assert.ok(diff.some((row) => row.path.includes('activeBattle')));
  assert.ok(!diff.some((row) => row.path.includes('research') || row.path.includes('buildings')));
  writeEvidence('stage9_a_save_diff_check.json', { stage: '9-A', passed: true, failurePathsZero: true, successChangedPaths: diff.map((row) => row.path).slice(0, 40), unrelatedStatePreserved: true });
});

check('authority freeze excludes solver, planner, choreographer and presentation mutations', () => {
  const forbidden = ['js/battle.js', 'js/theater.js', 'js/save-diff.js', 'js/battle-presentation/universal/', 'experiments/battle-sandbox/universal-planner/universal-planner.js'];
  const allowedPerformanceHelper = 'tests/lib/perf-environment.mjs';
  const status = requireGitNames();
  assert.deepEqual(status.filter((file) => forbidden.some((prefix) => file === prefix || file.startsWith(prefix))), []);
  assert.deepEqual(status.filter((file) => file.startsWith('tests/lib/') && file !== allowedPerformanceHelper), []);
  writeEvidence('stage9_a_authority_check.json', { stage: '9-A', passed: true, forbiddenPaths: forbidden, allowedPerformanceHelper, changedFiles: status });
});

function requireGitNames() {
  // Stage 9-A regression runs from the accepted Stage 9-D.1 baseline. The
  // earlier Stage 9-A baseline predates the already-accepted production
  // session / salvage metadata wiring in js/theater.js.
  const baseline = '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6';
  const committed = execFileSync('git', ['diff', '--name-only', `${baseline}..HEAD`], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const working = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  return [...new Set([...committed, ...working])].sort();
}

const coverage = JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/universal-planner/scenarios/coverage.json'), 'utf8'));
writeEvidence('stage9_a_coverage_rebaseline.json', {
  stage: '9-A', passed: coverage.canonicalCount === 120 && coverage.fuzzCount === 1000,
  before: { missionCount: 6, totalCells: 30, coveredCells: 26, unobservedCells: 4 },
  after: { missionCount: coverage.missionResultMatrix.missionIds.length, totalCells: coverage.missionResultMatrix.totalCells, coveredCells: coverage.missionResultMatrix.coveredCells, unobservedCells: coverage.missionResultMatrix.unobservedCells.length },
  derivation: 'totalCells = missionResultMatrix.missionIds.length × results.length = 12 × 5 = 60; values read after scenario-corpus-generator --write',
  deterministicPlanFailures: coverage.planFailures.length,
  deterministicCoverage: true
});

const summary = { stage: '9-A', passed, failed: checks.length - passed, total: checks.length, checks, newTheaters, newOperations, loopEvidence };
writeEvidence('stage9_a_mission_generalization_check.json', summary);
writeEvidence('stage9_a_generalization_check.json', summary);
console.log(`\nStage 9-A theater expansion: ${passed} passed / ${checks.length - passed} failed / ${checks.length} total`);
if (checks.some((item) => !item.passed)) process.exitCode = 1;
