import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-builder.js';
const rows = JSON.parse(fs.readFileSync(new URL('../universal-planner/scenarios/canonical.json', import.meta.url), 'utf8'));
for (const row of rows) { const plan = buildUniversalPlan(row.report); assert.equal(plan.spatialValidation.collisions, 0, row.id); assert.ok(plan.scene.props.every((prop) => prop.geometry && prop.footprint && prop.position)); }
console.log(`universal-obstacle-avoidance-test: ${rows.length} plans passed`);

