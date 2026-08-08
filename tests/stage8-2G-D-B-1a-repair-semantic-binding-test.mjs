import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { evaluateProductionSemanticPredicate } from '../js/battle-presentation/universal/production-semantic-predicates.js';
import { resolveDB1SemanticFrame } from './lib/stage8-2G-DB1-semantic-frame-resolver.mjs';
import { buildDbArtShowcaseReport } from './lib/stage8-2G-DB-art-scenarios.mjs';

const root = process.cwd();
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const definitions = [
  ['formal-victory', fixture('campaign-victory.json')],
  ['formal-withdraw', fixture('campaign-withdraw.json')],
  ['synthetic-art', buildDbArtShowcaseReport()]
];
const rows = [];
for (const [sceneId, report] of definitions) {
  const presentation = createUniversalBattlePresentation({ id: `stage8g-db1a-binding-${sceneId}`, report, duration: report.duration, presentationPhase: 'battle' });
  assert.equal(presentation.ok, true, `${sceneId} presentation`);
  const resolution = resolveDB1SemanticFrame(presentation, 'repair-action');
  assert.equal(resolution.resolved, true, `${sceneId} repair semantic unresolved`);
  const state = presentation.renderState.atTime(resolution.visualTimeSeconds);
  const predicate = evaluateProductionSemanticPredicate('repair-action', state);
  assert.equal(predicate.passed, true);
  assert.ok(predicate.repairSourceActorId);
  assert.ok(predicate.repairTargetActorId);
  assert.notEqual(predicate.repairSourceActorId, predicate.repairTargetActorId);
  assert.equal(predicate.targetBound, true);

  const removeSource = structuredClone(state); removeSource.actors = removeSource.actors.filter((actor) => actor.id !== predicate.repairSourceActorId);
  const removeTarget = structuredClone(state); removeTarget.actors = removeTarget.actors.filter((actor) => actor.id !== predicate.repairTargetActorId);
  const wrongSource = structuredClone(state); const ordinary = wrongSource.actors.find((actor) => actor.id !== predicate.repairSourceActorId && !isRepairVehicle(actor));
  for (const event of wrongSource.formalRepairEvents) if (event.id === predicate.formalRepairEventId) { event.sourceActorId = ordinary?.id || 'ordinary-infantry'; event.actorId = event.sourceActorId; }
  const negative = {
    missingSource: evaluateProductionSemanticPredicate('repair-action', removeSource).passed === false,
    missingTarget: evaluateProductionSemanticPredicate('repair-action', removeTarget).passed === false,
    wrongSource: evaluateProductionSemanticPredicate('repair-action', wrongSource).passed === false
  };
  assert.deepEqual(negative, { missingSource: true, missingTarget: true, wrongSource: true }, `${sceneId} repair negative binding`);
  rows.push({ sceneId, formalRepairEventId: predicate.formalRepairEventId, repairSourceActorId: predicate.repairSourceActorId, repairTargetActorId: predicate.repairTargetActorId, sourceType: predicate.details.sourceType, targetType: predicate.details.targetType, sourceAnimation: predicate.sourceAnimation, sourceVisualState: predicate.sourceVisualState, targetBound: predicate.targetBound, matchedActorIds: predicate.matchedActorIds, negative });
}
const output = { stage: '8.2G-D-B.1a', kind: 'repair_semantic_source_target_binding', scenes: rows, negativeTests: { missingSourceRejected: true, missingTargetRejected: true, wrongSourceRejected: true }, passed: true };
fs.writeFileSync(path.join(root, 'stage8_2g_db1a_repair_semantic_binding.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, scenes: rows.length, sourceTargetBound: true, negativeTests: output.negativeTests }));

function isRepairVehicle(actor) { return actor?.type === 'repair_vehicle' || actor?.repairSource === true; }
