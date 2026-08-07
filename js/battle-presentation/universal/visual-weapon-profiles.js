/**
 * 8.2G-A production visual weapons.
 *
 * This module only derives presentation events.  It never writes to a report,
 * authority anchor, unit HP or settlement state.
 */

export const VISUAL_WEAPON_PROFILES = Object.freeze({
  infantry_light: Object.freeze({
    id: 'infantry_light', kind: 'small_arms', label: '步兵轻武器',
    aimDuration: 0.18, fireDuration: 0.08, reloadDuration: 0.42,
    projectileDuration: 0.18, muzzleLife: 0.10, impactLife: 0.28,
    projectileColor: '#f5d27b', impactKind: 'dust', recoil: 0.8, burst: 2,
    presentation: Object.freeze({ muzzleShape: 'small_flash', tracerWidth: 1.5, impactScale: .8, smoke: 'low', persistentMark: 'small_impact_mark' }),
    family: 'infantry_light', minRange: 70, preferredRange: 220, maximumRange: 480,
    validTargetClasses: ['infantry', 'vehicle', 'armor'], canAttack: true, suppressionCapability: true
  }),
  anti_armor_rocket: Object.freeze({
    id: 'anti_armor_rocket', kind: 'rocket', label: '反装甲火箭',
    aimDuration: 0.38, fireDuration: 0.12, reloadDuration: 1.15,
    projectileDuration: 0.34, muzzleLife: 0.16, impactLife: 0.46,
    projectileColor: '#f2b66e', impactKind: 'rocket_impact', recoil: 1.2, burst: 1,
    presentation: Object.freeze({ muzzleShape: 'launch_flash', tracerWidth: 2.5, impactScale: 1.35, smoke: 'short_trail', persistentMark: 'scorch' }),
    family: 'anti_armor', minRange: 120, preferredRange: 360, maximumRange: 680,
    validTargetClasses: ['armor', 'vehicle'], canAttack: true, suppressionCapability: true
  }),
  tank_main_gun: Object.freeze({
    id: 'tank_main_gun', kind: 'cannon', label: '坦克主炮',
    aimDuration: 0.82, fireDuration: 0.16, reloadDuration: 2.45,
    projectileDuration: 0.28, muzzleLife: 0.24, impactLife: 0.78,
    projectileColor: '#fff0a8', impactKind: 'heavy_explosion', recoil: 7, burst: 1,
    presentation: Object.freeze({ muzzleShape: 'large_flash', tracerWidth: 4, impactScale: 2.4, smoke: 'muzzle_smoke', persistentMark: 'crater' }),
    family: 'tank_cannon', minRange: 160, preferredRange: 480, maximumRange: 820,
    validTargetClasses: ['infantry', 'vehicle', 'armor'], canAttack: true, suppressionCapability: true
  }),
  scout_machine_gun: Object.freeze({
    id: 'scout_machine_gun', kind: 'small_arms', label: '侦察车机枪',
    aimDuration: 0.22, fireDuration: 0.08, reloadDuration: 0.66,
    projectileDuration: 0.20, muzzleLife: 0.10, impactLife: 0.30,
    projectileColor: '#e5d889', impactKind: 'dust', recoil: 1.3, burst: 2,
    presentation: Object.freeze({ muzzleShape: 'repeated_flash', tracerWidth: 2.2, impactScale: 1.1, smoke: 'low', persistentMark: 'small_impact_mark' }),
    family: 'scout_autocannon', minRange: 90, preferredRange: 300, maximumRange: 560,
    validTargetClasses: ['infantry', 'vehicle'], canAttack: true, suppressionCapability: true
  }),
  repair_tool: Object.freeze({
    id: 'repair_tool', kind: 'repair', label: '维修工具',
    aimDuration: 0.20, fireDuration: 0.20, reloadDuration: 0.45,
    projectileDuration: 0.20, muzzleLife: 0.12, impactLife: 0.30,
    projectileColor: '#d9f5ff', impactKind: 'welding', recoil: 0, burst: 1,
    presentation: Object.freeze({ muzzleShape: 'repair_spark', tracerWidth: 0, impactScale: .6, smoke: 'none', persistentMark: null }),
    family: 'repair', minRange: 0, preferredRange: 0, maximumRange: 0,
    validTargetClasses: [], canAttack: false, suppressionCapability: false
  })
});

