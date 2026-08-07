import { hashString } from './universal-plan-schema.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function polygonFor(row, jitter) { const dx = ((jitter + row.id.length * 7) % 9) - 4; const dy = ((jitter + row.kind.length * 5) % 7) - 3; const x = clamp(row.x + dx, 10, 1180 - row.width); const y = clamp(row.y + dy, 10, 690 - row.height); return [{ x, y }, { x: x + row.width, y }, { x: x + row.width, y: y + row.height }, { x, y: y + row.height }]; }
function centerOf(polygon) { return { x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length, y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length }; }

export function generateTacticalZones(scene, forces, intent, fingerprint = '') {
  const width = scene.bounds?.width || 1200; const height = scene.bounds?.height || 700; const jitter = Number.parseInt(hashString(`${fingerprint}:${intent.strategy.id}`).slice(0, 4), 16) % 37;
  const blueprint = scene.terrain.zoneBlueprint || [];
  const zones = blueprint.map((row, index) => { const polygon = polygonFor(row, jitter + index * 3); const center = centerOf(polygon); return { id: row.id, kind: row.kind, polygon, center, capacity: row.capacity || Math.max(1, Math.floor((row.width * row.height) / 5500)), allowedTags: row.allowedTags || [], forbiddenTags: row.forbiddenTags || [], side: row.side || 'neutral', traversable: row.traversable !== false, coverValue: row.coverValue ?? scene.terrain.cover ?? 0.25, objectiveRole: row.objectiveRole || null, lane: scene.terrain.lanes[index % Math.max(1, scene.terrain.lanes.length)] }; });
  return { bounds: { width, height }, zones, lanes: scene.terrain.lanes || ['center'], tacticalLayout: scene.terrain.tacticalLayout || null, objectiveAnchor: intent.objective.anchor, metrics: { laneCount: scene.terrain.lanes?.length || 1, zoneCount: zones.length, generatedFrom: hashString(`${fingerprint}:${intent.forceCounts.total}:${scene.terrain.id}`), geometryHash: hashString(JSON.stringify(zones.map((zone) => ({ id: zone.id, polygon: zone.polygon })))) } };
}
