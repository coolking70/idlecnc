/** Stage 8.2G-A: production visual core and mining victory vertical slice. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import * as cfg from '../js/config.js';
import * as stateApi from '../js/state.js';
import * as economy from '../js/economy.js';
import { simulateBattle } from '../js/battle.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { normalizeDebugOverlayOptions, drawUniversalDebugOverlay } from '../js/battle-presentation/universal/universal-debug-overlay.js';
import { UniversalBattleRenderer } from '../js/battle-presentation/universal/universal-battle-renderer.js';
import { visualWeaponProfile } from '../js/battle-presentation/universal/visual-weapon-profiles.js';

function makeMiningVictory() {
  const state = stateApi.createInitialState();
  const types = ['infantry', 'mbt'];
  state.units = types.map((type, index) => ({ id: `slice-u-${index + 1}`, type, hp: cfg.UNITS[type].stats.hp, maxHp: cfg.UNITS[type].stats.hp, damage: 'intact', status: 'assigned', formationId: 'slice', experience: 0, battles: 0 }));
  state.formations = [{ id: 'slice', name: '矿区混合编队', status: cfg.FORMATION_STATUS.IDLE, unitIds: state.units.map((unit) => unit.id), experience: 0, battles: 0 }];
  economy.recalcDerived(state);
  return simulateBattle({ state, formation: state.formations[0], theaterId: 'scrap_mine', strategyId: 'breakthrough', seed: 1 });
}

function active(report) { return { id: `stage8-2G-A-${report.id}`, theaterId: report.theaterId, report, elapsed: 0, duration: report.duration, presentationPhase: 'battle', returnElapsed: 0, returnDuration: 5 }; }
function check(name, fn) { fn(); console.log(`  PASS ${name}`); }

const report = makeMiningVictory();
const before = stableStringify(report);
const presentation = createUniversalBattlePresentation(active(report));
assert.equal(presentation.ok, true, presentation.reason || 'presentation invalid');
assert.equal(report.result, 'victory');
assert.equal(report.theaterId, 'scrap_mine');

check('production and debug options are independent', () => {
  const production = normalizeDebugOverlayOptions({ debugOverlay: false, showRoutes: true, showZones: true, showActorIds: true });
  const debug = normalizeDebugOverlayOptions({ debugOverlay: true });
  assert.equal(production.debugOverlay, false); assert.equal(production.showRoutes, false); assert.equal(production.showZones, false); assert.equal(production.showActorIds, false);
  assert.equal(debug.debugOverlay, true); assert.equal(debug.showRoutes, true); assert.equal(debug.showZones, true); assert.equal(debug.showActorIds, true);
  const rendererSource = fs.readFileSync(new URL('../js/battle-presentation/universal/universal-battle-renderer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(rendererSource, /drawRoutes\(context, plan\);/); assert.doesNotMatch(rendererSource, /drawZones\(context, plan\);/);
  assert.match(fs.readFileSync(new URL('../js/battle-presentation/universal/universal-debug-overlay.js', import.meta.url), 'utf8'), /drawUniversalDebugOverlay/);
});

check('debug overlay draws from the same state without mutating it', () => {
  const state = presentation.renderState.atTime(presentation.plan.timeline.duration * .48);
  const beforeState = stableStringify(state);
  const context = new Proxy({}, { get: (_target, property) => typeof property === 'symbol' ? undefined : (() => {}), set: () => true });
  assert.equal(drawUniversalDebugOverlay(context, presentation.plan, state, { debugOverlay: false }), false);
  assert.equal(drawUniversalDebugOverlay(context, presentation.plan, state, { debugOverlay: true }), true);
  assert.equal(stableStringify(state), beforeState);
});

check('mining victory exposes six visual stages', () => {
  const duration = presentation.plan.timeline.duration;
  const stages = [.08, .25, .45, .80, .90, 1].map((ratio) => presentation.renderState.atTime(duration * ratio).visualStage);
  assert.equal(stages[0], 'deploy'); assert.equal(stages[1], 'approach'); assert.ok(stages.includes('first_contact')); assert.ok(stages.includes('main_engagement')); assert.equal(stages.at(-1), 'battle_end');
});

check('mixed actors use distinct small arms and cannon profiles', () => {
  const infantry = presentation.renderState.atTime(0).actors.find((actor) => actor.type === 'infantry');
  const tank = presentation.renderState.atTime(0).actors.find((actor) => actor.type === 'mbt');
  assert.equal(visualWeaponProfile(infantry).kind, 'small_arms'); assert.equal(visualWeaponProfile(tank).kind, 'cannon');
  assert.ok(presentation.renderState.atTime(0).shotSchedule.some((shot) => shot.weaponKind === 'small_arms'));
  assert.ok(presentation.renderState.atTime(0).shotSchedule.some((shot) => shot.weaponKind === 'cannon'));
});

check('authority fire, hit and destruction produce a continuous visual chain', () => {
  const anchors = presentation.plan.timeline.anchors;
  const destroy = anchors.find((anchor) => anchor.type === 'destroy'); assert.ok(destroy);
  const fire = anchors.find((anchor) => anchor.type === 'fire' && anchor.targetId === destroy.targetId && anchor.t <= destroy.t); assert.ok(fire);
  const damage = anchors.find((anchor) => anchor.type === 'damage' && anchor.targetId === fire.targetId && anchor.t >= fire.t); assert.ok(damage);
  const aim = presentation.renderState.atTime(Math.max(0, fire.t - .10)); const firing = presentation.renderState.atTime(fire.t + .03); const hit = presentation.renderState.atTime(damage.t + .10); const destroying = presentation.renderState.atTime(destroy.t + .20); const wreck = presentation.renderState.atTime(destroy.t + 1.0);
  assert.equal(aim.actors.find((actor) => actor.id === fire.actorId).visualState, 'aim');
  assert.equal(firing.actors.find((actor) => actor.id === fire.actorId).visualState, 'fire'); assert.ok(firing.projectiles.length || firing.effects.some((effect) => effect.kind === 'muzzle_flash'));
  assert.equal(hit.actors.find((actor) => actor.id === damage.targetId).visualState, 'hit'); assert.ok(hit.effects.some((effect) => effect.source === 'authority_anchor'));
  assert.equal(destroying.actors.find((actor) => actor.id === destroy.targetId).visualState, 'destroying'); assert.equal(destroying.wrecks.length, 0);
  assert.equal(wreck.actors.find((actor) => actor.id === destroy.targetId).visible, false); assert.ok(wreck.wrecks.some((row) => row.sourceActorId === destroy.targetId)); assert.ok(wreck.smoke.length > 0);
});

check('visual state is deterministic for arbitrary time jumps', () => {
  const duration = presentation.plan.timeline.duration; const times = [0, 1.25, 4.5, 12.2, 18.75, duration - .4, duration];
  for (const time of times) assert.equal(stableStringify(presentation.renderState.atTime(time)), stableStringify(presentation.renderState.atTime(time)));
  assert.equal(stableStringify(report), before, 'visual presentation must not mutate authority report');
});

check('renderer exposes debug overlay state without changing scene time', () => {
  const renderer = new UniversalBattleRenderer(null); renderer.setPresentation(presentation); renderer.render(active(report)); const beforeTime = renderer.lastState.time;
  assert.equal(renderer.setDebugOverlay(true), true); assert.equal(renderer.getDebugOverlayState().debugOverlay, true); assert.equal(renderer.lastState.time, beforeTime);
  assert.equal(renderer.setDebugOverlay(false), false); renderer.destroy();
});

console.log('stage8-2G-A-test: 7 passed / 7 total');
