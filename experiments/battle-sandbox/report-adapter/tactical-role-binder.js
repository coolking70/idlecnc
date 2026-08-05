const ROLE_ORDER = [
  'friendly_scout', 'friendly_north_infantry', 'friendly_south_infantry', 'friendly_at',
  'friendly_lead_armor', 'friendly_support_armor', 'friendly_repair', 'friendly_reserve',
  'enemy_north_infantry', 'enemy_center_infantry', 'enemy_south_infantry', 'enemy_north_at',
  'enemy_south_at', 'enemy_lead_armor', 'enemy_support_armor', 'enemy_reserve'
];

const numeric = (actor, key) => Number(actor?.stats?.[key]) || 0;
const stable = (rows) => rows.slice().sort((a, b) => (a._index - b._index) || a.id.localeCompare(b.id));
const infantry = (actor) => actor.category === 'infantry' && actor.type !== 'at_infantry';
const antiTank = (actor) => actor.type === 'at_infantry' || numeric(actor, 'antiArmor') > numeric(actor, 'attack');
const armor = (actor) => actor.category === 'armor' || actor.type.includes('armor') || actor.type === 'mbt' || actor.type === 'scout_car';

export function bindTacticalRoles(normalized) {
  const roles = Object.fromEntries(ROLE_ORDER.map((role) => [role, null]));
  const actorRoles = {};
  const reserves = { friendly: [], enemy: [] };
  const conflicts = [];
  const missingRoles = {};
  const occupied = new Set();
  const all = [...(normalized?.actors?.friendly || []), ...(normalized?.actors?.enemy || [])].map((actor, _index) => ({ ...actor, _index }));
  const candidates = (side, predicate) => stable(all.filter((actor) => actor.side === side && !occupied.has(actor.id) && predicate(actor)));
  const assign = (role, actor) => {
    if (!actor) return;
    if (occupied.has(actor.id)) { conflicts.push({ role, actorId: actor.id, reason: 'actor already assigned' }); return; }
    roles[role] = actor.id; occupied.add(actor.id);
    actorRoles[actor.id] = [...(actorRoles[actor.id] || []), role];
  };
  const assignBest = (role, side, predicate, score = () => 0) => {
    const list = candidates(side, predicate).sort((a, b) => (score(b) - score(a)) || (a._index - b._index) || a.id.localeCompare(b.id));
    assign(role, list[0]);
  };

  assignBest('friendly_scout', 'friendly', (actor) => actor.category === 'vehicle' && actor.type !== 'repair_vehicle', (actor) => numeric(actor, 'scouting'));
  assignBest('friendly_lead_armor', 'friendly', armor, (actor) => numeric(actor, 'attack'));
  assignBest('friendly_support_armor', 'friendly', armor, (actor) => numeric(actor, 'defense'));
  assignBest('friendly_repair', 'friendly', (actor) => numeric(actor, 'repair') > 0 || actor.category === 'support', (actor) => numeric(actor, 'repair'));
  assignBest('friendly_at', 'friendly', antiTank, (actor) => numeric(actor, 'antiArmor'));
  const friendlyInf = candidates('friendly', infantry);
  assign('friendly_north_infantry', friendlyInf[0]);
  assign('friendly_south_infantry', friendlyInf[1]);

  const enemyInf = candidates('enemy', infantry);
  assign('enemy_north_infantry', enemyInf[0]);
  assign('enemy_center_infantry', enemyInf[1]);
  assign('enemy_south_infantry', enemyInf[2]);
  const enemyAt = candidates('enemy', antiTank);
  assign('enemy_north_at', enemyAt[0]);
  assign('enemy_south_at', enemyAt[1]);
  assignBest('enemy_lead_armor', 'enemy', armor, (actor) => numeric(actor, 'attack'));
  assignBest('enemy_support_armor', 'enemy', armor, (actor) => numeric(actor, 'defense'));

  for (const actor of all) {
    if (occupied.has(actor.id)) continue;
    const side = actor.side;
    reserves[side].push(actor.id);
    if (!roles[`${side}_reserve`]) assign(`${side}_reserve`, actor);
    else {
      actorRoles[actor.id] = [...(actorRoles[actor.id] || []), `${side}_reserve`];
      occupied.add(actor.id);
    }
  }
  for (const role of ROLE_ORDER) if (!roles[role]) missingRoles[role] = `${role} has no eligible actor in the report`;
  return { roleOrder: ROLE_ORDER.slice(), roles, actorRoles, reserves, missingRoles, conflicts };
}

export const bindRoles = bindTacticalRoles;
