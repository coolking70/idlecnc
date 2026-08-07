export function buildUniversalRepairChoreography(normalized, timeline, forces, layout = null) {
  const repairs = (timeline.anchors || []).filter((anchor) => anchor.type === 'repair');
  const actorSlots = new Map();
  const targetApproachStarts = new Map();
  for (const anchor of repairs) targetApproachStarts.set(anchor.targetId, Math.min(targetApproachStarts.get(anchor.targetId) ?? Infinity, Math.max(0, anchor.t - 6)));
  return repairs.map((anchor, index) => {
    const repairActor = [...(forces.friendly || []), ...(forces.enemy || [])].find((row) => row.actorId === anchor.actorId);
    const target = [...(forces.friendly || []), ...(forces.enemy || [])].find((row) => row.actorId === anchor.targetId);
    const repairRoute = layout?.routes?.find((route) => route.actorId === anchor.actorId); const targetRoute = layout?.routes?.find((route) => route.actorId === anchor.targetId);
    const repairNode = layout?.nodes?.find((node) => node.actorId === anchor.actorId); const targetNode = layout?.nodes?.find((node) => node.actorId === anchor.targetId);
    const duration = Math.max(1, timeline.duration); const workStart = Math.max(0, anchor.t); const approachStart = targetApproachStarts.get(anchor.targetId) ?? Math.max(0, workStart - 6); const rendezvousStart = Math.min(workStart - .5, approachStart + 1.5); const workEnd = Math.min(duration, workStart + .8); const departureEnd = Math.min(duration, workStart + 1.6);
    const targetPosition = targetRoute ? routePosition(targetRoute.points, workStart / duration) : { x: targetNode?.x || 0, y: targetNode?.y || 0 };
    const targetRadius = target?.footprint?.radius || targetNode?.radius || 18; const repairRadius = repairActor?.footprint?.radius || repairNode?.radius || 18; const requiredCenterDistance = targetRadius + repairRadius + 24;
    if (!actorSlots.has(anchor.actorId)) actorSlots.set(anchor.actorId, actorSlots.size);
    const blockedPositions = (layout?.nodes || []).filter((node) => ![anchor.actorId, anchor.targetId].includes(node.actorId)).map((node) => ({ x: node.x, y: node.y, radius: node.radius || 18 }));
    const direction = chooseContactDirection(targetPosition, requiredCenterDistance, layout?.bounds || { width: 1200, height: 700 }, actorSlots.get(anchor.actorId), blockedPositions, repairRadius + 8);
    const repairPosition = { x: targetPosition.x + direction.x * requiredCenterDistance, y: targetPosition.y + direction.y * requiredCenterDistance };
    const targetHoldPatch = { actorId: anchor.targetId, start: workStart, end: departureEnd, position: targetPosition };
    const approachPosition = repairRoute ? routePosition(repairRoute.points, approachStart / duration) : repairNode || repairPosition;
    const detour = direction.x !== 0 || (Math.sign(repairPosition.y - approachPosition.y) !== Math.sign(targetPosition.y - approachPosition.y)) ? { x: direction.x !== 0 ? repairPosition.x : approachPosition.x + (approachPosition.x < boundsWidth(layout) / 2 ? -requiredCenterDistance : requiredCenterDistance), y: approachPosition.y } : null;
    let repairRoutePatch = { actorId: anchor.actorId, start: approachStart, rendezvousStart, workStart, workEnd, departureEnd, position: repairPosition, detour, contactPoint: { x: targetPosition.x + direction.x * targetRadius, y: targetPosition.y + direction.y * targetRadius } };
    if (repairRoute) patchRoute(repairRoute, repairRoutePatch, duration);
    if (targetRoute) patchRoute(targetRoute, targetHoldPatch, duration, true);
    return { repairActorId: anchor.actorId, targetActorId: anchor.targetId, anchorIds: [anchor.id], approachStart, rendezvousStart, workStart, workEnd, departureEnd, repairPosition, targetPosition, workPosition: repairPosition, contactPoint: repairRoutePatch.contactPoint, requiredCenterDistance, actualCenterDistance: Math.hypot(repairPosition.x - targetPosition.x, repairPosition.y - targetPosition.y), repairRoutePatch, targetHoldPatch, repairIndex: index, repairActorType: repairActor?.type || null, targetType: target?.type || null, valid: true };
  });
}

function boundsWidth(layout) { return layout?.bounds?.width || 1200; }

function chooseContactDirection(position, gap, bounds, index, blocked = [], clearance = 26) {
  const options = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  const margin = 26;
  for (const direction of options.slice(index % options.length).concat(options.slice(0, index % options.length))) { const x = position.x + direction.x * gap; const y = position.y + direction.y * gap; if (x > margin && x < bounds.width - margin && y > margin && y < bounds.height - margin && blocked.every((item) => Math.hypot(x - item.x, y - item.y) >= clearance + item.radius)) return direction; }
  return { x: position.x > bounds.width / 2 ? -1 : 1, y: 0 };
}

function patchRoute(route, patch, duration, holdOnly = false) {
  const original = route.points.slice().sort((a, b) => a.t - b.t); const ratio = (time) => Math.max(0, Math.min(1, time / duration)); const before = routePosition(original, ratio(patch.start)); const after = routePosition(original, ratio(patch.end ?? patch.departureEnd));
  if (!route.basePoints) route.basePoints = original.slice();
  const inserts = [{ t: ratio(patch.start), x: before.x, y: before.y }];
  if (!holdOnly) {
    if (patch.detour) inserts.push({ t: ratio((patch.start + patch.rendezvousStart) / 2), x: patch.detour.x, y: patch.detour.y }, { t: ratio(patch.rendezvousStart), x: patch.position.x, y: patch.position.y });
    else inserts.push({ t: ratio(patch.rendezvousStart), x: patch.position.x, y: patch.position.y });
    inserts.push({ t: ratio(patch.workStart), x: patch.position.x, y: patch.position.y }, { t: ratio(patch.workEnd), x: patch.position.x, y: patch.position.y }, { t: ratio(patch.departureEnd), x: after.x, y: after.y });
  }
  else inserts.push({ t: ratio(patch.start), x: patch.position.x, y: patch.position.y }, { t: ratio(patch.end), x: patch.position.x, y: patch.position.y });
  const filtered = original.filter((point) => !inserts.some((insert) => Math.abs(insert.t - point.t) < 1e-8)); route.points = [...filtered, ...inserts].sort((a, b) => a.t - b.t); route.repairPatches = [...(route.repairPatches || []), patch];
}

function routePosition(points, ratio) { if (!points?.length) return { x: 0, y: 0 }; if (ratio <= points[0].t) return { x: points[0].x, y: points[0].y }; for (let index = 1; index < points.length; index += 1) { const left = points[index - 1]; const right = points[index]; if (ratio <= right.t) { const amount = (ratio - left.t) / Math.max(1e-6, right.t - left.t); return { x: left.x + (right.x - left.x) * amount, y: left.y + (right.y - left.y) * amount }; } } return { x: points.at(-1).x, y: points.at(-1).y }; }
