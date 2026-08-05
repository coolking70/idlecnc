import { getRoute } from './dynamic-route-registry.js';
import { isReserveSlot } from './reserve-slot-policy.js';
import { boundsIntersect, getVisualBounds } from './visual-bounds.js';

const KEY_TIMES = Object.freeze([0, 7, 13, 21, 26, 32, 35]);
const EPSILON = 1e-6;
const OBJECTIVE = { x: 760, y: 405, radius: 28 };
const BUILDINGS = [
  { x: 100, y: 300, w: 150, h: 90 }, { x: 160, y: 610, w: 125, h: 70 },
  { x: 980, y: 170, w: 170, h: 100 }, { x: 1060, y: 520, w: 140, h: 85 }
];

function finitePoint(point) { return point && Number.isFinite(point.x) && Number.isFinite(point.y); }
function positionAtRoute(route, time, duration = 35) {
  const points = route.points; const phase = Math.max(0, Math.min(1, time / duration)) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(phase)); const amount = phase - index;
  const left = points[index]; const right = points[index + 1];
  return { x: left.x + (right.x - left.x) * amount, y: left.y + (right.y - left.y) * amount };
}
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function inRect(point, rect, padding = 20) { return point.x >= rect.x - padding && point.x <= rect.x + rect.w + padding && point.y >= rect.y - padding && point.y <= rect.y + rect.h + padding; }
function minDistance(actor, other) {
  if (actor.category === 'vehicle' || actor.category === 'armor') return other.category === 'infantry' ? 30 : 42;
  return other.category === 'infantry' ? 24 : 30;
}

export function validateSlotLayout(plan) {
  const errors = [];
  const actors = plan?.actors || [];
  const routes = plan?.routeRegistry || {};
  const actorIds = new Set(actors.map((actor) => actor.id));
  const slotIds = actors.map((actor) => actor.templateSlot);
  if (new Set(slotIds).size !== slotIds.length) errors.push('slot_layout_duplicate_slot');
  for (const actor of actors) {
    if (!actorIds.has(actor.id)) errors.push(`slot_layout_unknown_actor:${actor.id}`);
    let route;
    try { route = getRoute(routes, actor.templateSlot); } catch (error) { errors.push(error.message); continue; }
    if (route.points.length < 2) errors.push(`route_too_short:${actor.templateSlot}`);
    if (route.points.some((point) => !finitePoint(point))) errors.push(`route_non_finite:${actor.templateSlot}`);
    const start = route.points[0];
    if (actor.side === 'friendly' && start.x >= 500) errors.push(`friendly_route_starts_too_far_right:${actor.templateSlot}`);
    if (actor.side === 'enemy' && start.x <= 780) errors.push(`enemy_route_starts_too_far_left:${actor.templateSlot}`);
    if (route.points.every((point, index) => index === 0 || point.x === route.points[index - 1].x && point.y === route.points[index - 1].y)) errors.push(`route_collapsed:${actor.templateSlot}`);
    if (inRect(route.finalPosition, { x: OBJECTIVE.x - 22, y: OBJECTIVE.y - 22, w: 44, h: 44 }, 0)) errors.push(`route_final_on_objective_flag:${actor.templateSlot}`);
    if (inRect(route.finalPosition, BUILDINGS[0], 0) || inRect(route.finalPosition, BUILDINGS[1], 0) || inRect(route.finalPosition, BUILDINGS[2], 0) || inRect(route.finalPosition, BUILDINGS[3], 0)) errors.push(`route_final_in_building:${actor.templateSlot}`);
    if (isReserveSlot(actor.templateSlot) && Math.abs(route.finalPosition.x - 640) < 1 && Math.abs(route.finalPosition.y - 400) < 1) errors.push(`reserve_center_fallback:${actor.templateSlot}`);
  }
  const routeValues = Object.values(routes);
  for (let i = 0; i < routeValues.length; i += 1) for (let j = i + 1; j < routeValues.length; j += 1) {
    if (JSON.stringify(routeValues[i].points) === JSON.stringify(routeValues[j].points)) errors.push(`duplicate_route:${routeValues[i].slotId}:${routeValues[j].slotId}`);
  }
  for (const time of KEY_TIMES) {
    const positions = [];
    for (const actor of actors) {
      try { positions.push({ actor, position: positionAtRoute(getRoute(routes, actor.templateSlot), time, plan.duration) }); } catch { /* route error already reported above */ }
    }
    for (let i = 0; i < positions.length; i += 1) for (let j = i + 1; j < positions.length; j += 1) {
      const first = positions[i]; const second = positions[j]; const gap = distance(first.position, second.position);
      if (first.actor.side !== second.actor.side) continue;
      const boundsA = getVisualBounds(first.actor, first.position); const boundsB = getVisualBounds(second.actor, second.position);
      if (boundsIntersect(boundsA, boundsB)) errors.push(`actor_visual_bounds_overlap:${first.actor.id}:${second.actor.id}@${time}`);
      if (gap <= EPSILON) errors.push(`actor_overlap_exact:${first.actor.id}:${second.actor.id}@${time}`);
      if (gap < minDistance(first.actor, second.actor)) errors.push(`actor_center_spacing_diagnostic:${first.actor.id}:${second.actor.id}@${time}:${gap.toFixed(2)}`);
    }
  }
  return { ok: errors.length === 0, errors, keyTimes: KEY_TIMES.slice() };
}

export { KEY_TIMES, positionAtRoute };
