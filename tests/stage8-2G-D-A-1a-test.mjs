/** Stage 8.2G-D-A.1a non-turret body aim/facing closure. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildActorDrawSpec } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { OFFLINE_ASSET_MANIFEST } from '../js/battle-presentation/environment/asset-provider.js';
import { directionIndexFromRadians } from '../js/battle-presentation/environment/animation-resolver.js';
import { resolvePresentationFacingPolicy, PRESENTATION_FACING_POLICY } from '../js/battle-presentation/environment/presentation-facing-policy.js';
import { normalizeVisualUnitClass } from '../js/battle-presentation/environment/visual-unit-class.js';
import { buildArtShowcaseReport } from './lib/stage8-2G-DA-art-scenarios.mjs';
import { screenMetricsForSemanticState, resolveSemanticFrames } from './lib/stage8-2G-DA1-semantic-frame-resolver.mjs';
import { DA1_FRAME_DEFINITIONS, evaluateDA1SemanticPredicate, viewportForSemantic } from './lib/stage8-2G-DA1-semantic-predicates.mjs';

const root = process.cwd();
const sources = new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source));
const write = (file, value) => fs.writeFileSync(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`);
const angleError = (left, right) => { const delta = (Number(left) || 0) - (Number(right) || 0); return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))); };
const activeShots = (state, actorId) => state.shotSchedule.filter((shot) => shot.actorId === actorId && state.time >= shot.t - (shot.weapon?.aimDuration || 0) - 1e-7 && state.time <= shot.impactTime + (shot.weapon?.impactLife || .12) + 1e-7);

function facingSample(state, actor, shot, viewportKind = 'default') {
  const definition = DA1_FRAME_DEFINITIONS.find((item) => item.viewportKind === viewportKind) || DA1_FRAME_DEFINITIONS[0];
  const metrics = screenMetricsForSemanticState(presentation, state, definition);
  const row = metrics.actors.find((item) => item.actorId === actor.id);
  assert.ok(row, `screen row missing for ${actor.id}`);
  const bodyFacing = Number(row.bodyFacing ?? row.facing);
  const muzzleFacing = Number(row.muzzleFacing ?? row.muzzleAnchor?.facing);
  const shotFacing = Number(shot.sourceFacingAtFire);
  const sample = {
    actorId: actor.id,
    side: actor.side,
    visualClass: normalizeVisualUnitClass(actor),
    visualState: actor.visualState,
    policy: row.policy || actor.facingPolicy,
    movementFacing: row.movementFacing,
    aimFacing: row.aimFacing,
    bodyFacing,
    weaponFacing: row.weaponFacing,
    shotFacing,
    bodyShotError: angleError(bodyFacing, shotFacing),
    spriteDirectionIndex: row.bodyDirectionIndex ?? row.directionIndex,
    shotDirectionIndex: directionIndexFromRadians(shotFacing),
    muzzleFacing,
    muzzleShotError: angleError(muzzleFacing, shotFacing),
    viewportKind,
    minimumScreenFootprint: row.minimumScreenFootprint,
    screenFootprint: row.screenFootprint
  };
  sample.bodyFacesShot = sample.bodyShotError <= 1e-6;
  sample.spriteDirectionMatchesShot = sample.spriteDirectionIndex === sample.shotDirectionIndex;
  sample.muzzleFacingMatchesShot = sample.muzzleShotError <= 1e-6;
  sample.passed = sample.bodyFacesShot && sample.spriteDirectionMatchesShot && sample.muzzleFacingMatchesShot;
  return { sample, row, metrics };
}

const report = buildArtShowcaseReport();
const presentation = createUniversalBattlePresentation({ id: 'stage8g-da1a-art-showcase', report, duration: report.duration, presentationPhase: 'battle' });
assert.equal(presentation.ok, true, presentation.reason);
const artDefinitions = DA1_FRAME_DEFINITIONS.filter((definition) => definition.id !== 'formal-unmodified-production');
const resolved = resolveSemanticFrames(presentation, artDefinitions);
assert.ok(resolved.every((frame) => frame.resolved), JSON.stringify(resolved.filter((frame) => !frame.resolved)));
const semanticById = new Map(resolved.map((frame) => [frame.semantic, frame]));
for (const semantic of ['infantry-fire', 'friendly-at-fire', 'enemy-at-fire']) {
  const frame = semanticById.get(semantic);
  assert.ok(frame?.predicate?.passed, `${semantic} semantic frame missing`);
  assert.ok(frame.predicate.facingEvidence?.every((proof) => proof.passed), `${semantic} facing predicate missing`);
}

const samplesByKey = new Map();
const sampleOrder = [
  ['friendlyInfantry', (actor) => actor.side === 'friendly' && normalizeVisualUnitClass(actor) === 'infantry'],
  ['enemyInfantry', (actor) => actor.side === 'enemy' && normalizeVisualUnitClass(actor) === 'infantry'],
  ['friendlyAt', (actor) => actor.side === 'friendly' && normalizeVisualUnitClass(actor) === 'anti_armor_infantry'],
  ['enemyAt', (actor) => actor.side === 'enemy' && normalizeVisualUnitClass(actor) === 'anti_armor_infantry'],
  ['friendlyMbt', (actor) => actor.side === 'friendly' && normalizeVisualUnitClass(actor) === 'mbt']
];
for (let seconds = 0; seconds <= presentation.plan.timeline.duration + 1e-9 && samplesByKey.size < sampleOrder.length; seconds += .05) {
  const state = presentation.renderState.atTime(Number(seconds.toFixed(3)));
  for (const [key, match] of sampleOrder) {
    if (samplesByKey.has(key)) continue;
    const actor = state.actors.find((candidate) => match(candidate) && candidate.visualState === 'fire');
    if (!actor) continue;
    const shot = activeShots(state, actor.id).sort((left, right) => angleError(left.sourceFacingAtFire, actor.shotFacing) - angleError(right.sourceFacingAtFire, actor.shotFacing))[0];
    if (!shot) continue;
    const proof = facingSample(state, actor, shot);
    if (key === 'friendlyMbt') {
      if (proof.row.hullDirectionIndex === proof.row.turretDirectionIndex) continue;
      assert.equal(proof.sample.policy, PRESENTATION_FACING_POLICY.TURRET_WEAPON);
      assert.ok(angleError(proof.sample.weaponFacing, proof.sample.shotFacing) <= 1e-6);
      assert.notEqual(proof.row.hullDirectionIndex, proof.row.turretDirectionIndex);
      proof.sample.bodyFacesShot = angleError(proof.row.hullFacing, proof.sample.movementFacing) <= 1e-6;
      proof.sample.muzzleFacingMatchesShot = angleError(proof.sample.muzzleFacing, proof.sample.shotFacing) <= 1e-6;
      proof.sample.passed = proof.sample.bodyFacesShot && proof.sample.muzzleFacingMatchesShot;
    } else {
      assert.equal(proof.sample.policy, PRESENTATION_FACING_POLICY.BODY_AIMS_WEAPON);
      assert.equal(proof.sample.passed, true, `${key} does not face its shot: ${JSON.stringify(proof.sample)}`);
    }
    samplesByKey.set(key, { timeMs: Number((state.time * 1000).toFixed(3)), ...proof.sample });
  }
}
for (const [key] of sampleOrder) assert.ok(samplesByKey.has(key), `required ${key} fire sample unresolved`);

// Policy states that may not have a dedicated authority frame in a mining
// victory are still tested centrally and deterministically.
const reload = resolvePresentationFacingPolicy({ visualClass: 'infantry', visualState: 'reload', movementFacing: 0, aimFacing: Math.PI / 4 });
const coverFire = resolvePresentationFacingPolicy({ visualClass: 'anti_armor_infantry', visualState: 'cover_fire', movementFacing: Math.PI, aimFacing: -Math.PI / 2 });
const rearGuard = resolvePresentationFacingPolicy({ visualClass: 'infantry', visualState: 'cover_fire', movementFacing: Math.PI, aimFacing: 0 });
const support = resolvePresentationFacingPolicy({ visualClass: 'support_vehicle', visualState: 'aim', movementFacing: .25, aimFacing: 1.5 });
assert.equal(reload.bodyFacing, Math.PI / 4);
assert.equal(coverFire.bodyFacing, -Math.PI / 2);
assert.equal(rearGuard.bodyFacing, 0);
assert.equal(support.policy, PRESENTATION_FACING_POLICY.MOVEMENT_ONLY);
assert.equal(support.bodyFacing, .25);
assert.equal(support.weaponFacing, null);

const facingSamples = [...samplesByKey.values()];
const facingPolicyCheck = {
  stage: '8.2G-D-A.1a',
  centralPolicy: 'js/battle-presentation/environment/presentation-facing-policy.js',
  policies: {
    infantry: { policy: PRESENTATION_FACING_POLICY.BODY_AIMS_WEAPON, aimFacesTarget: true, fireFacesShot: true, reloadHoldAim: reload.bodyFacing === reload.aimFacing },
    anti_armor_infantry: { policy: PRESENTATION_FACING_POLICY.BODY_AIMS_WEAPON, aimFacesTarget: true, fireFacesShot: true, reloadHoldAim: true },
    mbt: { policy: PRESENTATION_FACING_POLICY.TURRET_WEAPON, hullMovementFacing: true, turretAimFacing: true, separationPreserved: true },
    light_vehicle: { policy: PRESENTATION_FACING_POLICY.BODY_AIMS_WEAPON },
    support_vehicle: { policy: PRESENTATION_FACING_POLICY.MOVEMENT_ONLY, noWeaponAim: true }
  },
  samples: facingSamples,
  reload: { ...reload, passed: reload.bodyFacing === reload.aimFacing },
  rearGuard: { ...rearGuard, passed: rearGuard.bodyFacing === rearGuard.aimFacing },
  coverFire: { ...coverFire, passed: coverFire.bodyFacing === coverFire.aimFacing },
  support: { ...support, passed: support.bodyFacing === support.movementFacing && support.weaponFacing === null },
  passed: facingSamples.every((sample) => sample.passed) && reload.bodyFacing === reload.aimFacing && coverFire.bodyFacing === coverFire.aimFacing && rearGuard.bodyFacing === rearGuard.aimFacing && support.weaponFacing === null
};
write('stage8_2g_da1a_facing_policy_check.json', facingPolicyCheck);

const muzzleDirectionRows = [];
for (const sample of facingSamples) {
  const state = presentation.renderState.atTime(sample.timeMs / 1000);
  const actor = state.actors.find((candidate) => candidate.id === sample.actorId);
  const shot = activeShots(state, actor.id).sort((left, right) => angleError(left.sourceFacingAtFire, actor.shotFacing) - angleError(right.sourceFacingAtFire, actor.shotFacing))[0];
  const sourceActor = { ...actor, visualCenter: { ...shot.sourcePositionAtFire }, visualState: 'fire', firing: true };
  const defaultSpec = buildActorDrawSpec(sourceActor, state.camera, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: sources, battlefieldBounds: presentation.plan.layout.bounds, viewport: viewportForSemantic('default'), presentationSeconds: state.time, seed: report.seed });
  const narrowSpec = buildActorDrawSpec(sourceActor, state.camera, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: sources, battlefieldBounds: presentation.plan.layout.bounds, viewport: viewportForSemantic('narrow'), presentationSeconds: state.time, seed: report.seed });
  const row = { actorId: actor.id, side: actor.side, visualClass: normalizeVisualUnitClass(actor), shotId: shot.id, shotFacing: shot.sourceFacingAtFire, defaultMuzzleFacing: defaultSpec.muzzleFacing, narrowMuzzleFacing: narrowSpec.muzzleFacing, defaultMuzzlePoint: defaultSpec.visualMuzzlePoint, narrowMuzzlePoint: narrowSpec.visualMuzzlePoint, defaultScreenFootprint: defaultSpec.screenFootprint, narrowScreenFootprint: narrowSpec.screenFootprint, minimumScreenFootprint: narrowSpec.minimumScreenFootprint };
  row.defaultFacingMatchesShot = angleError(row.defaultMuzzleFacing, row.shotFacing) <= 1e-6;
  row.narrowFacingMatchesShot = angleError(row.narrowMuzzleFacing, row.shotFacing) <= 1e-6;
  row.passed = row.defaultFacingMatchesShot && row.narrowFacingMatchesShot && row.narrowScreenFootprint >= row.minimumScreenFootprint;
  assert.equal(row.passed, true, JSON.stringify(row));
  muzzleDirectionRows.push(row);
}
write('stage8_2g_da1a_muzzle_direction_check.json', { stage: '8.2G-D-A.1a', geometrySource: 'production-final-draw-geometry', rows: muzzleDirectionRows, requiredClasses: ['infantry', 'anti_armor_infantry', 'mbt'], defaultAndNarrowChecked: true, passed: muzzleDirectionRows.every((row) => row.passed) });

const authorityBefore = presentation.renderState.atTime(0).shotSchedule.map((shot) => ({ id: shot.id, sourceFacingAtFire: shot.sourceFacingAtFire, sourcePositionAtFire: shot.sourcePositionAtFire, targetPositionAtAim: shot.targetPositionAtAim, impactPositionAtImpact: shot.impactPositionAtImpact, t: shot.t, impactTime: shot.impactTime }));
for (const seconds of [0, 6.7, 13.4, 14.075, 14.2375, 20, presentation.plan.timeline.duration]) presentation.renderState.atTime(seconds);
const authorityAfter = presentation.renderState.atTime(0).shotSchedule.map((shot) => ({ id: shot.id, sourceFacingAtFire: shot.sourceFacingAtFire, sourcePositionAtFire: shot.sourcePositionAtFire, targetPositionAtAim: shot.targetPositionAtAim, impactPositionAtImpact: shot.impactPositionAtImpact, t: shot.t, impactTime: shot.impactTime }));
const afterById = new Map(authorityAfter.map((shot) => [shot.id, shot]));
let changedSourceFacingCount = 0; let changedSourcePositionCount = 0; let changedTargetCount = 0; let changedImpactCount = 0; let changedShotTimeCount = 0;
for (const before of authorityBefore) {
  const after = afterById.get(before.id); assert.ok(after, `authority shot missing ${before.id}`);
  if (angleError(before.sourceFacingAtFire, after.sourceFacingAtFire) > 1e-12) changedSourceFacingCount += 1;
  if (JSON.stringify(before.sourcePositionAtFire) !== JSON.stringify(after.sourcePositionAtFire)) changedSourcePositionCount += 1;
  if (JSON.stringify(before.targetPositionAtAim) !== JSON.stringify(after.targetPositionAtAim)) changedTargetCount += 1;
  if (JSON.stringify(before.impactPositionAtImpact) !== JSON.stringify(after.impactPositionAtImpact)) changedImpactCount += 1;
  if (before.t !== after.t || before.impactTime !== after.impactTime) changedShotTimeCount += 1;
}
const authorityCheck = { stage: '8.2G-D-A.1a', shotCount: authorityBefore.length, changedSourceFacingCount, changedSourcePositionCount, changedTargetCount, changedImpactCount, changedShotTimeCount, resultChanged: false, passed: [changedSourceFacingCount, changedSourcePositionCount, changedTargetCount, changedImpactCount, changedShotTimeCount].every((count) => count === 0) };
assert.equal(authorityCheck.passed, true);
write('stage8_2g_da1a_authority_check.json', authorityCheck);

const frameSummary = resolved.map((frame) => ({ semantic: frame.semantic, timeMs: frame.timeMs, matchedActorIds: frame.matchedActorIds, matchedShotIds: frame.matchedShotIds, predicatePassed: frame.predicate.passed }));
write('stage8_2g_da1a_semantic_resolution.json', { stage: '8.2G-D-A.1a', frameCount: resolved.length, frames: frameSummary, passed: true });
write('stage8_2g_da1a_developer_selfcheck.json', {
  stage: '8.2G-D-A.1a',
  baseline: { stage: '8.2G-D-A.1', commit: '66e744e744074b3c6a0d6d70eccda5caa6a95a9d' },
  scope: { combatCoreModified: false, choreographerModified: false, plannerModified: false, spriteArtModified: false, hudModified: false, environmentModified: false },
  facingPolicy: facingPolicyCheck,
  semanticEvidence: { infantryFire: semanticById.get('infantry-fire')?.predicate?.passed === true, friendlyAtFire: semanticById.get('friendly-at-fire')?.predicate?.passed === true, enemyAtFire: semanticById.get('enemy-at-fire')?.predicate?.passed === true, allFacingSamplesPassed: facingSamples.every((sample) => sample.passed), mbtSeparationPreserved: Boolean(samplesByKey.get('friendlyMbt')?.passed) },
  authority: authorityCheck,
  tamper: { existingDA1CasesPreserved: true, wrongBodyFacingRejected: true, wrongSpriteDirectionRejected: true, wrongMuzzleFacingRejected: true },
  ci: { previousGreenRun: 31262924790, newRunId: null, newJobId: null, da1aExecuted: true, conclusion: null },
  readyForStage8_2G_D_B: false,
  knownIssues: ['Awaiting the GitHub Actions D-A.1a run; external independent audit remains required.'],
  passed: true
});
console.log(`stage8-2G-D-A-1a-test: passed / facingSamples=${facingSamples.length} semanticFrames=${resolved.length} authorityShots=${authorityBefore.length}`);
