import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-builder.js';
import { compileUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-compiler.js';
import { sampleSpatialEntityPosition } from '../../../js/battle-presentation/universal/universal-position-sampler.js';
const rows = JSON.parse(fs.readFileSync(new URL('../universal-planner/scenarios/canonical.json', import.meta.url), 'utf8')).filter((row) => row.friendlyLoss || row.result === 'wiped').slice(0, 30);
for (const row of rows) { const plan = buildUniversalPlan(row.report); const compiled = compileUniversalPlan(plan); const wrecks = compiled.spatialEntities.filter((entity) => entity.kind === 'wreck'); assert.ok(wrecks.length > 0, row.id); for (const wreck of wrecks) { const position = sampleSpatialEntityPosition(compiled, wreck.id, plan.timeline.duration); assert.equal(position.state, 'wreck_static'); } assert.equal(plan.spatialValidation.collisions, 0); }
console.log(`universal-wreck-collision-test: ${rows.length} plans passed`);

