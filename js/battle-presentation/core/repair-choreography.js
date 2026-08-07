import { positionAtSlot } from './contract-movement-director.js';
import { boundsIntersect, distanceBetween, getVisualBounds } from './visual-bounds.js';

const REPAIR_OFFSET = Object.freeze({ x: -62, y: -38 });
// Lead-armor repairs rendezvous on the tank's forward-right quarter so the
// maintenance vehicle does not clip the friendly workshop at the south-west
// edge of the road template when the lead tank is still near spawn.
const LEAD_REPAIR_OFFSET = Object.freeze({ x: 54, y: -38 });
const CONTACT_OFFSET = Object.freeze({ x: -24, y: 10 });
const APPROACH_DURATION = 0.65;
const RETRACT_DURATION = 0.66;

function rotateOffset(offset, facing = 0) { return { x: offset.x * Math.cos(facing) - offset.y * Math.sin(facing), y: offset.x * Math.sin(facing) + offset.y * Math.cos(facing) }; }
function pointWithOffset(position, offset) { const rotated = rotateOffset(offset, position.facing || 0); return { x: position.x + rotated.x, y: position.y + rotated.y }; }
function repairOffsetForRole(role) { return role === 'friendly_lead_armor' ? LEAD_REPAIR_OFFSET : REPAIR_OFFSET; }
function actorById(plan, id) { return plan.actorById?.[id] || plan.actors.find((actor) => actor.id === id); }
function routePosition(plan, actor, time) { return positionAtSlot(plan.routeRegistry, actor.templateSlot, time); }

export function getRepairWorkPosition(targetPosition, targetFacing = targetPosition?.facing || 0, targetRole = null) { return pointWithOffset({ ...targetPosition, facing: targetFacing }, repairOffsetForRole(targetRole)); }
export function getRepairContactPoint(targetPosition, targetFacing = targetPosition?.facing || 0, targetType = 'mbt') { return pointWithOffset({ ...targetPosition, facing: targetFacing }, targetType === 'mbt' ? CONTACT_OFFSET : { x: -18, y: 8 }); }

export function buildRepairGroups(plan) {
  const repairs = plan.anchors.filter((anchor) => anchor.type === 'repair').slice().sort((a, b) => a.presentationTime - b.presentationTime || a.sourceIndex - b.sourceIndex);
  const grouped = new Map();
  for (const anchor of repairs) {
    const key = `${anchor.actorId}→${anchor.targetId}`;
    if (!grouped.has(key)) grouped.set(key, { id: `repair-group-${grouped.size + 1}`, repairVehicleId: anchor.actorId, targetId: anchor.targetId, anchors: [] });
    grouped.get(key).anchors.push(anchor);
  }
  return [...grouped.values()].map((group) => {
    const first = group.anchors[0].presentationTime; const last = group.anchors.at(-1).presentationTime;
    const earlyGroup = first < 20;
    const workingStart = first - (earlyGroup ? 0.42 : 0.35);
    const approachStart = workingStart - APPROACH_DURATION;
    const retractStart = last + (earlyGroup ? 0.64 : 0.66);
    const end = retractStart + RETRACT_DURATION;
    return { ...group, firstRepairTime: first, lastRepairTime: last, approachStart, workingStart, retractStart, end, repairValues: group.anchors.map((anchor) => anchor.value) };
  });
}

function lerpPoint(first, second, amount) { return { x: first.x + (second.x - first.x) * amount, y: first.y + (second.y - first.y) * amount }; }
function retractPoint(workCurrent, retractBase, amount, targetRole = null) {
  const waypoint = targetRole === 'friendly_lead_armor'
    ? { x: workCurrent.x + 92, y: workCurrent.y - 16 }
    : { x: Math.max(workCurrent.x - 92, 330), y: workCurrent.y + 16 };
  if (amount <= .45) return lerpPoint(workCurrent, waypoint, amount / .45);
  return lerpPoint(waypoint, retractBase, (amount - .45) / .55);
}
function approachPoint(approachBase, workAtWork, amount, targetRole = null) {
  if (targetRole === 'friendly_lead_armor') {
    const belowRight = { x: 500, y: 620 }; const detourRight = { x: 530, y: 450 }; const aboveRight = { x: 130, y: 80 };
    if (amount <= .35) return lerpPoint(approachBase, belowRight, amount / .35);
    if (amount <= .48) return lerpPoint(belowRight, detourRight, (amount - .35) / .13);
    if (amount <= .75) return lerpPoint(detourRight, aboveRight, (amount - .48) / .27);
    return lerpPoint(aboveRight, workAtWork, (amount - .75) / .25);
  }
  // Keep the repair vehicle on the safe side of the target while it closes in.
  // The old waypoint approached from below, which can briefly put a repair
  // vehicle inside a tank's visual bounds when the target is already moving
  // through the south lane.  The work pose remains target-relative; only the
  // transit waypoint is moved above it so the continuous layout validator can
  // observe a collision-free approach at every sampled frame.
  const waypoint = { x: Math.max(workAtWork.x - 92, 330), y: workAtWork.y - 36 };
  if (amount <= .55) return lerpPoint(approachBase, waypoint, amount / .55);
  return lerpPoint(waypoint, workAtWork, (amount - .55) / .45);
}

