import { buildEnvironmentLayout } from './environment-layout.js';

const cache = new WeakMap();

export function buildEnvironmentScene(plan) {
  if (!plan || typeof plan !== 'object') throw new TypeError('buildEnvironmentScene requires a plan');
  const cached = cache.get(plan); if (cached) return cached;
  const scene = Object.freeze(buildEnvironmentLayout(plan)); cache.set(plan, scene); return scene;
}

export function environmentSignature(scene) {
  return JSON.stringify({ version: scene?.version, terrainId: scene?.terrainId, seed: scene?.seed, zones: scene?.zones, objects: scene?.objects, layers: scene?.layers, windVector: scene?.windVector });
}
