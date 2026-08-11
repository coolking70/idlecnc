import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SAVE_VERSION, UNITS, UNIT_RANKS, EQUIPMENT, EQUIPMENT_RULES, EQUIPMENT_STAT_KEYS,
  THEATERS, OPERATIONS
} from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { createUnit } from '../js/production.js';
import { createFormation } from '../js/formations.js';
import { recalcDerived } from '../js/economy.js';
import {
  emptyEquipmentState, getEquipmentDefinition, getUnitEquipment,
  getEquipmentComposition, canEquipEquipment, equipEquipment,
  canUnequipEquipment, unequipEquipment, sanitizeEquipment,
  roundEquipmentNumber
} from '../js/equipment.js';
import { getUnitEffectiveStats, sanitizeUnits } from '../js/units.js';
import {
  buildDispatchSnapshot, dispatchFormation, finishBattleReturn,
  replayBattleSession, tickActiveBattle
} from '../js/theater.js';
import { migrate } from '../js/save.js';
import { computeSaveDiff } from '../js/save-diff.js';
import { canonicalHash } from '../js/production-battle-session.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const writeEvidence = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const statsOf = (stats) => Object.fromEntries(EQUIPMENT_STAT_KEYS.concat(['hp']).map((key) => [key, stats[key]]));
const checks = [];
let passed = 0;

function check(name, fn) {
  try {
    fn(); passed += 1; checks.push({ name, passed: true }); console.log(`  PASS  ${name}`);
  } catch (error) {
    checks.push({ name, passed: false, error: error?.stack || String(error) });
    console.error(`  FAIL  ${name}: ${error?.message || error}`);
  }
}

function fixture(types = ['infantry', 'scout_car', 'mbt', 'repair_vehicle']) {
  const state = createInitialState();
  state.resources = { supply: 999999, alloy: 999999, intel: 999999 };
  state.command.capacity = 999;
  types.forEach((type, index) => {
    const unit = createUnit(type, `stage9-b-unit-${index}`);
    unit.id = `stage9-b-unit-${index}`;
    state.units.push(unit);
  });
  const result = createFormation(state, 'Stage 9-B 装备验证编队');
  assert.equal(result.ok, true);
  result.formation.unitIds = state.units.map((unit) => unit.id);
  state.units.forEach((unit) => { unit.formationId = result.formation.id; unit.status = 'assigned'; });
  recalcDerived(state);
  state.command.capacity = 999;
  return state;
}

function formationOf(state) { return state.formations[0]; }

function diffPaths(before, after) {
  return computeSaveDiff(before, after).map((row) => row.path).filter(Boolean);
}

function sourceChangedFiles() {
  return execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
}

console.log('\n── Stage 9-B equipment core / persistence / snapshot ──');

check('equipment model has deterministic definitions, acquisition conditions and no hp modifier', () => {
  assert.equal(SAVE_VERSION, 8);
  assert.equal(EQUIPMENT_RULES.maxSlotsPerUnit, 2);
  assert.equal(Object.keys(EQUIPMENT).length, EQUIPMENT_RULES.starterInventory);
  Object.values(EQUIPMENT).forEach((def) => {
    assert.ok(def.id && def.name && Array.isArray(def.applicableTypes));
    assert.ok(def.acquisition && def.acquisition.kind);
    assert.ok(!Object.prototype.hasOwnProperty.call(def.modifiers, 'hp'));
    assert.ok(!Object.prototype.hasOwnProperty.call(def.modifiers, 'maxHp'));
    Object.keys(def.modifiers).forEach((key) => assert.ok(EQUIPMENT_STAT_KEYS.includes(key)));
  });
  writeEvidence('stage9_b_equipment_model_check.json', {
    stage: '9-B', passed: true, saveVersion: SAVE_VERSION, rules: EQUIPMENT_RULES,
    definitions: clone(EQUIPMENT), inventoryShape: '{ inventory: [{ id, equipmentId, quantity: 1 }], bindings: { unitId: instanceId[] } }',
    bindingRules: ['unit exists', 'equipment exists', 'applicable type', 'unique instance owner', 'max slots']
  });
});

