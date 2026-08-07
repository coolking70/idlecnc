import { normalizeFootprint } from './universal-spatial-entity-schema.js';

const point = (x, y) => ({ x, y });

export function buildUniversalSceneSpatialObjects(scene, terrain, mission, intent, bounds = { width: 1200, height: 700 }) {
  const tactical = terrain.tacticalLayout || {};
  const objectiveX = Number(tactical.objectiveX) || 900;
  const objectiveY = Number(tactical.laneCenters?.[1]) || 350;
  const objects = (scene.sceneObjects || []).map((object, index) => {
    if (object.kind === 'convoy_vehicle') return { ...object, id: 'convoy_scene_object_1', routeId: 'scene_route_1', solid: true, footprint: normalizeFootprint({ width: 40, height: 24, radius: 24 }), position: point(235, 665), stateMachine: { moving: 'moving', arrived: 'arrived', withdraw: 'returned', defeat: 'returned', wiped: 'stopped', pyrrhic: 'arrived_damaged' } };
    if (object.kind === 'salvage_site') return { ...object, solid: false, footprint: normalizeFootprint({ width: 56, height: 40, radius: 28 }), position: point(objectiveX, objectiveY), lifecycle: { start: 0, end: Infinity } };
    if (object.kind === 'salvage_team') return { ...object, solid: false, footprint: normalizeFootprint({ width: 28, height: 20, radius: 15 }), position: point(Math.max(100, objectiveX - 82), Math.min(bounds.height - 40, objectiveY + 190)), moving: true };
    if (object.kind === 'search_sector') return { ...object, solid: false, footprint: normalizeFootprint({ width: 120, height: 70, radius: 60 }), position: point(300 + index * 190, tactical.laneCenters?.[index % 3] || 350), objectiveRole: 'sweep_sector' };
    return { ...object, solid: false, footprint: normalizeFootprint({ width: 70, height: 60, radius: 35 }), position: point(objectiveX, objectiveY) };
  });
  return { ...scene, bounds, sceneObjects: objects, objective: { ...scene.objective, traversable: true } };
}

export function buildUniversalObstacleGeometry(terrain, bounds = { width: 1200, height: 700 }) {
  const types = terrain.obstacles || [];
  const templates = { scrap_heap: [18, 12], crater: [16, 10], berm: [20, 10], checkpoint: [22, 10], barrier: [20, 10], ditch: [18, 8], bunker: [24, 12], sandbag: [18, 8], watchtower: [16, 16], barbed_wire: [20, 6] };
  const obstacles = Array.isArray(terrain.obstacleLayout) && terrain.obstacleLayout.length ? terrain.obstacleLayout : types.map((type, index) => { const [width, height] = templates[type] || [18, 10]; return { type, x: 300 + index * 180, y: 350, width, height, cover: 'light' }; });
  const layout = [...obstacles, ...(Array.isArray(terrain.coverLayout) ? terrain.coverLayout.map((item) => ({ ...item, tacticalCover: true })) : [])];
  return layout.map((item, index) => { const [fallbackWidth, fallbackHeight] = templates[item.type] || [18, 10]; const width = Number(item.width) || fallbackWidth; const height = Number(item.height) || fallbackHeight; const x = Math.max(width + 10, Math.min(bounds.width - width - 10, Number(item.x) || 0)); const y = Math.max(height + 10, Math.min(bounds.height - height - 10, Number(item.y) || 0)); return { id: `prop_${index + 1}`, type: item.type, semantic: item.tacticalCover ? 'tactical_soft_cover' : 'non_authority_scene_prop', authority: false, solid: false, passable: true, collisionPolicy: 'soft_cover', tacticalCover: item.tacticalCover === true, coverRole: item.coverRole || null, laneId: item.laneId || null, cover: item.cover || 'light', footprint: normalizeFootprint({ width: width * 1.25, height: height * 1.25, radius: Math.max(width, height) * .62 }), position: point(x, y), geometry: { shape: 'box', width, height } }; });
}
