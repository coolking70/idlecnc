function zonePoint(zone, index = 0, count = 1) {
  const xs = zone.polygon.map((point) => point.x); const ys = zone.polygon.map((point) => point.y); const x = Math.min(...xs); const y = Math.min(...ys); const width = Math.max(...xs) - x; const height = Math.max(...ys) - y;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count))); const col = index % columns; const row = Math.floor(index / columns); const rows = Math.max(1, Math.ceil(count / columns));
  return { x: x + ((col + 1) / (columns + 1)) * width, y: y + ((row + 1) / (rows + 1)) * height };
}

function lerp(a, b, t) { return a + (b - a) * t; }
function point(x, y, t) { return { t, x, y }; }
function segment(start, end, startT, endT) { return [point(start.x, start.y, startT), point(lerp(start.x, end.x, .5), lerp(start.y, end.y, .5), startT + (endT - startT) * .5), point(end.x, end.y, endT)]; }
function hold(position, startT, endT) { return [point(position.x, position.y, startT), point(position.x, position.y, endT)]; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function sampleRoute(points = [], ratio = 0) { const sorted = points.slice().sort((a, b) => a.t - b.t); const value = clamp(ratio, 0, 1); if (!sorted.length) return { x: 0, y: 0 }; if (value <= sorted[0].t) return sorted[0]; for (let index = 1; index < sorted.length; index += 1) { if (value <= sorted[index].t) { const left = sorted[index - 1]; const right = sorted[index]; const amount = (value - left.t) / Math.max(1e-9, right.t - left.t); return { x: lerp(left.x, right.x, amount), y: lerp(left.y, right.y, amount) }; } } return sorted.at(-1); }

function distanceToSegment(pointA, pointB, target) {
  const dx = pointB.x - pointA.x; const dy = pointB.y - pointA.y; const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-9) return Math.hypot(target.x - pointA.x, target.y - pointA.y);
  const ratio = Math.max(0, Math.min(1, ((target.x - pointA.x) * dx + (target.y - pointA.y) * dy) / lengthSquared));
  return Math.hypot(target.x - (pointA.x + dx * ratio), target.y - (pointA.y + dy * ratio));
}

function routeClear(pointA, pointB, obstacles) {
  return obstacles.every((obstacle) => distanceToSegment(pointA, pointB, obstacle) >= obstacle.clearance - 1e-6);
}

