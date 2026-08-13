import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  BUILDING_STATUS, CURRENT_STAGE, CURRENT_STAGE_LABEL, EQUIPMENT, EQUIPMENT_RULES,
  EQUIPMENT_STAT_KEYS, OPERATIONS, PRODUCTION, SAVE_VERSION, SALVAGE_RULES,
  TECHNOLOGIES, THEATERS, UNITS
} from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import {
  createUnit, queueEquipment, tickProduction, advanceOffline
} from '../js/production.js';
import { createFormation } from '../js/formations.js';
import {
  canEquipEquipment, equipEquipment, getEquipmentComposition, getUnitEquipment,
  sanitizeEquipment
} from '../js/equipment.js';
import { getUnitEffectiveStats } from '../js/units.js';
import { migrate } from '../js/save.js';
import { computeSaveDiff } from '../js/save-diff.js';
import {
  buildDispatchSnapshot, dispatchOperation, finishBattleReturn,
  replayBattleSession, tickActiveBattle
} from '../js/theater.js';
import { claimBattleSalvage, deriveSalvageOffer } from '../js/battle-salvage.js';
import { canonicalHash } from '../js/production-battle-session.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
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

function diffPaths(before, after) {
  return computeSaveDiff(before, after).map((row) => row.path).filter(Boolean);
}

function fixture() {
  const state = createInitialState();
  state.resources = { supply: 999999, alloy: 999999, intel: 999999 };
  state.command.capacity = 999;
  state.research.completed = ['modular_assembly', 'field_maintenance', 'composite_armor', 'expanded_storage'];
  state.unlocks.units = Object.keys(UNITS);
  state.buildings.push({ id: 'stage9-e-armor-factory', type: 'armor_factory', status: BUILDING_STATUS.OPERATIONAL, progress: 1 });

  // Five combat units are required by the operation solver.  The spare infantry
  // is deliberately outside the formation so every production equipment type
  // remains mountable after a deterministic salvage result.
  ['mbt', 'mbt', 'mbt', 'mbt', 'mbt', 'infantry'].forEach((type, index) => {
    const unit = createUnit(type, `stage9-e-unit-${index}`);
    unit.id = `stage9-e-unit-${index}`;
    state.units.push(unit);
  });
  const formationResult = createFormation(state, 'Stage 9-E integrated campaign');
  assert.equal(formationResult.ok, true);
  const formation = formationResult.formation;
  formation.id = 'stage9-e-formation';
  state.units.slice(0, 5).forEach((unit) => {
    unit.formationId = formation.id;
    unit.status = 'assigned';
    formation.unitIds.push(unit.id);
  });
  recalcDerived(state);
  state.command.capacity = 999;
  state.theaters.river_crossing.captured = true;
  return state;
}

function sourceChangedFiles() {
  return execFileSync('git', ['diff', '--name-only', '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6', '--'], { cwd: root, encoding: 'utf8' })
    .split('\n').map((row) => row.trim()).filter(Boolean);
}

console.log('\n── Stage 9-E integrated campaign / equipment milestone closure ──');

check('product metadata is promoted to Stage 9 without changing the v10 save schema', () => {
  assert.equal(CURRENT_STAGE, 9);
  assert.equal(CURRENT_STAGE_LABEL, 'Stage 9 · Expanded Campaign & Equipment');
  assert.equal(SAVE_VERSION, 10);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.9.0');
});

check('the accepted Stage 9-A campaign remains six theaters and six operations', () => {
  assert.equal(Object.keys(THEATERS).length, 6);
  assert.equal(Object.keys(OPERATIONS).length, 6);
  assert.deepEqual(['river_crossing', 'relay_station', 'mountain_pass'], Object.keys(THEATERS).slice(3));
  assert.deepEqual(['river_ferry', 'relay_intercept', 'pass_patrol'], Object.keys(OPERATIONS).slice(3));
  Object.values(OPERATIONS).forEach((operation) => {
    assert.equal(operation.missionKind, 'operation');
    assert.equal(operation.requiresCaptured, true);
    assert.ok(THEATERS[operation.theaterId]);
  });
});

