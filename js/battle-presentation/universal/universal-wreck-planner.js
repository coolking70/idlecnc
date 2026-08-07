import { sampleRoutePosition } from './universal-position-sampler.js';
import { normalizeFootprint } from './universal-spatial-entity-schema.js';

export function buildUniversalWreckEntities(plan) {
  const result = []; const actors = [...(plan.forces?.friendly || []), ...(plan.forces?.enemy || [])];
  for (const actor of actors.filter((row) => row.final?.alive === false)) {
    const destroy = (plan.timeline?.anchors || []).filter((anchor) => anchor.type === 'destroy' && anchor.targetId === actor.actorId).sort((a, b) => a.t - b.t)[0];
    const route = plan.layout.routes.find((item) => item.actorId === actor.actorId);
    const destructionTime = destroy?.t ?? 0; const position = route?.wreckPosition || (route ? sampleRoutePosition(route.basePoints || route.points, destructionTime / Math.max(1, plan.timeline.duration)) : plan.layout.nodes.find((node) => node.actorId === actor.actorId));
    // A wreck is persistent battle evidence, not a terrain wall. Hard
    // collision semantics belong to cover bands, obstacles and mission
    // objects; keeping debris passable prevents terminal retreat routes from
    // being rejected when they cross an earlier same-side wreck.
    result.push({ id: `wreck_${actor.actorId}`, kind: 'wreck', sourceActorId: actor.actorId, side: actor.side, authority: false, solid: false, moving: false, footprint: normalizeFootprint(actor.footprint), position: { x: position?.x || 0, y: position?.y || 0 }, lifecycle: { start: destructionTime, end: Infinity }, stateMachine: { before: 'actor_moving', after: 'wreck_static' } });
  }
  return result;
}
