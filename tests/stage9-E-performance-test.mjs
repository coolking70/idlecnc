import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { awaitFitEnvironment, loadSnapshot, PerfEnvironmentUnfitError } from './lib/perf-environment.mjs';
import { BUILDING_STATUS, EQUIPMENT_RULES, EQUIPMENT_STAT_KEYS, PRODUCTION, UNITS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { createUnit, queueEquipment, tickProduction } from '../js/production.js';
import { createFormation } from '../js/formations.js';
import { equipEquipment, equipmentInventoryCounts } from '../js/equipment.js';
import { getUnitEffectiveStats } from '../js/units.js';
import { buildDispatchSnapshot } from '../js/theater.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const warmup = 20;
const samples = 120;
const budgetMs = 16.7;

function p95(values) {
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)] || 0;
}

function measure(name, fn) {
  for (let index = 0; index < warmup; index += 1) fn();
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const started = process.hrtime.bigint();
    fn();
    values.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  return {
    name, warmup, samples, metric: 'p95',
    p95Ms: Number(p95(values).toFixed(4)),
    maxMs: Number(Math.max(...values).toFixed(4))
  };
}

function fixture() {
  const state = createInitialState();
  state.resources = { supply: 999999, alloy: 999999, intel: 999999 };
  state.command.capacity = 999;
  state.research.completed = ['modular_assembly', 'field_maintenance', 'composite_armor', 'expanded_storage'];
  state.unlocks.units = Object.keys(UNITS);
  state.buildings.push({ id: 'stage9-e-performance-factory', type: 'armor_factory', status: BUILDING_STATUS.OPERATIONAL, progress: 1 });
  ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'].forEach((type, index) => {
    const unit = createUnit(type, 'stage9-e-performance');
    unit.id = `stage9-e-performance-unit-${index}`;
    state.units.push(unit);
  });
  const result = createFormation(state, 'Stage 9-E performance');
  assert.equal(result.ok, true);
  result.formation.unitIds = state.units.map((unit) => unit.id);
  result.formation.unitIds.forEach((unitId) => {
    const unit = state.units.find((row) => row.id === unitId);
    unit.formationId = result.formation.id;
    unit.status = 'assigned';
  });
  recalcDerived(state);
  state.command.capacity = 999;
  assert.equal(queueEquipment(state, 'anti_armor_sights').ok, true);
  tickProduction(state, 18);
  assert.equal(state.production.current, null);
  assert.equal(equipEquipment(state, state.units[3].id, state.equipment.inventory.find((item) => item.equipmentId === 'anti_armor_sights').id).ok, true);
  return { state, formation: result.formation };
}

const loadBefore = loadSnapshot();
const guard = await awaitFitEnvironment();
if (!guard.fit) {
  const output = {
    stage: '9-E', version: 1, measurement: 'integrated equipment acquisition read paths',
    budgetMs, warmup, samples, metric: 'p95', measurementValid: false, passed: false,
    environment: guard.snapshot, loadBefore, loadAfter: guard.snapshot,
    environmentGuard: { fit: false, threshold: guard.threshold, attempts: guard.attempts, samples: guard.samples },
    scenarios: [],
    hotPathGuards: { parserOutsideFrameLoop: false, renderSignature: false, noPerFrameSaveHash: false }
  };
  fs.writeFileSync(path.join(root, 'stage9_e_performance_check.json'), `${JSON.stringify(output, null, 2)}\n`);
  throw new PerfEnvironmentUnfitError('9-E', guard);
}

const { state, formation } = fixture();
const stats = measure('effectiveStats', () => getUnitEffectiveStats(state.units[3], state.equipment));
const snapshot = measure('dispatchSnapshot', () => buildDispatchSnapshot(state, formation, 'river_crossing', 'cautious'));
const inventory = measure('inventoryCounts', () => equipmentInventoryCounts(state.equipment));
const queueRead = measure('equipmentQueueEligibility', () => {
  const current = state.production.current;
  const queued = state.production.queue;
  return { current: current ? current.kind : null, queued: queued.length, max: PRODUCTION.maxQueueSize };
});

const uiSource = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'js/renderer.js'), 'utf8');
const battleRendererSource = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
const hotPathGuards = {
  parserOutsideFrameLoop: !rendererSource.includes('getUnitEffectiveStats') && !battleRendererSource.includes('getUnitEffectiveStats'),
  renderSignature: uiSource.includes('equipmentSignature') && uiSource.includes('equipmentSig'),
  noPerFrameSaveHash: !uiSource.includes('computeSaveDiff') && !uiSource.includes('localStorage')
};
assert.equal(hotPathGuards.parserOutsideFrameLoop, true);
assert.equal(hotPathGuards.renderSignature, true);
assert.equal(hotPathGuards.noPerFrameSaveHash, true);
assert.equal(Object.keys(getUnitEffectiveStats(state.units[3], state.equipment).base).includes('hp'), true);
assert.equal(Object.keys(getUnitEffectiveStats(state.units[3], state.equipment).equipmentModifiers).every((key) => EQUIPMENT_STAT_KEYS.includes(key)), true);

const loadAfter = loadSnapshot();
const environment = {
  platform: os.platform(), arch: os.arch(), cpuModel: os.cpus()[0]?.model || 'unknown',
  cpuCount: os.cpus().length, nodeVersion: process.version
};
const scenarios = { stats, snapshot, inventory, queueRead };
assert.ok(Object.values(scenarios).every((row) => row.samples === samples && row.p95Ms < budgetMs), JSON.stringify(scenarios));
const output = {
  stage: '9-E', version: 1, measurement: 'integrated equipment acquisition read paths',
  budgetMs, warmup, samples, metric: 'p95', measurementValid: true, passed: true,
  environment, loadBefore, loadAfter,
  environmentGuard: {
    fit: true, qualificationVersion: guard.qualificationVersion, threshold: guard.threshold,
    attempts: guard.attempts, attemptsLimit: guard.attemptsLimit, samples: guard.samples,
    loadBefore: loadBefore.normalizedLoad1, loadAfter: loadAfter.normalizedLoad1
  },
  scenarios, hotPathGuards,
  sourceState: { unitCount: state.units.length, inventory: state.equipment.inventory, maxSlotsPerUnit: EQUIPMENT_RULES.maxSlotsPerUnit }
};
fs.writeFileSync(path.join(root, 'stage9_e_performance_check.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, measurementValid: true, p95Ms: Object.fromEntries(Object.entries(scenarios).map(([id, row]) => [id, row.p95Ms])), loadBefore: loadBefore.normalizedLoad1, loadAfter: loadAfter.normalizedLoad1, environment }));
