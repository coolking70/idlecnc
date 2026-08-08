/**
 * Presentation-only weapon topology.  This policy never changes authority
 * shots, routes, target selection or combat outcomes.  It only decides which
 * visual component turns when an actor has an aim/fire direction.
 */
export const PRESENTATION_FACING_POLICY = Object.freeze({
  TURRET_WEAPON: 'turret_weapon',
  BODY_AIMS_WEAPON: 'body_aims_weapon',
  MOVEMENT_ONLY: 'movement_only'
});

export const WEAPON_TOPOLOGY = Object.freeze({
  BODY_MOUNTED: 'body_mounted',
  INDEPENDENT_TURRET: 'independent_turret',
  UNARMED: 'unarmed'
});

const VALID_TOPOLOGIES = new Set(Object.values(WEAPON_TOPOLOGY));

const BODY_AIM_STATES = new Set(['aim', 'fire', 'reload', 'cover_fire']);
export const PROHIBITED_UNARMED_VISUAL_STATES = Object.freeze(['aim', 'fire', 'reload', 'cover_fire']);

function normalizeVisualState(value) {
  return String(value || 'idle').trim().toLowerCase();
}

function unarmedFallbackState(action, fallback = 'idle') {
  const current = normalizeVisualState(action);
  if (['retreat', 'disengage', 'rear_guard', 'withdraw'].includes(current)) return 'retreat';
  if (['move', 'advance', 'take_cover', 'screen', 'repair_approach', 'deploy', 'turn', 'brake'].includes(current)) return 'move';
  return normalizeVisualState(fallback) === 'retreat' ? 'retreat' : 'idle';
}

function finiteFacing(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function resolveWeaponTopology({ actor = {}, visualClass = 'unknown', weaponTopology = null } = {}) {
  const explicit = weaponTopology || actor.weaponTopology || actor.presentationWeaponTopology;
  if (VALID_TOPOLOGIES.has(explicit)) return explicit;
  if (visualClass === 'mbt') return WEAPON_TOPOLOGY.INDEPENDENT_TURRET;
  if (['infantry', 'anti_armor_infantry', 'light_vehicle'].includes(visualClass)) return WEAPON_TOPOLOGY.BODY_MOUNTED;
  return WEAPON_TOPOLOGY.UNARMED;
}

/** Presentation-only capability gate; authority actions and schedules are untouched. */
export function resolvePresentationVisualState({ actor = {}, visualClass = 'unknown', weaponTopology = null, visualState = 'idle', action = null, formalRepair = false, fallback = 'idle' } = {}) {
  const topology = resolveWeaponTopology({ actor, visualClass, weaponTopology });
  const requested = normalizeVisualState(visualState);
  if (topology !== WEAPON_TOPOLOGY.UNARMED || !PROHIBITED_UNARMED_VISUAL_STATES.includes(requested)) {
    return { visualState: requested, weaponTopology: topology, filtered: false, reason: null };
  }
  if (formalRepair) return { visualState: 'repair', weaponTopology: topology, filtered: true, reason: 'formal_repair_event_precedes_generic_fire' };
  return { visualState: unarmedFallbackState(action, fallback), weaponTopology: topology, filtered: true, reason: 'unarmed_combat_visual_prohibited' };
}

export function isPresentationWeaponVisualAllowed({ actor = {}, visualClass = 'unknown', weaponTopology = null, visualState = 'idle' } = {}) {
  const topology = resolveWeaponTopology({ actor, visualClass, weaponTopology });
  return topology !== WEAPON_TOPOLOGY.UNARMED || !PROHIBITED_UNARMED_VISUAL_STATES.includes(normalizeVisualState(visualState));
}

export function resolvePresentationFacingPolicy({ actor = {}, visualClass = 'unknown', weaponTopology = null, visualState = 'idle', movementFacing = 0, aimFacing = null, shot = null } = {}) {
  const topology = resolveWeaponTopology({ actor, visualClass, weaponTopology });
  const policy = topology === WEAPON_TOPOLOGY.INDEPENDENT_TURRET
    ? PRESENTATION_FACING_POLICY.TURRET_WEAPON
    : topology === WEAPON_TOPOLOGY.BODY_MOUNTED
      ? PRESENTATION_FACING_POLICY.BODY_AIMS_WEAPON
      : PRESENTATION_FACING_POLICY.MOVEMENT_ONLY;
  const movement = finiteFacing(movementFacing);
  const aim = finiteFacing(aimFacing, movement);
  const state = String(visualState || actor.visualState || 'idle');
  const aiming = topology !== WEAPON_TOPOLOGY.UNARMED && (BODY_AIM_STATES.has(state) || Boolean(shot));
  const bodyFacing = policy === PRESENTATION_FACING_POLICY.BODY_AIMS_WEAPON && aiming ? aim : movement;
  const weaponFacing = policy === PRESENTATION_FACING_POLICY.MOVEMENT_ONLY
    ? null
    : policy === PRESENTATION_FACING_POLICY.TURRET_WEAPON
      ? aim
      : bodyFacing;
  const turretFacing = policy === PRESENTATION_FACING_POLICY.TURRET_WEAPON ? weaponFacing : null;
  const shotFacing = Number.isFinite(Number(shot?.sourceFacingAtFire)) ? Number(shot.sourceFacingAtFire) : null;
  return {
    policy,
    weaponTopology: topology,
    movementFacing: movement,
    aimFacing: aim,
    bodyFacing,
    weaponFacing,
    facing: bodyFacing,
    turretFacing,
    shotFacing,
    aiming
  };
}

export function presentationFacingPolicyFor(actor = {}, visualClass = null) {
  const resolvedClass = visualClass || actor.visualClass || actor.visualClassName;
  const topology = resolveWeaponTopology({ actor, visualClass: resolvedClass });
  return topology === WEAPON_TOPOLOGY.INDEPENDENT_TURRET
    ? PRESENTATION_FACING_POLICY.TURRET_WEAPON
    : topology === WEAPON_TOPOLOGY.BODY_MOUNTED ? PRESENTATION_FACING_POLICY.BODY_AIMS_WEAPON : PRESENTATION_FACING_POLICY.MOVEMENT_ONLY;
}