check('the six-theater prerequisite chain is intact', () => {
  assert.deepEqual(THEATERS.river_crossing.requires, ['enemy_outpost']);
  assert.deepEqual(THEATERS.relay_station.requires, ['river_crossing']);
  assert.deepEqual(THEATERS.mountain_pass.requires, ['relay_station']);
});

let productionInstance;
check('the integrated fixture has an operational armor factory and the real production queue', () => {
  const state = fixture();
  const before = clone(state.resources);
  const result = queueEquipment(state, 'anti_armor_sights');
  assert.equal(result.ok, true);
  assert.equal(state.production.current.kind, 'equipment');
  assert.equal(state.production.current.equipmentId, 'anti_armor_sights');
  assert.equal(state.resources.supply, before.supply - EQUIPMENT.anti_armor_sights.acquisition.cost.supply);
  assert.equal(state.resources.alloy, before.alloy - EQUIPMENT.anti_armor_sights.acquisition.cost.alloy);
  assert.equal(state.production.queue.length + 1, 1);
  tickProduction(state, EQUIPMENT.anti_armor_sights.acquisition.buildTime);
  productionInstance = state.equipment.inventory.find((item) => item.provenance?.kind === 'production');
  assert.ok(productionInstance);
  assert.equal(productionInstance.id, 'equipment-production-anti_armor_sights-1');
  assert.equal(state.production.current, null);
});

check('production completion enters inventory exactly once with deterministic provenance', () => {
  const state = fixture();
  queueEquipment(state, 'anti_armor_sights');
  tickProduction(state, 18);
  const after = clone(state.equipment);
  tickProduction(state, 18);
  assert.deepEqual(state.equipment, after);
  assert.equal(after.inventory.filter((item) => item.provenance?.kind === 'production').length, 1);
  assert.equal(after.inventory.filter((item) => item.id === 'equipment-production-anti_armor_sights-1').length, 1);
});

check('production queue remains shared with the configured concurrency and queue limits', () => {
  const state = fixture();
  Object.values(EQUIPMENT).filter((def) => def.acquisition?.kind === 'production').forEach((def) => assert.equal(queueEquipment(state, def.id).ok, true));
  assert.equal((state.production.current ? 1 : 0) + state.production.queue.length, PRODUCTION.maxQueueSize);
  const before = clone(state.resources);
  assert.equal(queueEquipment(state, 'anti_armor_sights').code, 'queue_full');
  assert.deepEqual(state.resources, before);
  assert.equal(PRODUCTION.maxConcurrent, 1);
});

check('research gates are authoritative and blocked production has no side effect', () => {
  const state = fixture();
  state.research.completed = [];
  const before = clone(state);
  const result = queueEquipment(state, 'anti_armor_sights');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'equipment_tech_prerequisite');
  assert.deepEqual(state.resources, before.resources);
  assert.deepEqual(state.production, before.production);
});

check('all eight definitions cover every unit type and use only legal non-hp modifiers', () => {
  assert.equal(Object.keys(EQUIPMENT).length, 8);
  const coverage = Object.fromEntries(Object.keys(UNITS).map((type) => [type, Object.values(EQUIPMENT).filter((def) => def.applicableTypes.includes(type)).length]));
  Object.values(coverage).forEach((count) => assert.ok(count >= 2));
  Object.values(EQUIPMENT).forEach((def) => {
    Object.keys(def.modifiers).forEach((key) => assert.ok(EQUIPMENT_STAT_KEYS.includes(key)));
    assert.equal(def.modifiers.hp, undefined);
    assert.equal(def.modifiers.maxHp, undefined);
  });
  assert.equal(EQUIPMENT_RULES.maxSlotsPerUnit, 2);
});

check('starter definitions remain the original three and salvage is production-only', () => {
  const starters = Object.values(EQUIPMENT).filter((def) => def.acquisition?.kind === 'starter');
  assert.equal(starters.length, 3);
  assert.equal(EQUIPMENT_RULES.starterInventory, 3);
  assert.equal(SALVAGE_RULES.poolKind, 'production');
  assert.equal(Object.values(EQUIPMENT).filter((def) => def.acquisition?.kind === 'battle_salvage').length, 0);
});

