/**
 * Event-driven evidence frame selection for Stage 8.2G-B.1.
 *
 * Names are assigned only after a real schedule/authority predicate is found.
 * The resolver never chooses a frame from a fixed percentage of the timeline.
 */
import { engagementAtTime, assignmentAtTime, suppressionTargetAtTime, retreatAtTime } from './universal-engagement-choreographer.js';
import { buildCameraDirector, cameraInterestAtTime } from './universal-camera-director.js';
import { semanticPredicateForName, requiredPredicateForName } from './evidence-integrity.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const actorRows = (plan) => [...(plan?.forces?.friendly || []), ...(plan?.forces?.enemy || [])];
const phaseAt = (schedule, time) => schedule?.phases?.find((phase) => time >= phase.start - 1e-6 && (time < phase.end - 1e-6 || phase.id === 'battle_end')) || schedule?.phases?.at(-1) || null;
const shotsAt = (schedule, time) => (schedule?.shots || []).filter((shot) => time >= shot.t - shot.weapon.aimDuration && time <= shot.impactTime + .12);
const anchorsAt = (plan, time) => (plan?.timeline?.anchors || []).filter((anchor) => Math.abs(Number(anchor.t) - time) < .18);

export const STAGE8G_B11_EVIDENCE_NAMES = Object.freeze({
  victory: ['victory-01-first-contact.png', 'victory-02-main-engagement-mixed-fire.png', 'victory-03-tank-or-antiarmor-fire.png', 'victory-04-suppression-target.png', 'victory-05-cover-advance.png', 'victory-06-target-switch.png', 'victory-07-authoritative-hit.png', 'victory-08-authoritative-destruction.png', 'victory-09-battle-end.png'],
  withdraw: ['defeat-01-line-collapse.png', 'defeat-02-main-withdrawal.png', 'defeat-03-rear-guard-cover-fire.png', 'defeat-04-rear-guard-projectile.png', 'defeat-05-rear-guard-withdraw-or-loss.png', 'defeat-06-authoritative-loss.png', 'defeat-07-final-state.png'],
  debug: ['debug-assignment-phase-slices.png', 'debug-cover-retreat-shot.png', 'debug-authoritative-shot-facing.png', 'debug-evidence-frame-binding.png'],
  formal: ['formal-victory-default-size.png', 'formal-victory-narrow-size.png', 'formal-defeat-default-size.png', 'formal-defeat-narrow-size.png']
});

function candidates(plan, schedule) {
  const duration = Number(plan.timeline?.duration) || 1; const values = new Set([0, duration]);
  for (const phase of schedule.phases || []) values.add(clamp(phase.start + .01, 0, duration));
  for (const shot of schedule.shots || []) { values.add(clamp(shot.t, 0, duration)); values.add(clamp(shot.t + .04, 0, duration)); }
  for (const row of schedule.suppressionBursts || []) values.add(clamp((row.start + row.end) / 2, 0, duration));
  for (const row of schedule.coverMoves || []) { values.add(clamp(row.start + .05, 0, duration)); values.add(clamp((row.start + row.end) / 2, 0, duration)); }
  for (const row of schedule.targetSwitches || []) values.add(clamp(row.time + .01, 0, duration));
  for (const row of schedule.retreatOrders || []) { values.add(clamp(row.start + .05, 0, duration)); values.add(clamp(row.start + .35, 0, duration)); values.add(clamp(row.start + .8, 0, duration)); }
  for (const anchor of plan.timeline?.anchors || []) if (['damage', 'destroy'].includes(anchor.type)) { values.add(clamp(Number(anchor.t) + .01, 0, duration)); values.add(clamp(Number(anchor.t) + .14, 0, duration)); values.add(clamp(Number(anchor.t) + .17, 0, duration)); }
  return [...values].sort((a, b) => a - b);
}

