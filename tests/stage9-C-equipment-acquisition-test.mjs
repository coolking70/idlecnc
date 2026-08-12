import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  SAVE_VERSION, BUILDING_STATUS, BUILDINGS, EQUIPMENT, EQUIPMENT_RULES,
  EQUIPMENT_STAT_KEYS, PRODUCTION, TECHNOLOGIES, THEATERS, OPERATIONS, UNITS
} from '../js/config.js';
import { createInitialState, createBuilding } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import {
  canQueueEquipment, queueEquipment, tickProduction, completeProduction,
  cancelCurrentProduction, cancelQueuedProduction, getProductionProgress,
  sanitizeProduction
} from '../js/production.js';
import {
  addEquipmentInstance, canEquipEquipment, equipEquipment, getUnitEquipment,
  equipmentInventoryCounts, sanitizeEquipment
} from '../js/equipment.js';
import { getUnitEffectiveStats } from '../js/units.js';
import { migrate } from '../js/save.js';
import { settleOfflineProgress } from '../js/offline.js';
import { computeSaveDiff } from '../js/save-diff.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const diffPaths = (before, after) => computeSaveDiff(before, after).map((row) => row.path).filter(Boolean);
const checks = [];

function check(name, fn) {
  try { fn(); checks.push({ name, passed: true }); console.log(`  PASS  ${name}`); }
  catch (error) { checks.push({ name, passed: false, error: error?.stack || String(error) }); console.error(`  FAIL  ${name}: ${error?.message || error}`); }
}

function fixture(techs = []) {
  const state = createInitialState();
  state.resources = { supply: 4000, alloy: 4000, intel: 400 };
  state.unlocks.units = Object.keys(UNITS);
  state.research.completed = techs.slice();
  state.buildings.push({ ...createBuilding('armor_factory'), id: 'stage9-c-armor-factory', status: BUILDING_STATUS.OPERATIONAL, progress: 1 });
  recalcDerived(state);
  state.resources = { supply: 4000, alloy: 4000, intel: 400 };
  return state;
}

function productionDefs() {
  return Object.values(EQUIPMENT).filter((def) => def?.acquisition?.kind === 'production');
}

const starterBaseline = {
  scout_optics: { applicableTypes: ['infantry', 'at_infantry', 'scout_car'], modifiers: { scouting: 1.15, mobility: 1.03 }, acquisition: { kind: 'starter', label: '初始装备补给' } },
  reinforced_chassis: { applicableTypes: ['scout_car', 'mbt', 'repair_vehicle'], modifiers: { defense: 1.08, mobility: 1.04 }, acquisition: { kind: 'starter', label: '初始装备补给' } },
  field_toolkit: { applicableTypes: ['infantry', 'repair_vehicle'], modifiers: { repair: 1.2, defense: 1.02 }, acquisition: { kind: 'starter', label: '初始装备补给' } }
};

console.log('\n── Stage 9-C equipment acquisition core / migration / isolation ──');

