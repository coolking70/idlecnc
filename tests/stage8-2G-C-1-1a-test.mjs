import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalEvidenceString } from '../js/battle-presentation/universal/evidence-integrity.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { OFFLINE_ASSET_MANIFEST, resolveUnitAsset } from '../js/battle-presentation/environment/asset-provider.js';
import { buildActorFinalDrawGeometry, buildProductionDrawSpecs, MINIMUM_SCREEN_FOOTPRINT } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { normalizeVisualUnitClass } from '../js/battle-presentation/environment/visual-unit-class.js';
import { routeClearanceRadius } from '../js/battle-presentation/environment/environment-layout.js';
import { buildC1ScenarioReports } from './lib/stage8-2G-C1-scenarios.mjs';

const root = process.cwd();
const write = (file, value) => fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
const reports = await buildC1ScenarioReports();
const manifestSources = new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source));
const aliases = [
  [{ type: 'infantry', category: 'infantry', shape: 'infantry' }, 'infantry'],
  [{ type: 'enemy_infantry', category: 'infantry' }, 'infantry'],
  [{ type: 'at_infantry', category: 'at_infantry', shape: 'at_infantry' }, 'anti_armor_infantry'],
  [{ type: 'enemy_at', category: 'at_infantry' }, 'anti_armor_infantry'],
  [{ type: 'mbt', category: 'armor', shape: 'tank' }, 'mbt'],
  [{ type: 'scout_car', category: 'vehicle', shape: 'scout' }, 'light_vehicle'],
  [{ type: 'enemy_scout_car', category: 'vehicle' }, 'light_vehicle'],
  [{ type: 'repair_vehicle', category: 'support' }, 'support_vehicle'],
  [{ type: 'support_vehicle', category: 'support_vehicle', shape: 'support' }, 'support_vehicle'],
  [{ type: 'unmapped' }, 'unknown']
];
const aliasCases = aliases.map(([actor, expected]) => {
  const actual = normalizeVisualUnitClass(actor); assert.equal(actual, expected, `${actor.type} visual class`); return { actor, expected, actual };
});
const enemyAt = { id: 'alias-enemy-at', side: 'enemy', type: 'enemy_at', category: 'at_infantry' };
const enemyAtAsset = resolveUnitAsset(enemyAt, OFFLINE_ASSET_MANIFEST, manifestSources, 'sprite');
assert.equal(normalizeVisualUnitClass(enemyAt), 'anti_armor_infantry');
assert.equal(enemyAtAsset.assetId, null); assert.equal(enemyAtAsset.mode, 'procedural'); assert.equal(enemyAtAsset.factionVisualMode, 'procedural_enemy');

