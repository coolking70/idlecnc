/** Deterministic battle camera; no input handling or game-state mutation. */
import { clamp, safeNumber } from './utils.js';
import { BATTLE_WORLD, getVisualActorsAtTime, getVisualEffectsAtTime } from './battle-visual-director.js';

export const CAMERA_MODES = Object.freeze({ overview: 'overview', focus: 'focus', impact: 'impact', result: 'result' });

function actorCenter(actors, side = null) {
  const list = side ? actors.filter((actor) => actor.side === side) : actors;
  if (!list.length) return { x: BATTLE_WORLD.width / 2, y: BATTLE_WORLD.height / 2 };
  return { x: list.reduce((sum, actor) => sum + actor.x, 0) / list.length, y: list.reduce((sum, actor) => sum + actor.y, 0) / list.length };
}

export function createBattleCamera(plan, options = {}) {
  return {
    mode: options.mode || CAMERA_MODES.overview,
    auto: options.auto !== false,
    focusId: options.focusId || null,
    last: { x: BATTLE_WORLD.width / 2, y: BATTLE_WORLD.height / 2, zoom: 0.86 },
    planId: plan ? `${plan.seed}:${plan.theaterId || ''}` : null
  };
}

export function setBattleCameraMode(camera, mode, focusId = null) {
  if (!camera || !Object.values(CAMERA_MODES).includes(mode)) return camera;
  camera.mode = mode;
  camera.focusId = focusId || null;
  return camera;
}

function targetFor(camera, plan, elapsed, actors, effects) {
  if (camera.mode === CAMERA_MODES.result) return { x: BATTLE_WORLD.width / 2, y: BATTLE_WORLD.height / 2, zoom: 0.82 };
  if (camera.mode === CAMERA_MODES.focus && camera.focusId) {
    const actor = actors.find((item) => item.id === camera.focusId);
    if (actor) return { x: actor.x, y: actor.y, zoom: 1.15 };
  }
  if (camera.mode === CAMERA_MODES.impact) {
    const impact = effects.filter((event) => event.type === 'damage' || event.type === 'destroy').at(-1);
    const actor = impact && actors.find((item) => item.id === impact.targetId);
    if (actor) return { x: actor.x, y: actor.y, zoom: 1.22 };
  }
  if (camera.auto) {
    const latest = effects.filter((event) => event.type === 'damage' || event.type === 'fire').at(-1);
    const actor = latest && actors.find((item) => item.id === latest.targetId || item.id === latest.actorId);
    if (actor) return { x: actor.x, y: actor.y, zoom: 1.02 };
  }
  return { ...actorCenter(actors), zoom: 0.86 };
}

export function getBattleCamera(camera, plan, elapsed, options = {}) {
  if (!camera || !plan) return { x: 600, y: 350, zoom: 0.86, mode: CAMERA_MODES.overview };
  const actors = getVisualActorsAtTime(plan, elapsed, options);
  const effects = getVisualEffectsAtTime(plan, elapsed);
  const target = targetFor(camera, plan, elapsed, actors, effects);
  const smoothing = clamp(safeNumber(options.smoothing, 0.12), 0.01, 1);
  camera.last = {
    x: camera.last.x + (target.x - camera.last.x) * smoothing,
    y: camera.last.y + (target.y - camera.last.y) * smoothing,
    zoom: camera.last.zoom + (target.zoom - camera.last.zoom) * smoothing
  };
  return { ...camera.last, mode: camera.mode, focusId: camera.focusId, auto: camera.auto };
}

export function validateBattleCamera(camera) {
  const ok = !!camera && Object.values(CAMERA_MODES).includes(camera.mode)
    && Number.isFinite(camera.last && camera.last.x) && Number.isFinite(camera.last && camera.last.y);
  return { ok, problems: ok ? [] : ['invalid camera state'] };
}

export const BATTLE_CAMERA_API = { CAMERA_MODES, createBattleCamera, setBattleCameraMode, getBattleCamera, validateBattleCamera };

