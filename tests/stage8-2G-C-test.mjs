/** Stage 8.2G-C battlefield environment, destruction and asset pipeline tests. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as cfg from '../js/config.js';
import * as stateApi from '../js/state.js';
import * as economy from '../js/economy.js';
import { simulateBattle } from '../js/battle.js';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildEnvironmentScene } from '../js/battle-presentation/environment/environment-scene-builder.js';
import { resolveAsset, resolveUnitAsset } from '../js/battle-presentation/environment/asset-provider.js';
import { unitVisualSpec } from '../js/battle-presentation/environment/sprite-ready-unit-renderer.js';
import { VISUAL_WEAPON_PROFILES } from '../js/battle-presentation/universal/visual-weapon-profiles.js';

function makePresentation(seed = 1) {
  const state = stateApi.createInitialState(); const types = ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'];
  state.units = types.map((type, index) => ({ id: `g-c-${seed}-${index}`, type, hp: cfg.UNITS[type].stats.hp, maxHp: cfg.UNITS[type].stats.hp, damage: 'intact', status: 'assigned', formationId: `g-c-${seed}`, experience: 0, battles: 0 }));
  state.formations = [{ id: `g-c-${seed}`, name: 'C 混合编队', status: cfg.FORMATION_STATUS.IDLE, unitIds: state.units.map((unit) => unit.id), experience: 0, battles: 0 }]; economy.recalcDerived(state);
  const report = simulateBattle({ state, formation: state.formations[0], theaterId: 'scrap_mine', strategyId: 'breakthrough', seed });
  return { report, presentation: createUniversalBattlePresentation({ id: `stage8-2G-C-${seed}`, theaterId: 'scrap_mine', report, elapsed: 0, duration: report.duration, presentationPhase: 'battle' }) };
}

const { report, presentation } = makePresentation(); assert.equal(presentation.ok, true, presentation.reason); const plan = presentation.plan; const duration = plan.timeline.duration;
const checks = [];
function check(name, fn) { fn(); checks.push(name); console.log(`  PASS ${name}`); }

check('environment is deterministic and presentation-only', () => {
  const first = buildEnvironmentScene(plan); const second = buildEnvironmentScene(plan); assert.deepEqual(first, second); assert.ok(first.objects.length >= 8); assert.ok(first.objects.some((item) => item.category === 'industrial_prop')); assert.equal(first.metrics.routeBlockingObjects, 0); assert.ok(first.objects.every((item) => item.routeBlocking === false && item.authority === false));
  const spatialIds = new Set((plan.spatialEntities || []).map((item) => item.id)); assert.ok(first.objects.every((item) => !spatialIds.has(item.id)));
  const routePoints = (plan.layout.routes || []).flatMap((route) => route.points || []); for (const object of first.objects) for (const point of routePoints) assert.ok(Math.hypot(object.position.x - point.x, object.position.y - point.y) > (object.clearanceRadius || 20) + 20, `${object.id} intersects route point`);
});

check('terrain grammar exposes mine identity and semantic zones', () => {
  const env = presentation.renderState.atTime(0).environment; assert.equal(env.terrainId, 'open'); assert.ok(env.zones.some((zone) => zone.kind === 'objective')); assert.ok(env.objects.some((item) => ['headframe', 'conveyor', 'ore_silo', 'machine_module'].includes(item.variant))); assert.ok(env.layers.base && env.layers.largeVariation > 0 && env.layers.tracks > 0);
});

const schedule = presentation.renderState.atTime(0).shotSchedule; const heavyShot = schedule.find((shot) => ['tank_cannon', 'anti_armor'].includes(shot.weaponFamily) || shot.weapon?.kind === 'cannon'); const destroy = schedule.find((shot) => shot.hitType === 'destroy'); assert.ok(heavyShot, 'heavy visual shot missing'); assert.ok(destroy, 'destroy visual shot missing');

check('persistent destruction supports impact, seek and rewind', () => {
  const impact = Number(heavyShot.impactTime); const before = presentation.renderState.atTime(Math.max(0, impact - .05)); const after = presentation.renderState.atTime(Math.min(duration, impact + .2)); const direct = presentation.renderState.atTime(Math.min(duration, impact + .2)); assert.ok(before.decals.filter((item) => item.createdAt <= impact).length < after.decals.length || impact <= .05); assert.ok(after.decals.some((item) => ['crater', 'scorch'].includes(item.kind))); assert.equal(after.destruction.signature, direct.destruction.signature); assert.equal(after.environment.signature, direct.environment.signature); const rewind = presentation.renderState.atTime(Math.max(0, impact - .05)); assert.deepEqual(rewind.decals, before.decals);
});

check('heavy and light impacts use different decal scale', () => {
  const light = schedule.find((shot) => shot.weaponFamily === 'infantry_light'); if (light) { const lightState = presentation.renderState.atTime(Math.min(duration, light.impactTime + .1)); assert.ok(lightState.decals.filter((item) => item.source === light.actorId).every((item) => item.kind !== 'crater')); }
  assert.ok(presentation.renderState.atTime(Math.min(duration, heavyShot.impactTime + .1)).decals.some((item) => item.kind === 'crater'));
});

check('wreck lifecycle preserves authoritative position and facing', () => {
  const t = Number(destroy.impactTime); const destroying = presentation.renderState.atTime(Math.min(duration, t + .2)); const wreck = presentation.renderState.atTime(Math.min(duration, t + 1.1)); assert.equal(destroying.actors.find((actor) => actor.id === destroy.targetId)?.visible, true); assert.ok(!destroying.wrecks.some((item) => item.sourceActorId === destroy.targetId)); assert.equal(wreck.actors.find((actor) => actor.id === destroy.targetId)?.visible, false); const row = wreck.wrecks.find((item) => item.sourceActorId === destroy.targetId); assert.ok(row); assert.ok(['infantry_casualty_marker', 'light_vehicle_wreck', 'tank_wreck', 'structure_wreck'].includes(row.wreckType));
});

check('smoke and dust are bounded and deterministic', () => {
  const state = presentation.renderState.atTime(Math.min(duration, Number(destroy.impactTime) + 2)); assert.ok(state.smoke.length > 0); assert.ok(state.smoke.length <= state.destruction.limits.maxSmokeColumns); assert.ok(state.debris.length <= state.destruction.limits.maxDebrisObjects); assert.ok(state.effects.length <= state.destruction.limits.maxActiveParticles + 32); assert.deepEqual(state.smoke, presentation.renderState.atTime(Math.min(duration, Number(destroy.impactTime) + 2)).smoke);
});

check('weapon profiles are visually distinct', () => {
  const families = ['infantry_light', 'scout_machine_gun', 'anti_armor_rocket', 'tank_main_gun']; assert.equal(new Set(families.map((id) => VISUAL_WEAPON_PROFILES[id].presentation.muzzleShape)).size, 4); assert.ok(VISUAL_WEAPON_PROFILES.tank_main_gun.presentation.impactScale > VISUAL_WEAPON_PROFILES.infantry_light.presentation.impactScale); assert.equal(VISUAL_WEAPON_PROFILES.repair_tool.presentation.smoke, 'none');
});

check('asset manifest and procedural fallback are valid', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../assets/battle/asset-manifest.json', import.meta.url), 'utf8')); assert.equal(manifest.runtimeGeneration, false); assert.equal(manifest.assets.length, 5); const missing = resolveAsset(manifest, 'unit_friendly_mbt', new Set()); assert.equal(missing.mode, 'procedural'); assert.equal(missing.fallback, true); const resolved = resolveAsset(manifest, 'unit_friendly_mbt', new Set([manifest.assets.find((asset) => asset.id === 'unit_friendly_mbt').source])); assert.equal(resolved.mode, 'sprite'); assert.equal(resolveUnitAsset({ type: 'mbt' }, manifest, new Set()).fallback, true); assert.equal(unitVisualSpec({ type: 'mbt' }, { manifest }).minimumScreenFootprint, 46);
});

check('production and debug remain separated', () => {
  const renderer = fs.readFileSync(new URL('../js/battle-presentation/universal/universal-battle-renderer.js', import.meta.url), 'utf8'); assert.doesNotMatch(renderer, /drawRoutes\(context, plan\);/); assert.doesNotMatch(renderer, /drawZones\(context, plan\);/); assert.match(fs.readFileSync(new URL('../js/battle-presentation/universal/universal-debug-overlay.js', import.meta.url), 'utf8'), /showRoutes|showZones|showActorIds/);
});

check('authority report is unchanged by presentation sampling', () => {
  const before = stableStringify(report); for (let index = 0; index < 10; index += 1) presentation.renderState.atTime(duration * index / 9); assert.equal(stableStringify(report), before); assert.deepEqual(presentation.plan.authority.finalState, presentation.plan.outcome.finalState);
});

check('environment seek performance is bounded', () => {
  const start = performance.now(); for (let index = 0; index < 120; index += 1) presentation.renderState.atTime(duration * ((index * 37) % 120) / 119); const elapsed = performance.now() - start; assert.ok(elapsed < 1600, `render samples took ${elapsed.toFixed(1)}ms`); console.log(`  INFO averageRenderMs=${(elapsed / 120).toFixed(3)}`);
});

console.log(`stage8-2G-C-test: ${checks.length} passed / ${checks.length} total; environment=${buildEnvironmentScene(plan).objects.length}; decals=${presentation.renderState.atTime(duration).decals.length}; wrecks=${presentation.renderState.atTime(duration).wrecks.length}`);