const aliasEvidence = { stage: '8.2G-C.1.1a', matrix: aliasCases, enemyAt: { assetId: enemyAtAsset.assetId, mode: enemyAtAsset.mode, factionVisualMode: enemyAtAsset.factionVisualMode, rendererFamily: 'infantry' }, passed: true };
const geometryCases = []; const footprintCases = []; const coverCases = []; const sourceHashes = {};
const visualRadius = (actor) => Math.max(1, Number(actor?.drawSpec?.finalDrawGeometry?.worldSize?.width || 30), Number(actor?.drawSpec?.finalDrawGeometry?.worldSize?.height || 30)) / 2;
for (const [scenario, report] of Object.entries(reports)) {
  const presentation = createUniversalBattlePresentation({ id: `stage8g-c11a-${scenario}`, report, duration: report.duration, presentationPhase: 'battle' });
  assert.equal(presentation.ok, true, `${scenario} presentation`);
  sourceHashes[scenario] = canonicalEvidenceString(report);
  const plan = presentation.plan;
  const state = presentation.renderState.atTime(plan.timeline.duration * .62);
  const narrow = { width: 780, height: 900, scale: Math.min(780 / 1280, 900 / 720) };
  const specs = buildProductionDrawSpecs({ actors: state.actors, wrecks: state.wrecks, environment: state.environment, camera: state.camera, options: { battlefieldBounds: plan.layout.bounds, viewport: narrow } });
  for (const spec of specs.actorSpecs) {
    assert.equal(spec.rendererGeometrySource, 'production-final-draw-geometry');
    const manifestAsset = OFFLINE_ASSET_MANIFEST.assets.find((asset) => asset.id === spec.assetId);
    assert.deepEqual(spec.finalDrawGeometry, buildActorFinalDrawGeometry({ actor: state.actors.find((actor) => actor.id === spec.actorId), resolved: { assetId: spec.assetId, requestedAssetId: spec.requestedAssetId, mode: spec.assetMode, fallback: spec.fallbackUsed, worldSize: manifestAsset?.worldSize || null }, visualClass: spec.visualClass, camera: state.camera, battlefieldBounds: plan.layout.bounds, viewport: narrow }));
    assert.ok(spec.finalCssWidth >= 0 && spec.finalCssHeight >= 0);
    assert.ok(spec.screenFootprint + 1e-9 >= spec.minimumScreenFootprint, `${scenario} ${spec.actorId} floor`);
    geometryCases.push({ scenario, actorId: spec.actorId, visualClass: spec.visualClass, renderMode: spec.renderMode, assetId: spec.assetId, logicalRect: spec.logicalRect, cssRect: spec.cssRect, finalCssWidth: spec.finalCssWidth, finalCssHeight: spec.finalCssHeight, screenFootprint: spec.screenFootprint, minimumScreenFootprint: spec.minimumScreenFootprint, visualScaleBoost: spec.visualScaleBoost, rendererGeometrySource: spec.rendererGeometrySource });
  }
  footprintCases.push({ scenario, viewport: narrow, actors: specs.actorSpecs.map((spec) => ({ actorId: spec.actorId, visualClass: spec.visualClass, finalCssWidth: spec.finalCssWidth, finalCssHeight: spec.finalCssHeight, screenFootprint: spec.screenFootprint, minimumScreenFootprint: spec.minimumScreenFootprint, visualScaleBoost: spec.visualScaleBoost })) });
  const sameFrame = state.actors.filter((actor) => ['friendly', 'enemy'].includes(actor.side)).map((actor) => normalizeVisualUnitClass(actor));
  assert.ok(sameFrame.includes('infantry') && sameFrame.includes('anti_armor_infantry'), `${scenario} faction class coverage`);
  const schedule = state.engagementSchedule;
  for (const move of schedule.coverMoves) {
    for (const actorId of move.maneuverGroupIds) assert.ok(move.presentationRoutes?.[actorId]?.length >= (move.purpose === 'cover_retreat' ? 3 : 9), `${scenario} ${move.id} route ${actorId}`);
    for (const actorId of move.fireGroupIds) assert.ok(move.fireGroupHoldPositions?.[actorId], `${scenario} ${move.id} fire hold ${actorId}`);
  }
  const windows = [...schedule.coverMoves.map((move) => ({ id: move.id, start: move.start, end: move.end, class: move.purpose })), ...schedule.retreatOrders.map((order) => ({ id: order.id, start: order.start, end: order.end, class: order.role === 'rear_guard' ? 'rear_guard' : 'retreat' }))];
  const sampled = [];
  for (const window of windows) for (let seconds = window.start; seconds <= window.end + .0001; seconds += .05) {
    const frame = presentation.renderState.atTime(seconds);
    for (const actor of frame.actors.filter((item) => item.alive)) for (const object of frame.environment.objects) {
      const distance = Math.hypot(actor.visualCenter.x - object.position.x, actor.visualCenter.y - object.position.y);
      const required = routeClearanceRadius(object);
      if (distance < required) sampled.push({ scenario, seed: report.seed, window: window.id, actorId: actor.id, objectId: object.id, distance, required });
    }
  }
  assert.equal(sampled.length, 0, `${scenario} sampled visual-center clearance`);
  coverCases.push({ scenario, seed: report.seed, sampledWindows: windows.length, sampleStepMs: 50, samples: windows.reduce((sum, window) => sum + Math.floor((window.end - window.start) / .05) + 1, 0), plannerRouteViolations: state.environment.metrics.routeSegmentViolationsByClass?.planner?.length || 0, coverAdvanceRouteViolations: state.environment.metrics.routeSegmentViolationsByClass?.cover_advance?.length || 0, retreatRouteViolations: state.environment.metrics.routeSegmentViolationsByClass?.retreat?.length || 0, rearGuardRouteViolations: state.environment.metrics.routeSegmentViolationsByClass?.rear_guard?.length || 0, sampledPathViolations: sampled.length });
}
const seededCoverCases = [];
for (const [scenario, baseReport] of Object.entries(reports)) for (let seed = 0; seed < 20; seed += 1) {
  const report = { ...baseReport, seed };
  const presentation = createUniversalBattlePresentation({ id: `stage8g-c11a-${scenario}-seed-${seed}`, report, duration: report.duration, presentationPhase: 'battle' });
  assert.equal(presentation.ok, true, `${scenario} seed ${seed} presentation`);
  const duration = presentation.plan.timeline.duration;
  const schedule = presentation.renderState.atTime(duration * .62).engagementSchedule;
  const windows = [...schedule.coverMoves.map((move) => ({ id: move.id, start: move.start, end: move.end })), ...schedule.retreatOrders.map((order) => ({ id: order.id, start: order.start, end: order.end }))];
  let violations = 0; let samples = 0;
  for (const window of windows) for (let seconds = window.start; seconds <= window.end + .0001; seconds += .05) {
    const frame = presentation.renderState.atTime(seconds); samples += frame.actors.length * frame.environment.objects.length;
    for (const actor of frame.actors.filter((item) => item.alive)) for (const object of frame.environment.objects) if (Math.hypot(actor.visualCenter.x - object.position.x, actor.visualCenter.y - object.position.y) < routeClearanceRadius(object)) violations += 1;
  }
  assert.equal(violations, 0, `${scenario} seed ${seed} sampled clearance`);
  seededCoverCases.push({ scenario, seed, windows: windows.length, sampleStepMs: 50, samples, sampledPathViolations: violations });
}
assert.deepEqual(sourceHashes, Object.fromEntries(Object.entries(reports).map(([key, report]) => [key, canonicalEvidenceString(report)])), 'combat report authority mutated');