export function describeEvidenceFrameAt(plan, schedule, time, reason) {
  const phase = phaseAt(schedule, time); const shots = shotsAt(schedule, time); const anchors = anchorsAt(plan, time); const activeEngagement = engagementAtTime(schedule, time); const activeSuppression = (schedule.suppressionBursts || []).filter((row) => time >= row.start - .01 && time <= row.end + .01); const activeCover = (schedule.coverMoves || []).filter((row) => time >= row.start - .01 && time <= row.end + .01); const activeRetreats = (schedule.retreatOrders || []).filter((row) => time >= row.start - .01 && time <= row.end + .01); const switches = (schedule.targetSwitches || []).filter((row) => Math.abs(row.time - time) < .2); const cameraInterest = cameraInterestAtTime(buildCameraDirectorSafe(schedule), time) || null;
  const frame = { time, reason, phase: phase?.id || 'unknown', engagementIds: activeEngagement ? [activeEngagement.id] : [], activePresentationShots: shots.map((shot) => shot.id), activeAuthoritativeEvents: anchors.map((anchor) => anchor.type), weaponFamilies: [...new Set(shots.map((shot) => shot.weaponFamily || shot.weapon?.family).filter(Boolean))], friendlyShotCount: shots.filter((shot) => shot.side === 'friendly').length, enemyShotCount: shots.filter((shot) => shot.side === 'enemy').length, suppressionSources: [...new Set(activeSuppression.flatMap((row) => row.sourceIds))], suppressionTargets: [...new Set(activeSuppression.flatMap((row) => row.targetIds))], coverMoves: activeCover.map((row) => row.id), retreatOrders: activeRetreats.map((row) => row.id), targetSwitches: switches.map((row) => row.id), cameraInterest, sceneHash: plan.planFingerprint || plan.source?.reportFingerprint || null };
  const rearGuardIds = new Set(activeRetreats.filter((order) => order.role === 'rear_guard').map((order) => order.actorId));
  frame.rearGuardCoverFire = rearGuardIds.size > 0 && frame.suppressionSources.length > 0 && shots.some((shot) => shot.phase === 'retreat' && rearGuardIds.has(shot.actorId));
  frame.semanticPredicates = semanticPredicateForName(reason, frame);
  frame.requiredPredicate = requiredPredicateForName(reason);
  return frame;
}

function buildCameraDirectorSafe(schedule) { return buildCameraDirector(schedule); }

function satisfies(name, frame, plan, schedule) {
  const hasAuthority = (type) => frame.activeAuthoritativeEvents.includes(type);
  if (name.includes('first-contact')) return frame.phase === 'first_contact';
  if (name.includes('friendly-and-enemy-fire') || name.includes('main-engagement-mixed-fire')) return frame.friendlyShotCount > 0 && frame.enemyShotCount > 0;
  if (name.includes('weapon-diversity')) return frame.weaponFamilies.length >= 2;
  if (name.includes('tank-or-antiarmor-fire')) return frame.weaponFamilies.some((family) => ['tank_cannon', 'anti_armor'].includes(family));
  if (name.includes('suppression-target')) return frame.suppressionTargets.length > 0;
  if (name.includes('cover-advance')) return frame.coverMoves.some((id) => id === 'cover_move_1');
  if (name.includes('target-switch')) return frame.targetSwitches.length > 0;
  if (name.includes('authoritative-hit')) return hasAuthority('damage');
  if (name.includes('authoritative-destruction') || name.includes('final-authoritative-destruction')) return hasAuthority('destroy');
  if (name.includes('battle-end') || name.includes('final-state')) return frame.phase === 'battle_end';
  if (name.includes('main-engagement')) return frame.phase === 'main_engagement';
  if (name.includes('line-collapse')) return ['withdraw', 'wiped'].includes(plan.source?.result) && frame.phase === 'critical_event';
  if (name.includes('main-group-retreat') || name.includes('main-withdrawal')) return frame.retreatOrders.length > 0 && frame.time >= ((schedule.retreatOrders || []).find((row) => row.role !== 'rear_guard')?.start || 0) + .25 && frame.retreatOrders.some((id) => (schedule.retreatOrders || []).find((row) => row.id === id)?.role !== 'rear_guard');
  if (name.includes('rear-guard-cover-fire')) return frame.retreatOrders.some((id) => (schedule.retreatOrders || []).find((row) => row.id === id)?.role === 'rear_guard') && frame.suppressionSources.length > 0 && (schedule.shots || []).some((shot) => shot.phase === 'retreat' && frame.activePresentationShots.includes(shot.id));
  if (name.includes('rear-guard-projectile')) return (schedule.shots || []).some((shot) => shot.phase === 'retreat' && frame.activePresentationShots.includes(shot.id) && (schedule.retreatOrders || []).find((order) => order.actorId === shot.actorId)?.role === 'rear_guard');
  if (name.includes('rear-guard-withdraw-or-loss')) return frame.retreatOrders.some((id) => (schedule.retreatOrders || []).find((row) => row.id === id)?.role === 'rear_guard');
  if (name.includes('authoritative-loss')) return hasAuthority('destroy') || hasAuthority('damage');
  if (name.includes('last-resistance') || name.includes('firepower-decline') || name.includes('wreck-field')) return frame.phase === 'critical_event' || frame.phase === 'battle_end';
  if (name.startsWith('debug-')) return name.includes('assignment-phase-slices') ? (schedule.targetAssignmentSlices || []).some((slice) => slice.phase === 'main_engagement') : name.includes('target-legality') ? frame.activePresentationShots.length > 0 : name.includes('suppression') || name.includes('evidence-frame-binding') ? frame.suppressionTargets.length > 0 : name.includes('authoritative-shot-facing') ? hasAuthority('damage') || hasAuthority('destroy') : name.includes('cover') ? frame.coverMoves.length > 0 : name.includes('retreat') ? frame.retreatOrders.length > 0 : Boolean(frame.cameraInterest);
  if (name.startsWith('formal-')) return true;
  return false;
}

