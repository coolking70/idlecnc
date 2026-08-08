import { PROHIBITED_UNARMED_VISUAL_STATES, WEAPON_TOPOLOGY } from '../environment/presentation-facing-policy.js';
import { isRepairCapableActor } from './presentation-action-attribution.js';

const lower = (value) => String(value || '').toLowerCase();
const activeAt = (item, seconds) => Number(seconds) >= Number(item?.start ?? item?.t ?? item?.time ?? 0) - 1e-6 && Number(seconds) <= Number(item?.end ?? item?.impactTime ?? item?.t ?? item?.time ?? 0) + 1e-6;
const actorClass = (actor) => lower(actor?.drawSpec?.visualClass || actor?.visualClass || actor?.type);
const actorName = (actor) => `${actorClass(actor)} ${lower(actor?.type)} ${lower(actor?.role)}`;

function activeShots(state) {
  const seconds = Number(state?.time) || 0;
  return (state?.shotSchedule || []).filter((shot) => seconds >= Number(shot.t || 0) - Number(shot.weapon?.aimDuration || 0) && seconds <= Number(shot.impactTime || shot.t || 0) + Number(shot.weapon?.impactLife || .12));
}

function result(id, passed, matchedActorIds = [], matchedShotIds = [], details = {}) {
  return { id, passed: Boolean(passed), matchedActorIds: [...new Set(matchedActorIds)].sort(), matchedShotIds: [...new Set(matchedShotIds)].sort(), details };
}

export const PRODUCTION_SEMANTIC_IDS = Object.freeze(['scout-move', 'scout-fire', 'repair-action', 'support-unarmed', 'cover-advance', 'retreat-rear-guard']);

export function evaluateProductionSemanticPredicate(name, state) {
  const id = lower(name).replace(/_/g, '-');
  const actors = state?.actors || [];
  const seconds = Number(state?.time) || 0;
  if (id.includes('scout-move')) {
    const matched = actors.filter((actor) => actorName(actor).includes('scout') && actor.visualState === 'move' && actor.drawSpec?.animation === 'move');
    return result('scout-move', matched.length > 0, matched.map((actor) => actor.id), [], { state: 'move', animation: 'move' });
  }
  if (id.includes('scout-fire')) {
    const shots = activeShots(state);
    const matched = actors.filter((actor) => actorName(actor).includes('scout') && actor.visualState === 'fire' && actor.firing === true && actor.weaponTopology !== WEAPON_TOPOLOGY.UNARMED && actor.drawSpec?.animation === 'fire');
    const shotIds = shots.filter((shot) => matched.some((actor) => actor.id === shot.actorId)).map((shot) => shot.id);
    return result('scout-fire', matched.length > 0 && shotIds.length > 0, matched.map((actor) => actor.id), shotIds, { state: 'fire', activeShot: shotIds.length > 0 });
  }
  if (id.includes('repair')) {
    const events = (state?.formalRepairEvents || []).filter((event) => seconds >= Number(event.t) - 1e-6 && seconds <= Number(event.t) + .42 + 1e-6 && event.sourceActorId && event.targetActorId);
    for (const event of events) {
      const source = actors.find((actor) => actor.id === event.sourceActorId);
      const target = actors.find((actor) => actor.id === event.targetActorId);
      const sourceBound = Boolean(source && source.id === event.sourceActorId && isRepairCapableActor(source) && source.repairSource === true && source.formalRepairSourceActive === true && source.visualState === 'repair' && source.visualStatus === 'repairing' && source.drawSpec?.animation === 'repair');
      const targetBound = Boolean(target && target.id === event.targetActorId && target.id !== event.sourceActorId && target.repairTargeted === true && target.visualStatus === 'being_repaired' && target.drawSpec?.animation !== 'repair');
      if (sourceBound && targetBound) return { ...result('repair-action', true, [source.id, target.id], [], { formalRepairEvent: true, formalRepairEventId: event.id || null, sourceActorId: source.id, targetActorId: target.id, sourceType: source.type || null, targetType: target.type || null, sourceAnimation: source.drawSpec.animation, sourceVisualState: source.visualState, targetBound: true, targetAnimation: target.drawSpec?.animation || null }), repairSourceActorId: source.id, repairTargetActorId: target.id, sourceAnimation: source.drawSpec.animation, sourceVisualState: source.visualState, targetBound: true, formalRepairEventId: event.id || null };
    }
    return { ...result('repair-action', false, [], [], { formalRepairEvent: false, targetBound: false, reason: 'repair_source_target_binding_missing' }), repairSourceActorId: null, repairTargetActorId: null, sourceAnimation: null, sourceVisualState: null, targetBound: false, formalRepairEventId: null };
  }
  if (id.includes('support')) {
    const matched = actors.filter((actor) => actorName(actor).includes('support') && actor.weaponTopology === WEAPON_TOPOLOGY.UNARMED && !PROHIBITED_UNARMED_VISUAL_STATES.includes(lower(actor.visualState)) && actor.firing !== true && actor.aiming !== true && actor.reloading !== true);
    return result('support-unarmed', matched.length > 0, matched.map((actor) => actor.id), [], { prohibitedStates: PROHIBITED_UNARMED_VISUAL_STATES });
  }
  if (id.includes('cover-advance')) {
    const activeMoves = (state?.engagementSchedule?.coverMoves || []).filter((move) => activeAt(move, seconds));
    const matched = actors.filter((actor) => actor.presentationMode === 'cover_advance' && activeMoves.some((move) => (move.maneuverGroupIds || []).includes(actor.id)));
    return result('cover-advance', matched.length > 0, matched.map((actor) => actor.id), [], { activeMoveCount: activeMoves.length });
  }
  if (id.includes('retreat') || id.includes('rear-guard')) {
    const activeRetreats = (state?.engagementSchedule?.retreatOrders || []).filter((order) => activeAt(order, seconds));
    const retreatActorIds = activeRetreats.filter((order) => order.role !== 'rear_guard').map((order) => order.actorId).filter((actorId) => actors.some((actor) => actor.id === actorId && actor.presentationMode === 'retreat_route'));
    const rearGuardActorIds = activeRetreats.filter((order) => order.role === 'rear_guard').map((order) => order.actorId).filter((actorId) => actors.some((actor) => actor.id === actorId && actor.presentationMode === 'rear_guard_hold'));
    const distinctPair = retreatActorIds.some((actorId) => rearGuardActorIds.every((guardId) => guardId !== actorId));
    const matchedActorIds = [...new Set([...retreatActorIds, ...rearGuardActorIds])];
    return result('retreat-rear-guard', retreatActorIds.length > 0 && rearGuardActorIds.length > 0 && distinctPair, matchedActorIds, activeShots(state).filter((shot) => rearGuardActorIds.includes(shot.actorId)).map((shot) => shot.id), { retreatPresent: retreatActorIds.length > 0, rearGuardPresent: rearGuardActorIds.length > 0, retreatActorIds, rearGuardActorIds, distinctPair });
  }
  return result(id || 'unknown', false, [], [], { reason: 'unknown_semantic_id' });
}