export function getRepairChoreographyAtTime(plan, time, actorPositions = {}) {
  const groups = plan.repairGroups || buildRepairGroups(plan);
  const active = groups.find((group) => time >= group.approachStart && time <= group.end);
  if (!active) return { active: false, state: 'stowed', groups, activeGroupId: null, repairVehicleId: null, targetId: null, repairPosition: null, contactPoint: null, armEndpoint: null, sparkPoint: null, sparkActive: false, anchorId: null };
  const repairActor = actorById(plan, active.repairVehicleId); const targetActor = actorById(plan, active.targetId);
  const repairBase = actorPositions[active.repairVehicleId] || routePosition(plan, repairActor, time);
  const targetCurrent = actorPositions[active.targetId] || routePosition(plan, targetActor, time);
  const targetAtWork = routePosition(plan, targetActor, Math.max(active.workingStart, Math.min(active.retractStart, time)));
  const workAtWork = getRepairWorkPosition(targetAtWork, targetAtWork.facing, targetActor.role); const workCurrent = getRepairWorkPosition(targetCurrent, targetCurrent.facing, targetActor.role); const contactPoint = getRepairContactPoint(targetCurrent, targetCurrent.facing, targetActor.type);
  let state = 'working'; let repairPosition = workCurrent;
  if (time < active.workingStart) { state = 'deploying'; const approachBase = routePosition(plan, repairActor, active.approachStart); repairPosition = approachPoint(approachBase, workAtWork, Math.max(0, Math.min(1, (time - active.approachStart) / (active.workingStart - active.approachStart))), targetActor.role); }
  else if (time > active.retractStart) { state = 'retracting'; const retractBase = routePosition(plan, repairActor, active.end); repairPosition = retractPoint(workCurrent, retractBase, Math.max(0, Math.min(1, (time - active.retractStart) / (active.end - active.retractStart))), targetActor.role); }
  const latest = active.anchors.filter((anchor) => anchor.presentationTime <= time).at(-1) || null;
  const sparkActive = active.anchors.some((anchor) => time >= anchor.presentationTime && time <= anchor.presentationTime + 0.55);
  const sparkPoint = { x: contactPoint.x + 4, y: contactPoint.y + 3 };
  return { active: true, state, groups, activeGroupId: active.id, repairVehicleId: active.repairVehicleId, targetId: active.targetId, repairPosition, workPosition: workCurrent, contactPoint, armEndpoint: contactPoint, sparkPoint, sparkActive, anchorId: latest?.id || null, anchorSourceEventId: latest?.sourceEventId || null, distance: distanceBetween(repairPosition, targetCurrent) };
}

export function validateRepairChoreography(choreography, plan) {
  const errors = [];
  const groups = choreography.groups || plan.repairGroups || buildRepairGroups(plan);
  const repairs = plan.anchors.filter((anchor) => anchor.type === 'repair');
  if (groups.reduce((count, group) => count + group.anchors.length, 0) !== repairs.length) errors.push('not all repair anchors are grouped');
  for (const group of groups) for (const anchor of group.anchors) {
    const positions = Object.fromEntries(plan.actors.map((actor) => [actor.id, routePosition(plan, actor, anchor.presentationTime)]));
    const sample = getRepairChoreographyAtTime(plan, anchor.presentationTime, positions);
    const repair = actorById(plan, group.repairVehicleId); const target = actorById(plan, group.targetId);
    const targetPosition = positions[group.targetId];
    const repairBounds = getVisualBounds(repair, sample.repairPosition); const targetBounds = getVisualBounds(target, targetPosition);
    const distance = distanceBetween(sample.repairPosition, targetPosition);
    if (distance < 55 || distance > 82) errors.push(`${anchor.id} distance ${distance} outside 55..82`);
    if (boundsIntersect(repairBounds, targetBounds)) errors.push(`${anchor.id} vehicle bounds intersect`);
    if (distanceBetween(sample.armEndpoint, sample.contactPoint) > 6) errors.push(`${anchor.id} arm endpoint misses contact`);
    if (distanceBetween(sample.sparkPoint, sample.contactPoint) > 8) errors.push(`${anchor.id} sparks are too far from contact`);
    if (distanceBetween(sample.contactPoint, targetPosition) > 82) errors.push(`${anchor.id} contact geometry is invalid`);
  }
  for (const time of Array.from({ length: 35 * 60 + 1 }, (_, index) => index / 60)) {
    const currentPositions = Object.fromEntries(plan.actors.map((actor) => [actor.id, routePosition(plan, actor, time)]));
    const nextTime = time + 1 / 60;
    const nextPositions = Object.fromEntries(plan.actors.map((actor) => [actor.id, routePosition(plan, actor, nextTime)]));
    const current = getRepairChoreographyAtTime(plan, time, currentPositions);
    const next = getRepairChoreographyAtTime(plan, nextTime, nextPositions);
    if (current.repairPosition && next.repairPosition && distanceBetween(current.repairPosition, next.repairPosition) > 35) errors.push(`repair jump at ${time.toFixed(3)}`);
  }
  return { ok: errors.length === 0, errors };
}

export { REPAIR_OFFSET, LEAD_REPAIR_OFFSET, CONTACT_OFFSET };
