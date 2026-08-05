import { fixedSeedSequence, SANDBOX_SEED } from './sandbox-config.js';

export const WORK_POSITION = Object.freeze({ x: 480, y: 500 });
export const REPAIR_PATH = Object.freeze([{ t: 12, x: 320, y: 540 }, { t: 13, x: 365, y: 520 }, { t: 14, x: 415, y: 500 }, { t: 15, x: 465, y: 485 }, { t: 16.2, x: 500, y: 475 }, { t: 19.5, x: 500, y: 475 }, { t: 20, x: 480, y: 500 }, { t: 20.8, x: 480, y: 500 }]);
export const WELDING_PULSE_TIMES = Object.freeze([16.35, 16.58, 16.90, 17.25, 17.62, 18.00, 18.36, 18.72]);

export function getRepairActionAtTime(elapsed) {
  if (elapsed < 12) return 'holding';
  if (elapsed < 15.6) return 'moving_to_repair';
  if (elapsed < 16.2) return 'positioning';
  if (elapsed < 19) return 'repairing';
  if (elapsed < 20.8) return elapsed < 20 ? 'holding_repair_position' : elapsed < 20.8 ? 'retracting_repair_arm' : 'withdrawing_from_repair';
  if (elapsed < 22) return 'withdrawing_from_repair';
  if (elapsed < 30.5) return 'support_holding';
  if (elapsed < 34.5) return 'following_damaged_tank';
  return 'support_holding';
}

export function getRepairArmPose(elapsed) {
  const amount = Math.max(0, Math.min(1, (elapsed - 16.2) / 0.8));
  const retract = elapsed < 19 ? amount : Math.max(0, 1 - (elapsed - 19) / 1.8);
  return { extension: retract, angle: -0.85 + retract * 0.25, active: elapsed >= 16.2 && elapsed < 19 };
}

export function getRepairContactPoint(repair, tank) {
  const amount = 0.92;
  return { x: repair.x + (tank.x - repair.x) * amount, y: repair.y + (tank.y - repair.y) * amount };
}

export function buildWeldingPulses(seed = SANDBOX_SEED) {
  const rng = fixedSeedSequence(seed + 271);
  return WELDING_PULSE_TIMES.map((time, index) => ({ time: Number((time + (rng() - 0.5) * 0.02).toFixed(3)), lifetime: 0.14, index }));
}

export function getSmokeLevelAtTime(elapsed) {
  if (elapsed < 11.45) return 0;
  if (elapsed < 16.2) return 0.75;
  return Math.max(0.22, 0.75 - ((elapsed - 16.2) / 2.8) * 0.53);
}

export function interpolateRepairPath(elapsed) {
  if (elapsed <= REPAIR_PATH[0].t) return { x: 320, y: 540, angle: 0 };
  for (let index = 1; index < REPAIR_PATH.length; index += 1) {
    const a = REPAIR_PATH[index - 1]; const b = REPAIR_PATH[index];
    if (elapsed <= b.t) { const p = (elapsed - a.t) / (b.t - a.t); return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, angle: Math.atan2(b.y - a.y, b.x - a.x) }; }
  }
  const last = REPAIR_PATH[REPAIR_PATH.length - 1]; return { x: last.x, y: last.y, angle: 0 };
}
