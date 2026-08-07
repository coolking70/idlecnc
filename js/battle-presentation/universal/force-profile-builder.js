import { numberOr } from './universal-plan-schema.js';

function capability(actor) {
  const s = actor?.stats || {};
  const type = String(actor?.type || '');
  const armor = actor.category === 'armor' || actor.type === 'mbt' || /armor/i.test(type);
  const repair = numberOr(s.repair) > 0 || actor.type === 'repair_vehicle';
  return {
    combat: numberOr(s.attack) > 0 || numberOr(s.antiArmor) > 0,
    antiArmor: numberOr(s.antiArmor) > 0 || actor.type === 'at_infantry',
    scout: numberOr(s.scouting) > 0 && !repair && (actor.type === 'scout_car' || actor.type === 'enemy_scout_car' || actor.category === 'vehicle' && !armor),
    armor,
    vehicle: ['vehicle', 'armor', 'support'].includes(actor.category) || armor,
    repair,
    mobile: numberOr(s.mobility) >= 10,
    durable: numberOr(s.defense) >= 20
  };
}

export function buildForceProfile(actor, index = 0) {
  const tags = capability(actor);
  const primary = tags.repair ? 'repair' : tags.scout ? 'scout' : tags.armor ? 'armor' : tags.antiArmor ? 'anti_armor' : tags.combat ? 'line' : 'reserve';
  const tagList = Object.entries({ infantry: actor.category === 'infantry' || actor.type === 'at_infantry', anti_armor: tags.antiArmor, scout: tags.scout, armor: tags.armor, vehicle: tags.vehicle, repair: tags.repair, combat: tags.combat, support: tags.repair || actor.category === 'support', high_mobility: tags.mobile, high_defense: tags.durable, long_range_visual: numberOr(actor.stats?.attack) >= 25 || numberOr(actor.stats?.antiArmor) >= 20 }).filter(([, value]) => value).map(([key]) => key);
  const combatPower = numberOr(actor.stats?.attack); const antiArmorPower = numberOr(actor.stats?.antiArmor); const supportPower = numberOr(actor.stats?.repair);
  return {
    actorId: actor.id, side: actor.side, type: actor.type, category: actor.category, name: actor.name,
    index, primary, tags: tagList, capabilities: tags, initial: actor.initial, final: actor.final,
    footprint: tags.armor ? { width: 42, height: 26, radius: 23 } : tags.vehicle ? { width: 34, height: 22, radius: 19 } : { width: 26, height: 20, radius: 15 },
    preferredRange: tags.antiArmor || tags.armor ? 'long' : tags.repair ? 'support' : 'mid',
    mobilityClass: tags.mobile ? 'high' : numberOr(actor.stats?.mobility) >= 6 ? 'medium' : 'low',
    combatPower, antiArmorPower, supportPower, survivability: numberOr(actor.stats?.defense) + numberOr(actor.initial?.maxHp),
    mobility: numberOr(actor.stats?.mobility), defense: numberOr(actor.stats?.defense)
  };
}

export function buildForces(normalized) {
  const stable = (rows) => rows.slice().sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.type).localeCompare(String(b.type)) || String(a.id).localeCompare(String(b.id)));
  const friendly = stable(normalized?.actors?.friendly || []).map((actor, i) => buildForceProfile(actor, i));
  const enemy = stable(normalized?.actors?.enemy || []).map((actor, i) => buildForceProfile(actor, i));
  const count = (rows, key) => rows.filter((row) => row.tags.includes(key)).length;
  const all = [...friendly, ...enemy]; const combatActorCount = all.filter((row) => row.tags.includes('combat')).length;
  const counts = Object.fromEntries(['infantry', 'anti_armor', 'scout', 'armor', 'vehicle', 'repair', 'support'].map((key) => [key, count(all, key)]));
  const archetype = friendly.length <= 2 ? 'light_force' : counts.armor >= Math.max(2, counts.infantry) ? 'armor_heavy' : counts.scout >= Math.max(2, Math.ceil(friendly.length / 2)) ? 'recon_heavy' : counts.repair >= Math.max(2, Math.ceil(friendly.length / 2)) ? 'support_heavy' : counts.infantry >= Math.max(3, counts.armor * 2) ? 'infantry_heavy' : counts.armor && counts.infantry ? 'balanced' : 'mixed';
  return {
    friendly, enemy,
    roleGroups: { friendly: {}, enemy: {} },
    profile: { friendlyCount: friendly.length, enemyCount: enemy.length, totalCount: friendly.length + enemy.length, combatActorCount, counts, archetype, friendlyCapabilities: { scout: count(friendly, 'scout'), armor: count(friendly, 'armor'), repair: count(friendly, 'repair') }, enemyCapabilities: { scout: count(enemy, 'scout'), armor: count(enemy, 'armor'), antiArmor: count(enemy, 'anti_armor') } }
  };
}
