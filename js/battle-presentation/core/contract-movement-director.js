import { FIXED_ROUTES, getRoute } from './dynamic-route-registry.js';

function mix(a, b, p) { return a + (b - a) * p; }
function routePosition(route, time, duration = 35) {
  if (!route || !Array.isArray(route.points) || route.points.length < 2) throw new Error('unknown_template_slot');
  const points = route.points; const phase = Math.max(0, Math.min(1, time / duration)) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(phase)); const p = phase - index;
  const left = points[index]; const right = points[index + 1];
  return { x: mix(left.x, right.x, p), y: mix(left.y, right.y, p), facing: Math.atan2(right.y - left.y, right.x - left.x) };
}

export function positionAtSlot(routeRegistryOrSlotId, slotIdOrTime, maybeTime) {
  if (typeof routeRegistryOrSlotId === 'string') {
    const slotId = routeRegistryOrSlotId; const time = slotIdOrTime;
    const points = FIXED_ROUTES[slotId];
    if (!points) throw new Error(`unknown_template_slot:${slotId}`);
    return routePosition({ points: points.map(([x, y]) => ({ x, y })) }, time);
  }
  return routePosition(getRoute(routeRegistryOrSlotId, slotIdOrTime), maybeTime, 35);
}

export function buildVisualActor(actor, slot, routeRegistry = null) {
  const memberCount = actor.type === 'at_infantry' || actor.type === 'enemy_at' ? 3 : (actor.category === 'infantry' ? 4 : 0);
  const members = Array.from({ length: memberCount }, (_, index) => ({ id: `${actor.id}:member:${index}`, parentActorId: actor.id, index, role: actor.type.includes('at') && index === 0 ? 'rocket' : 'rifle' }));
  const routePositionAt = (time) => routeRegistry ? positionAtSlot(routeRegistry, slot.slotId, time) : positionAtSlot(slot.slotId, time);
  const initial = routePositionAt(0);
  return { id: actor.id, sourceActorId: actor.id, side: actor.side, type: actor.type, category: actor.category, shape: actor.shape, role: slot.role, templateSlot: slot.slotId, anchorPosition: initial, visualCenter: initial, facing: 0, turretFacing: 0, members, memberPositions: [], hp: actor.initial.hp, maxHp: actor.initial.maxHp, alive: actor.initial.alive, visualStatus: 'ready' };
}

export function updateVisualActor(actor, time, authority, routeRegistry = null) {
  const position = routeRegistry ? positionAtSlot(routeRegistry, actor.templateSlot, time) : positionAtSlot(actor.templateSlot, time);
  actor.visualCenter = position; actor.anchorPosition = position; actor.facing = position.facing; actor.turretFacing = position.facing;
  const source = authority.actors[actor.sourceActorId]; actor.hp = source.hp; actor.alive = source.alive;
  if (actor.members.length) actor.memberPositions = actor.members.map((member, index) => ({ x: position.x + [-15, 8, -8, 14][index] * (actor.side === 'enemy' ? -1 : 1), y: position.y + [-10, -7, 8, 10][index], facing: position.facing, stance: source.alive ? (time < 7 ? 'moving' : index % 2 ? 'stand' : 'crouch') : 'down' }));
  return actor;
}

export { FIXED_ROUTES as ROUTES };
