import { environmentSignature } from './environment-scene-builder.js';

export function buildEnvironmentState(scene, seconds = 0) {
  const time = Math.max(0, Number(seconds) || 0);
  return { version: scene?.version || '8.2G-C-environment-1', time, terrainId: scene?.terrainId || null, bounds: scene?.bounds ? { ...scene.bounds } : null, zones: (scene?.zones || []).map((zone) => ({ ...zone, center: { ...zone.center } })), objects: (scene?.objects || []).map((object) => ({ ...object, position: { ...object.position }, geometry: { ...object.geometry } })), layers: { ...(scene?.layers || {}) }, windVector: { ...(scene?.windVector || { x: 0, y: 0 }) }, metrics: { ...(scene?.metrics || {}), routeSegmentViolations: [...(scene?.metrics?.routeSegmentViolations || [])] }, signature: environmentSignature(scene) };
}