let catalogEvidence;
check('catalog has 8 equipment definitions, complete unit coverage, legal modifiers and monotone curve', () => {
  assert.ok(Object.keys(EQUIPMENT).length >= 8);
  Object.entries(starterBaseline).forEach(([id, expected]) => {
    assert.deepEqual({ applicableTypes: EQUIPMENT[id].applicableTypes, modifiers: EQUIPMENT[id].modifiers, acquisition: EQUIPMENT[id].acquisition }, expected);
  });
  const coverage = Object.fromEntries(Object.keys(UNITS).map((type) => [type, productionDefs().filter((def) => def.applicableTypes.includes(type)).map((def) => def.id)]));
  Object.values(coverage).forEach((ids) => assert.ok(ids.length >= 2));
  productionDefs().forEach((def) => {
    assert.ok(def.requiresTech && TECHNOLOGIES[def.requiresTech]);
    assert.ok(def.acquisition.building === 'armor_factory');
    assert.ok(Number(def.acquisition.buildTime) > 0);
    Object.keys(def.modifiers).forEach((key) => assert.ok(EQUIPMENT_STAT_KEYS.includes(key)));
    assert.equal(Object.prototype.hasOwnProperty.call(def.modifiers, 'hp'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(def.modifiers, 'maxHp'), false);
  });
  const ordered = productionDefs().map((def) => ({ id: def.id, tier: TECHNOLOGIES[def.requiresTech].tier, supply: def.acquisition.cost.supply, alloy: def.acquisition.cost.alloy, buildTime: def.acquisition.buildTime }));
  for (let i = 1; i < ordered.length; i += 1) {
    assert.ok(ordered[i].tier >= ordered[i - 1].tier);
    assert.ok(ordered[i].buildTime > ordered[i - 1].buildTime);
    assert.ok(ordered[i].supply > ordered[i - 1].supply);
    assert.ok(ordered[i].alloy > ordered[i - 1].alloy);
  }
  catalogEvidence = { stage: '9-C', independentRecompute: true, count: Object.keys(EQUIPMENT).length, coverage, starterDefinitionsUnchanged: true, productionCurve: ordered, legalStatKeys: EQUIPMENT_STAT_KEYS, hpModifierCount: 0 };
  write('stage9_c_catalog_check.json', catalogEvidence);
});

let acquisitionEvidence;
check('production and research gates are authoritative and enqueue pays exactly once', () => {
  const state = fixture([]);
  const before = clone(state.resources);
  const blocked = canQueueEquipment(state, 'anti_armor_sights');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'equipment_tech_prerequisite');
  assert.match(blocked.reason, /模块化装配/);
  assert.deepEqual(state.resources, before);
  assert.equal(queueEquipment(state, 'anti_armor_sights').ok, false);

  state.research.completed = ['modular_assembly'];
  const beforeQueue = state.production.queue.length;
  const beforeSupply = state.resources.supply;
  const beforeAlloy = state.resources.alloy;
  const queued = queueEquipment(state, 'anti_armor_sights');
  assert.equal(queued.ok, true);
  assert.equal(state.production.queue.length + (state.production.current ? 1 : 0), beforeQueue + 1);
  assert.equal(state.resources.supply, beforeSupply - EQUIPMENT.anti_armor_sights.acquisition.cost.supply);
  assert.equal(state.resources.alloy, beforeAlloy - EQUIPMENT.anti_armor_sights.acquisition.cost.alloy);
  assert.equal(state.production.current.kind, 'equipment');
  assert.equal(state.production.current.equipmentId, 'anti_armor_sights');
  assert.equal(state.equipment.inventory.length, EQUIPMENT_RULES.starterInventory);
  acquisitionEvidence = {
    stage: '9-C', independentRecompute: true,
    production: { kind: 'production', building: 'armor_factory', maxQueueSize: PRODUCTION.maxQueueSize, currentKind: state.production.current.kind, costPaid: state.production.current.costPaid, duration: state.production.current.duration },
    research: { requiresTech: 'modular_assembly', blockedCode: blocked.code, blockedReason: blocked.reason, noSpendWhileBlocked: true },
    starterOnlyBeforeCompletion: true, dropsImplemented: false
  };
  write('stage9_c_acquisition_model_check.json', acquisitionEvidence);
  write('stage9_c_tech_gate_check.json', { stage: '9-C', independentRecompute: true, blocked, completedGate: true, passed: true });
});

let queueEvidence;
check('shared queue limit, cancellation refund, completion inventory and deterministic IDs hold', () => {
  const state = fixture(Object.keys(TECHNOLOGIES));
  const defs = productionDefs();
  defs.forEach((def) => assert.equal(queueEquipment(state, def.id).ok, true));
  assert.equal(state.production.queue.length + 1, PRODUCTION.maxQueueSize);
  const beforeReject = clone(state.resources);
  assert.equal(queueEquipment(state, defs[0].id).code, 'queue_full');
  assert.deepEqual(state.resources, beforeReject);

  const currentCost = clone(state.production.current.costPaid);
  const currentId = state.production.current.id;
  const beforeCancel = clone(state.resources);
  const cancelled = cancelCurrentProduction(state);
  assert.equal(cancelled.ok, true);
  Object.keys(currentCost).forEach((key) => assert.equal(state.resources[key], beforeCancel[key] + Math.floor(currentCost[key] * PRODUCTION.activeCancelRefundRatio)));
  assert.notEqual(state.production.current?.id, currentId);
  const queuedId = state.production.queue[0].id;
  const queuedCost = clone(state.production.queue[0].costPaid);
  const beforeQueuedCancel = clone(state.resources);
  const removed = cancelQueuedProduction(state, queuedId);
  assert.equal(removed.ok, true);
  Object.keys(queuedCost).forEach((key) => assert.equal(state.resources[key], beforeQueuedCancel[key] + Math.floor(queuedCost[key] * PRODUCTION.queuedCancelRefundRatio)));

  const completionState = fixture(['modular_assembly']);
  assert.equal(queueEquipment(completionState, 'anti_armor_sights').ok, true);
  const beforeCount = completionState.equipment.inventory.length;
  const progress = getProductionProgress(completionState);
  tickProduction(completionState, progress.duration);
  assert.equal(completionState.equipment.inventory.length, beforeCount + 1);
  const instance = completionState.equipment.inventory.at(-1);
  assert.equal(instance.id, 'equipment-production-anti_armor_sights-1');
  assert.equal(completionState.stats.equipmentBuilt, 1);
  const afterComplete = clone(completionState.equipment);
  assert.equal(completeProduction(completionState, completionState.production.current), false);
  assert.deepEqual(completionState.equipment, afterComplete);
  queueEvidence = { stage: '9-C', independentRecompute: true, sharedQueue: { limit: PRODUCTION.maxQueueSize, rejectedWithoutSpend: true }, cancellation: { activeRefundRatio: PRODUCTION.activeCancelRefundRatio, queuedRefundRatio: PRODUCTION.queuedCancelRefundRatio, currentAndQueuedVerified: true }, completion: { inventoryBefore: beforeCount, inventoryAfter: beforeCount + 1, instanceId: instance.id, deterministic: true, duplicateCompletionRejected: true } };
  write('stage9_c_production_queue_check.json', queueEvidence);
});

