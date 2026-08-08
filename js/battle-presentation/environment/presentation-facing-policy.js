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

const BODY_AIM_STATES = new Set(['aim', 'fire', 'reload', 'cover_fire']);

function finiteFacing(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

export function resolvePresentationFacingPolicy({ actor = {}, visualClass = 'unknown', visualState = 'idle', movementFacing = 0, aimFacing = null, shot = null } = {}) {
  const policy = visualClass === 'mbt'
    ? PRESENTATION_FACING_POLICY.TURRET_WEAPON
    : visualClass === 'infantry' || visualClass === 'anti_armor_infantry' || visualClass === 'light_vehicle'
      ? PRESENTATION_FACING_POLICY.BODY_AIMS_WEAPON
      : PRESENTATION_FACING_POLICY.MOVEMENT_ONLY;
  const movement = finiteFacing(movementFacing);
  const aim = finiteFacing(aimFacing, movement);
  const state = String(visualState || actor.visualState || 'idle');
  const aiming = BODY_AIM_STATES.has(state) || Boolean(shot);
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
  if (resolvedClass === 'mbt') return PRESENTATION_FACING_POLICY.TURRET_WEAPON;
  if (['infantry', 'anti_armor_infantry', 'light_vehicle'].includes(resolvedClass)) return PRESENTATION_FACING_POLICY.BODY_AIMS_WEAPON;
  return PRESENTATION_FACING_POLICY.MOVEMENT_ONLY;
}
