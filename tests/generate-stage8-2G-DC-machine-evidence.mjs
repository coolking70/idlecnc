import fs from 'node:fs';
import path from 'node:path';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildDbArtShowcaseReport } from './lib/stage8-2G-DB-art-scenarios.mjs';
import { resolveDCSemanticFrame } from './lib/stage8-2G-DC-semantic-frame-resolver.mjs';

const root = process.cwd();
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const definitions = [
  { sceneId: 'stage8g-dc-victory', report: fixture('campaign-victory.json'), result: 'victory', frames: [
    ['d-c-01-infantry-muzzle.png', 'infantry-muzzle', 'default'], ['d-c-02-at-rocket-launch.png', 'at-rocket-launch', 'default'], ['d-c-03-mbt-cannon-fire.png', 'mbt-cannon-fire', 'default'], ['d-c-04-small-arms-impact.png', 'small-arms-impact', 'default'], ['d-c-05-rocket-impact.png', 'rocket-impact', 'default'], ['d-c-06-tank-impact.png', 'tank-impact', 'default'], ['d-c-07-damaged-vehicle-smoke.png', 'damaged-smoke', 'default'], ['d-c-08-destruction-sequence.png', 'unit-destroy', 'default'], ['d-c-09-burning-wreck.png', 'wreck-smoke', 'default'], ['d-c-10-repair-effect.png', 'repair-effect', 'default'], ['d-c-12-battle-intro.png', 'battle-intro', 'default'], ['d-c-13-victory-outro.png', 'victory-outro', 'default']
  ] },
  { sceneId: 'stage8g-dc-withdraw', report: fixture('campaign-withdraw.json'), result: 'withdraw', frames: [['d-c-11-heavy-battle-polish.png', 'tank-impact', 'default'], ['d-c-14-defeat-withdraw-outro.png', 'withdraw-outro', 'narrow']] },
  { sceneId: 'stage8g-dc-art', report: buildDbArtShowcaseReport(), result: 'victory', frames: [] }
];

const scenes = [];
for (const definition of definitions) {
  const presentation = createUniversalBattlePresentation({ id: definition.sceneId, report: definition.report, duration: definition.report.duration, presentationPhase: 'battle' });
  if (!presentation.ok) throw new Error(`D-C presentation failed ${definition.sceneId}`);
  const frames = definition.frames.map(([file, semantic, viewportKind]) => {
    const resolution = resolveDCSemanticFrame(presentation, semantic, { viewportKind, sceneId: definition.sceneId });
    if (!resolution.resolved || resolution.predicate?.passed !== true) throw new Error(`D-C semantic unresolved ${definition.sceneId}/${semantic}`);
    return { file, semantic, sceneId: definition.sceneId, seed: definition.report.seed, viewportKind, visualTimeSeconds: resolution.visualTimeSeconds, timeMs: resolution.timeMs, semanticCheck: true, sceneHash: presentation.plan.planFingerprint || presentation.plan.source?.reportFingerprint || null, stateSignature: resolution.stateSignature, semanticResolution: resolution, effectKinds: resolution.effectKinds, effectInventory: resolution.effectInventory, cameraFeedback: resolution.cameraFeedback, audioCues: resolution.audioCues, transitions: resolution.transitions };
  });
  scenes.push({ sceneId: definition.sceneId, result: definition.result, seed: definition.report.seed, reportId: definition.report.id, sourceDuration: Number(definition.report.duration), visualDuration: Number(presentation.plan.timeline.duration), sceneHash: presentation.plan.planFingerprint || presentation.plan.source?.reportFingerprint || null, sourceReport: definition.report, frames });
}

const output = { stage: '8.2G-D-C', version: 1, frameCount: scenes.reduce((sum, scene) => sum + scene.frames.length, 0), sceneCount: scenes.length, scenes, generatedBy: 'tests/generate-stage8-2G-DC-machine-evidence.mjs', browserEvidenceRequired: true, semanticResolution: { failClosed: true, browserRecomputeRequired: true, authorityEventBindingRequired: true, effectRuntimeVersion: '8.2G-D-C' } };
fs.writeFileSync(path.join(root, 'stage8_2g_dc_machine_evidence.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frameCount: output.frameCount, sceneCount: output.sceneCount, semanticFrames: output.frameCount }));