// The tactical route is deliberately authored as stage landmarks (staging,
// cover, firing, approach).  This visibility graph only inserts non-authority
// motion points where a solid scene prop blocks one of those landmarks; it
// never changes the authority timeline or the tactical stage semantics.
export function detourSegment(start, end, obstacles, preferredSide = null) {
  if (!obstacles.length || routeClear(start, end, obstacles)) return [{ x: start.x, y: start.y }, { x: end.x, y: end.y }];
  const blocking = obstacles.filter((obstacle) => distanceToSegment(start, end, obstacle) < obstacle.clearance);
  const graph = [{ x: start.x, y: start.y, obstacleId: null }, { x: end.x, y: end.y, obstacleId: null }];
  blocking.forEach((obstacle, obstacleId) => {
    const radius = obstacle.clearance + 8;
    for (let index = 0; index < 16; index += 1) {
      const angle = (Math.PI * 2 * index) / 16;
      graph.push({ x: obstacle.x + Math.cos(angle) * radius, y: obstacle.y + Math.sin(angle) * radius, obstacleId });
    }
  });
  const midpointY = (start.y + end.y) / 2; const preferredSides = blocking.map((obstacle) => preferredSide ?? (midpointY < obstacle.y ? 1 : -1));
  const distances = Array(graph.length).fill(Infinity); const previous = Array(graph.length).fill(-1); const visited = new Set(); distances[0] = 0;
  for (let iteration = 0; iteration < graph.length; iteration += 1) {
    let current = -1; let best = Infinity;
    for (let index = 0; index < graph.length; index += 1) if (!visited.has(index) && distances[index] < best) { current = index; best = distances[index]; }
    if (current < 0) break;
    visited.add(current);
    if (current === 1) break;
    for (let next = 0; next < graph.length; next += 1) {
      if (visited.has(next) || next === current) continue;
      const candidate = graph[next]; if (!routeClear(graph[current], candidate, obstacles)) continue;
      if (candidate.obstacleId !== null && (candidate.y - blocking[candidate.obstacleId].y) * preferredSides[candidate.obstacleId] < -1e-6) continue;
      const weight = Math.hypot(candidate.x - graph[current].x, candidate.y - graph[current].y); const sidePenalty = candidate.obstacleId === null ? 0 : ((candidate.y - blocking[candidate.obstacleId].y) * preferredSides[candidate.obstacleId] < 0 ? 5000 : 0); const distance = distances[current] + weight + sidePenalty;
      if (distance < distances[next]) { distances[next] = distance; previous[next] = current; }
    }
  }
  let path = [];
  if (Number.isFinite(distances[1])) {
    for (let current = 1; current >= 0; current = previous[current]) { path.unshift({ x: graph[current].x, y: graph[current].y }); if (current === 0) break; }
    if (path.every((item, index) => index === 0 || routeClear(path[index - 1], item, obstacles))) return path;
  }
  // The fallback needs more room than the nominal circle radius: the route
  // is sampled at discrete time steps and a single corner can otherwise
  // re-enter the expanded wreck footprint on the segment to the exit point.
  const obstacle = blocking[0]; const clearance = obstacle.clearance + 20;
  const sides = preferredSide === null ? [1, -1] : [preferredSide, -preferredSide];
  const candidates = [];
  for (const side of sides) {
    const left = { x: obstacle.x - clearance, y: obstacle.y + side * clearance }; const right = { x: obstacle.x + clearance, y: obstacle.y + side * clearance };
    candidates.push([left, right], [right, left]);
  }
  for (const side of [1, -1]) {
    const top = { x: obstacle.x + side * clearance, y: obstacle.y - clearance }; const bottom = { x: obstacle.x + side * clearance, y: obstacle.y + clearance };
    candidates.push([top, bottom], [bottom, top]);
  }
  for (const [first, second] of candidates) {
    if (routeClear(start, first, obstacles) && routeClear(first, second, obstacles) && routeClear(second, end, obstacles)) return [{ x: start.x, y: start.y }, first, second, { x: end.x, y: end.y }];
  }
  return path.length ? path : [{ x: start.x, y: start.y }, { x: end.x, y: end.y }];
}

function safePosition(position, obstacles, time = 0) {
  let safe = { x: position.x, y: position.y };
  for (let iteration = 0; iteration < obstacles.length * 2; iteration += 1) {
    const obstacle = obstacles.find((item) => time >= (item.lifecycleStart ?? 0) - 1e-9 && Math.hypot(safe.x - item.x, safe.y - item.y) < item.clearance);
    if (!obstacle) break;
    const radius = obstacle.clearance + 8; const lateral = radius * .72 * (safe.x < obstacle.x ? -1 : 1); const vertical = radius * .694 * (safe.y < obstacle.y ? 1 : -1);
    safe = { x: obstacle.x + lateral, y: obstacle.y + vertical };
  }
  return safe;
}

