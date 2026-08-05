export const VISUAL_DAMAGE_STATES = Object.freeze(['intact', 'hit', 'damaged', 'being_repaired', 'stabilized', 'disabled']);

export function createVisualDamageState() {
  return { state: 'intact', smokeLevel: 0, mobilityMultiplier: 1, turretOperational: true, repairedFraction: 0, hitAt: null, repairAt: null, disabledPose: { bodyTilt: 0, turretAngleOffset: 0, suspensionDrop: 0, smokeLevel: 0 } };
}

export function applyVisualHit(damage, time, options = {}) {
  damage.state = 'hit'; damage.hitAt = time; damage.smokeLevel = options.smokeLevel ?? 0.75; damage.mobilityMultiplier = options.mobilityMultiplier ?? 0.45; damage.turretOperational = options.turretOperational ?? true;
  return damage;
}

export function applyDisabledPose(damage) {
  damage.state = 'disabled'; damage.turretOperational = false; damage.mobilityMultiplier = 0; damage.smokeLevel = 0.55;
  damage.disabledPose = { bodyTilt: 0.14, turretAngleOffset: -0.45, suspensionDrop: 4, smokeLevel: 0.55 };
  return damage;
}

export function updateVisualDamage(damage, time, options = {}) {
  if (!damage.hitAt) return damage;
  const repairAt = options.repairAt ?? 16.2; const stabilizedAt = options.stabilizedAt ?? 19;
  damage.repairAt = repairAt;
  if (time < damage.hitAt + 0.25) damage.state = 'hit';
  else if (time < repairAt) damage.state = 'damaged';
  else if (time < stabilizedAt) damage.state = 'being_repaired';
  else damage.state = 'stabilized';
  if (time < repairAt) damage.smokeLevel = 0.75;
  else damage.smokeLevel = Math.max(0.22, 0.75 - ((time - repairAt) / Math.max(0.001, stabilizedAt - repairAt)) * 0.53);
  damage.mobilityMultiplier = time >= stabilizedAt ? 0.72 : 0.45;
  damage.repairedFraction = time >= stabilizedAt ? 0.45 : 0;
  return damage;
}

export function visualMobilityMultiplier(damage) { return damage?.mobilityMultiplier ?? 1; }