const actorType = (actor) => String(actor?.type || '').toLowerCase();

export function visualWeaponProfile(actor = {}) {
  const type = actorType(actor);
  if (type === 'mbt' || actor.category === 'armor' || actor.tags?.includes?.('armor')) return VISUAL_WEAPON_PROFILES.tank_main_gun;
  if (type === 'at_infantry' || type === 'enemy_at') return VISUAL_WEAPON_PROFILES.anti_armor_rocket;
  if (type === 'scout_car' || type === 'enemy_scout_car') return VISUAL_WEAPON_PROFILES.scout_machine_gun;
  if (type === 'enemy_light_armor') return VISUAL_WEAPON_PROFILES.scout_machine_gun;
  if (type === 'repair_vehicle' || actor.tags?.includes?.('repair')) return VISUAL_WEAPON_PROFILES.repair_tool;
  if (type === 'unknown' || type === 'object' || actor.category === 'support') return VISUAL_WEAPON_PROFILES.repair_tool;
  return VISUAL_WEAPON_PROFILES.infantry_light;
}

/**
 * The choreographer uses this explicit profile instead of treating every
 * unmapped actor as infantry.  It is presentation metadata only; no combat
 * authority is derived from it.
 */
export function combatProfileFor(actor = {}) {
  const weapon = visualWeaponProfile(actor);
  const type = actorType(actor);
  const mapped = ['mbt', 'at_infantry', 'enemy_at', 'scout_car', 'enemy_scout_car', 'enemy_light_armor', 'infantry', 'enemy_infantry'].includes(type) || weapon.id === 'repair_tool';
  return Object.freeze({
    actorId: actor.actorId || actor.id || null,
    actorType: type || 'unknown',
    weaponId: weapon.id,
    weaponFamily: weapon.family,
    canAttack: mapped && weapon.canAttack === true,
    canSuppress: mapped && weapon.suppressionCapability === true,
    minRange: weapon.minRange,
    preferredRange: weapon.preferredRange,
    maximumRange: weapon.maximumRange,
    validTargetClasses: [...(weapon.validTargetClasses || [])],
    mappingStatus: mapped ? 'mapped' : 'unmapped'
  });
}

export const weaponProfileFor = combatProfileFor;

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

export function deterministicUnit(seed, salt = '') {
  return stableHash(`${seed ?? 0}:${salt}`) / 4294967296;
}

function actorsById(plan) {
  return new Map([...(plan?.forces?.friendly || []), ...(plan?.forces?.enemy || [])].map((actor) => [actor.actorId, actor]));
}

function authorityAnchors(plan, type) {
  return (plan?.timeline?.anchors || []).filter((anchor) => !type || anchor.type === type);
}

function matchingFire(fires, anchor) {
  return fires.find((fire) => fire.actorId === anchor.actorId && fire.targetId === anchor.targetId && Number(fire.t) <= Number(anchor.t) + 1e-6 && Number(anchor.t) - Number(fire.t) <= 1.2);
}

/**
 * Builds a stable, presentation-only shot schedule from formal anchors.
 * Damage/destroy anchors without a nearby fire anchor receive a derived shot
 * so the authority event still has a readable visual cause.
 */
function positionAt(positionSampler, actor, seconds) {
  const sampled = typeof positionSampler === 'function' ? positionSampler(actor.actorId, seconds) : null;
  return { ...(sampled || actor.visualCenter || actor.position || { x: 0, y: 0 }) };
}

function projectileFacing(source, impact) {
  const dx = Number(impact?.x || 0) - Number(source?.x || 0);
  const dy = Number(impact?.y || 0) - Number(source?.y || 0);
  return Math.hypot(dx, dy) > .001 ? Math.atan2(dy, dx) : 0;
}

