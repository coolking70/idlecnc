import { SANDBOX_SEED } from './sandbox-config.js';
import { createSandboxState, synchronizeSandboxStateAtTime, updateSandboxState, SANDBOX_DURATION } from './sandbox-director.js';
import { TIME_EPSILON } from './sandbox-objective-director.js';

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

export function seekSandboxState(seconds, { step = 1 / 120, seed = SANDBOX_SEED } = {}) {
  const requested = Number(seconds);
  const target = clamp(Number.isFinite(requested) ? requested : 0, 0, SANDBOX_DURATION);
  const logicStep = Number.isFinite(step) && step > 0 ? step : 1 / 120;
  const state = createSandboxState(seed);
  state.paused = false;
  while (state.time < target - TIME_EPSILON && !state.ended) {
    const remaining = target - state.time;
    updateSandboxState(state, Math.min(logicStep, remaining));
  }
  state.time = target;
  synchronizeSandboxStateAtTime(state, target);
  if (target >= SANDBOX_DURATION - TIME_EPSILON) {
    state.time = SANDBOX_DURATION;
    state.ended = true;
  }
  state.paused = true;
  return state;
}

export function buildCaptureState(seconds, options = {}) {
  return seekSandboxState(seconds, options);
}

export function validateCaptureState(state, expectedSeconds) {
  const expected = clamp(Number.isFinite(Number(expectedSeconds)) ? Number(expectedSeconds) : 0, 0, SANDBOX_DURATION);
  const errors = [];
  if (!state || Math.abs(state.time - expected) > 0.000001) errors.push('actual time differs from requested time');
  if (!state?.paused) errors.push('capture state must be paused');
  if (expected >= SANDBOX_DURATION - TIME_EPSILON && !state?.ended) errors.push('35 second capture must be ended');
  if (expected >= 31.5 - TIME_EPSILON && state?.objective?.status !== 'captured') errors.push('late capture must be captured');
  return { ok: errors.length === 0, expectedTime: expected, actualTime: state?.time ?? null, errors };
}

export function getVisualBounds(actor) {
  const center = actor?.visualCenter || actor || { x: 0, y: 0 };
  const x = Number.isFinite(center.x) ? center.x : 0;
  const y = Number.isFinite(center.y) ? center.y : 0;
  return { left: x - 26, right: x + 26, top: y - 16, bottom: y + 16 };
}

export function boundsIntersect(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
