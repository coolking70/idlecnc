function zoneBounds(zone) { const xs = zone.polygon.map((point) => point.x); const ys = zone.polygon.map((point) => point.y); return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }; }
function pointFor(zone, index, count, side) {
  const bounds = zoneBounds(zone);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const column = index % columns; const row = Math.floor(index / columns);
  return { x: bounds.x + ((column + 1) / (columns + 1)) * bounds.width, y: bounds.y + ((row + 1) / (rows + 1)) * bounds.height, side };
}

function overlaps(a, b) {
  const dx = a.x - b.x; const dy = a.y - b.y; const min = (a.radius || 12) + (b.radius || 12);
  return dx * dx + dy * dy < min * min;
}

export function planUniversalLayout(forces, assignments, zones) {
  const zoneRows = Array.isArray(zones) ? zones : zones.zones;
  const tactical = Array.isArray(zones) ? null : zones.tacticalLayout;
  const nodes = []; const nodeById = new Map();
  for (const side of ['friendly', 'enemy']) {
    const rows = forces[side] || []; const zoneId = side === 'friendly' ? 'friendly_deploy' : 'enemy_depth'; const zone = zoneRows.find((item) => item.id === zoneId) || zoneRows.find((item) => item.side === side);
    rows.forEach((force, index) => {
      const assignment = assignments.find((item) => item.actorId === force.actorId);
      const explicitRole = assignment?.primaryRole;
      const roleLane = explicitRole === 'vanguard' || explicitRole === 'armor' ? 1
        : explicitRole === 'overwatch' ? 0
          : explicitRole === 'support' ? 2
            : explicitRole === 'line' && intentDoctrineIsCombined(assignments) ? (index % 2 ? 2 : 0)
              : null;
      const preferredLane = roleLane === null
        ? (force.tags?.includes('scout') ? 0 : force.tags?.includes('armor') ? 1 : force.tags?.includes('repair') ? 2 : (index % 3))
        : roleLane;
      const laneIndex = Math.max(0, Math.min((tactical?.laneCenters?.length || 3) - 1, preferredLane));
      const laneCenter = tactical?.laneCenters?.[laneIndex] ?? pointFor(zone, index, rows.length, side).y;
      const sameLane = rows.slice(0, index).filter((row, priorIndex) => {
        const priorAssignment = assignments.find((item) => item.actorId === row.actorId);
        const priorRole = priorAssignment?.primaryRole;
        const priorLane = priorRole === 'vanguard' || priorRole === 'armor' ? 1
          : priorRole === 'overwatch' ? 0
            : priorRole === 'support' ? 2
              : priorRole === 'line' && intentDoctrineIsCombined(assignments) ? (priorIndex % 2 ? 2 : 0)
                : (row.tags?.includes('scout') ? 0 : row.tags?.includes('armor') ? 1 : row.tags?.includes('repair') ? 2 : (priorIndex % 3));
        return priorLane === laneIndex;
      }).length;
      const laneSpread = sameLane === 0 ? 0 : (sameLane % 2 ? 1 : -1) * Math.ceil(sameLane / 2) * 46;
      const deployX = side === 'friendly' ? (tactical?.friendlyDeployX ?? 110) : (tactical?.enemyDeployX ?? 1090);
      let position = tactical ? { x: deployX, y: laneCenter + laneSpread, side } : pointFor(zone, index, rows.length, side);
      let attempts = 0;
      while (nodes.some((node) => node.side === side && overlaps(node, { ...position, radius: force.footprint.radius })) && attempts < 30) { position = { ...position, y: position.y + 13 }; attempts++; }
      position.x = Math.max(force.footprint.radius + 4, Math.min(zones.bounds.width - force.footprint.radius - 4, position.x)); position.y = Math.max(force.footprint.radius + 4, Math.min(zones.bounds.height - force.footprint.radius - 4, position.y));
      const node = { id: `node_${force.actorId}`, actorId: force.actorId, side, groupId: assignment.groupId, role: assignment.primaryRole, tacticalLane: tactical?.laneIds?.[laneIndex] || null, tacticalLaneIndex: laneIndex, ...position, radius: force.footprint.radius, footprint: force.footprint };
      nodes.push(node); nodeById.set(force.actorId, node);
    });
  }
  if (tactical) {
    for (const side of ['friendly', 'enemy']) for (let laneIndex = 0; laneIndex < (tactical.laneCenters?.length || 3); laneIndex += 1) {
      const laneNodes = nodes.filter((node) => node.side === side && node.tacticalLaneIndex === laneIndex).sort((a, b) => a.y - b.y || a.actorId.localeCompare(b.actorId));
      if (laneNodes.length < 2) continue;
      const maximumRadius = Math.max(...laneNodes.map((node) => node.radius || 12)); const minimumY = maximumRadius + 4; const maximumY = zones.bounds.height - maximumRadius - 4; const step = Math.max(2 * maximumRadius + 4, 42); const span = step * (laneNodes.length - 1); const center = tactical.laneCenters?.[laneIndex] ?? zones.bounds.height / 2; const start = Math.max(minimumY, Math.min(center - span / 2, maximumY - span));
      laneNodes.forEach((node, index) => { node.y = Math.max(minimumY, Math.min(maximumY, start + index * step)); });
    }
  }
  const sameSideOverlaps = nodes.filter((node, i) => nodes.slice(i + 1).some((other) => other.side === node.side && overlaps(node, other))).length;
  return { bounds: zones.bounds, zones: zoneRows, tacticalLayout: tactical, tacticalRouting: Boolean(tactical), nodes, metrics: { nodeCount: nodes.length, sameSideOverlaps, uniqueActorNodes: nodeById.size } };
}

function intentDoctrineIsCombined(assignments) {
  return assignments.some((item) => item.primaryRole === 'vanguard' || item.primaryRole === 'armor')
    && assignments.some((item) => item.primaryRole === 'line' || item.primaryRole === 'overwatch');
}