export function routeAroundObstacles(points, props, actorRadius, preferredSide = null, ignoredActorId = null) {
  const obstacles = (props || []).filter((prop) => prop?.solid !== false && prop.position && prop.actorId !== ignoredActorId).map((prop) => ({ x: Number(prop.position.x), y: Number(prop.position.y), clearance: Number(prop.footprint?.radius || 0) + actorRadius + 5, lifecycleStart: prop.lifecycleStart === Infinity ? Infinity : (Number.isFinite(Number(prop.lifecycleStart)) ? Number(prop.lifecycleStart) : 0) }));
  if (!obstacles.length || points.length < 2) return points;
  const expanded = []; const lifecycleTimes = [...new Set(obstacles.map((item) => item.lifecycleStart).filter((time) => time > 0 && time < 1))].sort((a, b) => a - b);
  for (let index = 0; index < points.length - 1; index += 1) { const start = points[index]; const end = points[index + 1]; if (!expanded.length) expanded.push(start); for (const time of lifecycleTimes) if (time > start.t + 1e-8 && time < end.t - 1e-8) { const ratio = (time - start.t) / Math.max(1e-9, end.t - start.t); expanded.push({ t: time, x: lerp(start.x, end.x, ratio), y: lerp(start.y, end.y, ratio) }); } expanded.push(end); }
  const adjusted = expanded.map((item) => ({ ...item, ...safePosition(item, obstacles, item.t) }));
  const safePoints = [];
  for (let index = 0; index < adjusted.length - 1; index += 1) {
    const start = adjusted[index]; const end = adjusted[index + 1]; const activeObstacles = obstacles.filter((item) => start.t >= item.lifecycleStart - 1e-9); const path = detourSegment(start, end, activeObstacles, preferredSide);
    const lengths = path.slice(1).map((item, pathIndex) => Math.hypot(item.x - path[pathIndex].x, item.y - path[pathIndex].y)); const total = Math.max(1e-9, lengths.reduce((sum, value) => sum + value, 0)); let elapsed = 0;
    path.forEach((item, pathIndex) => {
      if (pathIndex > 0) elapsed += lengths[pathIndex - 1];
      const t = total < 1e-8 ? (pathIndex === path.length - 1 ? end.t : start.t) : start.t + (end.t - start.t) * (elapsed / total); if (!safePoints.length || Math.abs(safePoints.at(-1).t - t) > 1e-8) safePoints.push({ t, x: item.x, y: item.y }); else safePoints[safePoints.length - 1] = { t, x: item.x, y: item.y };
    });
  }
  return safePoints;
}

function safeTarget(node, destination, index, count, result, force, side, tactical) {
  if (!destination) return { x: node.x, y: node.y };
  if ((result === 'withdraw' || result === 'defeat') && side === 'friendly' && force?.final?.alive !== false) { const edgeY = count > 1 ? 36 + (index / (count - 1)) * 628 : 350; return { x: 42, y: Math.max(36, Math.min(664, edgeY)) }; }
  const target = zonePoint(destination, index, count);
  if (side === 'friendly' && destination) {
    const centerY = destination.center?.y ?? target.y; const formationOffset = (index - (count - 1) / 2) * 64;
    target.y = Math.max(70, Math.min(630, centerY + formationOffset));
  } else target.y = node.y;
  if (side === 'enemy' && tactical) target.x = Math.max(tactical.enemyScreenX || target.x, target.x - 180);
  if (result === 'pyrrhic' && force.final.hp / Math.max(1, force.final.maxHp) < .5) return { x: lerp(node.x, target.x, .35), y: lerp(node.y, target.y, .35) };
  return target;
}

function laneDetour(layout, node, laneId = node.tacticalLane, yOverride = null) {
  const profile = layout.tacticalLayout || {};
  const value = profile.detour?.[laneId] || 0;
  const hasOverride = yOverride !== null && yOverride !== undefined && Number.isFinite(Number(yOverride));
  return { y: hasOverride ? Number(yOverride) : node.y + value, x: profile.friendlyStagingX || 320 };
}

