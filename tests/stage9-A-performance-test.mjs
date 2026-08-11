import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { THEATERS, OPERATIONS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { createUnit } from '../js/production.js';
import { createFormation } from '../js/formations.js';
import { canDispatch, canDispatchOperationMission } from '../js/theater.js';

const root = path.resolve(process.cwd());
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
};

function fixture() {
  const state = createInitialState();
  state.resources = { supply: 999999, alloy: 999999, intel: 999999 };
  ['mbt', 'mbt', 'mbt'].forEach((type, index) => {
    const unit = createUnit(type, `stage9-performance-${index}`);
    unit.id = `stage9-performance-${index}`;
    state.units.push(unit);
  });
  const result = createFormation(state, 'Stage 9 performance');
  assert.equal(result.ok, true);
  state.units.forEach((unit) => {
    unit.formationId = result.formation.id;
    unit.status = 'assigned';
    result.formation.unitIds.push(unit.id);
  });
  recalcDerived(state);
  state.command.capacity = 999;
  Object.values(state.theaters).forEach((row) => { row.captured = true; });
  return { state, formationId: result.formation.id };
}

const samples = [];
const { state, formationId } = fixture();
const targets = [
  ...Object.keys(THEATERS).map((id) => () => canDispatch(state, formationId, id, 'cautious')),
  ...Object.keys(OPERATIONS).map((id) => () => canDispatchOperationMission(state, formationId, id, 'cautious'))
];
for (let round = 0; round < 500; round += 1) {
  const start = performance.now();
  targets.forEach((target) => target());
  samples.push(performance.now() - start);
}

const regressionCommands = [
  'tests/stage8-2G-E-A-test.mjs',
  'tests/stage8-2G-E-A-1-replay-reload-test.mjs',
  'tests/stage8-2G-E-B-command-flow-test.mjs',
  'tests/stage8-2G-E-C-offline-progression-test.mjs',
  'tests/stage8-2G-D-C-1-performance-test.mjs'
];
const regression = regressionCommands.map((script) => {
  try {
    const output = execFileSync(process.execPath, [script], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { script, exitCode: 0, outputTail: output.slice(-1200) };
  } catch (error) {
    return { script, exitCode: error.status ?? 1, outputTail: `${error.stdout || ''}${error.stderr || ''}`.slice(-1200) };
  }
});

const output = {
  stage: '9-A',
  sampleCount: samples.length,
  operationCountPerSample: targets.length,
  timingMs: { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), max: Math.max(...samples) },
  environment: { platform: process.platform, arch: process.arch, nodeVersion: process.version, cpuModel: os.cpus()[0]?.model || null, cpuCount: os.cpus().length },
  method: 'performance.now around real eligibility reads for all configured theaters and operations',
  regression,
  passed: samples.length === 500 && regression.every((row) => row.exitCode === 0)
};
fs.writeFileSync(path.join(root, 'stage9_a_performance_check.json'), `${JSON.stringify(output, null, 2)}\n`);
fs.writeFileSync(path.join(root, 'stage9_a_regression_check.json'), `${JSON.stringify({ stage: '9-A', commands: regression, passed: output.passed }, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, p95Ms: output.timingMs.p95, maxMs: output.timingMs.max, regressions: regression.length }));
if (!output.passed) process.exitCode = 1;
