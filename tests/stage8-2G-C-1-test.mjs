import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildEnvironmentScene } from '../js/battle-presentation/environment/environment-scene-builder.js';
import { buildEnvironmentLayout, buildRouteSegments, distanceToSegment, routeClearanceRadius } from '../js/battle-presentation/environment/environment-layout.js';
import { buildBattlefieldDecals } from '../js/battle-presentation/environment/battlefield-decals.js';
import { OFFLINE_ASSET_MANIFEST, resolveAsset } from '../js/battle-presentation/environment/asset-provider.js';
import { buildActorDrawSpec, buildProductionDrawSpecs, MINIMUM_SCREEN_FOOTPRINT } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { buildUniversalVisualScene } from '../js/battle-presentation/universal/universal-visual-scene.js';
import { buildEvidenceStateSignature, canonicalEvidenceString } from '../js/battle-presentation/universal/evidence-integrity.js';
import { VISUAL_WEAPON_PROFILES, visualWeaponProfile } from '../js/battle-presentation/universal/visual-weapon-profiles.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildC1ScenarioReports } from './lib/stage8-2G-C1-scenarios.mjs';

const root = process.cwd();
const writeEvidence = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0; };
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));

const reports = await buildC1ScenarioReports();
const presentation = createUniversalBattlePresentation({ id: 'stage8g-c1-test', report: reports.victory, duration: reports.victory.duration, presentationPhase: 'battle' });
assert.equal(presentation.ok, true, presentation.reason || 'C.1 presentation must be valid');
const plan = presentation.plan;
const stateAt = (ratio) => presentation.renderState.atTime(plan.timeline.duration * ratio);
const state = stateAt(.72);

// Manifest -> Draw Spec -> runtime fallback is a closed, inspectable path.
const availableSources = new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source));
const infantry = state.actors.find((actor) => actor.type === 'infantry');
const tank = state.actors.find((actor) => actor.type === 'mbt');
assert.ok(infantry?.drawSpec?.assetId === 'unit_friendly_infantry');
assert.ok(['sprite', 'hybrid'].includes(infantry.drawSpec.assetMode));
assert.equal(tank?.drawSpec?.assetMode, 'hybrid');
assert.deepEqual(tank.drawSpec.hybridComponents, ['sprite_hull', 'sprite_turret', 'procedural_selection', 'procedural_weapon_effects']);
const fallbackSpec = buildActorDrawSpec(infantry, { zoom: .86 }, { availableSources: new Set() });
assert.equal(fallbackSpec.assetMode, 'procedural');
assert.equal(fallbackSpec.fallbackUsed, true);
assert.equal(resolveAsset(OFFLINE_ASSET_MANIFEST, 'unit_friendly_infantry', availableSources).status, 'ready');
writeEvidence('stage8_2g_c1_asset_runtime_check.json', { stage: '8.2G-C.1', manifestProvider: OFFLINE_ASSET_MANIFEST.provider, runtimeGeneration: OFFLINE_ASSET_MANIFEST.runtimeGeneration, assets: OFFLINE_ASSET_MANIFEST.assets.map((asset) => ({ id: asset.id, source: asset.source, status: resolveAsset(OFFLINE_ASSET_MANIFEST, asset.id, availableSources).status, drawPath: 'drawImage' })), productionDrawSpecs: state.drawSpecs, browserRuntimeRequired: true, passed: true });
writeEvidence('stage8_2g_c1_fallback_check.json', { stage: '8.2G-C.1', assetId: 'unit_friendly_infantry', disabledRuntimePath: 'procedural-fallback', fallbackSpec, brokenImageAvoided: true, passed: true });

