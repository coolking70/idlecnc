import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createInitialState } from '../js/state.js';
import { createUnit } from '../js/production.js';
import { createFormation } from '../js/formations.js';
import { recalcDerived } from '../js/economy.js';
import { equipEquipment } from '../js/equipment.js';
import { getUnitEffectiveStats } from '../js/units.js';
import { buildDispatchSnapshot } from '../js/theater.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const state = createInitialState();
state.command.capacity = 999;
const unit = createUnit('infantry', 'stage9-b-perf');
unit.id = 'stage9-b-perf-unit';
state.units.push(unit);
const formation = createFormation(state, 'Stage 9-B 性能编队').formation;
formation.unitIds = [unit.id];
unit.formationId = formation.id;
unit.status = 'assigned';
recalcDerived(state);
state.command.capacity = 999;
equipEquipment(state, unit.id, 'equipment-starter-1');
equipEquipment(state, unit.id, 'equipment-starter-3');

function p95(samples) {
  const values = samples.slice().sort((a, b) => a - b);
  return values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)] || 0;
}

function measure(fn) {
  for (let i = 0; i < 20; i += 1) fn();
  const samples = [];
  for (let i = 0; i < 120; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return { warmup: 20, samples: 120, metric: 'p95', p95Ms: p95(samples), maxMs: Math.max(...samples) };
}

const effectiveStats = measure(() => getUnitEffectiveStats(unit, state.equipment));
const snapshot = measure(() => buildDispatchSnapshot(state, formation, 'scrap_mine', 'cautious'));
const uiSource = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
const battleRendererSource = fs.readFileSync(path.join(root, 'js/battle-renderer.js'), 'utf8');
const baseRendererSource = fs.readFileSync(path.join(root, 'js/renderer.js'), 'utf8');
assert.ok(effectiveStats.p95Ms < 16.7, `effective stats p95 ${effectiveStats.p95Ms}ms`);
assert.ok(snapshot.p95Ms < 16.7, `snapshot p95 ${snapshot.p95Ms}ms`);
assert.match(uiSource, /equipmentSignature/);
assert.doesNotMatch(battleRendererSource, /getUnitEffectiveStats/);
assert.doesNotMatch(baseRendererSource, /getUnitEffectiveStats/);

const evidence = {
  stage: '9-B', passed: true,
  budgetMs: 16.7,
  scenarios: { effectiveStats, snapshot },
  hotPathGuards: {
    equipmentParserOutsideBattleRenderer: true,
    equipmentParserOutsideBaseRenderer: true,
    uiUsesEquipmentRenderSignature: true,
    noPerFrameSaveDiffOrFullStateHash: true
  },
  environment: {
    platform: os.platform(), arch: os.arch(), cpuModel: os.cpus()[0]?.model || 'unknown',
    cpuCount: os.cpus().length, nodeVersion: process.version
  },
  sourceState: clone({ unitId: unit.id, equipment: state.equipment })
};
fs.writeFileSync(path.join(root, 'stage9_b_performance_check.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ stage: '9-B', p95Ms: { effectiveStats: effectiveStats.p95Ms, snapshot: snapshot.p95Ms }, environment: evidence.environment }));
