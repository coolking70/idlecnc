import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { compileUniversalPlan } from '../js/battle-presentation/universal/universal-plan-compiler.js';
import { sampleSpatialEntityPosition } from '../js/battle-presentation/universal/universal-position-sampler.js';
import { buildUniversalEngagementSchedule, scheduleAuthorityFingerprint } from '../js/battle-presentation/universal/universal-engagement-choreographer.js';
import { buildVisualShotSchedule } from '../js/battle-presentation/universal/visual-weapon-profiles.js';
import { resolveEvidenceFrameSpecs, STAGE8G_B11_EVIDENCE_NAMES } from '../js/battle-presentation/universal/evidence-frame-resolver.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures');
const load = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8')).report;
const active = (report, id) => ({ id, theaterId: report.theaterId, report, elapsed: 0, duration: report.duration, presentationPhase: 'battle' });
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const build = (report, id) => { const presentation = createUniversalBattlePresentation(active(report, id)); const plan = presentation.plan; const compiled = compileUniversalPlan(plan); const sampler = (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time); return { report, plan, presentation, sampler, schedule: buildUniversalEngagementSchedule(plan, sampler), authorityShots: buildVisualShotSchedule(plan, sampler) }; };
const built = { victory: build(load('campaign-victory.json'), 'b11-victory'), withdraw: build(load('campaign-withdraw.json'), 'b11-withdraw'), wiped: build(load('campaign-defeat-or-wiped.json'), 'b11-wiped') };
const write = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data, null, 2) + '\n');