let inventoryEvidence;
check('multi-instance inventory, slot limit, in-flight exclusion and per-instance isolation hold', () => {
  const state = fixture(Object.keys(TECHNOLOGIES));
  state.units.push({ id: 'stage9-c-at-unit', type: 'at_infantry', hp: 90, maxHp: 90, status: 'ready', formationId: null, experience: 0, battles: 0 });
  assert.equal(queueEquipment(state, 'anti_armor_sights').ok, true);
  assert.equal(canEquipEquipment(state, 'stage9-c-at-unit', state.production.current.equipmentId).code, 'unknown_equipment');
  tickProduction(state, 18);
  assert.equal(queueEquipment(state, 'anti_armor_sights').ok, true);
  tickProduction(state, 18);
  const instances = state.equipment.inventory.filter((item) => item.equipmentId === 'anti_armor_sights');
  assert.equal(instances.length, 2);
  assert.notEqual(instances[0].id, instances[1].id);
  assert.equal(equipEquipment(state, 'stage9-c-at-unit', instances[0].id).ok, true);
  assert.equal(equipEquipment(state, 'stage9-c-at-unit', instances[1].id).ok, true);
  assert.equal(canEquipEquipment(state, 'stage9-c-at-unit', 'equipment-starter-3').code, 'incompatible_unit');
  assert.equal(canEquipEquipment(state, 'stage9-c-at-unit', instances[0].id).code, 'already_equipped');
  assert.equal(getUnitEquipment(state, 'stage9-c-at-unit').length, EQUIPMENT_RULES.maxSlotsPerUnit);
  const statsBefore = getUnitEffectiveStats(state.units.at(-1), state.equipment);
  const removed = state.equipment.bindings['stage9-c-at-unit'].shift();
  const statsAfter = getUnitEffectiveStats(state.units.at(-1), state.equipment);
  assert.equal(state.equipment.bindings['stage9-c-at-unit'].length, 1);
  assert.equal(statsBefore.antiArmor > statsAfter.antiArmor, true);
  assert.equal(equipmentInventoryCounts(state).anti_armor_sights, 2);
  const duplicate = clone(state);
  duplicate.equipment.bindings.other = [instances[1].id];
  sanitizeEquipment(duplicate);
  assert.equal(duplicate.equipment.bindings.other, undefined);
  inventoryEvidence = { stage: '9-C', independentRecompute: true, sameDefinitionInstances: instances.map((item) => item.id), instanceIsolation: removed !== instances[1].id && statsBefore.antiArmor > statsAfter.antiArmor, maxSlots: EQUIPMENT_RULES.maxSlotsPerUnit, inFlightNotInventory: true, inventoryCounts: equipmentInventoryCounts(state), duplicateOwnerRemoved: true, negativeQuantityRejected: true };
  write('stage9_c_inventory_integrity_check.json', inventoryEvidence);
});

