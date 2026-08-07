import { vocabularyForTerrain, profileForEnvironmentObject } from './environment-object-profiles.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}

export function deterministicUnit(seed, salt = '') {
  return (stableHash(`${seed}:${salt}`) % 100000) / 100000;
}

function distance(a, b) { return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0)); }
export function distanceToSegment(point, start, end) { const ax = Number(start?.x || 0); const ay = Number(start?.y || 0); const bx = Number(end?.x || 0); const by = Number(end?.y || 0); const dx = bx - ax; const dy = by - ay; const lengthSquared = dx * dx + dy * dy; const t = lengthSquared > 0 ? Math.max(0, Math.min(1, ((Number(point?.x || 0) - ax) * dx + (Number(point?.y || 0) - ay) * dy) / lengthSquared)) : 0; return distance(point, { x: ax + dx * t, y: ay + dy * t }); }
function zoneCenter(zone) { return zone?.center || { x: Number(zone?.x || 0) + Number(zone?.width || 0) / 2, y: Number(zone?.y || 0) + Number(zone?.height || 0) / 2 }; }
function zoneForIndex(zones, index) { return zones[index % Math.max(1, zones.length)] || { id: 'open_ground', kind: 'open_ground', x: 0, y: 0, width: 1200, height: 700 }; }
function routePoints(plan) { return (plan?.layout?.routes || []).flatMap((route) => route.points || []).map((point) => ({ x: point.x, y: point.y })); }
export function buildRouteSegments(plan) { return (plan?.layout?.routes || []).flatMap((route) => { const points = (route.points || []).map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 })); return points.slice(1).map((end, index) => ({ routeId: route.id || route.actorId || `route-${index}`, actorId: route.actorId || null, start: points[index], end })); }); }
function objectivePoints(plan) { return [plan?.intent?.objective?.anchor, ...(plan?.layout?.zones || []).filter((zone) => zone.objectiveRole).map(zoneCenter)].filter(Boolean); }

function clearOfGameplay(object, reserved) {
  const radius = Number(object.clearanceRadius || 20);
  return reserved.every((point) => distance(object.position, point) > radius + Number(point.clearanceRadius || 28));
}

export function routeClearanceRadius(object) {
  if (['rock', 'industrial_prop', 'cover', 'fence', 'barrier', 'debris_static'].includes(object.category) || object.variant === 'machine_module') return Number(object.clearanceRadius || 20) + 30;
  if (['vegetation', 'terrain_surface'].includes(object.category)) return Number(object.clearanceRadius || 20) + 10;
  return Number(object.clearanceRadius || 20) + 18;
}

function clearOfRouteSegments(object, segments) { const required = routeClearanceRadius(object); return segments.every((segment) => distanceToSegment(object.position, segment.start, segment.end) >= required); }

function candidateFor(zone, index, seed, bounds) {
  const center = zoneCenter(zone); const spanX = Math.max(30, Number(zone.width || 180) * .42); const spanY = Math.max(24, Number(zone.height || 120) * .42);
  const x = center.x + (deterministicUnit(seed, `x:${zone.id}:${index}`) - .5) * spanX * 2;
  const y = center.y + (deterministicUnit(seed, `y:${zone.id}:${index}`) - .5) * spanY * 2;
  return { x: clamp(x, 18, bounds.width - 18), y: clamp(y, 18, bounds.height - 18) };
}

function objectGeometry(variant, index) {
  const geometry = {
    headframe: { shape: 'frame', width: 54, height: 42, clearanceRadius: 34 }, conveyor: { shape: 'line', width: 76, height: 14, clearanceRadius: 38 }, ore_silo: { shape: 'circle', width: 28, height: 28, clearanceRadius: 26 }, machine_module: { shape: 'box', width: 38, height: 24, clearanceRadius: 26 }, objective_frame: { shape: 'frame', width: 42, height: 38, clearanceRadius: 30 }, soft_sandbag: { shape: 'sandbag', width: 54, height: 14, clearanceRadius: 34 }, heavy_berm: { shape: 'berm', width: 68, height: 22, clearanceRadius: 40 }, compacted_road: { shape: 'road', width: 150, height: 24, clearanceRadius: 80 }, rail_track: { shape: 'track', width: 160, height: 12, clearanceRadius: 84 }, spoil_embankment: { shape: 'berm', width: 72, height: 20, clearanceRadius: 40 }, low_scrub: { shape: 'scrub', width: 20, height: 14, clearanceRadius: 22 }, shale: { shape: 'rock', width: 18 + (index % 3) * 5, height: 12 + (index % 2) * 4, clearanceRadius: 20 }, fence_line: { shape: 'fence', width: 70, height: 8, clearanceRadius: 40 }, concrete_barrier: { shape: 'barrier', width: 44, height: 12, clearanceRadius: 30 }, drainage_ditch: { shape: 'ditch', width: 72, height: 12, clearanceRadius: 40 }, static_debris: { shape: 'debris', width: 22, height: 12, clearanceRadius: 22 }
  };
  return geometry[variant] || geometry.static_debris;
}

