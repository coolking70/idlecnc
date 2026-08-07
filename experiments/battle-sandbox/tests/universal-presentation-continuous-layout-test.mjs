import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-builder.js';
import { validateContinuousUniversalLayout } from '../../../js/battle-presentation/universal/universal-layout-deconflictor.js';
import { inputFor } from '../universal-planner/scenario-corpus-generator.mjs';
import { simulateBattle } from '../../../js/battle.js';

const dir = new URL('../universal-planner/scenarios/', import.meta.url);
const canonical = JSON.parse(fs.readFileSync(new URL('canonical.json', dir), 'utf8')); const fuzzSpecs = JSON.parse(fs.readFileSync(new URL('fuzz-specs.json', dir), 'utf8')); const rows = [...canonical, ...fuzzSpecs.map((spec) => ({ ...spec, report: simulateBattle(inputFor(spec.index, spec.missionId, spec.strategyId, spec.unitTypes, { kind: 'fuzz', seed: spec.seed, initialRatios: spec.initialRatios, experiences: spec.experiences })) }))];
let checks = 0;
for (const row of rows) {
  const plan = buildUniversalPlan(row.report); assert.equal(plan.ok, true, `${row.id}: planner`);
  const continuous = validateContinuousUniversalLayout(plan, { step: 0.05 }); assert.equal(continuous.ok, true, `${row.id}: continuous layout`); checks += 1;
  assert.equal(continuous.metrics.collisions, 0, `${row.id}: collision count`);
}
const friendlyCounts = rows.map((row) => row.report.initial.friendly.length);
assert.equal(rows.length, 1120); assert.equal(Math.max(...friendlyCounts), 8); assert.equal(Math.min(...friendlyCounts), 1); checks += 3;
console.log(`universal-presentation-continuous-layout-test: ${checks} checks passed`);