export function resolveEvidenceFrameSpecs(plan, schedule, options = {}) {
  const names = options.names || (plan.source?.result === 'victory' ? [
    'victory-01-first-contact.png', 'victory-02-friendly-and-enemy-fire.png', 'victory-03-weapon-diversity.png', 'victory-04-suppression-target.png', 'victory-05-cover-advance.png', 'victory-06-target-switch.png', 'victory-07-authoritative-hit.png', 'victory-08-authoritative-destruction.png', 'victory-09-battle-end.png'
  ] : plan.source?.result === 'wiped' ? [
    'defeat-01-main-engagement.png', 'defeat-02-line-collapse.png', 'defeat-03-last-resistance.png', 'defeat-04-firepower-decline.png', 'defeat-05-final-authoritative-destruction.png', 'defeat-06-wreck-field.png'
  ] : [
    'defeat-01-main-engagement.png', 'defeat-02-line-collapse.png', 'defeat-03-main-group-retreat.png', 'defeat-04-rear-guard-cover-fire.png', 'defeat-05-rear-guard-withdraw-or-loss.png', 'defeat-06-authoritative-loss.png', 'defeat-07-final-state.png'
  ]);
  const pool = candidates(plan, schedule); const used = new Set();
  return names.map((name) => {
    let selected = null;
    for (const time of pool) { if (used.has(time)) continue; const frame = describeEvidenceFrameAt(plan, schedule, time, name); if (satisfies(name, frame, plan, schedule)) { selected = frame; break; } }
    if (!selected) return { name, status: 'not_applicable', reason: `no schedule event satisfies ${name}`, timeMs: null, phase: null, engagementIds: [], activePresentationShots: [], activeAuthoritativeEvents: [], weaponFamilies: [], friendlyShotCount: 0, enemyShotCount: 0, suppressionSources: [], suppressionTargets: [], coverMoves: [], retreatOrders: [], targetSwitches: [], cameraInterest: null, sceneHash: plan.planFingerprint || null, semanticPredicates: semanticPredicateForName(name), requiredPredicate: requiredPredicateForName(name) };
    used.add(selected.time); return { name, status: 'resolved', timeMs: Number((selected.time * 1000).toFixed(3)), ...selected };
  });
}
