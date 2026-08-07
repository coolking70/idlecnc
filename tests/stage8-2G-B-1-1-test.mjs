/** Stage 8.2G-B.1.1 phase-continuous fire and evidence closure checks. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { compileUniversalPlan } from '../js/battle-presentation/universal/universal-plan-compiler.js';
import { sampleSpatialEntityPosition } from '../js/battle-presentation/universal/universal-position-sampler.js';
import { buildUniversalEngagementSchedule, classifyTargetClass, evaluateTargetLegality, ENGAGEMENT_LIMITS } from '../js/battle-presentation/universal/universal-engagement-choreographer.js';
import { buildVisualShotSchedule } from '../js/battle-presentation/universal/visual-weapon-profiles.js';
import { resolveEvidenceFrameSpecs, STAGE8G_B11_EVIDENCE_NAMES } from '../js/battle-presentation/universal/evidence-frame-resolver.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures');
const load = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8')).report;
const active = (report, id) => ({ id, theaterId: report.theaterId, report, elapsed: 0, duration: report.duration, presentationPhase: 'battle' });
const build = (report, id) => {
  const presentation = createUniversalBattlePresentation(active(report, id));
  assert.equal(presentation.ok, true, presentation.reason);
  const plan = presentation.plan;
  const compiled = compileUniversalPlan(plan);
  const sampler = (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time);
  return { plan, presentation, sampler, schedule: buildUniversalEngagementSchedule(plan, sampler) };
};

const victory = build(load('campaign-victory.json'), 'b11-victory');
const withdraw = build(load('campaign-withdraw.json'), 'b11-withdraw');
const wiped = build(load('campaign-defeat-or-wiped.json'), 'b11-wiped');

// Assignment Phase Slicing: one hold may produce shots in all three combat phases.
const byAssignment = new Map();
for (const shot of victory.schedule.shots) {
  if (!byAssignment.has(shot.targetAssignmentId)) byAssignment.set(shot.targetAssignmentId, new Set());
  byAssignment.get(shot.targetAssignmentId).add(shot.phase);
}
assert.ok([...byAssignment.values()].some((phases) => ['first_contact', 'main_engagement', 'critical_event'].every((phase) => phases.has(phase))));
assert.ok(victory.schedule.targetAssignmentSlices.some((slice) => slice.phase === 'main_engagement'));
for (const slice of victory.schedule.targetAssignmentSlices) assert.ok(slice.end > slice.start, `${slice.id} overlaps or is empty`);
assert.equal(victory.schedule.shots.filter((shot) => shot.phase === 'approach').length, 0);
assert.ok(victory.schedule.phaseBudgets.first_contact.scheduledShots <= ENGAGEMENT_LIMITS.firstContactShotsPerSide * 2);
assert.ok(victory.schedule.phaseBudgets.main_engagement.scheduledShots > 0);
assert.ok(victory.schedule.phaseBudgets.critical_event.scheduledShots > 0);

// Covering Retreat Fire: it is a legal, real shot chain rather than metadata.
const rear = withdraw.schedule.retreatOrders.find((order) => order.role === 'rear_guard');
const retreatShots = withdraw.schedule.shots.filter((shot) => shot.phase === 'retreat');
assert.ok(rear && retreatShots.length > 0);
assert.ok(retreatShots.every((shot) => shot.actorId === rear.actorId && shot.suppressionId));
assert.ok(retreatShots.every((shot) => shot.legality?.ok === true && shot.weaponId));
assert.ok(withdraw.schedule.coverMoves.some((move) => move.purpose === 'cover_retreat'));
assert.ok(rear.presentationRoute.at(-1).x < rear.presentationRoute[0].x);
assert.equal(wiped.schedule.retreatOrders.length, 0);

// Authority shots must face their projectile vector, including moving actors.
for (const row of [victory, withdraw, wiped]) {
  const compiled = compileUniversalPlan(row.plan);
  const authorityShots = buildVisualShotSchedule(row.plan, (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time));
  let maxError = 0;
  for (const shot of authorityShots) {
    const vector = Math.atan2(shot.impactPositionAtImpact.y - shot.sourcePositionAtFire.y, shot.impactPositionAtImpact.x - shot.sourcePositionAtFire.x);
    const error = Math.abs(Math.atan2(Math.sin(vector - shot.sourceFacingAtFire), Math.cos(vector - shot.sourceFacingAtFire)));
    maxError = Math.max(maxError, error);
  }
  assert.ok(maxError <= Math.PI / 36, `${row.plan.source.result} authority facing error ${(maxError * 180 / Math.PI).toFixed(3)}°`);
}

// AT infantry remains infantry while retaining its anti-armour weapon affinity.
assert.equal(classifyTargetClass({ type: 'at_infantry', category: 'at_infantry' }), 'infantry');
assert.equal(classifyTargetClass({ type: 'enemy_at' }), 'infantry');
const light = { actorId: 'light', type: 'infantry', side: 'friendly', final: { alive: true }, position: { x: 0, y: 0 } };
const at = { actorId: 'at', type: 'at_infantry', side: 'enemy', final: { alive: true }, position: { x: 220, y: 0 } };
assert.equal(evaluateTargetLegality({ forces: { friendly: [light], enemy: [at] }, scene: {} }, light, at, 1).ok, true);

// Resolver uses semantic predicates and the B.1.1 names, never timeline percentages.
const victoryFrames = resolveEvidenceFrameSpecs(victory.plan, victory.schedule, { names: STAGE8G_B11_EVIDENCE_NAMES.victory });
const withdrawFrames = resolveEvidenceFrameSpecs(withdraw.plan, withdraw.schedule, { names: STAGE8G_B11_EVIDENCE_NAMES.withdraw });
assert.ok(victoryFrames.every((frame) => frame.status === 'resolved'), JSON.stringify(victoryFrames));
assert.ok(withdrawFrames.every((frame) => frame.status === 'resolved'), JSON.stringify(withdrawFrames));
assert.ok(withdrawFrames.find((frame) => frame.name === 'defeat-03-rear-guard-cover-fire.png').activePresentationShots.length > 0);
assert.ok(withdrawFrames.find((frame) => frame.name === 'defeat-04-rear-guard-projectile.png').activePresentationShots.length > 0);

// Presentation remains read-only with respect to the formal report.
const before = JSON.stringify(load('campaign-victory.json'));
victory.presentation.renderState.atTime(0);
victory.presentation.renderState.atTime(victory.plan.timeline.duration / 2);
victory.presentation.renderState.atTime(victory.plan.timeline.duration);
assert.equal(JSON.stringify(load('campaign-victory.json')), before);

console.log(`stage8-2G-B-1-1-test: 20 passed / 20 total; victory phases=${JSON.stringify(victory.schedule.phaseBudgets)}; retreat shots=${retreatShots.length}; rear guard=${rear.actorId}`);
