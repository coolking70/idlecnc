import fs from 'node:fs';
import path from 'node:path';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildDbArtShowcaseReport } from './lib/stage8-2G-DB-art-scenarios.mjs';
import { resolveDB1SemanticFrame } from './lib/stage8-2G-DB1-semantic-frame-resolver.mjs';

const root = process.cwd();
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const definitions = [
  { sceneId: 'stage8g-db1-victory', report: fixture('campaign-victory.json'), result: 'victory', semanticFrames: [
    ['d-b1-01-scout-move.png', 'scout-move', 'default'], ['d-b1-02-scout-fire.png', 'scout-fire', 'default'], ['d-b1-03-repair-action.png', 'repair-action', 'default'], ['d-b1-05-cover-advance.png', 'cover-advance', 'default'], ['d-b1-07-narrow-battle-480.png', 'cover-advance', 'narrow']
  ], extraFrames: [['d-b1-08-narrow-victory-result.png', 'victory-result', 'narrow', false]] },
  { sceneId: 'stage8g-db1-withdraw', report: fixture('campaign-withdraw.json'), result: 'withdraw', semanticFrames: [['d-b1-06-retreat-rear-guard.png', 'retreat-rear-guard', 'default']], extraFrames: [['d-b1-09-narrow-withdraw-result.png', 'defeat-result', 'narrow', false]] },
  { sceneId: 'stage8g-db1-art', report: buildDbArtShowcaseReport(), result: 'victory', semanticFrames: [['d-b1-04-support-unarmed.png', 'support-unarmed', 'default'], ['d-b1-10-debug-overlay-preserved.png', 'support-unarmed', 'default', true]] }
];
const scenes = [];
for (const definition of definitions) {
  const presentation = createUniversalBattlePresentation({ id: definition.sceneId, report: definition.report, duration: definition.report.duration, presentationPhase: 'battle' });
  if (!presentation.ok) throw new Error(`D-B.1 machine presentation failed ${definition.sceneId}`);
  const frames = [];
  for (const [file, semantic, viewportKind, debugOverlay = false] of definition.semanticFrames) {
    const resolution = resolveDB1SemanticFrame(presentation, semantic, { viewportKind, sceneId: definition.sceneId });
    if (!resolution.resolved) throw new Error(`D-B.1 semantic unresolved ${definition.sceneId}/${semantic}`);
    frames.push({ file, semantic, sceneId: definition.sceneId, seed: definition.report.seed, viewportKind, visualTimeSeconds: resolution.visualTimeSeconds, timeMs: resolution.timeMs, semanticCheck: true, debugOverlay, sceneHash: presentation.plan.planFingerprint || presentation.plan.source?.reportFingerprint || null, stateSignature: resolution.stateSignature, semanticResolution: resolution, selectionType: semantic.includes('scout') ? 'scout' : semantic.includes('repair') ? 'repair' : semantic.includes('support') ? 'support' : 'friendly' });
  }
  for (const [file, semantic, viewportKind, debugOverlay = false] of (definition.extraFrames || [])) {
    const duration = Number(presentation.plan.timeline.duration);
    const stateSignature = null;
    frames.push({ file, semantic, sceneId: definition.sceneId, seed: definition.report.seed, viewportKind, visualTimeSeconds: duration, timeMs: Number((duration * 1000).toFixed(3)), semanticCheck: false, debugOverlay, sceneHash: presentation.plan.planFingerprint || presentation.plan.source?.reportFingerprint || null, stateSignature, selectionType: 'friendly' });
  }
  scenes.push({ sceneId: definition.sceneId, result: definition.result, seed: definition.report.seed, reportId: definition.report.id, sourceDuration: Number(definition.report.duration), visualDuration: Number(presentation.plan.timeline.duration), sceneHash: presentation.plan.planFingerprint || presentation.plan.source?.reportFingerprint || null, sourceReport: definition.report, frames });
}
const output = { stage: '8.2G-D-B.1', version: 1, frameCount: scenes.reduce((sum, scene) => sum + scene.frames.length, 0), sceneCount: scenes.length, scenes, generatedBy: 'tests/generate-stage8-2G-DB1-machine-evidence.mjs', browserEvidenceRequired: true, semanticResolution: { failClosed: true, browserRecomputeRequired: true } };
fs.writeFileSync(path.join(root, 'stage8_2g_db1_machine_evidence.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frameCount: output.frameCount, sceneCount: output.sceneCount, semanticFrames: scenes.flatMap((scene) => scene.frames).filter((frame) => frame.semanticCheck).length }));
