import { createSpatialEntity } from './universal-spatial-entity-schema.js';

const cache = new WeakMap();

function allActors(plan) { return [...(plan.forces?.friendly || []), ...(plan.forces?.enemy || [])]; }
function routeById(plan) { return new Map((plan.layout?.routes || []).map((route) => [route.routeId, route])); }

function buildSpatialEntities(plan) {
  if (Array.isArray(plan.spatialEntities) && plan.spatialEntities.length) return plan.spatialEntities.map(createSpatialEntity);
  const entities = [];
  const destroyTimes = new Map();
  for (const anchor of plan.timeline?.anchors || []) if (anchor.type === 'destroy' && anchor.targetId) destroyTimes.set(anchor.targetId, Math.min(destroyTimes.get(anchor.targetId) ?? Infinity, anchor.t));
  for (const actor of allActors(plan)) {
    const route = plan.layout?.routes?.find((item) => item.actorId === actor.actorId);
    const destroyTime = actor.final?.alive === false ? (destroyTimes.get(actor.actorId) ?? 0) : Infinity;
    entities.push(createSpatialEntity({ id: actor.actorId, kind: 'actor', side: actor.side, sourceActorId: actor.actorId, solid: true, moving: true, routeId: route?.routeId, footprint: actor.footprint, lifecycle: { start: 0, end: destroyTime }, metadata: { type: actor.type } }));
    if (actor.final?.alive === false) entities.push(createSpatialEntity({ id: `wreck_${actor.actorId}`, kind: 'wreck', side: actor.side, sourceActorId: actor.actorId, solid: true, moving: false, footprint: actor.footprint, lifecycle: { start: destroyTime, end: Infinity } }));
  }
  for (const object of plan.scene?.sceneObjects || []) {
    const route = plan.layout?.sceneRoutes?.find((item) => item.objectId === object.id);
    entities.push(createSpatialEntity({ ...object, id: object.id, kind: object.kind === 'convoy_vehicle' ? 'convoy' : object.kind === 'objective_area' ? 'objective_area' : 'mission_object', sourceObjectId: object.id, routeId: route?.routeId || object.routeId, solid: object.solid === true, moving: Boolean(route), footprint: object.footprint, position: object.position, lifecycle: object.lifecycle || { start: 0, end: Infinity }, stateMachine: object.stateMachine }));
  }
  for (const prop of plan.scene?.props || []) entities.push(createSpatialEntity({ ...prop, kind: prop.solid === false ? 'decoration' : 'obstacle', sourceObjectId: prop.id, position: prop.position, footprint: prop.footprint, solid: prop.solid !== false, moving: false }));
  return entities;
}

function compileRoute(route) {
  const points = (route?.points || []).slice().sort((a, b) => a.t - b.t).map((point) => ({ t: Number(point.t), x: Number(point.x), y: Number(point.y) }));
  const basePoints = (route?.basePoints || points).slice().sort((a, b) => a.t - b.t).map((point) => ({ t: Number(point.t), x: Number(point.x), y: Number(point.y) }));
  return { routeId: route?.routeId || null, actorId: route?.actorId || null, points, basePoints, repairPatches: (route?.repairPatches || []).map((patch) => ({ ...patch })) };
}

export function compileUniversalPlan(plan) {
  if (!plan || typeof plan !== 'object') throw new TypeError('compileUniversalPlan requires a plan object');
  const cached = cache.get(plan); if (cached) return cached;
  const routes = (plan.layout?.routes || []).map(compileRoute);
  const sceneRoutes = (plan.layout?.sceneRoutes || []).map(compileRoute);
  const routeByActorId = new Map(routes.filter((route) => route.actorId).map((route) => [route.actorId, route]));
  const routeByIdMap = new Map([...routes, ...sceneRoutes].filter((route) => route.routeId).map((route) => [route.routeId, route]));
  const destroyTimeByActorId = new Map();
  for (const anchor of plan.timeline?.anchors || []) if (anchor.type === 'destroy' && anchor.targetId) destroyTimeByActorId.set(anchor.targetId, Math.min(destroyTimeByActorId.get(anchor.targetId) ?? Infinity, anchor.t));
  const repairWindowsByActorId = new Map();
  for (const repair of plan.timeline?.repairs || []) {
    if (!repairWindowsByActorId.has(repair.repairActorId)) repairWindowsByActorId.set(repair.repairActorId, []);
    repairWindowsByActorId.get(repair.repairActorId).push(repair);
  }
  const entities = buildSpatialEntities(plan);
  const spatialEntityById = new Map(entities.map((entity) => [entity.id, entity]));
  const spatialBuckets = new Map(); const bucketSize = 96;
  for (const entity of entities) {
    const position = entity.position || plan.layout?.nodes?.find((node) => node.actorId === entity.sourceActorId) || { x: 0, y: 0 };
    const key = `${Math.floor(position.x / bucketSize)},${Math.floor(position.y / bucketSize)}`;
    if (!spatialBuckets.has(key)) spatialBuckets.set(key, []); spatialBuckets.get(key).push(entity.id);
  }
  const compiled = Object.freeze({ plan, actors: allActors(plan), routes, sceneRoutes, actorById: new Map(allActors(plan).map((actor) => [actor.actorId, actor])), routeByActorId, routeById: routeByIdMap, spatialEntities: entities, spatialEntityById, destroyTimeByActorId, repairWindowsByActorId, routeSegments: [...routes, ...sceneRoutes].flatMap((route) => route.points.slice(1).map((point, index) => ({ routeId: route.routeId, from: route.points[index], to: point }))), timelineDuration: Number(plan.timeline?.duration) || 0, spatialBuckets, bucketSize });
  cache.set(plan, compiled); return compiled;
}

export function clearUniversalPlanCompilerCache() { /* WeakMap entries are intentionally released by GC. */ }
