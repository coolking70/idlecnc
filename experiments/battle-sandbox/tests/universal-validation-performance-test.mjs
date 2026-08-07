import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-builder.js';
const rows = JSON.parse(fs.readFileSync(new URL('../universal-planner/scenarios/canonical.json', import.meta.url), 'utf8'));
const started = performance.now(); let maxElapsed = 0; for (const row of rows) { const plan = buildUniversalPlan(row.report); maxElapsed = Math.max(maxElapsed, plan.spatialValidation.metrics.elapsedMs); assert.equal(plan.spatialValidation.metrics.samples >= Math.ceil(plan.timeline.duration / .05), true); assert.equal(plan.spatialValidation.collisions, 0); } const elapsed = performance.now() - started; assert.ok(maxElapsed < 120000); assert.ok(elapsed < 120000); console.log(`universal-validation-performance-test: ${rows.length} plans, ${Math.round(elapsed)}ms`);