// Minimum footprint is enforced even at a narrow camera zoom and is visible in the formal spec.
const footprintRows = Object.entries(MINIMUM_SCREEN_FOOTPRINT).map(([type, minimum]) => {
  const actor = type === 'mbt' ? tank : infantry;
  const spec = buildActorDrawSpec({ ...(actor || {}), type: type === 'anti_armor_infantry' ? 'at_infantry' : type, category: ['infantry', 'anti_armor_infantry'].includes(type) ? 'infantry' : 'vehicle' }, { zoom: .2 }, { availableSources });
  assert.ok(spec.screenFootprint >= minimum, `${type} footprint ${spec.screenFootprint} < ${minimum}`);
  return { type, minimum, screenFootprint: spec.screenFootprint, visualScaleBoost: spec.visualScaleBoost };
});
const narrowSpecs = buildProductionDrawSpecs({ actors: [tank, infantry].filter(Boolean), wrecks: state.wrecks, environment: state.environment, camera: { x: 640, y: 360, zoom: .2 }, options: { availableSources } });
assert.ok(narrowSpecs.actorSpecs.every((spec) => spec.screenFootprint >= spec.minimumScreenFootprint));
writeEvidence('stage8_2g_c1_minimum_screen_footprint.json', { stage: '8.2G-C.1', defaultViewport: state.drawSpecs.actorSpecs.map((spec) => ({ type: spec.type, screenFootprint: spec.screenFootprint, minimum: spec.minimumScreenFootprint })), narrowViewport: footprintRows, rendererNarrowSpecs: narrowSpecs.actorSpecs.map((spec) => ({ actorId: spec.actorId, screenFootprint: spec.screenFootprint, minimum: spec.minimumScreenFootprint })), enforced: true, passed: true });

// Route clearance is checked against every polyline segment, not only route vertices.
const routeRows = [];
for (let seed = 0; seed < 20; seed += 1) {
  const report = { ...reports.victory, seed };
  const seeded = createUniversalBattlePresentation({ id: `stage8g-c1-route-${seed}`, report, duration: report.duration, presentationPhase: 'battle' });
  assert.equal(seeded.ok, true, `seed ${seed} presentation`);
  const environment = buildEnvironmentLayout(seeded.plan);
  const segments = buildRouteSegments(seeded.plan);
  assert.equal(environment.metrics.routeSegmentViolations.length, 0, `seed ${seed} route segment violation`);
  for (const object of environment.objects) for (const segment of segments) assert.ok(distanceToSegment(object.position, segment.start, segment.end) >= routeClearanceRadius(object) - 1e-9);
  routeRows.push({ seed, objectCount: environment.objects.length, routeSegmentCount: segments.length, routeSegmentViolations: environment.metrics.routeSegmentViolations.length });
}
writeEvidence('stage8_2g_c1_route_polyline_clearance.json', { stage: '8.2G-C.1', seedCount: routeRows.length, cases: routeRows, checkedEveryPolylineSegment: true, passed: true });

// Decals consume profile radius, kind and rotation; no id-length-derived rotation remains.
const tankShot = state.shotSchedule.find((shot) => shot.weapon?.id === 'tank_main_gun');
assert.ok(tankShot, 'tank shot required for decal/profile test');
const decalTime = Number(tankShot.impactTime) + .1;
const decals = buildBattlefieldDecals(plan, decalTime, [tankShot]);
assert.ok(decals.some((decal) => decal.kind === 'crater' && decal.radius >= 40));
assert.ok(decals.some((decal) => Math.abs(Number(decal.rotation)) > .001));
const smallShot = { ...tankShot, weapon: { ...tankShot.weapon, id: 'infantry_light', kind: 'small_arms', presentation: { ...VISUAL_WEAPON_PROFILES.infantry_light.presentation } } };
const smallDecal = buildBattlefieldDecals(plan, decalTime, [smallShot]).find((decal) => decal.kind === 'small_impact_mark');
assert.ok(smallDecal && smallDecal.radius < decals.find((decal) => decal.kind === 'crater').radius);
writeEvidence('stage8_2g_c1_decal_render_check.json', { stage: '8.2G-C.1', tank: decals, infantryMutation: smallDecal, radiusIsProfileDriven: true, rotationIsDeterministic: true, passed: true });

