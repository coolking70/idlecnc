import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { awaitFitEnvironment, loadSnapshot, PerfEnvironmentUnfitError } from './lib/perf-environment.mjs';
import { EQUIPMENT, EQUIPMENT_RULES } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { createUnit } from '../js/production.js';
import { createFormation } from '../js/formations.js';
import { recalcDerived } from '../js/economy.js';
import { equipEquipment, equipmentInventoryCounts } from '../js/equipment.js';
import { getUnitEffectiveStats } from '../js/units.js';
import { buildDispatchSnapshot } from '../js/theater.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const warmup = 20;
const samples = 120;
const budgetMs = 16.7;
const p95 = (values) => {
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)] || 0;
};
const measure = (name, fn) => {
  for (let i = 0; i < warmup; i += 1) fn();
  const values = [];
  for (let i = 0; i < samples; i += 1) {
    const start = process.hrtime.bigint();
    fn();
    values.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  return { name, warmup, samples, metric: 'p95', p95Ms: Number(p95(values).toFixed(4)), maxMs: Number(Math.max(...values).toFixed(4)) };
};

const guard = await awaitFitEnvironment();
if (!guard.fit) {
  const output = {
    stage: '9-C', version: 1, measurement: 'equipment effective-stats, snapshot and inventory read paths',
    budgetMs, measurementValid: false, passed: false, environment: guard.snapshot,
    environmentGuard: { fit: false, threshold: guard.threshold, attempts: guard.attempts, samples: guard.samples, loadBefore: guard.snapshot.normalizedLoad1, loadAfter: guard.snapshot.normalizedLoad1 },
    scenarios: [], hotPathGuards: { parserOutsideFrameLoop: false, renderSignature: false, noPerFrameSaveHash: false }
  };
  fs.writeFileSync(path.join(root, 'stage9_c_performance_check.json'), `${JSON.stringify(output, null, 2)}\n`);
  throw new PerfEnvironmentUnfitError('9-C', guard);
}

const state = createInitialState();
state.command.capacity = 999;
const types = ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'];
types.forEach((type, index) => {
  const unit = createUnit(type, 'stage9-c-performance');
  unit.id = `stage9-c-performance-${index}`;
  state.units.push(unit);
});
const formationResult = createFormation(state, 'Stage 9-C performance');
assert.equal(formationResult.ok, true);
const formation = formationResult.formation;
formation.unitIds = state.units.map((unit) => unit.id);
state.units.forEach((unit) => { unit.formationId = formation.id; unit.status = 'assigned'; });
recalcDerived(state);
state.command.capacity = 999;
equipEquipment(state, state.units[0].id, 'equipment-starter-1');
equipEquipment(state, state.units[0].id, 'equipment-starter-3');
equipEquipment(state, state.units[1].id, 'equipment-starter-1');

const effectiveStats = measure('effectiveStats', () => getUnitEffectiveStats(state.units[0], state.equipment));
const snapshot = measure('snapshot', () => buildDispatchSnapshot(state, formation, 'scrap_mine', 'cautious'));
const inventory = measure('inventoryCounts', () => equipmentInventoryCounts(state.equipment));
const uiSource = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const baseRendererSource = fs.readFileSync(path.join(root, 'js/renderer.js'), 'utf8');
const battleRendererSource = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
const hotPathGuards = {
  parserOutsideFrameLoop: !baseRendererSource.includes('getUnitEffectiveStats') && !battleRendererSource.includes('getUnitEffectiveStats'),
  renderSignature: uiSource.includes('equipmentSignature') && uiSource.includes('equipmentSig'),
  noPerFrameSaveHash: !uiSource.includes('computeSaveDiff') && !uiSource.includes('localStorage')
};
assert.equal(hotPathGuards.parserOutsideFrameLoop, true);
assert.equal(hotPathGuards.renderSignature, true);
assert.equal(hotPathGuards.noPerFrameSaveHash, true);
const loadAfter = loadSnapshot();
const environment = {
  platform: os.platform(), arch: os.arch(), cpuModel: os.cpus()[0]?.model || 'unknown',
  cpuCount: os.cpus().length, nodeVersion: process.version
};
const scenarios = { effectiveStats, snapshot, inventory };
assert.ok(Object.values(scenarios).every((row) => row.samples === samples && row.p95Ms < budgetMs), JSON.stringify(scenarios));
const output = {
  stage: '9-C', version: 1, measurement: 'equipment effective-stats, snapshot and inventory read paths',
  budgetMs, warmup, samples, metric: 'p95', measurementValid: true, passed: true,
  environment,
  environmentGuard: { fit: true, threshold: guard.threshold, attempts: guard.attempts, samples: guard.samples, loadBefore: guard.snapshot.normalizedLoad1, loadAfter: loadAfter.normalizedLoad1 },
  scenarios, hotPathGuards,
  sourceState: { unitCount: state.units.length, equipment: state.equipment, maxSlotsPerUnit: EQUIPMENT_RULES.maxSlotsPerUnit, catalogCount: Object.keys(EQUIPMENT).length }
};
fs.writeFileSync(path.join(root, 'stage9_c_performance_check.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, measurementValid: true, p95Ms: Object.fromEntries(Object.entries(scenarios).map(([id, row]) => [id, row.p95Ms])), environment, loadBefore: output.environmentGuard.loadBefore, loadAfter: output.environmentGuard.loadAfter }));
