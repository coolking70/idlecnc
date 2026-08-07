import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildStageC1EvidenceStateSignature, buildEvidenceSceneHash } from '../js/battle-presentation/universal/evidence-integrity.js';
import { buildC1ScenarioReports } from './lib/stage8-2G-C1-scenarios.mjs';
import { buildProductionDrawSpecs } from '../js/battle-presentation/environment/production-visual-draw-spec.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frameSpec = [
  ['readability-01-friendly-vs-enemy-infantry.png', 'victory', .48, 'readability-friendly-enemy-infantry', 'default'],
  ['readability-02-friendly-vs-enemy-armor.png', 'victory', .62, 'readability-friendly-enemy-armor', 'default'],
  ['screen-01-default-footprint.png', 'victory', .48, 'screen-footprint-default', 'default'],
  ['screen-02-narrow-footprint.png', 'victory', .62, 'screen-footprint-narrow', 'narrow'],
  ['route-01-cover-advance-clear.png', 'victory', .52, 'cover-advance-clear', 'default'],
  ['route-02-retreat-clear.png', 'defeat', .9, 'retreat-clear', 'default'],
  ['route-03-rear-guard-clear.png', 'defeat', .91, 'rear-guard-clear', 'default']
];
const reports = await buildC1ScenarioReports(); const scenes = new Map();
// These are the measured CSS canvas boxes of the current production shell at
// the two evidence sizes (the browser manifest records the same rectangles).
const viewportFor = (kind) => kind === 'narrow' ? { width: 469, height: 726, scale: Math.min(469 / 1280, 726 / 720), dpr: 1, offsetX: 0, offsetY: (726 - 720 * Math.min(469 / 1280, 726 / 720)) / 2 } : { width: 1067, height: 712, scale: Math.min(1067 / 1280, 712 / 720), dpr: 1, offsetX: 0, offsetY: (712 - 720 * Math.min(1067 / 1280, 712 / 720)) / 2 };
for (const [file, result, ratio, semantic, viewportKind] of frameSpec) {
  const report = reports[result === 'defeat' ? 'defeat' : 'victory']; const sceneId = result === 'defeat' ? 'stage8g-c11-defeat' : 'stage8g-c11-victory'; const presentation = scenes.get(sceneId)?.presentation || createUniversalBattlePresentation({ id: sceneId, report, duration: report.duration, presentationPhase: 'battle' }); if (!presentation.ok) throw new Error(`C.1.1 presentation failed: ${sceneId}`); const scene = scenes.get(sceneId) || { sceneId, result: result === 'defeat' ? 'withdraw' : 'victory', seed: report.seed, reportId: report.id, sceneHash: buildEvidenceSceneHash(presentation.plan), presentation }; scenes.set(sceneId, scene);
  const timeMs = Number((presentation.plan.timeline.duration * ratio * 1000).toFixed(3)); const state = presentation.renderState.atTime(timeMs / 1000); const viewport = viewportFor(viewportKind); const runtimeSpecs = buildProductionDrawSpecs({ actors: state.actors, wrecks: state.wrecks, environment: state.environment, camera: state.camera, options: { battlefieldBounds: presentation.plan.layout.bounds, viewport } }); const screenMetrics = { metricSpace: 'final_css_pixels', viewport, camera: state.camera, actors: runtimeSpecs.actorSpecs.map((spec) => ({ actorId: spec.actorId, side: spec.faction, type: spec.type, minimumScreenFootprint: spec.minimumScreenFootprint, rawScreenFootprint: spec.rawScreenFootprint, visualScaleBoost: spec.visualScaleBoost, screenFootprint: spec.screenFootprint, metricSpace: spec.metricSpace })) }; const semanticFrameId = `${sceneId}::${semantic}::${viewportKind}`; scene.frames ||= []; scene.frames.push({ semanticFrameId, file, semantic, result: scene.result, sceneId, seed: report.seed, timeMs, visualTimeSeconds: timeMs / 1000, viewportKind, sceneHash: scene.sceneHash, stateSignature: buildStageC1EvidenceStateSignature({ sceneId, seed: report.seed, state, timeMs, semanticName: semantic }), environmentSignature: state.environment.signature, destructionSignature: state.destruction.signature, routeClearance: { routeClasses: state.environment.metrics.routeClasses, routeSegmentCounts: state.environment.metrics.routeSegmentCounts, violations: state.environment.metrics.routeSegmentViolations, violationsByClass: state.environment.metrics.routeSegmentViolationsByClass }, screenMetrics, factionResolution: state.drawSpecs.actorSpecs.map((spec) => ({ actorId: spec.actorId, side: spec.faction, type: spec.type, assetId: spec.assetId, assetMode: spec.assetMode, factionVisualMode: spec.factionVisualMode, requestedAssetId: spec.requestedAssetId })) });
}
const output = { stage: '8.2G-C.1.1', version: 1, generatedBy: 'tests/generate-stage8-2G-C11-machine-evidence.mjs', independentAudit: false, browserFallbackAllowed: false, canonical: { expectedState: 'recomputed-from-current-code-and-canonical-scenario-reports', stateSignature: 'stageC1-payload-v1/sha256' }, scenes: [...scenes.values()].map(({ presentation, ...scene }) => ({ ...scene, sourceReport: reports[scene.result === 'withdraw' ? 'defeat' : 'victory'] })), frameCount: frameSpec.length };
await fs.writeFile(path.join(root, 'stage8_2g_c11_machine_semantic_evidence.json'), `${JSON.stringify(output, null, 2)}\n`); console.log(JSON.stringify({ ok: true, stage: output.stage, scenes: output.scenes.length, frames: output.frameCount }));
