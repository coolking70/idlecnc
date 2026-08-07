/** Stage 8.2G-B: deterministic engagement choreographer and two result slices. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cfg from '../js/config.js';
import { buildUniversalPlanSafely } from '../js/battle-presentation/universal/universal-plan-builder.js';
import { compileUniversalPlan } from '../js/battle-presentation/universal/universal-plan-compiler.js';
import { sampleSpatialEntityPosition } from '../js/battle-presentation/universal/universal-position-sampler.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildUniversalEngagementSchedule, ENGAGEMENT_LIMITS, scheduleAuthorityFingerprint } from '../js/battle-presentation/universal/universal-engagement-choreographer.js';
import { buildCameraDirector, cameraInterestAtTime } from '../js/battle-presentation/universal/universal-camera-director.js';
import { deriveBattlePhases } from '../js/battle-presentation/universal/universal-battle-phase-resolver.js';
import { separateVisualFootprints, visualFootprint } from '../js/battle-presentation/universal/visual-footprints.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures');
const load = (name) => JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8')).report;
const active = (report, id) => ({ id, theaterId: report.theaterId, report, elapsed: 0, duration: report.duration, presentationPhase: 'battle' });
const victoryReport = load('campaign-victory.json');
const withdrawReport = load('campaign-withdraw.json');
const wipedReport = load('campaign-defeat-or-wiped.json');

function build(report, id) {
  const before = JSON.stringify(report);
  const presentation = createUniversalBattlePresentation(active(report, id));
  assert.equal(presentation.ok, true, presentation.reason);
  assert.equal(JSON.stringify(report), before, 'presentation must not mutate authoritative report');
  return presentation;
}

function scheduleFor(report) {
  const plan = buildUniversalPlanSafely(report); assert.equal(plan.ok, true);
  const compiled = compileUniversalPlan(plan);
  return { plan, schedule: buildUniversalEngagementSchedule(plan, (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time)) };
}

const victory = scheduleFor(victoryReport); const withdraw = scheduleFor(withdrawReport); const wiped = scheduleFor(wipedReport);

assert.ok(['Stage 8.2G-B.1 · Engagement Choreographer Correctness & Evidence Hardening', 'Stage 8.2G-B.1.1 · Phase-Continuous Fire & Browser Evidence Closure', 'Stage 8.2G-B.1.1a · Evidence Integrity & Final Package Record Hotfix', 'Stage 8.2G-C · Battlefield Environment & Persistent Destruction', 'Stage 8.2G-C.1 · Production Visual Consumption & Evidence Hardening'].includes(cfg.CURRENT_STAGE_LABEL));
assert.doesNotMatch(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /当前版本：[^\n]*Stage 8\.2G-A/);
assert.doesNotMatch(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /Stage 8\.2G-A/);

for (const { plan, schedule } of [victory, withdraw, wiped]) {
  assert.equal(schedule.deterministic, true);
  assert.ok(schedule.engagements.length > 0);
  assert.ok(schedule.shots.length > 0 && schedule.shots.length <= ENGAGEMENT_LIMITS.maxScheduledShots);
  assert.ok(schedule.cameraInterests.length >= 4);
  for (const engagement of schedule.engagements) { assert.ok(engagement.start >= 0 && engagement.end <= plan.timeline.duration && engagement.end >= engagement.start); assert.ok(engagement.attackerIds.every((id) => plan.forces.friendly.concat(plan.forces.enemy).some((actor) => actor.actorId === id))); }
  const actorMap = new Map([...plan.forces.friendly, ...plan.forces.enemy].map((actor) => [actor.actorId, actor]));
  for (const assignment of schedule.targetAssignments) { assert.ok(actorMap.has(assignment.actorId)); assert.ok(actorMap.has(assignment.targetId)); assert.notEqual(actorMap.get(assignment.actorId).side, actorMap.get(assignment.targetId).side); }
  for (const shot of schedule.shots) { assert.equal(shot.presentationOnly, true); assert.equal(shot.authorityAnchorId, null); assert.ok(shot.sourcePositionAtFire && shot.targetPositionAtAim && shot.impactPositionAtImpact); }
  assert.equal(typeof scheduleAuthorityFingerprint(schedule), 'string');
}

assert.equal(scheduleAuthorityFingerprint(victory.schedule), scheduleAuthorityFingerprint(scheduleFor(victoryReport).schedule), 'same seed must rebuild exactly');
assert.ok(victory.schedule.targetSwitches.length > 0, 'victory must expose target switching');
assert.ok(victory.schedule.suppressionBursts.length > 0, 'victory must expose suppression');
assert.ok(victory.schedule.coverMoves.some((move) => move.purpose === 'cover_advance'), 'victory must expose cover advance');
assert.ok(withdraw.schedule.retreatOrders.length > 0, 'withdraw must expose retreat orders');
assert.ok(withdraw.schedule.coverMoves.some((move) => move.purpose === 'cover_retreat'), 'withdraw must expose covering retreat');
assert.equal(wiped.schedule.retreatOrders.length, 0, 'wiped case cannot fabricate successful retreat');

const victoryPresentation = build(victoryReport, 'stage8-2G-B-victory');
const state0 = victoryPresentation.renderState.atTime(0);
const anchorShot = state0.shotSchedule.find((shot) => shot.authorityAnchorId);
assert.ok(anchorShot, 'authority projectile anchor must be present');
for (const field of ['id', 'sourcePositionAtFire', 'targetPositionAtAim', 'impactPositionAtImpact', 't', 'impactTime']) assert.ok(anchorShot[field] !== null && anchorShot[field] !== undefined, `anchor field ${field} must be non-empty`);
for (const time of [anchorShot.t, (anchorShot.t + anchorShot.impactTime) / 2, anchorShot.impactTime]) {
  const same = victoryPresentation.renderState.atTime(time).shotSchedule.find((shot) => shot.id === anchorShot.id);
  assert.deepEqual(same.sourcePositionAtFire, anchorShot.sourcePositionAtFire);
  assert.deepEqual(same.targetPositionAtAim, anchorShot.targetPositionAtAim);
  assert.deepEqual(same.impactPositionAtImpact, anchorShot.impactPositionAtImpact);
}
const sourceState = victoryPresentation.renderState.atTime(anchorShot.t); const sourceActor = sourceState.actors.find((actor) => actor.id === anchorShot.actorId); assert.ok(sourceActor);
assert.ok(Math.hypot(sourceActor.preSeparationPosition.x - anchorShot.sourcePositionAtFire.x, sourceActor.preSeparationPosition.y - anchorShot.sourcePositionAtFire.y) < .01);
const synthetic = separateVisualFootprints([{ actorId: 'a', actor: { type: 'infantry' }, type: 'infantry', visualCenter: { x: 100, y: 100 }, nextPosition: { x: 100, y: 100 }, previousPosition: { x: 100, y: 100 }, footprint: visualFootprint({ type: 'infantry' }) }, { actorId: 'b', type: 'infantry', visualCenter: { x: 100, y: 100 }, nextPosition: { x: 100, y: 100 }, previousPosition: { x: 100, y: 100 }, footprint: visualFootprint({ type: 'infantry' }) }], { width: 400, height: 300 });
assert.ok(synthetic.some((actor) => Math.hypot(actor.visualCenter.x - actor.preSeparationPosition?.x, actor.visualCenter.y - actor.preSeparationPosition?.y) > 0) || Math.hypot(synthetic[0].visualCenter.x - 100, synthetic[0].visualCenter.y - 100) > 0, 'separation must produce measurable visual offset');

const phases = deriveBattlePhases(victory.plan);
const jitterFrames = phases.flatMap((phase) => [-.2, -.1, 0, .1, .2].map((delta) => Math.max(0, Math.min(victory.plan.timeline.duration, phase.start + delta))));
const samples = jitterFrames.map((time) => victoryPresentation.renderState.atTime(time));
for (let index = 0; index < samples.length; index += 1) {
  const repeated = victoryPresentation.renderState.atTime(jitterFrames[index]);
  assert.deepEqual(samples[index].actors.map((actor) => [actor.id, actor.visualPosition, actor.visualOffset, actor.visualState]), repeated.actors.map((actor) => [actor.id, actor.visualPosition, actor.visualOffset, actor.visualState]));
  const maxOffset = Math.max(0, ...samples[index].actors.map((actor) => Math.hypot(actor.visualOffset?.x || 0, actor.visualOffset?.y || 0)));
  assert.ok(Number.isFinite(maxOffset));
}
for (let index = 1; index < samples.length; index += 1) { if (jitterFrames[index] - jitterFrames[index - 1] > .21) continue; for (const actor of samples[index].actors) {
  const previous = samples[index - 1].actors.find((item) => item.id === actor.id); if (!previous) continue;
  const jump = Math.hypot(actor.visualPosition.x - previous.visualPosition.x, actor.visualPosition.y - previous.visualPosition.y); assert.ok(jump < 220, `${actor.id} visual jitter jump ${jump}`);
  const a = previous.visualOffset || { x: 0, y: 0 }; const b = actor.visualOffset || { x: 0, y: 0 }; if (Math.hypot(a.x, a.y) > 1 && Math.hypot(b.x, b.y) > 1) assert.ok(a.x * b.x + a.y * b.y > -400, `${actor.id} separation direction flipped without stable basis`);
} }

const director = buildCameraDirector(victory.schedule); assert.ok(cameraInterestAtTime(director, phases.find((phase) => phase.id === 'first_contact').start)); assert.ok(cameraInterestAtTime(director, phases.find((phase) => phase.id === 'main_engagement').start));
const authorityBefore = JSON.stringify(victoryReport); const wipedPresentation = build(wipedReport, 'stage8-2G-B-wiped'); const finalWiped = wipedPresentation.renderState.atTime(wipedPresentation.plan.timeline.duration); assert.equal(finalWiped.actors.filter((actor) => actor.side === 'friendly' && actor.alive).length, 0); assert.equal(finalWiped.engagementSchedule.retreatOrders.length, 0); assert.equal(JSON.stringify(wipedReport), JSON.stringify(wipedReport)); assert.match(finalWiped.camera.label, /结局|关键|全局|撤退/); assert.equal(JSON.stringify(victoryReport), authorityBefore);

console.log(`stage8-2G-B-test: 1 passed / 1 total; victory shots=${victory.schedule.shots.length}; targetSwitches=${victory.schedule.targetSwitches.length}; withdraw retreatOrders=${withdraw.schedule.retreatOrders.length}; wiped friendlyAlive=${finalWiped.actors.filter((actor) => actor.side === 'friendly' && actor.alive).length}`);
