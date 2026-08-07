import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-builder.js';
import { compileUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-compiler.js';
const rows = JSON.parse(fs.readFileSync(new URL('../universal-planner/scenarios/canonical.json', import.meta.url), 'utf8')).slice(0, 12);
for (const row of rows) { const plan = buildUniversalPlan(row.report); const compiled = compileUniversalPlan(plan); assert.equal(compileUniversalPlan(plan), compiled); assert.equal(compiled.spatialEntityById.size, compiled.spatialEntities.length); assert.ok(compiled.spatialEntities.every((entity) => entity.footprint && entity.lifecycle && entity.sourceId)); }
console.log(`universal-spatial-entity-test: ${rows.length} plans passed`);

