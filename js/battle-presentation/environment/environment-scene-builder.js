import { buildEnvironmentLayout } from './environment-layout.js';

const cache = new WeakMap();

export function buildEnvironmentScene(plan, options = {}) {
  if (!plan || typeof plan !== 'object') throw new TypeError('buildEnvironmentScene requires a plan');
  if (options.engagementSchedule) {
    let schedules = cache.get(plan); if (!(schedules instanceof WeakMap)) { schedules = new WeakMap(); cache.set(plan, schedules); }
    const cached = schedules.get(options.engagementSchedule); if (cached) return cached;
    const scene = Object.freeze(buildEnvironmentLayout(plan, options)); schedules.set(options.engagementSchedule, scene); return scene;
  }
  const cached = cache.get(plan); if (cached && !(cached instanceof WeakMap)) return cached;
  const scene = Object.freeze(buildEnvironmentLayout(plan)); cache.set(plan, scene); return scene;
}

export function environmentSignature(scene) {
  return JSON.stringify({ version: scene?.version, terrainId: scene?.terrainId, seed: scene?.seed, zones: scene?.zones, objects: scene?.objects, layers: scene?.layers, windVector: scene?.windVector });
}