let effectiveEvidence = null;
check('effective stats apply rank first and equipment second with four-decimal rounding', () => {
  const state = fixture(['infantry']);
  const unit = state.units[0]; unit.experience = 30;
  assert.equal(equipEquipment(state, unit.id, 'equipment-starter-1').ok, true);
  assert.equal(equipEquipment(state, unit.id, 'equipment-starter-3').ok, true);
  const actual = getUnitEffectiveStats(unit, state.equipment);
  const expected = {
    attack: roundEquipmentNumber(12 * 1.06),
    antiArmor: roundEquipmentNumber(4 * 1.06),
    defense: roundEquipmentNumber(roundEquipmentNumber(10 * 1.06) * 1.02),
    scouting: roundEquipmentNumber(roundEquipmentNumber(2 * 1.05) * 1.15),
    mobility: roundEquipmentNumber(roundEquipmentNumber(5 * 1) * 1.15 * 1),
    repair: roundEquipmentNumber(roundEquipmentNumber(0 * 1.05) * 1.2),
    hp: 100
  };
  // optics has mobility 1.03; toolkit has no mobility modifier.
  expected.mobility = roundEquipmentNumber(roundEquipmentNumber(5 * 1) * 1.03);
  assert.deepEqual(statsOf(actual), expected);
  assert.equal(actual.hp, unit.maxHp);
  assert.equal(actual.base.hp, unit.maxHp);
  assert.equal(actual.calculation.order, 'base_then_rank_then_equipment');
  assert.equal(actual.calculation.rounding, 'round-half-up-4-decimal-after-each-multiplication');
  effectiveEvidence = {
    stage: '9-B', passed: true, order: ['base', 'rank', 'equipment'], roundingDigits: 4,
    rankId: actual.rankId, equipmentIds: actual.equipmentIds, expected, actual: statsOf(actual),
    hpInvariant: actual.hp === UNITS.infantry.stats.hp && actual.hp === unit.maxHp,
    floatingPointPolicy: actual.calculation
  };
  writeEvidence('stage9_b_effective_stats_check.json', effectiveEvidence);
});

let snapshotEvidence = null;
check('dispatch snapshot contains parsed stats and immutable equipment composition', () => {
  const state = fixture(['infantry', 'mbt']);
  const infantry = state.units[0];
  assert.equal(equipEquipment(state, infantry.id, 'equipment-starter-1').ok, true);
  const snapshot = buildDispatchSnapshot(state, formationOf(state), 'scrap_mine', 'cautious');
  const row = snapshot.units.find((unit) => unit.id === infantry.id);
  const expected = statsOf(getUnitEffectiveStats(infantry, state.equipment));
  assert.deepEqual(row.stats, expected);
  assert.deepEqual(row.equipment, getUnitEquipment(state.equipment, infantry.id));
  assert.deepEqual(snapshot.equipmentComposition[infantry.id], row.equipment);
  assert.ok(!Object.keys(row.stats).some((key) => !EQUIPMENT_STAT_KEYS.concat(['hp']).includes(key)));
  const hash = canonicalHash({ stats: row.stats, equipment: row.equipment });
  state.equipment.bindings[infantry.id] = [];
  assert.equal(canonicalHash({ stats: snapshot.units.find((unit) => unit.id === infantry.id).stats, equipment: snapshot.units.find((unit) => unit.id === infantry.id).equipment }), hash);
  snapshotEvidence = {
    stage: '9-B', passed: true, snapshotVersion: snapshot.snapshotVersion || null,
    unitId: infantry.id, parsedStats: row.stats, equipmentComposition: row.equipment,
    deploymentHashInput: hash, sourceAfterMutationStillHistorical: canonicalHash({ stats: snapshot.units.find((unit) => unit.id === infantry.id).stats, equipment: snapshot.units.find((unit) => unit.id === infantry.id).equipment }) === hash
  };
  writeEvidence('stage9_b_snapshot_binding_check.json', snapshotEvidence);
});