export function buildVisualShotSchedule(plan, positionSampler = null) {
  const actors = actorsById(plan);
  const fires = authorityAnchors(plan, 'fire');
  const combatAnchors = authorityAnchors(plan).filter((anchor) => ['fire', 'damage', 'destroy'].includes(anchor.type));
  const shots = [];
  const seen = new Set();
  for (const anchor of combatAnchors) {
    const attacker = actors.get(anchor.actorId);
    const target = actors.get(anchor.targetId);
    if (!attacker || !target || !anchor.actorId || !anchor.targetId) continue;
    const fire = anchor.type === 'fire' ? anchor : matchingFire(fires, anchor);
    const source = fire || anchor;
    const key = `${source.id}:${source.actorId}:${source.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const weapon = visualWeaponProfile(attacker);
    const impactAnchor = anchor.type === 'fire'
      ? authorityAnchors(plan).find((candidate) => candidate.actorId === anchor.actorId && candidate.targetId === anchor.targetId && ['damage', 'destroy'].includes(candidate.type) && Number(candidate.t) >= Number(anchor.t) && Number(candidate.t) - Number(anchor.t) <= 1.6)
      : anchor;
    const fireTime = Number(source.t) || 0;
    const impactTime = Number(impactAnchor?.t ?? fireTime + weapon.projectileDuration);
    const sourcePositionAtFire = positionAt(positionSampler, attacker, fireTime);
    const targetPositionAtAim = positionAt(positionSampler, target, Math.max(0, fireTime - weapon.aimDuration));
    const impactPositionAtImpact = positionAt(positionSampler, target, impactTime);
    shots.push(Object.freeze({
      id: `visual_shot_${shots.length + 1}_${source.id}`,
      sourceEventId: source.sourceEventId || source.id,
      authorityAnchorId: impactAnchor?.id || null,
      authorityType: impactAnchor?.type || null,
      actorId: attacker.actorId,
      targetId: target.actorId,
      side: attacker.side,
      weaponId: weapon.id,
      weaponKind: weapon.kind,
      weapon: { ...weapon, validTargetClasses: [...(weapon.validTargetClasses || [])] },
      t: Math.max(0, fireTime),
      impactTime: Math.max(fireTime, impactTime),
      sourcePositionAtFire,
      sourceFacingAtFire: projectileFacing(sourcePositionAtFire, impactPositionAtImpact),
      targetPositionAtAim,
      impactPositionAtImpact,
      hitType: impactAnchor?.type === 'destroy' ? 'destroy' : impactAnchor?.type === 'damage' ? 'damage' : 'near_miss',
      presentationOnly: true,
      seed: stableHash(`${plan.source?.seed ?? 0}:${source.id}:${attacker.actorId}:${target.actorId}`)
    }));
  }
  for (const destroy of authorityAnchors(plan, 'destroy')) {
    if (shots.some((shot) => shot.authorityAnchorId === destroy.id)) continue;
    const attacker = actors.get(destroy.actorId); const target = actors.get(destroy.targetId);
    if (!attacker || !target) continue;
    const weapon = visualWeaponProfile(attacker); const fireTime = Math.max(0, Number(destroy.t) - weapon.projectileDuration);
    const sourcePositionAtFire = positionAt(positionSampler, attacker, fireTime);
    const targetPositionAtAim = positionAt(positionSampler, target, Math.max(0, fireTime - weapon.aimDuration));
    const impactPositionAtImpact = positionAt(positionSampler, target, Number(destroy.t) || fireTime);
    shots.push(Object.freeze({
      id: `visual_destroy_shot_${shots.length + 1}_${destroy.id}`, sourceEventId: destroy.sourceEventId || destroy.id, authorityAnchorId: destroy.id,
      authorityType: 'destroy', actorId: attacker.actorId, targetId: target.actorId, side: attacker.side, weaponId: weapon.id, weaponKind: weapon.kind, weapon: { ...weapon, validTargetClasses: [...(weapon.validTargetClasses || [])] },
      t: fireTime, impactTime: Number(destroy.t) || fireTime, sourcePositionAtFire, sourceFacingAtFire: projectileFacing(sourcePositionAtFire, impactPositionAtImpact), targetPositionAtAim, impactPositionAtImpact, hitType: 'destroy', presentationOnly: true,
      seed: stableHash(`${plan.source?.seed ?? 0}:${destroy.id}:${attacker.actorId}:${target.actorId}`)
    }));
  }
  return shots.sort((left, right) => left.t - right.t || left.id.localeCompare(right.id));
}

export function visualWeaponSummary(actor) {
  const profile = visualWeaponProfile(actor);
  return { id: profile.id, kind: profile.kind, family: profile.family, label: profile.label, aimDuration: profile.aimDuration, reloadDuration: profile.reloadDuration, minRange: profile.minRange, maximumRange: profile.maximumRange, canAttack: profile.canAttack };
}