function tacticalRoute(node, finalTarget, layout, intent, side, force, props = [], contact = {}) {
  const profile = layout.tacticalLayout || {};
  const result = intent.outcome.id;
  // A unit that will eventually be destroyed still has to advance until its
  // authoritative destroy anchor.  Only the sampler freezes it at that
  // anchor; freezing the whole route made wiped/low-force scenes look like
  // two spawn lines firing forever.
  const staying = false;
  if (staying) {
    const stationary = point(node.x, node.y, 0);
    return { advanceRoute: hold(node, 0, .42), combatRoute: hold(node, .42, .76), finalRoute: hold(node, .76, 1), retreatRoute: hold(node, .76, 1), points: [stationary, point(node.x, node.y, 1)], tactical: { laneId: node.tacticalLane, stage: 'destroyed_or_held', cover: false } };
  }
  const detour = laneDetour(layout, node, contact.laneId || node.tacticalLane, contact.y);
  const stagingX = side === 'friendly' ? (profile.friendlyStagingX || 320) : (profile.enemyScreenX || 860);
  const firingX = side === 'friendly' ? (profile.friendlyFireX || 590) : (profile.enemyFireX || 790);
  const approachX = side === 'friendly' ? (profile.friendlyApproachX || 790) : Math.max(firingX, finalTarget.x);
  const staging = { x: stagingX, y: detour.y };
  const covered = { x: Math.max(stagingX + 80, firingX - 110), y: detour.y };
  const coverProp = props.find((prop) => prop?.tacticalCover === true && prop.coverRole === side && prop.laneId === (contact.laneId || node.tacticalLane));
  if (coverProp?.position) {
    const offset = Math.max(34, Number(force?.footprint?.radius || node.radius || 12) + 12);
    covered.x = side === 'friendly'
      ? clamp(coverProp.position.x - offset, stagingX + 60, firingX - 22)
      : clamp(coverProp.position.x + offset, firingX + 22, (profile.enemyDeployX || 1095) - 40);
  }
  const firing = { x: firingX, y: detour.y };
  const approach = { x: approachX, y: detour.y };
  const final = { x: finalTarget.x, y: finalTarget.y };
  const retreating = (result === 'withdraw' || result === 'defeat') && side === 'friendly' && force?.final?.alive !== false;
  const advanceEnd = retreating ? .18 : .2;
  const laneIndexForTransition = Number.isFinite(Number(node.tacticalLaneIndex)) ? Number(node.tacticalLaneIndex) : 1;
  const transitionX = clamp(stagingX + (laneIndexForTransition - 1) * 120, 180, side === 'friendly' ? firingX - 140 : (profile.enemyDeployX || 1095) - 140);
  const advanceRoute = [point(node.x, node.y, 0), point(transitionX, node.y, advanceEnd * .38), point(transitionX, staging.y, advanceEnd * .78), point(staging.x, staging.y, advanceEnd)];
  const combatRoute = retreating
    ? [...segment(staging, covered, .18, .30), ...segment(covered, firing, .30, .46).slice(1), ...hold(firing, .46, .62).slice(1)]
    : [...segment(staging, covered, .2, .34), ...segment(covered, firing, .34, .54).slice(1), ...segment(firing, approach, .54, .76).slice(1)];
  const retreat = finalTarget;
  const edge = { x: retreat.x, y: detour.y };
  const finalRoute = retreating
    ? [point(firing.x, firing.y, .62), point(lerp(firing.x, edge.x, .5), lerp(firing.y, edge.y, .5), .78), point(edge.x, edge.y, .88), point(retreat.x, retreat.y, 1)]
    : segment(approach, final, .76, 1);
  const coverValue = coverProp?.cover === 'heavy' ? 0.72 : coverProp?.cover === 'light' ? 0.38 : coverProp?.cover === 'denial' ? 0.18 : 0;
  return { advanceRoute, combatRoute, finalRoute, retreatRoute: retreating ? finalRoute : segment(final, node, .76, 1), points: [...advanceRoute, ...combatRoute.slice(1), ...finalRoute.slice(1)], tactical: { laneId: contact.laneId || node.tacticalLane, originalLaneId: node.tacticalLane, stage: retreating ? 'advance_cover_fire_disengage' : 'advance_cover_fire_objective', staging, covered, firing, approach, engagementRange: Math.max(180, Math.round(Math.abs(firingX - (side === 'friendly' ? profile.enemyFireX || 790 : profile.friendlyFireX || 590)))), cover: Boolean(coverProp), coverPropId: coverProp?.id || null, coverValue } };
}

