import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-builder.js';
const rows = JSON.parse(fs.readFileSync(new URL('../universal-planner/scenarios/canonical.json', import.meta.url), 'utf8')).filter((row) => row.eventTypes.includes('repair')).slice(0, 24);
let checks = 0;
for (const row of rows) for (const repair of buildUniversalPlan(row.report).timeline.repairs) { assert.ok(repair.repairRoutePatch && repair.targetHoldPatch); assert.ok(repair.actualCenterDistance >= repair.requiredCenterDistance - 3 && repair.actualCenterDistance <= repair.requiredCenterDistance + 3); assert.ok(repair.repairPosition && repair.targetPosition && repair.contactPoint); checks += 1; }
assert.ok(checks > 0); console.log(`universal-repair-contact-test: ${checks} contacts passed`);

