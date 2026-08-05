import { SANDBOX_SEED, fixedSeedSequence } from './sandbox-config.js';

export const PULSE_SCHEDULES = Object.freeze({
  f_inf_1: [7.40, 7.58, 7.76, 8.02, 8.24, 8.72, 10.18, 10.58, 10.98, 14.85, 15.20, 15.65, 16.10, 16.60, 17.20, 18.00, 19.00, 22.55, 23.00, 23.45, 23.90],
  e_inf_1: [7.48, 7.69, 7.91, 8.16, 8.36, 8.78, 10.95, 11.18, 11.45, 14.20, 15.00, 16.00, 17.20, 18.20, 22.90, 23.35, 23.80],
  f_inf_2: [7.60, 7.78, 8.00, 8.21, 8.46, 8.72, 9.02, 9.28, 9.55, 9.82, 10.16, 10.55, 10.90, 11.40, 11.85, 12.35, 13.10, 13.80, 14.60, 15.30, 16.20, 17.10, 18.15, 19.20, 24.45, 24.95, 25.45, 25.95],
  f_tank_2: [8.70, 8.82, 8.96, 9.18, 9.32, 9.51, 9.70, 9.88, 10.20, 10.80, 11.40, 12.10, 13.00, 14.00, 15.10, 16.10, 17.20, 18.20, 19.10, 23.05, 23.35, 23.75, 24.40, 25.10, 25.80, 26.50],
  e_armor_1: [11.05, 11.40, 14.60, 15.30, 16.40, 17.20, 18.00],
  e_inf_3: [10.40, 11.00, 12.10, 13.10, 15.10, 17.10, 18.10, 19.10, 22.70, 23.10, 23.60, 24.10, 26.90, 27.50],
  f_inf_1_objective: [22.45, 22.78, 23.12, 23.46, 23.80],
  f_inf_2_objective: [24.35, 24.75, 25.15, 25.55, 25.95]
});

function actionKey(action) { return typeof action === 'string' ? action : action?.key || action?.source || action?.id; }

export function buildPulseTimes(action, seed = SANDBOX_SEED) {
  const key = actionKey(action);
  const baseTimes = PULSE_SCHEDULES[key] || [];
  const lifetime = typeof action === 'object' && action.lifetime ? action.lifetime : 0.14;
  const rng = fixedSeedSequence(seed + [...String(key)].reduce((sum, char) => sum + char.charCodeAt(0), 0));
  return baseTimes.map((start, index) => ({ start: Number((start + (rng() - 0.5) * 0.02).toFixed(3)), lifetime, index, member: index % 2, spread: Number(((rng() - 0.5) * 12).toFixed(2)) })).sort((a, b) => a.start - b.start);
}

export function getActivePulses(action, elapsed, seed = SANDBOX_SEED) {
  return buildPulseTimes(action, seed).filter((pulse) => pulse.start <= elapsed && elapsed <= pulse.start + pulse.lifetime);
}

export function pulseSignature(seed = SANDBOX_SEED) {
  return JSON.stringify(Object.keys(PULSE_SCHEDULES).map((key) => [key, buildPulseTimes(key, seed)]));
}
