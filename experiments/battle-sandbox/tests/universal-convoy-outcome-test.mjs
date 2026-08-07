import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-builder.js';
import { sampleSceneObjectPosition } from '../../../js/battle-presentation/universal/universal-position-sampler.js';
const rows = JSON.parse(fs.readFileSync(new URL('../universal-planner/scenarios/canonical.json', import.meta.url), 'utf8')).filter((row) => row.missionId === 'convoy_escort');
for (const row of rows) { const plan = buildUniversalPlan(row.report); const object = plan.scene.sceneObjects.find((item) => item.kind === 'convoy_vehicle'); assert.ok(object?.footprint?.radius); const final = sampleSceneObjectPosition(plan, object.id, plan.timeline.duration); if (row.result === 'withdraw' || row.result === 'defeat') { assert.equal(final.state, 'returned'); assert.ok(final.x < 760); } else if (row.result === 'wiped') assert.equal(final.state, 'stopped'); else if (row.result === 'pyrrhic') assert.equal(final.state, 'arrived_damaged'); else assert.equal(final.state, 'arrived'); }
console.log(`universal-convoy-outcome-test: ${rows.length} convoy plans passed`);

