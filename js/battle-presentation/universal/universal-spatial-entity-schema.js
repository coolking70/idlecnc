export const SPATIAL_ENTITY_KINDS = Object.freeze(['actor', 'wreck', 'convoy', 'mission_object', 'obstacle', 'objective_area', 'decoration']);

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function normalizeFootprint(footprint = {}) {
  const width = Math.max(0, finite(footprint.width, finite(footprint.radius, 12) * 2));
  const height = Math.max(0, finite(footprint.height, finite(footprint.radius, 12) * 2));
  const radius = Number.isFinite(Number(footprint.radius)) ? Math.max(0, Number(footprint.radius)) : Math.hypot(width, height) / 2;
  return { width, height, radius };
}

export function createSpatialEntity(input = {}) {
  const kind = SPATIAL_ENTITY_KINDS.includes(input.kind) ? input.kind : 'decoration';
  const footprint = normalizeFootprint(input.footprint);
  const position = input.position ? { x: finite(input.position.x), y: finite(input.position.y) } : null;
  return {
    id: String(input.id), kind, side: input.side || 'neutral', authority: input.authority === true,
    sourceActorId: input.sourceActorId || null, sourceObjectId: input.sourceObjectId || null,
    sourceId: input.sourceId || input.sourceActorId || input.sourceObjectId || String(input.id),
    solid: input.solid !== false, moving: input.moving === true, lifecycle: input.lifecycle || { start: 0, end: Infinity },
    footprint, routeId: input.routeId || null, position, polygon: input.polygon || null,
    objectiveRole: input.objectiveRole || null, stateMachine: input.stateMachine || null,
    metadata: input.metadata || null
  };
}

export function entityActiveAt(entity, seconds) {
  const start = finite(entity.lifecycle?.start, 0); const end = finite(entity.lifecycle?.end, Infinity);
  return seconds >= start - 1e-9 && seconds < end - 1e-9;
}

export function entityRadius(entity) { return normalizeFootprint(entity?.footprint).radius; }