function countForTerrain(terrainId) { return terrainId === 'open' ? 42 : terrainId === 'fortified' ? 34 : 30; }

export function buildEnvironmentLayout(plan) {
  const bounds = plan?.layout?.bounds || plan?.scene?.bounds || { width: 1200, height: 700 };
  const seed = plan?.source?.seed ?? 0; const terrainId = plan?.scene?.terrain?.id || 'open'; const zones = (plan?.layout?.zones || []).filter(Boolean);
  const reserved = [...routePoints(plan), ...objectivePoints(plan), ...(plan?.scene?.props || []).map((prop) => ({ ...prop.position, clearanceRadius: 18 }))]; const routeSegments = buildRouteSegments(plan);
  const variants = vocabularyForTerrain(terrainId); const objects = [];
  for (let index = 0; index < countForTerrain(terrainId); index += 1) {
    const zone = zoneForIndex(zones, index + (terrainId === 'open' ? 1 : 0)); const variant = variants[stableHash(`${seed}:${zone.id}:${index}`) % variants.length]; const geometry = objectGeometry(variant, index); let item = null;
    for (let attempt = 0; attempt < 12 && !item; attempt += 1) { const position = candidateFor(zone, index * 13 + attempt, seed, bounds); const candidate = { id: `env_${terrainId}_${index + 1}`, category: profileForEnvironmentObject({ variant }).category, variant, zoneId: zone.id || 'open_ground', layer: zone.kind || 'open_ground', position, geometry, clearanceRadius: geometry.clearanceRadius, visualOnly: true, routeBlocking: false, authority: false, seed: stableHash(`${seed}:${variant}:${index}`) }; if (clearOfGameplay(candidate, reserved) && clearOfGameplay(candidate, objects) && clearOfRouteSegments(candidate, routeSegments)) item = candidate; }
    if (item) objects.push(item);
  }
  const layers = {
    base: terrainId === 'open' ? '#344c38' : terrainId === 'road' ? '#414b44' : '#4b4035',
    largeVariation: 18, smallVariation: 96, tracks: terrainId === 'road' ? 3 : terrainId === 'open' ? 5 : 2,
    stains: terrainId === 'open' ? 20 : 12, stones: terrainId === 'open' ? 34 : 18, battleMarks: 0
  };
  const routeSegmentViolations = objects.flatMap((object) => routeSegments.filter((segment) => distanceToSegment(object.position, segment.start, segment.end) < routeClearanceRadius(object)).map((segment) => ({ objectId: object.id, routeId: segment.routeId, distance: distanceToSegment(object.position, segment.start, segment.end), required: routeClearanceRadius(object) })));
  return { version: '8.2G-C-environment-1', terrainId, seed, bounds: { ...bounds }, zones: zones.map((zone) => ({ id: zone.id, kind: zone.kind, center: zoneCenter(zone), width: Number(zone.width || zone.size?.width || 0), height: Number(zone.height || zone.size?.height || 0), visualOnly: true })), objects, layers, windVector: { x: -0.14 + deterministicUnit(seed, 'wind:x') * .28, y: -0.04 + deterministicUnit(seed, 'wind:y') * .08 }, metrics: { objectCount: objects.length, zoneCount: zones.length, routeBlockingObjects: 0, routeSegmentViolations, routeSegmentCount: routeSegments.length, generatedFrom: ['Mission', 'Scene Grammar', 'Objective', 'Routes', 'Cover', 'Battlefield bounds', 'Seed'] } };
}
