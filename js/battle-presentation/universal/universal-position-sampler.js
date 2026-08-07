import { compileUniversalPlan } from './universal-plan-compiler.js';

export function sampleRoutePosition(points = [], ratio = 0) {
  if (!points.length) return { x: 0, y: 0 };
  const sorted = points.slice().sort((a, b) => a.t - b.t); const value = Math.max(0, Math.min(1, Number(ratio) || 0));
  if (value <= sorted[0].t) return { x: sorted[0].x, y: sorted[0].y };
  for (let index = 1; index < sorted.length; index += 1) { const left = sorted[index - 1]; const right = sorted[index]; if (value <= right.t) { const amount = (value - left.t) / Math.max(1e-9, right.t - left.t); return { x: left.x + (right.x - left.x) * amount, y: left.y + (right.y - left.y) * amount }; } }
  return { x: sorted.at(-1).x, y: sorted.at(-1).y };
}

export function sampleSpatialEntityPosition(compiledPlan, entityId, seconds) {
  const compiled = compiledPlan?.plan ? compiledPlan : compileUniversalPlan(compiledPlan); const entity = compiled.spatialEntityById.get(entityId); if (!entity) return null;
  const time = Math.max(0, Number(seconds) || 0); const duration = Math.max(1, compiled.timelineDuration); const lifecycleStart = Number(entity.lifecycle?.start || 0); const lifecycleEnd = Number(entity.lifecycle?.end ?? Infinity); const route = entity.routeId ? compiled.routeById.get(entity.routeId) : null;
  if (entity.kind === 'actor') {
    const destroy = compiled.destroyTimeByActorId.get(entity.sourceActorId); const capped = Number.isFinite(destroy) ? Math.min(time, destroy) : time; const activePatch = route?.repairPatches?.filter((patch) => time >= patch.start - 1e-9 && time <= (patch.departureEnd ?? patch.end ?? -Infinity) + 1e-9).sort((a, b) => a.start - b.start).at(-1); const position = activePatch?.position || sampleRoutePosition(route?.basePoints || route?.points, capped / duration); return { ...position, ratio: capped / duration, state: activePatch ? 'repairing' : Number.isFinite(destroy) && time >= destroy ? 'destroyed' : 'moving', entityId, actorId: entity.sourceActorId };
  }
  if (entity.kind === 'wreck') { const position = entity.position || sampleRoutePosition(route?.points, lifecycleStart / duration); return { ...position, ratio: lifecycleStart / duration, state: time >= lifecycleStart ? 'wreck_static' : 'actor_moving', entityId, actorId: entity.sourceActorId }; }
  if (route) {
    const ratio = Math.max(0, Math.min(1, time / duration)); const position = sampleRoutePosition(route.points, ratio); const mode = compiled.plan.source?.result; const finalState = entity.stateMachine?.[mode] || (ratio >= .96 ? 'arrived' : 'moving'); return { ...position, ratio, state: finalState, entityId, objectId: entity.sourceObjectId };
  }
  return { ...(entity.position || { x: 0, y: 0 }), ratio: time < lifecycleStart ? 0 : 1, state: time < lifecycleStart ? 'inactive' : (entity.stateMachine?.static || 'fixed'), entityId, objectId: entity.sourceObjectId };
}

export function sampleActorPosition(plan, actorId, seconds, options = {}) {
  const compiled = compileUniversalPlan(plan); const entity = compiled.spatialEntityById.get(actorId); if (!entity) return null;
  if (options.ignoreRepair) return sampleSpatialEntityPosition(compiled, actorId, seconds);
  return sampleSpatialEntityPosition(compiled, actorId, seconds);
}

export function sampleSceneObjectPosition(plan, objectId, seconds) { return sampleSpatialEntityPosition(compileUniversalPlan(plan), objectId, seconds); }