function contactFor(node, assignment, layout, intent, sideRows = []) {
  const engagement = (intent.engagements || []).find((row) => row.actorId === assignment.actorId);
  const targetNode = engagement ? layout.nodes.find((candidate) => candidate.actorId === engagement.targetId) : null;
  const profile = layout.tacticalLayout || {};
  const targetLaneId = targetNode?.tacticalLane || node.tacticalLane;
  const desiredLane = (row) => {
    const first = (intent.engagements || []).find((item) => item.actorId === row.actorId);
    const target = first ? layout.nodes.find((candidate) => candidate.actorId === first.targetId) : null;
    return target?.tacticalLane || layout.nodes.find((candidate) => candidate.actorId === row.actorId)?.tacticalLane;
  };
  const firstEngagementTime = (row) => Number((intent.engagements || []).find((item) => item.actorId === row.actorId)?.sourceTime ?? Infinity);
  const peers = sideRows.filter((row) => desiredLane(row) === targetLaneId).sort((a, b) => firstEngagementTime(a) - firstEngagementTime(b) || (layout.nodes.find((item) => item.actorId === a.actorId)?.y || 0) - (layout.nodes.find((item) => item.actorId === b.actorId)?.y || 0) || a.actorId.localeCompare(b.actorId));
  const peerIndex = Math.max(0, peers.findIndex((row) => row.actorId === assignment.actorId));
  // Keep the contact group on the target's tactical lane.  Rotating a large
  // group across unrelated lanes made the first shot look like a long-range
  // cross-map exchange, especially when one side had only a few units.  The
  // bounded lateral spread below is enough to avoid a perfect stack while
  // preserving a believable line-of-attack and cover relationship.
  const laneId = targetLaneId;
  const maxRadius = Math.max(...peers.map((row) => Number(layout.nodes.find((item) => item.actorId === row.actorId)?.radius || 12)), Number(node.radius || 12));
  const spread = Math.max(42, maxRadius * 2 + 6);
  const laneIndex = Math.max(0, (profile.laneIds || []).indexOf(laneId));
  const laneCenter = Number(profile.laneCenters?.[laneIndex]);
  const laneBase = Number.isFinite(laneCenter) ? laneCenter : node.y;
  const laneY = laneBase + (profile.detour?.[laneId] || 0);
  const lateral = (peerIndex - (peers.length - 1) / 2) * spread;
  const height = Number(layout.bounds?.height) || 700;
  const span = ((peers.length - 1) / 2) * spread;
  const safeCenter = clamp(laneY, 36 + span, height - 36 - span);
  return { laneId, y: clamp(safeCenter + lateral, 36, height - 36), targetId: targetNode?.actorId || null };
}

