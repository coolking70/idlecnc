export const OBJECTIVE_TIMELINE = Object.freeze({ contestedAt: 28, capturedAt: 31.5 });
export const TIME_EPSILON = 1e-6;
const CAPTURE_KEYS = Object.freeze([{ t: 28, p: 0 }, { t: 29, p: 0.3 }, { t: 30, p: 0.65 }, { t: 31, p: 0.9 }, { t: 31.5, p: 1 }]);

export function getCaptureProgress(time) {
  const safeTime = Number.isFinite(time) ? time : 0;
  if (safeTime < OBJECTIVE_TIMELINE.contestedAt - TIME_EPSILON) return 0;
  if (safeTime >= OBJECTIVE_TIMELINE.capturedAt - TIME_EPSILON) return 1;
  for (let index = 1; index < CAPTURE_KEYS.length; index += 1) {
    const previous = CAPTURE_KEYS[index - 1]; const next = CAPTURE_KEYS[index];
    if (safeTime <= next.t + TIME_EPSILON) return Math.max(0, Math.min(1, previous.p + (next.p - previous.p) * ((safeTime - previous.t) / (next.t - previous.t))));
  }
  return 1;
}

export function getObjectiveStateAtTime(time) {
  const progress = getCaptureProgress(time);
  const safeTime = Number.isFinite(time) ? time : 0;
  return { status: progress >= 1 - TIME_EPSILON ? 'captured' : safeTime >= OBJECTIVE_TIMELINE.contestedAt - TIME_EPSILON ? 'contested' : 'neutral', progress: progress >= 1 - TIME_EPSILON ? 1 : progress };
}

export function getFlagHeight(time) { return 42 * getCaptureProgress(time); }

export function getObjectiveLightColor(time) {
  const progress = getCaptureProgress(time);
  if (progress >= 1) return '#72d39a';
  if (progress > 0) return '#e9a15c';
  return '#d4685e';
}
