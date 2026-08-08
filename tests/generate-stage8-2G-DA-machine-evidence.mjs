import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStageC1EvidenceStateSignature, buildEvidenceSceneHash } from '../js/battle-presentation/universal/evidence-integrity.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { OFFLINE_ASSET_MANIFEST } from '../js/battle-presentation/environment/asset-provider.js';
import { buildProductionDrawSpecs } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { buildArtShowcaseReport } from './lib/stage8-2G-DA-art-scenarios.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'stage8_2g_da_machine_semantic_evidence.json');
const report = buildArtShowcaseReport(); const sceneId = 'stage8g-da-art-showcase'; const presentation = createUniversalBattlePresentation({ id: sceneId, report, duration: report.duration, presentationPhase: 'battle' }); if (!presentation.ok) throw new Error(presentation.reason || 'D-A showcase presentation failed');
const frameSpec = [
  ['d-a-01-friendly-unit-lineup.png', .18, 'friendly-lineup', 'default', false],
  ['d-a-02-enemy-unit-lineup.png', .18, 'enemy-lineup', 'default', false],
  ['d-a-03-friendly-infantry-move.png', .28, 'friendly-infantry-move', 'default', false],
  ['d-a-04-infantry-fire.png', .48, 'infantry-fire', 'default', false],
  ['d-a-05-friendly-at-fire.png', .52, 'friendly-at-fire', 'default', false],
  ['d-a-06-enemy-at-fire.png', .52, 'enemy-at-fire', 'default', false],
  ['d-a-07-tank-direction-and-turret.png', .38, 'tank-direction-and-turret', 'default', false],
  ['d-a-08-tank-fire.png', .62, 'tank-fire', 'default', false],
  ['d-a-09-mixed-battle.png', .58, 'mixed-battle', 'default', false],
  ['d-a-10-friendly-enemy-wrecks.png', 1, 'friendly-enemy-wrecks', 'default', false],
  ['d-a-11-narrow-readability.png', .58, 'narrow-readability', 'narrow', false],
  ['d-a-12-asset-fallback.png', .48, 'asset-fallback', 'default', true]
];
const viewportFor = (kind) => kind === 'narrow' ? { width: 469, height: 726, scale: 469 / 1280, dpr: 1, offsetX: 0, offsetY: (726 - 720 * (469 / 1280)) / 2 } : { width: 1067, height: 712, scale: Math.min(1067 / 1280, 712 / 720), dpr: 1, offsetX: 0, offsetY: (712 - 720 * Math.min(1067 / 1280, 712 / 720)) / 2 };
const rowFor = (spec) => ({ ...spec.finalDrawGeometry, actorId: spec.actorId, side: spec.faction, type: spec.type, assetId: spec.assetId, assetMode: spec.assetMode, assetStatus: spec.assetStatus, factionVisualMode: spec.factionVisualMode, factionPalette: spec.factionPalette, factionMark: spec.factionMark, animation: spec.animation, direction: spec.animationState?.direction || null, directionIndex: spec.animationState?.directionIndex ?? null, frameIndex: spec.animationState?.frameIndex ?? null, sourceRect: spec.sourceRect || null, turretSourceRect: spec.turretSourceRect || null, muzzleAnchor: spec.muzzleAnchor || null, actualDrawPath: spec.assetMode === 'procedural' ? 'procedural-fallback' : spec.assetMode === 'hybrid' ? 'drawImage:components' : 'drawImage', rendererGeometrySource: 'production-final-draw-geometry' });
const frames = frameSpec.map(([file, ratio, semantic, viewportKind, fallback]) => { const timeMs = Number((presentation.plan.timeline.duration * ratio * 1000).toFixed(3)); const state = presentation.renderState.atTime(timeMs / 1000); const viewport = viewportFor(viewportKind); const specs = buildProductionDrawSpecs({ actors: state.actors, wrecks: state.wrecks, environment: state.environment, camera: state.camera, options: { battlefieldBounds: presentation.plan.layout.bounds, viewport, presentationSeconds: timeMs / 1000, seed: report.seed } }); return { semanticFrameId: `${sceneId}::${semantic}::${viewportKind}`, file, semantic, sceneId, seed: report.seed, timeMs, visualTimeSeconds: timeMs / 1000, viewportKind, fallbackExpected: fallback, sceneHash: buildEvidenceSceneHash(presentation.plan), stateSignature: buildStageC1EvidenceStateSignature({ sceneId, seed: report.seed, state, timeMs, semanticName: semantic }), environmentSignature: state.environment.signature, destructionSignature: state.destruction.signature, screenMetrics: { metricSpace: 'final_css_pixels', geometrySource: 'production-final-draw-geometry', viewport, camera: state.camera, actors: specs.actorSpecs.map(rowFor) }, actors: state.actors.map((actor) => ({ id: actor.id, side: actor.side, type: actor.type, visualClass: actor.drawSpec?.visualClass, visualState: actor.visualState, position: actor.visualCenter })), wrecks: state.wrecks.map((wreck) => ({ id: wreck.id, sourceActorId: wreck.sourceActorId, side: wreck.side, wreckType: wreck.wreckType, assetId: wreck.drawSpec?.assetId, angle: wreck.angle })), routeClearance: { violations: state.environment.metrics.routeSegmentViolations, byClass: state.environment.metrics.routeSegmentViolationsByClass } }; });
const output = { stage: '8.2G-D-A', version: 1, generatedBy: 'tests/generate-stage8-2G-DA-machine-evidence.mjs', independentAudit: false, manifestSha256: crypto.createHash('sha256').update(await fs.readFile(path.join(root, 'assets/battle/asset-manifest.json'))).digest('hex'), sourceReportHash: crypto.createHash('sha256').update(stableStringify(report)).digest('hex'), scene: { sceneId, result: report.result, seed: report.seed, sceneHash: buildEvidenceSceneHash(presentation.plan), sourceReport: report, frames }, frameCount: frames.length };
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`); console.log(JSON.stringify({ ok: true, stage: output.stage, frames: frames.length, output: outputPath }));