export function planUniversalRoutes(layout, assignments, intent, forces = { friendly: [], enemy: [] }, props = [], timeline = null) {
  const routes = [];
  const routeProps = props;
  for (const side of ['friendly', 'enemy']) {
    const sideRows = assignments.filter((item) => item.side === side); const destination = side === 'friendly' ? (layout.zones.find((zone) => zone.objectiveRole === 'primary') || layout.zones.find((zone) => zone.kind === 'objective')) : (layout.zones.find((zone) => zone.id === 'enemy_depth') || layout.zones.find((zone) => zone.side === 'enemy'));
    const geometricOrder = sideRows.slice().sort((a, b) => (layout.nodes.find((node) => node.actorId === a.actorId)?.y || 0) - (layout.nodes.find((node) => node.actorId === b.actorId)?.y || 0) || a.actorId.localeCompare(b.actorId));
    const contactByActor = new Map(sideRows.map((assignment) => [assignment.actorId, contactFor(layout.nodes.find((item) => item.actorId === assignment.actorId), assignment, layout, intent, sideRows)]));
    sideRows.forEach((assignment) => {
      const index = geometricOrder.findIndex((item) => item.actorId === assignment.actorId); const node = layout.nodes.find((item) => item.actorId === assignment.actorId); const force = (forces[side] || []).find((row) => row.actorId === assignment.actorId); const finalTarget = safeTarget(node, destination, index, sideRows.length, intent.outcome.id, force, side, layout.tacticalLayout);
      if (side === 'friendly' && ['victory', 'pyrrhic'].includes(intent.outcome.id)) finalTarget.x += intent.strategy.id === 'cautious' ? -34 : intent.strategy.id === 'breakthrough' ? 34 : 0;
      const planned = tacticalRoute(node, finalTarget, layout, intent, side, force, routeProps, contactByActor.get(assignment.actorId));
      planned.points = routeAroundObstacles(planned.points, routeProps, force?.footprint?.radius || node.radius || 12, node.tacticalLaneIndex === 0 ? -1 : 1, assignment.actorId);
      routes.push({ actorId: assignment.actorId, side, routeId: `route_${assignment.actorId}`, ...planned, retreat: side === 'friendly' && (intent.outcome.id === 'withdraw' || intent.outcome.id === 'defeat'), outcomeMode: intent.outcome.id, finalTarget });
    });
  }
  // Reconcile cover metadata after lane distribution. A large force may be
  // spread across alternate contact lanes after the route is authored; the
  // final route lane is the only authoritative lookup for its soft-cover
  // marker.
  for (const route of routes) {
    const coverProp = routeProps.find((prop) => prop?.tacticalCover === true && prop.coverRole === route.side && prop.laneId === route.tactical?.laneId);
    if (!coverProp) continue;
    const radius = route.side === 'friendly' ? (forces.friendly.find((row) => row.actorId === route.actorId)?.footprint?.radius || 12) : (forces.enemy.find((row) => row.actorId === route.actorId)?.footprint?.radius || 12);
    route.tactical.cover = true; route.tactical.coverPropId = coverProp.id; route.tactical.coverValue = coverProp.cover === 'heavy' ? 0.72 : coverProp.cover === 'light' ? 0.38 : 0.18;
    if (route.tactical.covered) route.tactical.covered.x = route.side === 'friendly' ? clamp(coverProp.position.x - Math.max(34, radius + 12), 180, route.tactical.firing.x - 22) : clamp(coverProp.position.x + Math.max(34, radius + 12), route.tactical.firing.x + 22, 1055);
  }
  const wreckProps = [];
  for (const side of ['friendly', 'enemy']) for (const actor of forces[side] || []) {
    if (actor.final?.alive !== false) continue;
    const destroy = (timeline?.anchors || []).find((anchor) => anchor.type === 'destroy' && anchor.targetId === actor.actorId);
    const route = routes.find((item) => item.actorId === actor.actorId);
    if (!route || !destroy) continue;
    const ratio = Number(destroy.t) / Math.max(1, Number(timeline?.duration) || 30);
    const position = sampleRoute(route.points, ratio);
    route.wreckPosition = { x: position.x, y: position.y, ratio };
    wreckProps.push({ id: `wreck_${actor.actorId}`, actorId: actor.actorId, solid: true, position, footprint: actor.footprint, lifecycleStart: ratio });
  }
  if (wreckProps.length) for (const route of routes) route.points = routeAroundObstacles(route.points, [...routeProps, ...wreckProps], route.side === 'friendly' ? (forces.friendly.find((row) => row.actorId === route.actorId)?.footprint?.radius || 12) : (forces.enemy.find((row) => row.actorId === route.actorId)?.footprint?.radius || 12), null, route.actorId);
  return { routes, metrics: { routeCount: routes.length, retreatRoutes: routes.filter((route) => route.retreat).length, safeEdgeRoutes: routes.filter((route) => route.finalTarget.x < 100 && route.side === 'friendly').length, tacticalRoutes: routes.filter((route) => route.tactical?.stage).length } };
}