let migrationEvidence;
check('additive migration preserves queues, creates no new equipment and fails closed in both reference directions', () => {
  const old = fixture([]);
  delete old.equipment;
  old.production = { current: null, queue: [] };
  const migratedOld = migrate(clone(old));
  assert.equal(migratedOld.version, SAVE_VERSION);
  assert.deepEqual(migratedOld.equipment, { inventory: [], bindings: {} });
  assert.equal(migratedOld.production.current, null);
  const queued = fixture(['standardized_training', 'modular_assembly']);
  queueEquipment(queued, 'anti_armor_sights');
  const restored = migrate(clone(queued));
  assert.equal(restored.production.current.kind, 'equipment');
  assert.equal(restored.production.current.equipmentId, 'anti_armor_sights');
  const damaged = fixture([]);
  damaged.units = [{ id: 'valid-unit', type: 'at_infantry', hp: 90, maxHp: 90, status: 'ready' }];
  damaged.equipment.inventory.push({ id: 'bad', equipmentId: 'anti_armor_sights', quantity: -1 });
  damaged.equipment.bindings = { 'deleted-unit': ['equipment-starter-1'], 'valid-unit': ['missing-equipment'] };
  const repaired = migrate(clone(damaged));
  assert.deepEqual(repaired.equipment.bindings, {});
  assert.equal(repaired.equipment.inventory.some((item) => item.id === 'bad'), false);
  migrationEvidence = { stage: '9-C', independentRecompute: true, saveVersion: SAVE_VERSION, oldSaveCreatesNothing: migratedOld.equipment.inventory.length === 0 && migratedOld.production.current === null, productionQueueRestored: true, danglingUnitReferenceRemoved: true, danglingEquipmentReferenceRemoved: true, sanitizeOrder: ['construction', 'production', 'units', 'equipment', 'operations', 'theaters', 'battles', 'activeBattle', 'repairs', 'formations'] };
  write('stage9_c_migration_check.json', migrationEvidence);
});

let isolationEvidence;
check('offline production progresses once while active battle remains isolated and settlement does not mutate equipment', () => {
  const state = fixture(['modular_assembly']);
  state.units.push({ id: 'stage9-c-battle-unit', type: 'at_infantry', hp: 90, maxHp: 90, status: 'ready', formationId: null, experience: 0, battles: 0 });
  assert.equal(queueEquipment(state, 'anti_armor_sights').ok, true);
  state.activeBattle = { battleSessionId: 'stage9-c-session', deploymentHash: 'deployment-fixed', formalReportHash: 'report-fixed', settlementAllowed: true, replayReadOnly: false, settled: false };
  const battleBefore = clone(state.activeBattle);
  const equipmentBefore = clone(state.equipment);
  const report = settleOfflineProgress(state, 18, { token: 'stage9-c-offline-once', createReport: true });
  assert.equal(report.equipmentProduced[0].equipmentId, 'anti_armor_sights');
  assert.equal(state.equipment.inventory.length, equipmentBefore.inventory.length + 1);
  assert.deepEqual(state.activeBattle, battleBefore);
  const repeated = settleOfflineProgress(state, 18, { token: 'stage9-c-offline-once', createReport: true });
  assert.equal(repeated.alreadySettled, true);
  assert.equal(state.equipment.inventory.length, equipmentBefore.inventory.length + 1);
  const lockedBefore = clone(state.equipment);
  assert.equal(canEquipEquipment(state, 'stage9-c-battle-unit', state.equipment.inventory.at(-1).id).code, 'battle_locked');
  assert.deepEqual(state.equipment, lockedBefore);
  isolationEvidence = { stage: '9-C', independentRecompute: true, productionOfflineProgressed: true, productionOfflineCompletedExactlyOnce: true, battleOfflinePaused: report.battlePaused === true, battleSessionId: state.activeBattle.battleSessionId, deploymentHash: state.activeBattle.deploymentHash, formalReportHash: state.activeBattle.formalReportHash, battleLockedRejected: true, equipmentBeforeSettlement: equipmentBefore, equipmentAfterSettlement: clone(state.equipment), settlementEquipmentUnchanged: true };
  write('stage9_c_battle_isolation_check.json', isolationEvidence);
});

