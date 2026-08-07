/** Stage 8.2G-B.1: choreographer correctness and evidence hardening. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUniversalPlanSafely } from '../js/battle-presentation/universal/universal-plan-builder.js';
import { compileUniversalPlan } from '../js/battle-presentation/universal/universal-plan-compiler.js';
import { sampleSpatialEntityPosition } from '../js/battle-presentation/universal/universal-position-sampler.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildUniversalEngagementSchedule, evaluateTargetLegality, ENGAGEMENT_LIMITS } from '../js/battle-presentation/universal/universal-engagement-choreographer.js';
import { combatProfileFor } from '../js/battle-presentation/universal/visual-weapon-profiles.js';
import { resolveEvidenceFrameSpecs } from '../js/battle-presentation/universal/evidence-frame-resolver.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures');
const load = (file) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, file), 'utf8')).report;
const active = (report, id) => ({ id, theaterId: report.theaterId, report, elapsed: 0, duration: report.duration, presentationPhase: 'battle' });
const reports = { victory: load('campaign-victory.json'), withdraw: load('campaign-withdraw.json'), wiped: load('campaign-defeat-or-wiped.json') };

function build(report, id) {
  const presentation = createUniversalBattlePresentation(active(report, id)); assert.equal(presentation.ok, true, presentation.reason);
  const plan = presentation.plan; const compiled = compileUniversalPlan(plan); const schedule = buildUniversalEngagementSchedule(plan, (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time));
  return { presentation, plan, schedule, sampler: (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time) };
}

const victory = build(reports.victory, 'b1-victory'); const withdraw = build(reports.withdraw, 'b1-withdraw'); const wiped = build(reports.wiped, 'b1-wiped');
const actorMap = (plan) => new Map([...plan.forces.friendly, ...plan.forces.enemy].map((actor) => [actor.actorId, actor]));

// 1. Schedule starts at contact, never spends the global cap in approach.
for (const row of [victory, withdraw, wiped]) {
  assert.ok(row.schedule.shots.length > 0 && row.schedule.shots.length <= ENGAGEMENT_LIMITS.maxScheduledShots);
  assert.equal(row.schedule.shots.filter((shot) => shot.phase === 'approach').length, 0);
  assert.ok(row.schedule.phaseBudgets.main_engagement.scheduledShots > 0 || row.schedule.phaseBudgets.first_contact.scheduledShots > 0 || row.schedule.phaseBudgets.critical_event.scheduledShots > 0);
}

// 2. Stage/side/actor/weapon distribution is observable and bounded.
assert.ok(victory.schedule.shots.some((shot) => shot.side === 'friendly'));
assert.ok(victory.schedule.shots.some((shot) => shot.side === 'enemy'));
assert.ok(new Set(victory.schedule.shots.map((shot) => shot.weaponFamily)).size >= 2);
for (const shot of victory.schedule.shots) assert.ok((victory.schedule.shots.filter((other) => other.actorId === shot.actorId && other.phase === shot.phase).length) <= ENGAGEMENT_LIMITS.maxShotsPerActorPerPhase);

// 3. Explicit actor/weapon mapping excludes repair/support from attack.
const repair = victory.plan.forces.friendly.find((actor) => actor.type === 'repair_vehicle'); assert.equal(combatProfileFor(repair).canAttack, false);
assert.ok(victory.schedule.shots.every((shot) => shot.actorId !== repair.actorId));
assert.ok(victory.schedule.shots.some((shot) => shot.weaponId === 'anti_armor_rocket'));
assert.ok(victory.schedule.shots.some((shot) => shot.weaponId === 'tank_main_gun'));

// 4. Every choreographed shot has hard range/LOS legality and a real facing vector.
for (const row of [victory, withdraw, wiped]) {
  for (const shot of row.schedule.shots) {
    assert.equal(shot.legality?.ok, true, `${shot.id} legality ${shot.legality?.reason}`);
    const dx = shot.impactPositionAtImpact.x - shot.sourcePositionAtFire.x; const dy = shot.impactPositionAtImpact.y - shot.sourcePositionAtFire.y;
    assert.ok(Math.abs(Math.atan2(dy, dx) - shot.sourceFacingAtFire) < 1e-9 || Math.hypot(dx, dy) < .001);
  }
}
const hardPlan = structuredClone(victory.plan); hardPlan.scene.props = [{ id: 'hard-wall', solid: true, position: { x: 700, y: 391 }, footprint: { width: 30, height: 300 } }];
const a = hardPlan.forces.friendly.find((actor) => actor.type === 'infantry'); const e = hardPlan.forces.enemy[0]; const losResult = evaluateTargetLegality(hardPlan, a, e, 15, victory.sampler); assert.notEqual(losResult.reason, 'legal');

// 5. Suppression is applied to target actors and preserves source/target roles.
for (const burst of victory.schedule.suppressionBursts) { assert.ok(burst.sourceIds.length && burst.targetIds.length); assert.ok(!burst.sourceIds.some((id) => burst.targetIds.includes(id))); }
const activeSuppression = victory.schedule.suppressionBursts.find((row) => row.targetIds.length); assert.ok(activeSuppression);
const suppressionState = victory.presentation.renderState.atTime((activeSuppression.start + activeSuppression.end) / 2);
assert.ok(activeSuppression.targetIds.some((id) => suppressionState.actors.find((actor) => actor.id === id)?.suppression));
assert.ok(activeSuppression.sourceIds.every((id) => suppressionState.actors.find((actor) => actor.id === id)?.visualState !== 'suppressed'));

// 6. Cover advance has two real stations and a maneuver displacement.
const cover = victory.schedule.coverMoves.find((row) => row.purpose === 'cover_advance'); assert.ok(cover && cover.maneuverTargetPositions);
const coverBefore = victory.presentation.renderState.atTime(cover.start).actors; const coverAfter = victory.presentation.renderState.atTime(cover.end).actors;
for (const id of cover.maneuverGroupIds) { const before = coverBefore.find((actor) => actor.id === id); const after = coverAfter.find((actor) => actor.id === id); assert.ok(Math.hypot(after.visualPosition.x - before.visualPosition.x, after.visualPosition.y - before.visualPosition.y) > 20); }
for (const id of cover.fireGroupIds) { const before = coverBefore.find((actor) => actor.id === id); const after = coverAfter.find((actor) => actor.id === id); assert.ok(Math.hypot(after.visualPosition.x - before.visualPosition.x, after.visualPosition.y - before.visualPosition.y) < 40); }

// 7. Retreat routes are actual routes; rear guard starts after the main group and faces the enemy.
assert.ok(withdraw.schedule.retreatOrders.length >= 2); const first = withdraw.schedule.retreatOrders[0]; const rear = withdraw.schedule.retreatOrders.find((row) => row.role === 'rear_guard'); assert.ok(rear && rear.start > first.start);
assert.ok(rear.presentationRoute.length >= 3 && rear.distanceToExitAtStart > rear.distanceToExitAtEnd); const rearFrame = withdraw.presentation.renderState.atTime(rear.start + .01).actors.find((actor) => actor.id === rear.actorId); assert.ok(Math.abs(rearFrame.facing - rear.presentationFacing.rearGuardEnemyFacing) < 1e-9);
assert.equal(wiped.schedule.retreatOrders.length, 0);

// 8. Target hold/cooldown reasons are explicit and no legacy phase-change churn remains.
assert.ok(victory.schedule.targetSwitches.length > 0); assert.ok(victory.schedule.targetSwitches.every((row) => row.reason !== 'phase_change' && Number.isFinite(row.cooldown)));
for (const row of victory.schedule.targetSwitches) assert.ok(row.minimumHoldDuration >= 1);

// 9. Authority is byte-stable through presentation.
const before = JSON.stringify(reports.victory); victory.presentation.renderState.atTime(0); victory.presentation.renderState.atTime(victory.plan.timeline.duration / 2); victory.presentation.renderState.atTime(victory.plan.timeline.duration); assert.equal(JSON.stringify(reports.victory), before);

// 10. Evidence names resolve against actual events, not percentage slices.
const victoryFrames = resolveEvidenceFrameSpecs(victory.plan, victory.schedule); const withdrawFrames = resolveEvidenceFrameSpecs(withdraw.plan, withdraw.schedule); assert.ok(victoryFrames.every((frame) => frame.status === 'resolved'), JSON.stringify(victoryFrames)); assert.ok(withdrawFrames.every((frame) => frame.status === 'resolved'), JSON.stringify(withdrawFrames));
assert.ok(victoryFrames.find((frame) => frame.name === 'victory-06-target-switch.png').targetSwitches.length > 0);
assert.ok(victoryFrames.find((frame) => frame.name === 'victory-07-authoritative-hit.png').activeAuthoritativeEvents.includes('damage'));
assert.ok(victoryFrames.find((frame) => frame.name === 'victory-08-authoritative-destruction.png').activeAuthoritativeEvents.includes('destroy'));

// 11. Deterministic rebuild and distinct results.
const rebuilt = build(reports.victory, 'b1-victory-repeat'); assert.deepEqual(victory.schedule, rebuilt.schedule); assert.notDeepEqual(victory.schedule.shots.map((shot) => [shot.actorId, shot.targetId, shot.t]), withdraw.schedule.shots.map((shot) => [shot.actorId, shot.targetId, shot.t]));

// 12. Unknown/support mappings fail closed instead of silently becoming infantry.
assert.equal(combatProfileFor({ actorId: 'unknown', type: 'mystery', category: 'support' }).canAttack, false);

console.log(`stage8-2G-B-1-test: 12 passed / 12 total; victory shots=${victory.schedule.shots.length}; friendly=${victory.schedule.shots.filter((shot) => shot.side === 'friendly').length}; enemy=${victory.schedule.shots.filter((shot) => shot.side === 'enemy').length}; families=${new Set(victory.schedule.shots.map((shot) => shot.weaponFamily)).size}; retreatOrders=${withdraw.schedule.retreatOrders.length}`);
