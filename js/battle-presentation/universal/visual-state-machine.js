/** Closed production visual vocabulary.
 * Planner actions and authority event names never cross the renderer boundary.
 */
export const VISUAL_STATES = Object.freeze([
  'idle', 'deploy', 'move', 'turn', 'brake', 'aim', 'fire', 'reload', 'hit', 'destroying', 'wreck',
  'suppressed', 'take_cover', 'retreat', 'cover_fire', 'search_target', 'repair', 'being_repaired'
]);

const STATE_SET = new Set(VISUAL_STATES);
const ACTION_TO_STATE = Object.freeze({
  holding: 'idle', establish_fire_line: 'idle', escort_convoy: 'idle', secure: 'idle',
  deploy: 'deploy', advance: 'move', screen: 'move', take_cover: 'move', repair_approach: 'move', disengage: 'move',
  turn: 'turn', brake: 'brake', aim: 'aim', fire: 'fire', reload: 'reload', hit: 'hit', destroying: 'destroying', wreck: 'wreck',
  suppressed: 'suppressed', cover_fire: 'cover_fire', retreat: 'retreat', search_target: 'search_target', take_cover_visual: 'take_cover'
});

export function normalizeVisualState(value, fallback = 'idle') {
  return STATE_SET.has(value) ? value : (STATE_SET.has(fallback) ? fallback : 'idle');
}

export function plannerActionToVisualState(action, fallback = 'idle') {
  return normalizeVisualState(ACTION_TO_STATE[String(action || '').toLowerCase()], fallback);
}

export function visualStateVocabulary() { return [...VISUAL_STATES]; }

function finiteTime(value) { return Number.isFinite(Number(value)) ? Number(value) : null; }

function routeDeploymentEnd(plan, actorId) {
  const duration = Math.max(1, Number(plan?.timeline?.duration) || 30);
  const route = (plan?.layout?.routes || []).find((item) => item.actorId === actorId);
  const points = [...(route?.points || route?.basePoints || [])].sort((left, right) => Number(left.t) - Number(right.t));
  const staging = route?.tactical?.staging;
  if (!points.length) return null;
  const stagingPoint = staging && points.find((point) => Math.hypot(Number(point.x) - Number(staging.x), Number(point.y) - Number(staging.y)) <= 28);
  if (stagingPoint && Number.isFinite(Number(stagingPoint.t))) return Math.max(0, Math.min(duration, Number(stagingPoint.t) * duration));
  const firstRouteMove = points.find((point, index) => index > 0 && Math.hypot(Number(point.x) - Number(points[index - 1].x), Number(point.y) - Number(points[index - 1].y)) > 0.5);
  return firstRouteMove && Number.isFinite(Number(firstRouteMove.t)) ? Math.max(0, Math.min(duration, Number(firstRouteMove.t) * duration)) : 0;
}

/**
 * Deployment is complete at an actor-specific route/action boundary. This is
 * deliberately precomputed from the plan so arbitrary time seeks do not rely
 * on accumulated frame velocity or a fixed opening window.
 */
export function deploymentSemanticEnd(plan, actorId) {
  const duration = Math.max(1, Number(plan?.timeline?.duration) || 30);
  const routeEnd = routeDeploymentEnd(plan, actorId);
  const movementActions = new Set(['advance', 'screen', 'take_cover', 'repair_approach', 'disengage', 'turn']);
  const actionEnd = (plan?.timeline?.actions || [])
    .filter((action) => action.actorIds?.includes?.(actorId) && movementActions.has(action.type))
    .map((action) => finiteTime(action.t))
    .filter((time) => time !== null)
    .sort((left, right) => left - right)[0];
  if (routeEnd === null && actionEnd === undefined) return 0;
  if (routeEnd === null) return Math.max(0, Math.min(duration, actionEnd));
  if (actionEnd === undefined) return routeEnd;
  return Math.max(0, Math.min(duration, Math.min(routeEnd, actionEnd)));
}

export function movementVisualState({ seconds = 0, current, previous, next, deploymentEnd = 0 } = {}) {
  if (Number(seconds) < Math.max(0, Number(deploymentEnd) || 0)) return 'deploy';
  const nowSpeed = Math.hypot((next?.x || 0) - (current?.x || 0), (next?.y || 0) - (current?.y || 0));
  const previousSpeed = Math.hypot((current?.x || 0) - (previous?.x || 0), (current?.y || 0) - (previous?.y || 0));
  if (previousSpeed > 0.8 && nowSpeed < previousSpeed * 0.42) return 'brake';
  const before = Math.atan2((current?.y || 0) - (previous?.y || 0), (current?.x || 0) - (previous?.x || 0));
  const after = Math.atan2((next?.y || 0) - (current?.y || 0), (next?.x || 0) - (current?.x || 0));
  const turn = Math.abs(Math.atan2(Math.sin(after - before), Math.cos(after - before)));
  if (nowSpeed > 0.8 && turn > 0.24) return 'turn';
  if (nowSpeed > 0.8) return 'move';
  return 'idle';
}