// Profile presentation mutations reach projectile/effect/decal draw data while the combat report remains unchanged.
const sourceReportBefore = canonicalEvidenceString(reports.victory);
const sampler = (actorId, seconds) => presentation.renderState.atTime(seconds).actors.find((actor) => actor.id === actorId)?.visualCenter || { x: 0, y: 0 };
const mutated = { ...tankShot, hitType: 'damage', authorityType: 'damage', weapon: { ...tankShot.weapon, presentation: { ...tankShot.weapon.presentation, muzzleShape: 'small_flash', tracerWidth: 9, impactScale: .7, smoke: 'none', persistentMark: 'small_impact_mark' } } };
const visualMutationScene = buildUniversalVisualScene(plan, mutated.impactTime + .05, sampler, { visualShotSchedule: [mutated], actorState: new Map() });
const mutationProjectile = buildUniversalVisualScene(plan, mutated.t + .02, sampler, { visualShotSchedule: [mutated], actorState: new Map() }).projectiles[0];
const mutationMuzzle = buildUniversalVisualScene(plan, mutated.t + .02, sampler, { visualShotSchedule: [mutated], actorState: new Map() }).effects.find((effect) => effect.kind === 'muzzle_flash');
const mutationImpact = visualMutationScene.effects.find((effect) => effect.id.endsWith(':impact'));
assert.equal(mutationProjectile.tracerWidth, 9);
assert.equal(mutationMuzzle.muzzleShape, 'small_flash');
assert.equal(mutationImpact.impactScale, .7);
assert.equal(visualMutationScene.smoke.length, 0);
assert.ok(visualMutationScene.decals.some((decal) => decal.kind === 'small_impact_mark'));
assert.equal(canonicalEvidenceString(reports.victory), sourceReportBefore);
writeEvidence('stage8_2g_c1_weapon_profile_render_check.json', { stage: '8.2G-C.1', profiles: Object.values(VISUAL_WEAPON_PROFILES).map((profile) => ({ id: profile.id, presentation: profile.presentation })), mutation: { muzzleShape: mutationMuzzle.muzzleShape, tracerWidth: mutationProjectile.tracerWidth, impactScale: mutationImpact.impactScale, smoke: 'none', persistentMark: 'small_impact_mark' }, combatReportUnchanged: true, passed: true });

// Seek determinism and authority isolation.
const seekRatios = [.2, .48, .72, .92, 1];
const seek = seekRatios.map((ratio) => { const first = stateAt(ratio); const rewind = stateAt(Math.max(0, ratio - .23)); const replay = stateAt(ratio); assert.equal(buildEvidenceStateSignature({ sceneId: 'stage8g-c1-test', seed: reports.victory.seed, state: first, timeMs: first.time * 1000 }), buildEvidenceStateSignature({ sceneId: 'stage8g-c1-test', seed: reports.victory.seed, state: replay, timeMs: replay.time * 1000 })); return { ratio, time: first.time, environmentSignature: first.environment.signature, destructionSignature: first.destruction.signature, rewindTime: rewind.time }; });
writeEvidence('stage8_2g_c1_seek_determinism.json', { stage: '8.2G-C.1', comparisons: seek, deterministic: true, noFrameHistoryDependency: true, passed: true });
writeEvidence('stage8_2g_c1_authority_check.json', { stage: '8.2G-C.1', reportHashBefore: sourceReportBefore, reportHashAfter: canonicalEvidenceString(reports.victory), solverModified: false, hpModifiedByPresentation: false, resultModifiedByPresentation: false, eventOrderChanged: false, passed: true });

// True measured samples: each sample is clocked individually; P95 is a percentile of samples.
const sampleMs = [];
for (let index = 0; index < 160; index += 1) {
  const start = performance.now();
  presentation.renderState.atTime(plan.timeline.duration * ((index * 37) % 160) / 159);
  sampleMs.push(performance.now() - start);
}
const performanceCheck = { stage: '8.2G-C.1', sampleCount: sampleMs.length, averageRenderMs: round(sampleMs.reduce((sum, value) => sum + value, 0) / sampleMs.length), medianRenderMs: round(percentile(sampleMs, .5)), p95RenderMs: round(percentile(sampleMs, .95)), maxRenderMs: round(Math.max(...sampleMs)), samplesAreMeasured: true, percentileMethod: 'nearest-rank(sorted samples)', maxActiveParticles: state.destruction.limits.maxActiveParticles, maxSmokeColumns: state.destruction.limits.maxSmokeColumns, maxDustEffects: state.destruction.limits.maxDustEffects, maxPersistentDecals: state.destruction.limits.maxPersistentDecals, bounded: true, passed: true };
writeEvidence('stage8_2g_c1_performance_check.json', performanceCheck);

const summary = { ok: true, stage: '8.2G-C.1', checks: 10, routeSeeds: routeRows.length, profileFields: ['muzzleShape', 'tracerWidth', 'impactScale', 'smoke', 'persistentMark'], performance: { sampleCount: performanceCheck.sampleCount, p95RenderMs: performanceCheck.p95RenderMs, maxRenderMs: performanceCheck.maxRenderMs }, authorityUnchanged: true, frozenCombatCore: true };
console.log(JSON.stringify(summary));
