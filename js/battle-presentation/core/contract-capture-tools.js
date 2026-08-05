import { createAuthorityState, applyAuthorityAnchorsThrough, requiredAppliedCount, compareAuthorityToContractFinal } from './authority-state.js';
import { updateVisualActor } from './contract-movement-director.js';
import { mapPresentationToSource } from './semantic-time-mapper.js';
import { getRepairChoreographyAtTime } from './repair-choreography.js';
import { resolvePresentationStatus } from './presentation-status-resolver.js';
import { buildAuthorityEffects } from './authority-effect-director.js';

export function clampDemoTime(seconds) { return Math.max(0, Math.min(35, Number.isFinite(Number(seconds)) ? Number(seconds) : 0)); }

export function buildContractCaptureState(plan, contract, seconds) {
  const time = clampDemoTime(seconds); const authority = createAuthorityState(contract);
  applyAuthorityAnchorsThrough(authority, plan.anchors, time);
  const actors = plan.actors.map((actor) => updateVisualActor({ ...actor, members: actor.members.map((member) => ({ ...member })) }, time, authority, plan.routeRegistry));
  const actorPositions = Object.fromEntries(actors.map((actor) => [actor.id, actor.visualCenter]));
  const choreography = getRepairChoreographyAtTime(plan, time, actorPositions);
  const repairActor = choreography.repairVehicleId ? actors.find((actor) => actor.id === choreography.repairVehicleId) : null;
  if (repairActor && choreography.repairPosition) {
    repairActor.visualCenter = choreography.repairPosition; repairActor.anchorPosition = choreography.repairPosition;
    repairActor.facing = Math.atan2(choreography.contactPoint.y - choreography.repairPosition.y, choreography.contactPoint.x - choreography.repairPosition.x); repairActor.turretFacing = repairActor.facing;
    if (repairActor.members.length) repairActor.memberPositions = repairActor.members.map((member, index) => ({ x: choreography.repairPosition.x + ([-15, 8, -8, 14][index] || 0), y: choreography.repairPosition.y + ([-10, -7, 8, 10][index] || 0), facing: repairActor.facing, stance: 'stand' }));
  }
  for (const actor of actors) actor.visualStatus = resolvePresentationStatus(actor, authority, plan, time, choreography);
  const wrecks = actors.filter((actor) => actor.type === 'mbt' && !actor.alive).map((actor) => ({ id: `wreck_${actor.id}`, sourceActorId: actor.id, x: actor.visualCenter.x, y: actor.visualCenter.y, angle: actor.facing, createdAt: authority.actors[actor.id].destroyedAt }));
  return { time, authority, actors, wrecks, choreography, finalCompare: compareAuthorityToContractFinal(authority, contract) };
}

export function seekContractDemoState(plan, contract, seconds) { return buildContractCaptureState(plan, contract, seconds); }

export function buildContractTextState(plan, contract, state, showHud = true, debug = false, viewMode = 'overview') {
  const requiredTotal = plan.requiredAnchors.length; const requiredApplied = requiredAppliedCount(state.authority, plan.anchors);
  const enemyEnd = Math.max(0, ...plan.anchors.filter((anchor) => anchor.type === 'destroy' && plan.actorById[anchor.targetId]?.side === 'enemy').map((anchor) => anchor.presentationTime));
  const objectiveProgress = state.time < enemyEnd ? 0 : Math.min(1, (state.time - enemyEnd) / Math.max(.001, plan.duration - enemyEnd));
  const battle = contract.normalizedBattle.battle;
  const activeProjectileCount = buildAuthorityEffects(plan, state.time, state.choreography).filter((effect) => effect.start && effect.end).length;
  return {
    scene: 'contract-driven-road-assault', sourceId: plan.sourceId, sourceKind: plan.sourceKind, rebuildHash: plan.rebuildHash, reportId: battle.id, seed: battle.seed, missionKind: battle.missionKind, missionId: battle.missionId, theaterId: battle.theaterId, strategyId: battle.strategyId,
    result: state.authority.result, capture: state.authority.capture, presentationTime: Number(state.time.toFixed(3)), estimatedSourceTime: Number(mapPresentationToSource(plan.timeMap, state.time).toFixed(3)), viewMode, activeProjectileCount,
    contractValid: contract.validation.ok === true && plan.validation.ok === true, contractSupported: contract.diagnostics.supported === true,
    actorCount: plan.counts.realActors, visualActorCount: plan.counts.visualActors, hud: showHud, debug,
    counts: { actors: plan.counts.realActors, visualActors: plan.counts.visualActors, anchors: plan.counts.anchors, requiredAnchors: requiredTotal, appliedRequiredAnchors: requiredApplied, ...Object.fromEntries(['damage', 'suppress', 'repair', 'destroy', 'result'].map((type) => [type, plan.counts[type]])) },
    requiredAnchors: { total: requiredTotal, applied: requiredApplied }, allAnchors: { total: plan.anchors.length, scheduled: plan.anchors.length },
    actors: state.actors.map((actor) => { const authority = state.authority.actors[actor.id]; return { id: actor.id, side: actor.side, type: actor.type, role: actor.role, slot: actor.templateSlot, hp: authority.hp, maxHp: authority.maxHp, alive: authority.alive, x: Math.round(actor.visualCenter.x), y: Math.round(actor.visualCenter.y), visualStatus: actor.visualStatus }; }),
    objective: { status: state.time >= 35 && state.authority.capture ? 'captured' : state.time >= enemyEnd ? 'contested' : 'neutral', captureProgress: Number(objectiveProgress.toFixed(3)) },
    wrecks: state.wrecks.map((wreck) => ({ sourceActorId: wreck.sourceActorId, x: Math.round(wreck.x), y: Math.round(wreck.y) })), errors: plan.validation.ok ? [] : plan.validation.errors.slice(), authorityLog: debug ? state.authority.authorityLog.slice(-8) : undefined
  };
}