let migrationEvidence = null;
check('migration is additive, old saves become empty equipment and both dangling directions fail closed', () => {
  const legacy = fixture(['infantry']);
  delete legacy.equipment;
  const migratedLegacy = migrate(clone(legacy));
  assert.deepEqual(migratedLegacy.equipment, emptyEquipmentState());
  assert.equal(migratedLegacy.version, SAVE_VERSION);
  const damaged = fixture(['infantry']);
  damaged.equipment.bindings = {
    [damaged.units[0].id]: ['missing-equipment'],
    deleted_unit: ['equipment-starter-1']
  };
  damaged.equipment.inventory.push({ id: 'negative', equipmentId: 'scout_optics', quantity: -1 });
  const repaired = migrate(clone(damaged));
  assert.deepEqual(repaired.equipment.bindings, {});
  assert.ok(!repaired.equipment.inventory.some((row) => row.id === 'negative'));
  migrationEvidence = {
    stage: '9-B', passed: true, saveVersion: SAVE_VERSION,
    oldSaveEquipment: migratedLegacy.equipment, oldSaveCreatesNothing: migratedLegacy.equipment.inventory.length === 0,
    danglingUnitReferenceRemoved: true, danglingEquipmentReferenceRemoved: true,
    sanitizeOrder: ['construction', 'production', 'units', 'equipment', 'operations', 'theaters', 'battles', 'activeBattle', 'repairs', 'formations']
  };
  writeEvidence('stage9_b_migration_check.json', migrationEvidence);
});

check('slot, compatibility, duplicate-instance and invalid-quantity rules are fail closed', () => {
  const state = fixture(['infantry', 'scout_car']);
  assert.equal(canEquipEquipment(state, state.units[0].id, 'equipment-starter-2').code, 'incompatible_unit');
  assert.equal(equipEquipment(state, state.units[0].id, 'equipment-starter-1').ok, true);
  assert.equal(canEquipEquipment(state, state.units[1].id, 'equipment-starter-1').code, 'equipment_bound');
  state.equipment.inventory.push({ id: 'bad-copy', equipmentId: 'scout_optics', quantity: -3 });
  state.equipment.inventory.push({ id: 'bad-copy', equipmentId: 'scout_optics', quantity: 1 });
  state.equipment.bindings[state.units[0].id].push('equipment-starter-3', 'equipment-starter-2');
  sanitizeEquipment(state);
  assert.equal(state.equipment.bindings[state.units[0].id].length, 2);
  assert.equal(state.equipment.inventory.some((row) => row.id === 'bad-copy'), false);
  assert.equal(Object.values(state.equipment.bindings).flat().filter((id) => id === 'equipment-starter-1').length, 1);
});

