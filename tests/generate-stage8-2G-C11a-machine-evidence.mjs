import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildStageC1EvidenceStateSignature, buildEvidenceSceneHash } from '../js/battle-presentation/universal/evidence-integrity.js';
import { buildC1ScenarioReports } from './lib/stage8-2G-C1-scenarios.mjs';
import { buildProductionDrawSpecs } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { normalizeVisualUnitClass } from '../js/battle-presentation/environment/visual-unit-class.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const frameSpec = [
  ['alias-01-enemy-at-is-infantry.png', 'defeat', .62, 'enemy-at-alias', 'default'],
  ['footprint-01-friendly-infantry-narrow.png', 'victory', .48, 'friendly-infantry-narrow', 'narrow'],
  ['footprint-02-enemy-at-narrow.png', 'defeat', .68, 'enemy-at-narrow', 'narrow'],
  ['coverpath-01-cover-advance-route.png', 'victory', .52, 'cover-advance-start', 'default'],
  ['coverpath-02-cover-advance-midpoint.png', 'victory', .58, 'cover-advance-midpoint', 'default'],
  ['faction-01-friendly-enemy-at-same-frame.png', 'defeat', .68, 'faction-same-frame', 'default']
];
const viewportFor = (kind) => kind === 'narrow' ? { width: 469, height: 726, scale: Math.min(469 / 1280, 726 / 720), dpr: 1, offsetX: 0, offsetY: (726 - 720 * Math.min(469 / 1280, 726 / 720)) / 2 } : { width: 1067, height: 712, scale: Math.min(1067 / 1280, 712 / 720), dpr: 1, offsetX: 0, offsetY: (712 - 720 * Math.min(1067 / 1280, 712 / 720)) / 2 };
const reports = await buildC1ScenarioReports(); const scenes = new Map();
for (const [file, result, ratio, semantic, viewportKind] of frameSpec) {
  const report = reports[result === 'defeat' ? 'defeat' : 'victory']; const sceneId = result === 'defeat' ? 'stage8g-c11a-defeat' : 'stage8g-c11a-victory';
  const presentation = scenes.get(sceneId)?.presentation || createUniversalBattlePresentation({ id: sceneId, report, duration: report.duration, presentationPhase: 'battle' });
  if (!presentation.ok) throw new Error(`C.1.1a presentation failed: ${sceneId}`);
  const scene = scenes.get(sceneId) || { sceneId, result: result === 'defeat' ? 'withdraw' : 'victory', seed: report.seed, reportId: report.id, sceneHash: buildEvidenceSceneHash(presentation.plan), presentation };
  const timeMs = Number((presentation.plan.timeline.duration * ratio * 1000).toFixed(3)); const state = presentation.renderState.atTime(timeMs / 1000); const viewport = viewportFor(viewportKind);
  const specs = buildProductionDrawSpecs({ actors: state.actors, wrecks: state.wrecks, environment: state.environment, camera: state.camera, options: { battlefieldBounds: presentation.plan.layout.bounds, viewport, presentationSeconds: timeMs / 1000, seed: report.seed } });
  const screenMetrics = { metricSpace: 'final_css_pixels', geometrySource: 'production-final-draw-geometry', viewport, camera: state.camera, actors: specs.actorSpecs.map((spec) => ({ ...spec.finalDrawGeometry, actorId: spec.actorId, side: spec.faction, type: spec.type, assetId: spec.assetId, assetMode: spec.assetMode, assetStatus: spec.assetStatus, factionVisualMode: spec.factionVisualMode, factionPalette: spec.factionPalette, factionMark: spec.factionMark, animation: spec.animation, direction: spec.animationState?.direction || null, directionIndex: spec.animationState?.directionIndex ?? null, frameIndex: spec.animationState?.frameIndex ?? null, sourceRect: spec.sourceRect || null, turretSourceRect: spec.turretSourceRect || null, muzzleAnchor: spec.muzzleAnchor || null, actualDrawPath: spec.assetMode === 'procedural' ? 'procedural-fallback' : spec.assetMode === 'hybrid' ? 'drawImage:components' : 'drawImage', rendererGeometrySource: 'production-final-draw-geometry' })) };
  const semanticFrameId = `${sceneId}::${semantic}::${viewportKind}`;
  scene.frames ||= []; scene.frames.push({ semanticFrameId, file, semantic, result: scene.result, sceneId, seed: report.seed, timeMs, visualTimeSeconds: timeMs / 1000, viewportKind, sceneHash: scene.sceneHash, stateSignature: buildStageC1EvidenceStateSignature({ sceneId, seed: report.seed, state, timeMs, semanticName: semantic }), environmentSignature: state.environment.signature, destructionSignature: state.destruction.signature, routeClearance: { routeClasses: state.environment.metrics.routeClasses, routeSegmentCounts: state.environment.metrics.routeSegmentCounts, violations: state.environment.metrics.routeSegmentViolations, violationsByClass: state.environment.metrics.routeSegmentViolationsByClass }, coverPresentationRoutes: state.engagementSchedule.coverMoves.map((move) => ({ id: move.id, purpose: move.purpose, start: move.start, end: move.end, routes: move.presentationRoutes || {} })), retreatPresentationRoutes: state.engagementSchedule.retreatOrders.map((order) => ({ id: order.id, actorId: order.actorId, role: order.role, route: order.presentationRoute })), screenMetrics, visualClassRows: state.actors.map((actor) => ({ actorId: actor.id, side: actor.side, type: actor.type, visualClass: normalizeVisualUnitClass(actor) })), factionResolution: specs.actorSpecs.map((spec) => ({ actorId: spec.actorId, side: spec.faction, visualClass: spec.visualClass, assetId: spec.assetId, assetMode: spec.assetMode, factionVisualMode: spec.factionVisualMode, requestedAssetId: spec.requestedAssetId })) });
  scenes.set(sceneId, scene);
}
const output = { stage: '8.2G-C.1.1a', version: 1, generatedBy: 'tests/generate-stage8-2G-C11a-machine-evidence.mjs', independentAudit: false, canonical: { expectedState: 'recomputed-from-current-code-and-canonical-scenario-reports', stateSignature: 'stageC1-payload-v1/sha256' }, scenes: [...scenes.values()].map(({ presentation, ...scene }) => ({ ...scene, sourceReport: reports[scene.result === 'withdraw' ? 'defeat' : 'victory'] })), frameCount: frameSpec.length };
await fs.writeFile(path.join(root, 'stage8_2g_c11a_machine_semantic_evidence.json'), `${JSON.stringify(output, null, 2)}\n`); console.log(JSON.stringify({ ok: true, stage: output.stage, scenes: output.scenes.length, frames: output.frameCount }));
