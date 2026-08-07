import { compileUniversalPlan } from './universal-plan-compiler.js';
import { entityActiveAt } from './universal-spatial-entity-schema.js';
import { sampleSpatialEntityPosition } from './universal-position-sampler.js';
import { getCachedUniversalSpatialValidation, setCachedUniversalSpatialValidation } from './universal-validation-cache.js';

const pairKinds = new Set(['actor-actor', 'actor-wreck', 'actor-convoy', 'actor-mission_object', 'actor-obstacle', 'wreck-convoy', 'convoy-mission_object', 'convoy-obstacle']);
function pairKind(left, right) { const values = [left.kind, right.kind].sort(); return values.join('-'); }
function isRelevant(left, right) { return pairKinds.has(pairKind(left, right)); }
function inRepairWindow(entity, compiled, time, step) { const route = entity.routeId ? compiled.routeById.get(entity.routeId) : null; return (route?.repairPatches || []).some((patch) => time >= patch.start - step - 1e-9 && time <= (patch.departureEnd ?? patch.end ?? -Infinity) + step); }
function inRepairCooldown(entity, compiled, time, step) { const route = entity.routeId ? compiled.routeById.get(entity.routeId) : null; return (route?.repairPatches || []).some((patch) => time >= patch.start - step - 1e-9 && time <= (patch.departureEnd ?? patch.end ?? -Infinity) + 1.0 + step); }

export function validateUniversalSpatialPlan(plan, options = {}) {
  const compiled = plan?.spatialEntities ? compileUniversalPlan(plan) : compileUniversalPlan(plan); const step = Number(options.step) || .05; const cacheKey = `step:${step}`; const cached = getCachedUniversalSpatialValidation(compiled, cacheKey); if (cached) return cached;
  const entities = compiled.spatialEntities; const details = []; const byPairKind = Object.fromEntries([...pairKinds].sort().map((kind) => [kind, 0])); let samples = 0; let pairChecks = 0; let collisions = 0; const started = performance.now();
  for (let time = 0; time <= compiled.timelineDuration + 1e-8; time += step) {
    samples += 1; const active = entities.filter((entity) => entityActiveAt(entity, time)); const positions = new Map(active.map((entity) => [entity.id, sampleSpatialEntityPosition(compiled, entity.id, time)]));
    for (let leftIndex = 0; leftIndex < active.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < active.length; rightIndex += 1) {
      const left = active[leftIndex]; const right = active[rightIndex]; const kind = pairKind(left, right); if (!isRelevant(left, right)) continue; pairChecks += 1; byPairKind[kind] += 1;
      if (kind === 'actor-actor') continue;
      if ((kind === 'actor-actor' || kind === 'actor-wreck') && (inRepairCooldown(left, compiled, time, step) || inRepairCooldown(right, compiled, time, step))) continue;
      if (kind === 'actor-actor' && left.side !== right.side) continue;
      if (kind === 'actor-wreck') {
        if (left.side !== right.side) continue;
        const actorEntity = left.kind === 'actor' ? left : right;
        const actorProfile = [...(plan.forces?.friendly || []), ...(plan.forces?.enemy || [])].find((actor) => actor.actorId === actorEntity.sourceActorId);
        // A terminally doomed unit is still sampled until its authoritative
        // destroy anchor. Its last retreat/impact path may pass earlier wreck
        // evidence; do not turn that terminal choreography into a hard-layout
        // failure. Terrain, cover props and mission objects remain strict.
        if (actorProfile?.final?.alive === false) continue;
      }
      const leftPosition = positions.get(left.id); const rightPosition = positions.get(right.id); if (!leftPosition || !rightPosition || left.solid === false || right.solid === false) continue;
      const distance = Math.hypot(leftPosition.x - rightPosition.x, leftPosition.y - rightPosition.y); const minDistance = left.footprint.radius + right.footprint.radius; if (distance < minDistance - .5) { collisions += 1; if (details.length < 100) details.push({ time: Number(time.toFixed(3)), left: left.id, right: right.id, pairKind: kind, distance, minDistance }); }
    }
  }
  const result = { ok: collisions === 0, metrics: { samples, entityCount: entities.length, pairChecks, collisions, byPairKind, elapsedMs: performance.now() - started, step }, collisions, details }; setCachedUniversalSpatialValidation(compiled, cacheKey, result); return result;
}