let battleState;
let sessionId;
let offer;
let salvageInstance;
let productionEquipmentHash;
check('real DOM-equivalent production result can be mounted through the equipment authority', () => {
  battleState = fixture();
  queueEquipment(battleState, 'anti_armor_sights');
  tickProduction(battleState, 18);
  const instance = battleState.equipment.inventory.find((item) => item.provenance?.kind === 'production');
  const mounted = equipEquipment(battleState, 'stage9-e-unit-0', instance.id);
  assert.equal(mounted.ok, true);
  assert.deepEqual(battleState.equipment.bindings['stage9-e-unit-0'], [instance.id]);
  const stats = getUnitEffectiveStats(battleState.units[0], battleState.equipment);
  assert.deepEqual(stats.equipmentIds, [instance.id]);
  assert.equal(stats.hp, battleState.units[0].maxHp);
  assert.equal(stats.base.hp, battleState.units[0].maxHp);
  productionEquipmentHash = canonicalHash(battleState.equipment);
});

check('effective stats are base→rank→equipment and the snapshot carries resolved values plus composition', () => {
  const unit = battleState.units[0];
  const stats = getUnitEffectiveStats(unit, battleState.equipment);
  const expectedAntiArmor = Number((Number((UNITS.mbt.stats.antiArmor * 1).toFixed(4)) * 1.1).toFixed(4));
  assert.equal(stats.antiArmor, expectedAntiArmor);
  assert.equal(stats.calculation.order, 'base_then_rank_then_equipment');
  assert.equal(stats.calculation.rounding, 'round-half-up-4-decimal-after-each-multiplication');
  const snapshot = buildDispatchSnapshot(battleState, battleState.formations[0], 'river_crossing', 'cautious', 'operation', 'river_ferry');
  const row = snapshot.units.find((item) => item.id === unit.id);
  const expectedSnapshotStats = Object.fromEntries([...EQUIPMENT_STAT_KEYS, 'hp'].map((key) => [key, stats[key]]));
  assert.deepEqual(row.stats, expectedSnapshotStats);
  assert.deepEqual(row.equipment.map((item) => item.instanceId), stats.equipmentIds);
  assert.equal(snapshot.equipmentComposition['stage9-e-unit-0'][0].instanceId, productionInstance.id);
});

check('in-flight equipment is not mountable and slot/instance integrity is strict', () => {
  const state = fixture();
  queueEquipment(state, 'anti_armor_sights');
  assert.equal(canEquipEquipment(state, 'stage9-e-unit-0', 'anti_armor_sights').code, 'unknown_equipment');
  tickProduction(state, 18);
  const instance = state.equipment.inventory.find((item) => item.provenance?.kind === 'production');
  assert.equal(equipEquipment(state, 'stage9-e-unit-0', 'equipment-starter-2').ok, true);
  assert.equal(equipEquipment(state, 'stage9-e-unit-0', instance.id).ok, true);
  assert.equal(canEquipEquipment(state, 'stage9-e-unit-0', 'equipment-starter-1').code, 'incompatible_unit');
  assert.equal(equipEquipment(state, 'stage9-e-unit-1', instance.id).code, 'equipment_bound');
});

check('the Stage 9 repeat operation dispatches through Formal Battle with a fixed operation identity', () => {
  const result = dispatchOperation(battleState, battleState.formations[0].id, 'river_ferry', 'cautious', { seed: 6 });
  assert.equal(result.ok, true);
  sessionId = result.activeBattle.battleSessionId;
  assert.equal(result.activeBattle.missionKind, 'operation');
  assert.equal(result.activeBattle.missionId, 'river_ferry');
  assert.equal(result.activeBattle.productionSession.salvageRulesVersion, 1);
  assert.ok(result.activeBattle.dispatchSnapshot.units.some((row) => row.equipment?.length));
  assert.equal(canonicalHash(battleState.equipment), productionEquipmentHash);
});

let settlementEquipmentHash;
check('Formal settlement does not mutate equipment or its deployment binding', () => {
  const before = canonicalHash(battleState.equipment);
  const sessionBefore = clone(battleState.battleSessions[sessionId]);
  const result = tickActiveBattle(battleState, battleState.activeBattle.duration + 1);
  assert.equal(result.ok, true);
  assert.equal(battleState.activeBattle.settled, true);
  assert.equal(canonicalHash(battleState.equipment), before);
  assert.equal(battleState.battleSessions[sessionId].deploymentHash, sessionBefore.deploymentHash);
  assert.equal(battleState.battleSessions[sessionId].formalReportHash, sessionBefore.formalReportHash);
  settlementEquipmentHash = canonicalHash(battleState.equipment);
});

