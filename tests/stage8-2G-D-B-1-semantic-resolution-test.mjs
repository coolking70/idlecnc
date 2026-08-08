import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildDbArtShowcaseReport } from './lib/stage8-2G-DB-art-scenarios.mjs';
import { resolveDB1SemanticFrame } from './lib/stage8-2G-DB1-semantic-frame-resolver.mjs';

const root = process.cwd();
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const scenes = {
  'formal-victory': { report: fixture('campaign-victory.json'), semantics: ['scout-move', 'scout-fire', 'repair-action', 'cover-advance'] },
  'formal-defeat': { report: fixture('campaign-withdraw.json'), semantics: ['retreat-rear-guard'] },
  'synthetic-art': { report: buildDbArtShowcaseReport(), semantics: ['support-unarmed'] }
};
const resolutions = [];
for (const [sceneId, definition] of Object.entries(scenes)) {
  const presentation = createUniversalBattlePresentation({ id: `stage8g-db1-resolution-${sceneId}`, report: definition.report, duration: definition.report.duration, presentationPhase: 'battle' });
  assert.equal(presentation.ok, true, `${sceneId} presentation`);
  for (const semanticName of definition.semantics) {
    const resolution = resolveDB1SemanticFrame(presentation, semanticName);
    assert.equal(resolution.resolved, true, `${sceneId}/${semanticName} did not resolve: ${JSON.stringify(resolution)}`);
    assert.equal(resolution.recomputedPredicate.passed, true, `${sceneId}/${semanticName} recomputation failed`);
    assert.ok(resolution.matchedActorIds.length > 0, `${sceneId}/${semanticName} must bind actor ids`);
    resolutions.push({ sceneId, ...resolution });
  }
}
assert.equal(resolutions.some((item) => item.semanticName === 'scout-fire' && item.matchedShotIds.length > 0), true, 'scout-fire must bind an active shot');
assert.equal(resolutions.some((item) => item.semanticName === 'repair-action' && item.predicate.details.formalRepairEvent === true), true, 'repair must bind formal event');
assert.equal(resolutions.some((item) => item.semanticName === 'cover-advance' && item.predicate.details.activeMoveCount > 0), true, 'cover advance must bind active move');
assert.equal(resolutions.some((item) => item.semanticName === 'retreat-rear-guard' && item.predicate.details.rearGuardPresent === true), true, 'rear guard must bind retreat order');

const output = { stage: '8.2G-D-B.1', kind: 'semantic_resolution', resolver: 'production-render-state-with-coarse-scan-and-binary-refinement', stepSeconds: .05, failClosed: true, browserRecomputeRequired: true, unresolved: resolutions.filter((item) => !item.resolved).map((item) => `${item.sceneId}/${item.semanticName}`), resolutions, passed: true };
fs.writeFileSync(path.join(root, 'stage8_2g_db1_semantic_resolution.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, resolutions: resolutions.length, unresolved: output.unresolved.length, failClosed: output.failClosed }));