let isolationEvidence = null;
let replayEvidence = null;
check('running and result states reject equipment mutation without changing authoritative hashes or ledger', () => {
  const state = fixture(['mbt']);
  const unit = state.units[0];
  assert.equal(equipEquipment(state, unit.id, 'equipment-starter-2').ok, true);
  const dispatched = dispatchFormation(state, formationOf(state).id, 'scrap_mine', 'cautious', 1209);
  assert.equal(dispatched.ok, true);
  const sessionId = state.activeBattle.battleSessionId;
  const runningBefore = { sessionId, deploymentHash: state.activeBattle.deploymentHash, formalReportHash: state.activeBattle.formalReportHash, equipment: clone(state.equipment), ledger: clone(state.battleSettlementLedger) };
  const runningAttempt = unequipEquipment(state, unit.id, 'equipment-starter-2');
  assert.equal(runningAttempt.ok, false);
  assert.equal(runningAttempt.code, 'battle_locked');
  assert.equal(state.activeBattle.battleSessionId, runningBefore.sessionId);
  assert.equal(state.activeBattle.deploymentHash, runningBefore.deploymentHash);
  assert.equal(state.activeBattle.formalReportHash, runningBefore.formalReportHash);
  assert.deepEqual(state.equipment, runningBefore.equipment);
  tickActiveBattle(state, state.activeBattle.duration + 1);
  const resultBefore = clone({ session: state.battleSessions[sessionId], ledger: state.battleSettlementLedger, equipment: state.equipment });
  const resultAttempt = unequipEquipment(state, unit.id, 'equipment-starter-2');
  assert.equal(resultAttempt.ok, false);
  assert.equal(resultAttempt.code, 'battle_locked');
  assert.deepEqual({ session: state.battleSessions[sessionId], ledger: state.battleSettlementLedger, equipment: state.equipment }, resultBefore);
  isolationEvidence = {
    stage: '9-B', passed: true, runningAttempt, resultAttempt,
    running: { battleSessionId: runningBefore.sessionId, deploymentHashUnchanged: true, formalReportHashUnchanged: true, equipmentUnchanged: true },
    resultPanel: { ledgerUnchanged: true, noSecondSettlement: true, equipmentUnchanged: true }
  };
  writeEvidence('stage9_b_battle_isolation_check.json', isolationEvidence);
});

check('replay is read-only and old replay remains bound to historical equipment after current change', () => {
  const state = fixture(['mbt']);
  const unit = state.units[0];
  assert.equal(equipEquipment(state, unit.id, 'equipment-starter-2').ok, true);
  assert.equal(dispatchFormation(state, formationOf(state).id, 'scrap_mine', 'cautious', 1210).ok, true);
  const sessionId = state.activeBattle.battleSessionId;
  const historical = clone(state.battleSessions[sessionId].deploymentSnapshot);
  tickActiveBattle(state, state.activeBattle.duration + 1);
  finishBattleReturn(state);
  assert.equal(replayBattleSession(state, sessionId).ok, true);
  const replayBefore = clone(state.activeBattle.dispatchSnapshot);
  const attempt = unequipEquipment(state, unit.id, 'equipment-starter-2');
  assert.equal(attempt.ok, false);
  assert.equal(attempt.code, 'replay_read_only');
  assert.deepEqual(state.activeBattle.dispatchSnapshot, replayBefore);
  tickActiveBattle(state, state.activeBattle.duration + 1);
  finishBattleReturn(state);
  assert.equal(unequipEquipment(state, unit.id, 'equipment-starter-2').ok, true);
  assert.equal(replayBattleSession(state, sessionId).ok, true);
  assert.deepEqual(state.activeBattle.dispatchSnapshot, historical);
  assert.deepEqual(state.activeBattle.dispatchSnapshot.units.find((row) => row.id === unit.id).equipment, historical.units.find((row) => row.id === unit.id).equipment);
  replayEvidence = {
    stage: '9-B', passed: true, sessionId, historicalEquipment: historical.units.find((row) => row.id === unit.id).equipment,
    replayDuringMutation: { rejected: true, code: attempt.code, presentationSnapshotUnchanged: true },
    replayAfterCurrentEquipmentChanged: { usesHistoricalSnapshot: true, currentEquipment: getUnitEquipment(state.equipment, unit.id) }
  };
  writeEvidence('stage9_b_replay_historical_check.json', replayEvidence);
});

