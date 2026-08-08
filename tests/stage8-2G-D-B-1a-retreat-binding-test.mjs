import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { evaluateProductionSemanticPredicate } from '../js/battle-presentation/universal/production-semantic-predicates.js';
import { resolveDB1SemanticFrame } from './lib/stage8-2G-DB1-semantic-frame-resolver.mjs';

const root = process.cwd();
const report = JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures/campaign-withdraw.json'), 'utf8')).report;
const presentation = createUniversalBattlePresentation({ id: 'stage8g-db1a-retreat', report, duration: report.duration, presentationPhase: 'battle' });
assert.equal(presentation.ok, true);
const resolution = resolveDB1SemanticFrame(presentation, 'retreat-rear-guard');
assert.equal(resolution.resolved, true, 'retreat/rear guard semantic unresolved');
const state = presentation.renderState.atTime(resolution.visualTimeSeconds);
const predicate = evaluateProductionSemanticPredicate('retreat-rear-guard', state);
assert.equal(predicate.passed, true);
const retreatActorIds = predicate.details.retreatActorIds;
const rearGuardActorIds = predicate.details.rearGuardActorIds;
assert.ok(retreatActorIds.length > 0);
assert.ok(rearGuardActorIds.length > 0);
assert.equal(retreatActorIds.some((id) => rearGuardActorIds.includes(id)), false);

const missingRetreat = structuredClone(state); missingRetreat.actors = missingRetreat.actors.filter((actor) => !retreatActorIds.includes(actor.id));
const missingRearGuard = structuredClone(state); missingRearGuard.actors = missingRearGuard.actors.filter((actor) => !rearGuardActorIds.includes(actor.id));
const onlyRearGuard = structuredClone(state); onlyRearGuard.actors = onlyRearGuard.actors.filter((actor) => rearGuardActorIds.includes(actor.id));
const onlyRetreat = structuredClone(state); onlyRetreat.actors = onlyRetreat.actors.filter((actor) => retreatActorIds.includes(actor.id));
const negativeTests = {
  missingRetreatRejected: evaluateProductionSemanticPredicate('retreat-rear-guard', missingRetreat).passed === false,
  missingRearGuardRejected: evaluateProductionSemanticPredicate('retreat-rear-guard', missingRearGuard).passed === false,
  onlyRearGuardRejected: evaluateProductionSemanticPredicate('retreat-rear-guard', onlyRearGuard).passed === false,
  onlyRetreatRejected: evaluateProductionSemanticPredicate('retreat-rear-guard', onlyRetreat).passed === false
};
assert.deepEqual(negativeTests, { missingRetreatRejected: true, missingRearGuardRejected: true, onlyRearGuardRejected: true, onlyRetreatRejected: true });
const output = { stage: '8.2G-D-B.1a', kind: 'retreat_rear_guard_binding', semantic: predicate, retreatActorIds, rearGuardActorIds, distinctPair: true, negativeTests, passed: true };
fs.writeFileSync(path.join(root, 'stage8_2g_db1a_retreat_rear_guard_binding.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, retreatActorIds, rearGuardActorIds, distinctPair: true, negativeTests }));
