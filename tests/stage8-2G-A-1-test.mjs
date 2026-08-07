/** Stage 8.2G-A.1 production visual core hardening. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as cfg from '../js/config.js';
import * as stateApi from '../js/state.js';
import * as economy from '../js/economy.js';
import { simulateBattle } from '../js/battle.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { VISUAL_STATES } from '../js/battle-presentation/universal/visual-state-machine.js';
import { deriveBattlePhases, resolveBattlePhase } from '../js/battle-presentation/universal/universal-battle-phase-resolver.js';
import { buildWorldRenderQueue } from '../js/battle-presentation/universal/universal-battle-renderer.js';

function makePresentation() {
  const state = stateApi.createInitialState();
  const types = ['infantry', 'at_infantry', 'scout_car', 'mbt'];
  state.units = types.map((type, index) => ({ id: `g-a1-${index}`, type, hp: cfg.UNITS[type].stats.hp, maxHp: cfg.UNITS[type].stats.hp, damage: 'intact', status: 'assigned', formationId: 'g-a1', experience: 0, battles: 0 }));
  state.formations = [{ id: 'g-a1', name: 'A.1 混合编队', status: cfg.FORMATION_STATUS.IDLE, unitIds: state.units.map((unit) => unit.id), experience: 0, battles: 0 }];
  economy.recalcDerived(state);
  const report = simulateBattle({ state, formation: state.formations[0], theaterId: 'scrap_mine', strategyId: 'breakthrough', seed: 1 });
  return { report, presentation: createUniversalBattlePresentation({ id: 'stage8-2G-A-1', theaterId: 'scrap_mine', report, elapsed: 0, duration: report.duration, presentationPhase: 'battle' }) };
}

const { report, presentation } = makePresentation();
assert.equal(presentation.ok, true, presentation.reason);
const duration = presentation.plan.timeline.duration;
const samples = Array.from({ length: 65 }, (_, index) => presentation.renderState.atTime(duration * index / 64));
const states = new Set(samples.flatMap((state) => state.actors.map((actor) => actor.visualState)));
assert.ok([...states].every((state) => VISUAL_STATES.includes(state)), [...states]);
assert.ok(states.has('deploy') && states.has('turn') && states.has('brake'), [...states]);
assert.ok(![...states].some((state) => ['ambush', 'damage', 'destroy', 'phase', 'reveal', 'secure_objective', 'suppress'].includes(state)));

const shotsAtZero = presentation.renderState.atTime(0).shotSchedule;
assert.ok(shotsAtZero.length > 0);
const shot = shotsAtZero[0];
const laterSchedule = presentation.renderState.atTime(Math.min(duration, shot.impactTime + 2)).shotSchedule;
const sameShot = laterSchedule.find((entry) => entry.id === shot.id);
assert.deepEqual(sameShot.sourcePositionAtFire, shot.sourcePositionAtFire);
assert.deepEqual(sameShot.targetPositionAtAim, shot.targetPositionAtAim);
assert.deepEqual(sameShot.impactPositionAtImpact, shot.impactPositionAtImpact);
const projectile = presentation.renderState.atTime(Math.min(duration, shot.t + Math.max(.01, (shot.impactTime - shot.t) * .5))).projectiles.find((entry) => entry.shotId === shot.id);
if (projectile) { assert.deepEqual(projectile.start, shot.sourcePositionAtFire); assert.deepEqual(projectile.end, shot.impactPositionAtImpact); }

const phases = deriveBattlePhases(presentation.plan);
assert.deepEqual(phases.map((phase) => phase.id), ['deploy', 'approach', 'first_contact', 'main_engagement', 'critical_event', 'battle_end']);
const shifted = structuredClone(presentation.plan);
shifted.timeline.anchors = shifted.timeline.anchors.map((anchor) => ({ ...anchor, t: Math.min(duration, Number(anchor.t) + (anchor.type === 'fire' ? 5 : 0)) }));
assert.notDeepEqual(deriveBattlePhases(presentation.plan).map((phase) => phase.start), deriveBattlePhases(shifted).map((phase) => phase.start));
assert.equal(resolveBattlePhase(presentation.plan, phases.find((phase) => phase.id === 'first_contact').start + .01).id, 'first_contact');

const state = presentation.renderState.atTime(duration * .5);
const queueA = buildWorldRenderQueue(presentation.plan, state).map((item) => `${item.kind}:${item.stableId}:${item.depth}`);
const queueB = buildWorldRenderQueue(presentation.plan, state).map((item) => `${item.kind}:${item.stableId}:${item.depth}`);
assert.deepEqual(queueA, queueB);
for (let left = 0; left < state.actors.length; left += 1) for (let right = left + 1; right < state.actors.length; right += 1) {
  const a = state.actors[left]; const b = state.actors[right]; const distance = Math.hypot(a.visualCenter.x - b.visualCenter.x, a.visualCenter.y - b.visualCenter.y);
  assert.ok(distance >= (a.footprint.radius + b.footprint.radius) * .55, `${a.id}/${b.id} overlap ${distance}`);
}

const rendererSource = fs.readFileSync(new URL('../js/battle-presentation/universal/universal-battle-renderer.js', import.meta.url), 'utf8');
assert.doesNotMatch(rendererSource, /function draw(?:Routes|Zones)|draw(?:Routes|Zones)\(/);
assert.match(rendererSource, /buildWorldRenderQueue/);
assert.match(rendererSource, /cover === 'heavy'/);
assert.match(fs.readFileSync(new URL('../js/battle-presentation/universal/universal-debug-overlay.js', import.meta.url), 'utf8'), /showRoutes|showZones|showActorIds/);
assert.equal(JSON.stringify(report).includes('stage8-2G-A-1'), false);
console.log('stage8-2G-A-1-test: closed FSM, semantic phases, fixed shot anchors, stable depth queue, and footprint separation passed');
