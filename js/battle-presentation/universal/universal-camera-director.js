/** Deterministic, presentation-only camera interest director for 8.2G-B. */
import { resolveUniversalCamera, clampUniversalCamera } from './universal-render-camera.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function mapPoint(point, bounds) {
  return { x: (Number(point?.x) || 0) * 1280 / Math.max(1, Number(bounds?.width) || 1200), y: (Number(point?.y) || 0) * 720 / Math.max(1, Number(bounds?.height) || 700) };
}

function center(points, fallback = { x: 640, y: 360 }) {
  const valid = points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (!valid.length) return fallback;
  return valid.reduce((sum, point) => ({ x: sum.x + point.x / valid.length, y: sum.y + point.y / valid.length }), { x: 0, y: 0 });
}

export function buildCameraDirector(schedule) {
  return Object.freeze({ version: '8.2G-B.1', interests: (schedule?.cameraInterests || []).map((interest) => ({ ...interest, subjectIds: [...(interest.subjectIds || [])] })) });
}

export function cameraInterestAtTime(director, seconds) {
  return (director?.interests || []).filter((interest) => seconds >= interest.start && seconds <= interest.end).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0] || null;
}

export function resolveDirectedCamera(plan, state, director, options = {}) {
  const interest = cameraInterestAtTime(director, Number(state?.time) || 0);
  if (!interest || options.autoCamera === false || options.cameraOverride) {
    const camera = resolveUniversalCamera(plan, state, options.mode || 'overview', options.autoCamera !== false, options.cameraOverride || null);
    return { ...camera, interestId: interest?.id || null, interestReason: interest?.reason || null };
  }
  const byId = new Map((state?.actors || []).map((actor) => [actor.id, actor]));
  const points = interest.subjectIds.map((id) => byId.get(id)?.visualCenter).filter(Boolean).map((point) => mapPoint(point, plan.layout?.bounds));
  const fallback = { x: 640, y: 360 };
  const point = center(points, fallback);
  const zoom = interest.priority >= 90 ? 1.12 : interest.priority >= 60 ? 1.02 : .94;
  const camera = clampUniversalCamera({ x: point.x, y: point.y, zoom });
  return { ...camera, mode: options.mode || 'overview', auto: true, manual: false, label: interest.reason === 'retreat' ? '撤退焦点' : interest.reason === 'destroy' ? '关键摧毁' : interest.reason === 'critical_hit' ? '关键命中' : interest.reason === 'main_engagement' ? '主要交火' : interest.reason === 'first_contact' ? '首次接敌' : '全局态势', interestId: interest.id, interestReason: interest.reason };
}