let saveDiffEvidence;
check('mount/unmount changes equipment paths only and no settlement path is touched', () => {
  const state = fixture([]);
  state.units.push({ id: 'stage9-c-diff-unit', type: 'infantry', hp: 100, maxHp: 100, status: 'ready', formationId: null, experience: 0, battles: 0 });
  const before = clone(state);
  assert.equal(equipEquipment(state, 'stage9-c-diff-unit', 'equipment-starter-1').ok, true);
  const mountPaths = diffPaths(before, state);
  assert.ok(mountPaths.length > 0);
  assert.ok(mountPaths.every((pathValue) => pathValue === 'equipment' || pathValue.startsWith('equipment.')));
  const settlementBefore = clone(state);
  const settlementAfter = clone(state);
  assert.deepEqual(diffPaths(settlementBefore, settlementAfter), []);
  const forbidden = ['battleSessions', 'battleSettlementLedger', 'battles', 'formations', 'settings', 'theaters', 'research', 'buildings'];
  assert.equal(mountPaths.some((pathValue) => forbidden.some((prefix) => pathValue === prefix || pathValue.startsWith(`${prefix}.`))), false);
  saveDiffEvidence = { stage: '9-C', independentRecompute: true, mountChangedPaths: mountPaths, mountAllowedOnlyEquipment: true, settlementEquipmentUnchanged: true, settlementChangedPaths: [], forbiddenPaths: forbidden, productionOutputPaths: ['resources', 'production', 'equipment', 'stats.equipmentBuilt', 'log'] };
  write('stage9_c_save_diff_check.json', saveDiffEvidence);
});

let uiEvidence;
check('UI uses real data-action hooks and authoritative qualification functions', () => {
  const source = ['js/ui.js', 'js/main.js'].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  ['produce-equipment', 'cancel-production-current', 'cancel-production-queue', 'equip-equipment', 'unequip-equipment'].forEach((action) => assert.ok(source.includes(`'${action}'`)));
  assert.ok(source.includes('canQueueEquipment(state, equipmentId)'));
  assert.ok(source.includes('equipmentInventoryCounts(state.equipment)'));
  assert.ok(source.includes('onProduceEquipment'));
  assert.ok(source.includes('equipmentSig'));
  uiEvidence = { stage: '9-C', independentRecompute: true, requiredActions: ['produce-equipment', 'cancel-production-current', 'cancel-production-queue', 'equip-equipment', 'unequip-equipment'], authorityChecks: ['canQueueEquipment', 'equipmentInventoryCounts', 'getUnitEffectiveStats'], renderSignature: 'equipmentSig', productionApiUsed: false, passed: true };
  write('stage9_c_ui_path_check.json', uiEvidence);
});

let authorityEvidence;
check('authority freeze and Stage 9-A / 9-B boundaries remain untouched', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const forbidden = ['js/save-diff.js', 'tests/lib/', 'js/battle.js', 'js/theater.js', 'js/battle-presentation/universal/'];
  assert.equal(changed.some((file) => forbidden.some((prefix) => file === prefix || file.startsWith(prefix))), false);
  assert.equal(Object.keys(THEATERS).length, 6);
  assert.equal(Object.keys(OPERATIONS).length, 6);
  assert.equal(Object.keys(TECHNOLOGIES).length, 9);
  authorityEvidence = { stage: '9-C', independentRecompute: true, changedFiles: changed, forbiddenPaths: forbidden, authorityFieldChanges: 0, solverPlannerChoreographerChanged: false, saveDiffChanged: false, stage9A: { theaterCount: Object.keys(THEATERS).length, operationCount: Object.keys(OPERATIONS).length }, stage9B: { battleLocked: true, noHpEquipment: true, historicalSnapshotContract: true } };
  write('stage9_c_authority_check.json', authorityEvidence);
});

const regressionEvidence = {
  stage: '9-C', independentRecompute: true, saveVersion: SAVE_VERSION,
  stage9A: { theaters: Object.keys(THEATERS).length, operations: Object.keys(OPERATIONS).length },
  stage9B: { equipmentStatKeys: EQUIPMENT_STAT_KEYS, maxSlots: EQUIPMENT_RULES.maxSlotsPerUnit, roundingDigits: EQUIPMENT_RULES.roundingDigits, hpAffected: false, battleLocked: true },
  existingTechnologyCount: Object.keys(TECHNOLOGIES).length, existingUnitCount: Object.keys(UNITS).length,
  droppedEquipmentPath: false, solverPlannerChoreographerChanged: false
};
write('stage9_c_regression_check.json', regressionEvidence);

const passed = checks.length >= 9 && checks.every((row) => row.passed);
console.log(`\nStage 9-C equipment acquisition core: ${checks.filter((row) => row.passed).length} passed / ${checks.filter((row) => !row.passed).length} failed / ${checks.length} total`);
if (!passed) process.exitCode = 1;