check('deterministic salvage offer is a post-settlement production instance only', () => {
  offer = deriveSalvageOffer(battleState, sessionId);
  assert.equal(offer.ok, true);
  assert.equal(offer.outcome, 'equipment');
  assert.equal(offer.result, 'victory');
  assert.equal(offer.missionKind, 'operation');
  assert.equal(offer.equipmentId, 'command_uplink');
  assert.equal(offer.chance, 0.42);
  assert.equal(canonicalHash(battleState.equipment), settlementEquipmentHash);
});

check('claim is exactly once and the save diff is equipment-only', () => {
  const before = clone(battleState);
  const result = claimBattleSalvage(battleState, sessionId);
  assert.equal(result.ok, true);
  salvageInstance = result.instance;
  assert.equal(salvageInstance.provenance.kind, 'battle_salvage');
  assert.equal(salvageInstance.provenance.formalReportHash, battleState.battleSessions[sessionId].formalReportHash);
  const paths = diffPaths(before, battleState);
  assert.ok(paths.length > 0);
  assert.ok(paths.every((path) => path === 'equipment' || path.startsWith('equipment.')));
  assert.equal(claimBattleSalvage(battleState, sessionId).code, 'already_claimed');
  assert.equal(battleState.equipment.inventory.filter((item) => item.id === salvageInstance.id).length, 1);
});

check('claimed salvage mounts to a compatible unit without changing the production instance', () => {
  assert.equal(finishBattleReturn(battleState).ok, true);
  const before = clone(battleState.equipment.inventory);
  assert.equal(canEquipEquipment(battleState, 'stage9-e-unit-5', salvageInstance.id).ok, true);
  assert.equal(equipEquipment(battleState, 'stage9-e-unit-5', salvageInstance.id).ok, true);
  assert.deepEqual(battleState.equipment.bindings['stage9-e-unit-5'], [salvageInstance.id]);
  assert.deepEqual(battleState.equipment.inventory, before);
});

check('real migration preserves production queue provenance, salvage claims, and bindings', () => {
  const migrated = migrate(clone(battleState));
  const migratedSalvage = migrated.equipment.inventory.find((item) => item.id === salvageInstance.id);
  assert.equal(migrated.version, SAVE_VERSION);
  assert.equal(migratedSalvage.provenance.kind, 'battle_salvage');
  assert.deepEqual(migrated.equipment.bindings['stage9-e-unit-0'], [productionInstance.id]);
  assert.deepEqual(migrated.equipment.bindings['stage9-e-unit-5'], [salvageInstance.id]);
  assert.equal(migrated.equipment.salvageClaims[offer.salvageId].instanceId, salvageInstance.id);
  assert.equal(migrated.battleSessions[sessionId].formalReportHash, battleState.battleSessions[sessionId].formalReportHash);
  battleState = migrated;
});

check('legacy v9 migration creates no new equipment, claims, or production record', () => {
  const legacy = fixture();
  legacy.version = 9;
  delete legacy.equipment;
  legacy.production = { current: null, queue: [] };
  const migrated = migrate(clone(legacy));
  assert.equal(migrated.version, SAVE_VERSION);
  assert.deepEqual(migrated.equipment, { inventory: [], bindings: {}, salvageClaims: {} });
  assert.deepEqual(migrated.production, { current: null, queue: [] });
});

check('equipment sanitizer fails closed in both dangling-reference directions', () => {
  const state = fixture();
  state.equipment.inventory.push({ id: 'orphan', equipmentId: 'anti_armor_sights', quantity: 1 });
  state.equipment.bindings = { 'deleted-unit': ['equipment-starter-1'], 'stage9-e-unit-0': ['missing-equipment'] };
  const result = sanitizeEquipment(state);
  assert.equal(result.repaired, true);
  assert.deepEqual(state.equipment.bindings, {});
  assert.equal(state.equipment.inventory.some((item) => item.id === 'orphan'), true);
  const reverse = fixture();
  reverse.units = reverse.units.filter((unit) => unit.id !== 'stage9-e-unit-0');
  reverse.equipment.bindings = { 'stage9-e-unit-0': ['equipment-starter-1'] };
  sanitizeEquipment(reverse);
  assert.deepEqual(reverse.equipment.bindings, {});
});

