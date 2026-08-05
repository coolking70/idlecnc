import { buildReserveRoute, isReserveSlot, reserveIndexFromSlot } from './reserve-slot-policy.js';
import { boundsIntersect, getVisualBounds, distanceBetween } from './visual-bounds.js';

const DECONFLICTED_POINTS = Object.freeze({
  friendly_scout_flank: [[70, 100], [220, 110], [380, 120], [540, 130], [680, 150], [760, 160]],
  friendly_north_assault: [[70, 230], [250, 230], [430, 235], [600, 245], [700, 260], [700, 270]],
  friendly_south_infantry_assault: [[70, 590], [300, 590], [500, 600], [650, 600], [720, 600], [740, 600]],
  friendly_south_at_assault: [[70, 550], [260, 550], [430, 550], [580, 550], [680, 545], [690, 540]],
  friendly_lead_tank: [[70, 420], [260, 420], [320, 400], [450, 375], [580, 365], [610, 370]],
  friendly_support_tank: [[70, 705], [300, 705], [450, 680], [560, 660], [650, 645], [760, 640]],
  friendly_repair_rear: [[320, 650], [370, 650], [450, 630], [500, 610], [520, 590], [520, 570]],
  enemy_north_cover: [[1240, 330], [1180, 330], [1060, 330], [950, 325], [860, 320], [820, 315]],
  enemy_center_checkpoint: [[1240, 410], [1130, 410], [1000, 410], [900, 405], [850, 400], [830, 395]],
  enemy_south_cover: [[1240, 620], [1225, 620], [1040, 620], [930, 570], [850, 540], [820, 530]],
  enemy_rear_reserve: [[1240, 370], [1225, 370], [1100, 370], [960, 360], [850, 350], [820, 350]],
  enemy_north_at_nest: [[1240, 260], [1210, 280], [1180, 300], [1060, 300], [930, 285], [850, 270]],
  enemy_south_at_nest: [[1240, 480], [1210, 480], [1160, 480], [1050, 480], [950, 480], [850, 480]]
});

const PRIORITY = Object.freeze([
  'friendly_south_infantry_assault', 'friendly_south_at_assault', 'friendly_reserve', 'friendly_repair_rear',
  'enemy_north_cover', 'enemy_north_at_nest', 'enemy_south_cover', 'enemy_south_at_nest', 'enemy_reserve'
]);
const KEY_TIMES = Object.freeze([0, 7, 13, 21, 26, 32, 35]);

function clonePoints(points) { return points.map((point) => ({ x: Number(point[0] ?? point.x), y: Number(point[1] ?? point.y) })); }
function actorFor(plan, slotId) { return (plan?.actors || []).find((actor) => actor.templateSlot === slotId) || null; }
function shapeFor(actor) {
  if (actor?.members) return actor;
  const memberCount = actor?.type === 'at_infantry' || actor?.type === 'enemy_at' ? 3 : actor?.category === 'infantry' ? 4 : 0;
  return { ...actor, members: Array.from({ length: memberCount }) };
}
function positionAtRoute(route, time, duration = 35) {
  const phase = Math.max(0, Math.min(1, time / duration)) * (route.points.length - 1);
  const index = Math.min(route.points.length - 2, Math.floor(phase)); const amount = phase - index;
  const left = route.points[index]; const right = route.points[index + 1];
  return { x: left.x + (right.x - left.x) * amount, y: left.y + (right.y - left.y) * amount };
}
function routeEntry(old, slotId, points, source = old?.source || 'fixed') {
  const finalPosition = points.at(-1);
  return { ...old, slotId, points, finalPosition: { ...finalPosition }, source, deconflicted: true };
}
function reservePoints(slotId, side, category) {
  const index = reserveIndexFromSlot(slotId) || 1;
  if (side === 'friendly') {
    const y = Math.max(42, 195 - (index - 1) * 42);
    return [[90, y], [240, y], [400, y - 8], [550, y - 8], [680, y], [760, y + 8]];
  }
  const y = Math.min(700, 580 + (index - 1) * 46);
  return [[1240, y], [1225, y], [1225, y - 100], [1100, y - 110], [960, y - 120], [850, y - 130]];
}

export function scoreRouteRegistry(plan, contract, suppliedRegistry = null) {
  const registry = suppliedRegistry || plan?.routeRegistry || {};
  const actors = plan?.actors || [];
  let sameSideIntersections = 0; let minimumCenterDistance = Infinity; const intersections = [];
  for (const time of KEY_TIMES) {
    const positions = actors.map((actor) => ({ actor, position: positionAtRoute(registry[actor.templateSlot], time, plan?.duration || 35) })).filter((item) => item.position);
    for (let i = 0; i < positions.length; i += 1) for (let j = i + 1; j < positions.length; j += 1) {
      const first = positions[i]; const second = positions[j];
      if (first.actor.side !== second.actor.side) continue;
      const distance = distanceBetween(first.position, second.position); minimumCenterDistance = Math.min(minimumCenterDistance, distance);
      if (boundsIntersect(getVisualBounds(shapeFor(first.actor), first.position), getVisualBounds(shapeFor(second.actor), second.position))) {
        sameSideIntersections += 1; intersections.push({ time, actorA: first.actor.id, actorB: second.actor.id });
      }
    }
  }
  return { sameSideIntersections, minimumCenterDistance: Number.isFinite(minimumCenterDistance) ? minimumCenterDistance : null, intersections, keyTimes: KEY_TIMES.slice(), score: sameSideIntersections * 100000 - (minimumCenterDistance || 0) };
}

export function deconflictRouteRegistry(plan, contract, options = {}) {
  const source = options.routeRegistry || plan?.routeRegistry || {};
  const routeRegistry = {};
  const adjustments = [];
  for (const [slotId, old] of Object.entries(source)) {
    const actor = actorFor(plan, slotId); const explicit = DECONFLICTED_POINTS[slotId];
    const points = explicit ? clonePoints(explicit) : isReserveSlot(slotId) ? clonePoints(reservePoints(slotId, actor?.side || old.side, actor?.category || old.category)) : old.points.map((point) => ({ ...point }));
    routeRegistry[slotId] = routeEntry(old, slotId, points, isReserveSlot(slotId) ? 'dynamic' : 'fixed');
    if (JSON.stringify(old.points) !== JSON.stringify(points)) adjustments.push({ slotId, priority: PRIORITY.indexOf(slotId.replace(/_\d+$/, '')) >= 0 ? PRIORITY.indexOf(slotId.replace(/_\d+$/, '')) : 99, before: old.points, after: points });
  }
  const result = { routeRegistry, adjustments, before: scoreRouteRegistry(plan, contract, source), after: scoreRouteRegistry(plan, contract, routeRegistry) };
  result.errors = result.after.sameSideIntersections ? result.after.intersections.map((item) => `deconfliction_same_side_overlap:${item.actorA}:${item.actorB}@${item.time}`) : [];
  return result;
}

export function validateDeconflictedRegistry(plan, contract, suppliedRegistry = null) {
  const score = scoreRouteRegistry(plan, contract, suppliedRegistry);
  return { ok: score.sameSideIntersections === 0, errors: score.sameSideIntersections === 0 ? [] : score.intersections.map((item) => `deconflicted_route_overlap:${item.actorA}:${item.actorB}@${item.time}`), score };
}

export { DECONFLICTED_POINTS, KEY_TIMES as DECONFLICT_KEY_TIMES, positionAtRoute as deconflictedPositionAtRoute };
