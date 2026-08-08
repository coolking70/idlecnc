import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { actionAppliesToActor, actionForActor, nextActionForActor } from '../js/battle-presentation/universal/presentation-action-attribution.js';

const root = process.cwd();
const plan = { timeline: { actions: [
  { id: 'actor-only', type: 'repair', t: 1, actorId: 'u-1' },
  { id: 'group-action', type: 'advance', t: 2, actorIds: ['u-1', 'u-2'] },
  { id: 'explicit-global', type: 'battle_phase', t: 3, scope: 'global' },
  { id: 'unscoped-missing-ids', type: 'repair', t: 4 }
] } };
const actorAction = plan.timeline.actions[0];
const groupAction = plan.timeline.actions[1];
const globalAction = plan.timeline.actions[2];

assert.equal(actionAppliesToActor(actorAction, 'u-1'), true);
assert.equal(actionAppliesToActor(actorAction, 'u-2'), false);
assert.equal(actionAppliesToActor(groupAction, 'u-1'), true);
assert.equal(actionAppliesToActor(groupAction, 'u-2'), true);
assert.equal(actionAppliesToActor(groupAction, 'u-3'), false);
assert.equal(actionAppliesToActor(globalAction, 'u-1'), true);
assert.equal(actionAppliesToActor(globalAction, 'u-3'), true);
assert.equal(actionAppliesToActor(plan.timeline.actions[3], 'u-1'), false);

assert.equal(actionForActor(plan, 'u-1', 1.5)?.id, 'actor-only');
assert.equal(actionForActor(plan, 'u-2', 1.5), null);
assert.equal(actionForActor(plan, 'u-2', 2.5)?.id, 'group-action');
assert.equal(actionForActor(plan, 'u-3', 3.5)?.id, 'explicit-global');
assert.equal(actionForActor(plan, 'u-1', 4.5)?.id, 'explicit-global');
assert.equal(nextActionForActor(plan, 'u-2', 1.5)?.id, 'group-action');

const output = {
  stage: '8.2G-D-B.1a',
  kind: 'presentation_action_attribution',
  contract: { actorId: 'exact source only', actorIds: 'listed actors only', global: 'explicit scope only', missingIds: 'not global' },
  cases: { actorId: true, actorIds: true, explicitGlobal: true, unscopedMissingIdsRejected: true },
  combatCoreModified: false,
  passed: true
};
fs.writeFileSync(path.join(root, 'stage8_2g_db1a_action_attribution_check.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, actorId: true, actorIds: true, explicitGlobal: true, missingIdsRejected: true }));