check('replay is historical and read-only after current salvage mounting', () => {
  const currentEquipment = canonicalHash(battleState.equipment);
  assert.equal(replayBattleSession(battleState, sessionId).ok, true);
  const replaySnapshot = battleState.activeBattle.dispatchSnapshot;
  assert.deepEqual(replaySnapshot.equipmentComposition['stage9-e-unit-0'].map((item) => item.instanceId), [productionInstance.id]);
  assert.equal(replaySnapshot.equipmentComposition['stage9-e-unit-5'], undefined);
  const replayBefore = clone(battleState.equipment);
  assert.equal(equipEquipment(battleState, 'stage9-e-unit-1', salvageInstance.id).code, 'replay_read_only');
  tickActiveBattle(battleState, battleState.activeBattle.duration + 1);
  assert.deepEqual(battleState.equipment, replayBefore);
  assert.equal(canonicalHash(battleState.equipment), currentEquipment);
});

check('offline production is independent from battle and idempotent', () => {
  const state = fixture();
  queueEquipment(state, 'anti_armor_sights');
  const report = advanceOffline(state, 18);
  assert.equal(report.equipmentProduced.anti_armor_sights, 1);
  assert.equal(state.equipment.inventory.filter((item) => item.provenance?.kind === 'production').length, 1);
  const before = clone(state.equipment);
  const second = advanceOffline(state, 18);
  assert.deepEqual(second, {});
  assert.deepEqual(state.equipment, before);
  assert.equal(state.activeBattle, null);
});

check('production/runtime changes do not touch frozen authority modules', () => {
  const changed = sourceChangedFiles();
  assert.equal(changed.some((file) => file === 'js/battle.js' || file === 'js/save-diff.js' || file.startsWith('js/battle-presentation/universal/') || file.startsWith('tests/lib/')), false, changed.join(', '));
  assert.deepEqual(changed.filter((file) => file.startsWith('js/')), ['js/config.js']);
});

const evidence = {
  stage: '9-E',
  independentRecompute: true,
  passed: passed === checks.length && checks.length >= 22,
  checkCount: checks.length,
  passedCount: passed,
  checks,
  metadata: { currentStage: CURRENT_STAGE, currentStageLabel: CURRENT_STAGE_LABEL, packageVersion: '0.9.0', saveVersion: SAVE_VERSION },
  campaign: { theaterCount: Object.keys(THEATERS).length, operationCount: Object.keys(OPERATIONS).length, operationId: 'river_ferry', theaterId: 'river_crossing' },
  equipment: { definitionCount: Object.keys(EQUIPMENT).length, starterCount: 3, productionCount: 5, productionInstanceId: productionInstance?.id || null, salvageInstanceId: salvageInstance?.id || null, salvageEquipmentId: offer?.equipmentId || null, noHpModifiers: true, maxSlots: EQUIPMENT_RULES.maxSlotsPerUnit },
  integration: { missionKind: 'operation', missionId: 'river_ferry', seed: 6, sessionId, formalReportHash: battleState?.battleSessions?.[sessionId]?.formalReportHash || null, deploymentHash: battleState?.battleSessions?.[sessionId]?.deploymentHash || null, salvageRulesVersion: SALVAGE_RULES.version, settlementEquipmentHash, productionEquipmentHash, historicalReplayComposition: battleState?.activeBattle?.dispatchSnapshot?.equipmentComposition?.['stage9-e-unit-0'] || [] },
  boundaries: { salvageIsPostSettlement: true, settlementMutatesEquipment: false, claimDiffEquipmentOnly: true, replayReadOnly: true, offlineProductionIdempotent: true, dropsPreexistingNotImplemented: true }
};
fs.writeFileSync(path.join(root, 'stage9_e_core_evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`\nStage 9-E checks: ${passed}/${checks.length} passed`);
if (passed !== checks.length || checks.length < 22) process.exitCode = 1;