let saveDiffEvidence = null;
check('equipment mutation changes only equipment paths and settlement never changes equipment', () => {
  const state = fixture(['mbt']);
  const unit = state.units[0];
  const before = clone(state);
  assert.equal(equipEquipment(state, unit.id, 'equipment-starter-2').ok, true);
  const mountPaths = diffPaths(before, state);
  assert.ok(mountPaths.length > 0 && mountPaths.every((path) => path.startsWith(`equipment.`)));
  const settlementState = fixture(['mbt']);
  assert.equal(equipEquipment(settlementState, settlementState.units[0].id, 'equipment-starter-2').ok, true);
  assert.equal(dispatchFormation(settlementState, formationOf(settlementState).id, 'scrap_mine', 'cautious', 1211).ok, true);
  const equipmentBeforeSettlement = clone(settlementState.equipment);
  tickActiveBattle(settlementState, settlementState.activeBattle.duration + 1);
  assert.deepEqual(settlementState.equipment, equipmentBeforeSettlement);
  const forbidden = ['battleSessions', 'battleSettlementLedger', 'battles', 'formations', 'settings', 'research', 'buildings', 'theaters'];
  assert.ok(mountPaths.every((path) => !forbidden.some((prefix) => path === prefix || path.startsWith(`${prefix}.`))));
  saveDiffEvidence = { stage: '9-B', passed: true, mountChangedPaths: mountPaths, forbiddenPaths: forbidden, settlementEquipmentUnchanged: true };
  writeEvidence('stage9_b_save_diff_check.json', saveDiffEvidence);
});

check('authority freeze, Stage 9-A constants and UI authority boundaries are untouched', () => {
  const changed = sourceChangedFiles();
  const forbidden = [
    'js/battle.js', 'js/battle-presentation/universal/universal-plan-builder.js',
    'js/battle-presentation/universal/universal-choreographer.js', 'tests/lib/'
  ];
  assert.deepEqual(changed.filter((file) => forbidden.some((prefix) => file === prefix || file.startsWith(prefix))), []);
  assert.ok(!changed.includes('js/save-diff.js'));
  assert.equal(Object.keys(THEATERS).length, 6);
  assert.equal(Object.keys(OPERATIONS).length, 6);
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.match(ui, /dataset\.action = 'equip-equipment'/);
  assert.match(ui, /dataset\.action = 'unequip-equipment'/);
  assert.match(ui, /getUnitEffectiveStats\(unit, state\.equipment\)/);
  writeEvidence('stage9_b_authority_check.json', {
    stage: '9-B', passed: true, changedFiles: changed, forbiddenPaths: forbidden,
    solverPlannerChoreographerChanged: false, saveDiffChanged: false,
    stage9A: { theaterCount: Object.keys(THEATERS).length, operationCount: Object.keys(OPERATIONS).length },
    uiReadsAuthoritativeStats: true
  });
});

check('regression fixtures preserve all five unit definitions, four ranks and six theater / operation records', () => {
  assert.equal(Object.keys(UNITS).length, 5);
  assert.equal(Object.keys(UNIT_RANKS).length, 4);
  assert.equal(Object.keys(THEATERS).length, 6);
  assert.equal(Object.keys(OPERATIONS).length, 6);
  const state = fixture(['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle']);
  sanitizeUnits(state);
  assert.equal(state.units.length, 5);
  writeEvidence('stage9_b_regression_check.json', {
    stage: '9-B', passed: true, unitTypes: Object.keys(UNITS), rankIds: Object.keys(UNIT_RANKS),
    theaterCount: Object.keys(THEATERS).length, operationCount: Object.keys(OPERATIONS).length,
    existingBattleSystems: ['E-A', 'E-A.1', 'E-B', 'E-C', '9-A', 'D-C.1']
  });
});

const summary = {
  stage: '9-B', passed, failed: checks.length - passed, total: checks.length, checks,
  evidence: { effectiveEvidence, snapshotEvidence, migrationEvidence, isolationEvidence, replayEvidence, saveDiffEvidence },
  environment: { platform: os.platform(), arch: os.arch(), nodeVersion: process.version }
};
writeEvidence('stage9_b_developer_selfcheck.json', summary);
console.log(`\nStage 9-B equipment core: ${passed} passed / ${checks.length - passed} failed / ${checks.length} total`);
if (checks.length !== passed) process.exitCode = 1;
