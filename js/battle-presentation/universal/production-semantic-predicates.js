import { PROHIBITED_UNARMED_VISUAL_STATES, WEAPON_TOPOLOGY } from '../environment/presentation-facing-policy.js';

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
    const repairIds = new Set((state?.formalRepairEvents || []).filter((event) => Math.abs(Number(event.t) - seconds) < 1).map((event) => event.targetId));
    const matched = actors.filter((actor) => repairIds.has(actor.id) && (actor.visualState === 'repair' || actor.visualStatus === 'repairing') && actor.drawSpec?.animation === 'repair');
    return result('repair-action', matched.length > 0, matched.map((actor) => actor.id), [], { formalRepairEvent: matched.length > 0 });
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
    const matched = actors.filter((actor) => actor.presentationMode === 'rear_guard_hold' && activeRetreats.some((order) => order.role === 'rear_guard' && (order.actorId === actor.id || (order.actorIds || []).includes(actor.id))));
    const retreatPresent = actors.some((actor) => actor.presentationMode === 'retreat_route' || matched.some((guard) => guard.id === actor.id));
    return result('retreat-rear-guard', matched.length > 0 && retreatPresent, matched.map((actor) => actor.id), activeShots(state).filter((shot) => matched.some((actor) => actor.id === shot.actorId)).map((shot) => shot.id), { retreatPresent, rearGuardPresent: matched.length > 0 });
  }
  return result(id || 'unknown', false, [], [], { reason: 'unknown_semantic_id' });
}
