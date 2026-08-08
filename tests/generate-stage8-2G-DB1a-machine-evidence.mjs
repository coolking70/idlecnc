import fs from 'node:fs';
import path from 'node:path';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildDbArtShowcaseReport } from './lib/stage8-2G-DB-art-scenarios.mjs';
import { resolveDB1SemanticFrame } from './lib/stage8-2G-DB1-semantic-frame-resolver.mjs';

const root = process.cwd();
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const definitions = [
  { sceneId: 'stage8g-db1a-victory', report: fixture('campaign-victory.json'), result: 'victory', frames: [
    ['d-b1a-01-repair-source-target.png', 'repair-action', 'default'],
    ['d-b1a-04-scout-fire-regression.png', 'scout-fire', 'default'],
    ['d-b1a-05-cover-advance-regression.png', 'cover-advance', 'default'],
    ['d-b1a-06-narrow-regression.png', 'cover-advance', 'narrow']
  ] },
  { sceneId: 'stage8g-db1a-withdraw', report: fixture('campaign-withdraw.json'), result: 'withdraw', frames: [
    ['d-b1a-02-repair-no-contamination.png', 'repair-action', 'default'],
    ['d-b1a-03-retreat-rear-guard.png', 'retreat-rear-guard', 'default']
  ] },
  { sceneId: 'stage8g-db1a-art', report: buildDbArtShowcaseReport(), result: 'victory', frames: [
    ['d-b1a-07-production-no-leak-regression.png', 'support-unarmed', 'default']
  ] }
];
const scenes = [];
for (const definition of definitions) {
  const presentation = createUniversalBattlePresentation({ id: definition.sceneId, report: definition.report, duration: definition.report.duration, presentationPhase: 'battle' });
  if (!presentation.ok) throw new Error(`D-B.1a presentation failed ${definition.sceneId}`);
  const frames = definition.frames.map(([file, semantic, viewportKind]) => {
    const resolution = resolveDB1SemanticFrame(presentation, semantic, { viewportKind, sceneId: definition.sceneId });
    if (!resolution.resolved) throw new Error(`D-B.1a semantic unresolved ${definition.sceneId}/${semantic}`);
    const repair = semantic === 'repair-action';
    return {
      file,
      semantic,
      sceneId: definition.sceneId,
      seed: definition.report.seed,
      viewportKind,
      visualTimeSeconds: resolution.visualTimeSeconds,
      timeMs: resolution.timeMs,
      semanticCheck: true,
      sceneHash: presentation.plan.planFingerprint || presentation.plan.source?.reportFingerprint || null,
      stateSignature: resolution.stateSignature,
      semanticResolution: resolution,
      selectionType: repair ? 'repair-source' : semantic.includes('scout') ? 'scout' : semantic.includes('support') ? 'support' : 'friendly',
      repairExpected: repair
    };
  });
  scenes.push({ sceneId: definition.sceneId, result: definition.result, seed: definition.report.seed, reportId: definition.report.id, sourceDuration: Number(definition.report.duration), visualDuration: Number(presentation.plan.timeline.duration), sceneHash: presentation.plan.planFingerprint || presentation.plan.source?.reportFingerprint || null, sourceReport: definition.report, frames });
}
const output = { stage: '8.2G-D-B.1a', version: 1, frameCount: scenes.reduce((sum, scene) => sum + scene.frames.length, 0), sceneCount: scenes.length, scenes, generatedBy: 'tests/generate-stage8-2G-DB1a-machine-evidence.mjs', browserEvidenceRequired: true, semanticResolution: { failClosed: true, browserRecomputeRequired: true, repairSourceTargetRequired: true, retreatRearGuardPairRequired: true } };
fs.writeFileSync(path.join(root, 'stage8_2g_db1a_machine_evidence.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frameCount: output.frameCount, sceneCount: output.sceneCount, semanticFrames: output.frameCount }));
