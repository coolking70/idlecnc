/**
 * Presentation-only action attribution.
 *
 * A missing actorIds field is not a global action.  Formal authority events
 * use actorId for their source actor, while presentation groups may use
 * actorIds.  Global presentation actions must opt in explicitly with
 * scope:'global' (or global:true); this helper never changes the authority
 * action itself.
 */
export function actionAppliesToActor(action, actorId) {
  if (!action || actorId === null || actorId === undefined) return false;
  if (action.actorId !== null && action.actorId !== undefined) return String(action.actorId) === String(actorId);
  if (Array.isArray(action.actorIds)) return action.actorIds.some((id) => String(id) === String(actorId));
  return action.scope === 'global' || action.global === true;
}

export function actionForActor(plan, actorId, seconds) {
  return (plan?.timeline?.actions || [])
    .filter((action) => Number(action.t) <= Number(seconds) + 1e-9 && actionAppliesToActor(action, actorId))
    .at(-1) || null;
}

export function nextActionForActor(plan, actorId, seconds) {
  return (plan?.timeline?.actions || [])
    .filter((action) => Number(action.t) > Number(seconds) && actionAppliesToActor(action, actorId))
    .sort((left, right) => Number(left.t) - Number(right.t) || String(left.id || '').localeCompare(String(right.id || '')))[0] || null;
}

export function isRepairCapableActor(actor = {}) {
  const type = String(actor.type || '').toLowerCase();
  const tags = Array.isArray(actor.tags) ? actor.tags.map((tag) => String(tag).toLowerCase()) : [];
  return type === 'repair_vehicle' || type === 'repair' || tags.includes('repair');
}

export function repairEventRole(event, actorId) {
  if (!event || actorId === null || actorId === undefined) return null;
  if (String(event.actorId) === String(actorId)) return 'source';
  if (String(event.targetId) === String(actorId)) return 'target';
  return null;
}
