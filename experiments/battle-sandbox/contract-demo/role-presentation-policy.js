const TEMPORARY = new Set(['hit', 'being_repaired', 'repairing', 'suppressed', 'firing', 'repair_recovering']);

function hpRatio(authority) { return authority?.maxHp ? authority.hp / authority.maxHp : 0; }
function isInfantryRole(role) { return ['friendly_north_infantry', 'friendly_south_infantry', 'friendly_at'].includes(role); }

export function getFinalRoleStatus(actor, authority, plan) {
  if (!authority) return 'unknown';
  if (!authority.alive) return 'destroyed';
  const ratio = hpRatio(authority);
  if (actor.side === 'enemy') return 'invalid_enemy_alive';
  if (actor.role === 'friendly_scout') return 'scanning';
  if (isInfantryRole(actor.role)) return 'holding_objective';
  if (actor.role === 'friendly_lead_armor') return ratio < 0.5 ? 'damaged_holding' : 'overwatch';
  if (actor.role === 'friendly_support_armor') return ratio < 0.5 ? 'damaged_overwatch' : 'overwatch';
  if (actor.role === 'friendly_repair') return ratio < 0.5 ? 'damaged_support_holding' : 'support_holding';
  return actor.type === 'repair_vehicle' ? (ratio < 0.5 ? 'damaged_support_holding' : 'support_holding') : 'holding_objective';
}

function fireWindow(plan, actorId, time) { return plan.anchors.some((anchor) => anchor.type === 'fire' && anchor.actorId === actorId && time >= anchor.presentationTime && time <= anchor.presentationTime + (anchor.duration || .18)); }

export function resolveRolePresentationStatus(actor, authority, plan, time, choreography = null) {
  if (!authority) return 'unknown';
  if (!authority.alive) return 'destroyed';
  if (choreography?.active && choreography.targetId === actor.id && choreography.state === 'working') return 'being_repaired';
  if (choreography?.active && choreography.repairVehicleId === actor.id && ['deploying', 'working', 'retracting'].includes(choreography.state)) return 'repairing';
  if (time < authority.suppressedUntil) return 'suppressed';
  if (authority.lastDamage && time - authority.lastDamage.at <= .75) return 'hit';
  if (authority.lastRepair && time - authority.lastRepair.at <= .65) return 'repair_recovering';
  if (fireWindow(plan, actor.id, time)) return 'firing';
  if (time >= plan.duration - 1e-7) return getFinalRoleStatus(actor, authority, plan);
  if (actor.role === 'friendly_scout' && time >= plan.duration - 3) return 'scanning';
  if (actor.side === 'enemy') return 'defending';
  return 'moving';
}

export function validateRolePresentationPolicy(plan) {
  const errors = [];
  for (const actor of plan.actors || []) {
    const authority = plan.finalAuthority?.actors?.[actor.id];
    if (!authority) continue;
    const finalStatus = getFinalRoleStatus(actor, authority, plan);
    if (plan.result === 'victory' && actor.side === 'enemy' && authority.alive) errors.push(`${actor.id} is an enemy alive in victory plan`);
    if (finalStatus === 'invalid_enemy_alive') errors.push(`${actor.id} has invalid final enemy status`);
  }
  return { ok: errors.length === 0, errors };
}

export function isTemporaryPresentationStatus(status) { return TEMPORARY.has(status); }
export { TEMPORARY };