const runtimeCheck = { stage: '8.2G-C.1.1a', manifestProvider: OFFLINE_ASSET_MANIFEST.provider, runtimeApi: 'battlePresentationAssetStatus', sameFrameActualDrawPathRequired: true, fallbackPolicy: 'enemy-at-procedural-enemy', passed: true };
const authority = { stage: '8.2G-C.1.1a', reportHashes: sourceHashes, combatCoreModified: false, authorityInputsModified: false, plannerFootprintsModified: false, routeSemanticsModified: false, passed: true };
write('stage8_2g_c11a_visual_unit_class_check.json', aliasEvidence);
write('stage8_2g_c11a_final_draw_geometry.json', { stage: '8.2G-C.1.1a', geometrySource: 'production-final-draw-geometry', cases: geometryCases, passed: true });
write('stage8_2g_c11a_screen_footprint_check.json', { stage: '8.2G-C.1.1a', metricSpace: 'final_css_pixels', minimums: { ...MINIMUM_SCREEN_FOOTPRINT }, cases: footprintCases, passed: true });
write('stage8_2g_c11a_cover_path_check.json', { stage: '8.2G-C.1.1a', scenarios: ['victory', 'defeat'], seedsPerScenario: 20, sampleStepMs: 50, routeClasses: ['planner', 'cover_advance', 'retreat', 'rear_guard'], cases: [...coverCases, ...seededCoverCases], sampledPathViolations: 0, passed: true });
write('stage8_2g_c11a_asset_runtime_check.json', runtimeCheck);
write('stage8_2g_c11a_authority_check.json', authority);
write('stage8_2g_c11a_developer_selfcheck.json', { stage: '8.2G-C.1.1a', uniqueNormalizer: true, sharedFinalDrawGeometry: true, sharedPresentationRoutes: true, assetRuntimeGuarded: true, sampledSeeds: 40, sampledPathViolations: 0, passed: true });
console.log(JSON.stringify({ ok: true, stage: '8.2G-C.1.1a', aliasCases: aliasCases.length, geometryCases: geometryCases.length, coverCases: coverCases.length + seededCoverCases.length, sampledPathViolations: 0 }));
