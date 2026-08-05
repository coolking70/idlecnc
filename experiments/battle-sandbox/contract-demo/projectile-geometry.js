const MAX_SEGMENT_LENGTH = 40;
const EPSILON = 1e-9;

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
export function pointOnLine(start, end, progress) { const p = clamp(progress); return { x: start.x + (end.x - start.x) * p, y: start.y + (end.y - start.y) * p }; }
export function pointOnQuadraticCurve(start, control, end, progress) { const p = clamp(progress); const inverse = 1 - p; return { x: inverse * inverse * start.x + 2 * inverse * p * control.x + p * p * end.x, y: inverse * inverse * start.y + 2 * inverse * p * control.y + p * p * end.y }; }
export function getProjectileSegment(start, end, progress, segmentLength) { const head = pointOnLine(start, end, progress); const total = Math.hypot(end.x - start.x, end.y - start.y); const length = Math.min(MAX_SEGMENT_LENGTH, Math.max(0, segmentLength)); const tailProgress = total < EPSILON ? progress : Math.max(0, progress - length / total); const tail = pointOnLine(start, end, tailProgress); return { tail, head, length: Math.hypot(head.x - tail.x, head.y - tail.y), totalDistance: total }; }

export function buildProjectileGeometry(effect, time) {
  const launchTime = effect.launchTime ?? effect.presentationTime ?? 0; const duration = Math.max(EPSILON, effect.duration ?? effect.maxLife ?? .2); const progress = clamp((time - launchTime) / duration); const segmentLength = Math.min(MAX_SEGMENT_LENGTH, effect.segmentLength ?? 24); const curved = effect.kind === 'rocket';
  if (curved && effect.control) {
    const head = pointOnQuadraticCurve(effect.start, effect.control, effect.end, progress); const tailProgress = Math.max(0, progress - Math.min(.18, segmentLength / Math.max(1, Math.hypot(effect.end.x - effect.start.x, effect.end.y - effect.start.y)))); const tail = pointOnQuadraticCurve(effect.start, effect.control, effect.end, tailProgress); return { kind: effect.kind, tail, head, length: Math.hypot(head.x - tail.x, head.y - tail.y), segmentLength, progress, active: time >= launchTime && time <= launchTime + duration };
  }
  const segment = getProjectileSegment(effect.start, effect.end, progress, segmentLength); return { kind: effect.kind, ...segment, segmentLength, progress, active: time >= launchTime && time <= launchTime + duration };
}

export function validateProjectileGeometry(geometry) { const errors = []; if (!geometry || !geometry.tail || !geometry.head) errors.push('missing projectile endpoints'); else if (geometry.length > MAX_SEGMENT_LENGTH + 1e-6) errors.push(`segment length ${geometry.length} exceeds ${MAX_SEGMENT_LENGTH}`); if (geometry.active === false && geometry.progress > 0 && geometry.progress < 1) errors.push('inactive projectile has intermediate progress'); return { ok: errors.length === 0, errors };
}

export { MAX_SEGMENT_LENGTH };