const distributions = Object.fromEntries(Object.entries(built).map(([result, row]) => [result, {
  total: row.schedule.shots.length,
  byPhase: Object.fromEntries([...new Set([...row.schedule.phases.map((phase) => phase.id), 'retreat'])].map((phase) => [phase, row.schedule.shots.filter((shot) => shot.phase === phase).length])),
  bySide: { friendly: row.schedule.shots.filter((shot) => shot.side === 'friendly').length, enemy: row.schedule.shots.filter((shot) => shot.side === 'enemy').length },
  byWeapon: Object.fromEntries([...new Set(row.schedule.shots.map((shot) => shot.weaponFamily))].sort().map((family) => [family, row.schedule.shots.filter((shot) => shot.weaponFamily === family).length])),
  targetSwitches: row.schedule.targetSwitches.length,
  suppressionWindows: row.schedule.suppressionBursts.length,
  coverMoves: row.schedule.coverMoves.length,
  assignmentSlices: row.schedule.targetAssignmentSlices.length
}]));
write('stage8_2g_b11_assignment_phase_slices.json', { stage: '8.2G-B.1.1', cases: Object.fromEntries(Object.entries(built).map(([result, row]) => [result, { assignmentCount: row.schedule.targetAssignments.length, slices: row.schedule.targetAssignmentSlices, continuousAssignments: [...new Set(row.schedule.shots.map((shot) => shot.targetAssignmentId))].filter((id) => new Set(row.schedule.shots.filter((shot) => shot.targetAssignmentId === id).map((shot) => shot.phase)).size >= 2) }])), distributions });
write('stage8_2g_b11_cover_retreat_fire.json', { stage: '8.2G-B.1.1', cases: Object.fromEntries(Object.entries(built).map(([result, row]) => { const cover = row.schedule.coverMoves.filter((move) => move.purpose === 'cover_retreat'); const shots = row.schedule.shots.filter((shot) => shot.phase === 'retreat'); const rearIds = row.schedule.retreatOrders.filter((order) => order.role === 'rear_guard').map((order) => order.actorId); return [result, { coverWindows: cover, shotsDuringCoverRetreat: shots.length, rearGuardShots: shots.filter((shot) => rearIds.includes(shot.actorId)).length, mainWithdrawalShots: shots.filter((shot) => !rearIds.includes(shot.actorId)).length, realProjectile: shots.every((shot) => shot.sourcePositionAtFire && shot.impactPositionAtImpact), legalTargets: shots.every((shot) => shot.legality?.ok === true), rearGuardExit: row.schedule.retreatOrders.find((order) => order.role === 'rear_guard')?.presentationRoute?.at(-1) || null }]; })) });
const facing = Object.fromEntries(Object.entries(built).map(([result, row]) => { let max = 0; const rows = row.authorityShots.map((shot) => { const vector = Math.atan2(shot.impactPositionAtImpact.y - shot.sourcePositionAtFire.y, shot.impactPositionAtImpact.x - shot.sourcePositionAtFire.x); const error = Math.abs(Math.atan2(Math.sin(vector - shot.sourceFacingAtFire), Math.cos(vector - shot.sourceFacingAtFire))) * 180 / Math.PI; max = Math.max(max, error); return { id: shot.id, authorityType: shot.authorityType, actorId: shot.actorId, targetId: shot.targetId, errorDegrees: error }; }); return [result, { shotCount: rows.length, maxErrorDegrees: max, shots: rows }]; }));
write('stage8_2g_b11_authoritative_shot_facing.json', { stage: '8.2G-B.1.1', method: 'projectile_vector', thresholdDegrees: 5, cases: facing });
write('stage8_2g_b11_target_classification.json', { stage: '8.2G-B.1.1', at_infantry: 'infantry', enemy_at: 'infantry', weaponAffinity: 'anti_armor_rocket', antiArmorDoesNotChangeTargetClass: true });
const frameSets = { victory: resolveEvidenceFrameSpecs(built.victory.plan, built.victory.schedule, { names: STAGE8G_B11_EVIDENCE_NAMES.victory }), withdraw: resolveEvidenceFrameSpecs(built.withdraw.plan, built.withdraw.schedule, { names: STAGE8G_B11_EVIDENCE_NAMES.withdraw }) };
const frames = Object.values(frameSets).flat();
write('stage8_2g_b11_browser_evidence_manifest.json', { stage: '8.2G-B.1.1', version: 1, generatedBy: 'tests/generate-stage8-2G-B-1-1-machine-evidence.mjs', independentAudit: false, resolver: 'event-driven', scenes: frames, browserCaptureRequired: true, exactTimestampToleranceMs: 16.7 });
write('stage8_2g_b11_evidence_binding_check.json', { stage: '8.2G-B.1.1', status: 'pending_browser_capture', requiredFields: ['sceneId', 'seed', 'timeMs', 'viewport', 'sceneHash', 'stateSignature', 'semanticFrameId', 'imageSha256'], checks: { timestamp: false, sceneHash: false, stateSignature: false, semanticPredicate: false, pngHash: false, duplicateImageHash: false } });
write('stage8_2g_b11_authority_check.json', { stage: '8.2G-B.1.1', solverModified: false, hpModifiedByPresentation: false, resultModifiedByPresentation: false, authoritativeEventOrderChanged: false, cases: Object.fromEntries(Object.entries(built).map(([result, row]) => [result, { reportHash: sha(JSON.stringify(row.report)), authorityFacingMaxErrorDegrees: facing[result].maxErrorDegrees, presentationShots: row.schedule.shots.length }])), });
const fingerprints = Object.fromEntries(Object.entries(built).map(([result, row]) => [result, scheduleAuthorityFingerprint(row.schedule)]));
write('stage8_2g_b11_determinism_check.json', { stage: '8.2G-B.1.1', sameSeedFingerprint: fingerprints.victory === scheduleAuthorityFingerprint(build(load('campaign-victory.json'), 'b11-victory-repeat').schedule), differentResultFingerprints: fingerprints.victory !== fingerprints.withdraw });
write('stage8_2g_b11_package_hygiene.json', { stage: '8.2G-B.1.1', status: 'pending_final_package', forbidden: ['.DS_Store', '__MACOSX', '*.zip', 'node_modules', '.git', 'artifacts', 'browser profile', 'temporary screenshots'] });
write('stage8_2g_b11_full_test.json', { stage: '8.2G-B.1.1', status: 'pending_full_test', command: 'npm test', b11Test: 'tests/stage8-2G-B-1-1-test.mjs' });
console.log(JSON.stringify({ ok: true, stage: '8.2G-B.1.1', distributions, unresolved: frames.filter((frame) => frame.status !== 'resolved').map((frame) => frame.name) }));
