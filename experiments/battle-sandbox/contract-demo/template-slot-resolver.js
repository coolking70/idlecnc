export const TEMPLATE_ID = 'road_assault_v1_infantry_defense';

const SLOT_BINDINGS = Object.freeze([
  ['friendly_scout_flank', 'friendly_scout'],
  ['friendly_north_assault', 'friendly_north_infantry'],
  ['friendly_south_infantry_assault', 'friendly_south_infantry'],
  ['friendly_south_at_assault', 'friendly_at'],
  ['friendly_lead_tank', 'friendly_lead_armor'],
  ['friendly_support_tank', 'friendly_support_armor'],
  ['friendly_repair_rear', 'friendly_repair'],
  ['enemy_north_cover', 'enemy_north_infantry'],
  ['enemy_center_checkpoint', 'enemy_center_infantry'],
  ['enemy_south_cover', 'enemy_south_infantry'],
  ['enemy_rear_reserve', 'enemy_reserve'],
  ['enemy_north_at_nest', 'enemy_north_at'],
  ['enemy_south_at_nest', 'enemy_south_at']
]);

export function resolveTemplateSlots(contract) {
  const errors = [];
  const actorToSlot = {}; const slotToActor = {};
  const actors = [...(contract?.normalizedBattle?.actors?.friendly || []), ...(contract?.normalizedBattle?.actors?.enemy || [])];
  const actorIds = new Set(actors.map((actor) => actor.id));
  const slots = [];
  for (const [slotId, role] of SLOT_BINDINGS) {
    const actorId = contract?.roleBinding?.roles?.[role] || null;
    if (!actorId) continue;
    if (!actorIds.has(actorId)) { errors.push(`slot ${slotId} references unknown actor ${actorId}`); continue; }
    if (actorToSlot[actorId]) errors.push(`actor ${actorId} occupies ${actorToSlot[actorId]} and ${slotId}`);
    if (slotToActor[slotId]) errors.push(`slot ${slotId} is duplicated`);
    actorToSlot[actorId] = slotId; slotToActor[slotId] = actorId;
    slots.push({ slotId, role, actorId, side: actors.find((actor) => actor.id === actorId)?.side || null });
  }
  const mapped = new Set(Object.keys(actorToSlot));
  const missingOptionalSlots = Object.keys(contract?.roleBinding?.missingRoles || {}).map((role) => role);
  const unmapped = actors.filter((actor) => !mapped.has(actor.id));
  const reserveCounters = { friendly: 0, enemy: 0 };
  for (const actor of unmapped) {
    reserveCounters[actor.side] += 1;
    const index = reserveCounters[actor.side];
    const role = contract?.roleBinding?.actorRoles?.[actor.id]?.[0] || `${actor.side}_reserve`;
    const slotId = `${actor.side}_reserve_${index}`;
    actorToSlot[actor.id] = slotId; slotToActor[slotId] = actor.id; slots.push({ slotId, role, actorId: actor.id, side: actor.side });
  }
  return { templateId: TEMPLATE_ID, actorToSlot, slotToActor, slots, missingOptionalSlots, errors };
}

export { SLOT_BINDINGS };
