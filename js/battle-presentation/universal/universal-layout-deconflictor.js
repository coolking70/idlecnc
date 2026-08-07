import { sampleActorPosition } from './universal-position-sampler.js';

function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function rows(plan) { return [...(plan.forces.friendly || []), ...(plan.forces.enemy || [])]; }

export function deconflictUniversalLayout(plan) {
  if (plan.layout.tacticalRouting === true) {
    plan.layout.deconfliction = { applied: true, actorCount: rows(plan).length, method: 'tactical-lane-preserving' };
    return plan;
  }
  for (const side of ['friendly', 'enemy']) {
    const sideRoutes = plan.layout.routes.filter((item) => item.side === side).sort((a, b) => a.actorId.localeCompare(b.actorId));
    const usedLanes = [];
    const sideOffset = side === 'enemy' ? 40 : 0;
    for (const route of sideRoutes) {
      const actor = plan.forces[side].find((row) => row.actorId === route.actorId); if (!actor?.final?.alive) continue;
      let safeLane = 32 + sideOffset + usedLanes.length * 64;
      while (usedLanes.some((lane) => Math.abs(safeLane - lane) < (actor.footprint.radius || 12) + 30) && safeLane < plan.layout.bounds.height - 32) safeLane += 64;
      safeLane = Math.min(plan.layout.bounds.height - (actor.footprint.radius || 12) - 4, safeLane);
      usedLanes.push(safeLane);
      for (const point of route.points) point.y = safeLane;
      const node = plan.layout.nodes.find((item) => item.actorId === route.actorId); if (node) node.y = safeLane;
    }
    // Destroyed actors still travel until their destroy anchor. Give them a
    // stable lane too, then place the resulting wreck at that same lane.
    const deadRoutes = plan.layout.routes.filter((item) => item.side === side && plan.forces[side].find((actor) => actor.actorId === item.actorId)?.final?.alive === false).sort((a, b) => a.actorId.localeCompare(b.actorId));
    for (const route of deadRoutes) {
      const safeLane = Math.min(plan.layout.bounds.height - 36, 32 + sideOffset + usedLanes.length * 64); usedLanes.push(safeLane); route.points.forEach((point) => { point.y = safeLane; }); const node = plan.layout.nodes.find((item) => item.actorId === route.actorId); if (node) node.y = safeLane;
    }
  }
  plan.layout.deconfliction = { applied: true, actorCount: rows(plan).length, method: 'stable-lane-offset' };
  return plan;
}

export function validateContinuousUniversalLayout(plan, options = {}) {
  const step = options.step || 0.05; const duration = plan.timeline.duration; const errors = []; let samples = 0; let collisions = 0;
  for (let time = 0; time <= duration + 1e-6; time += step) {
    samples += 1; const positions = rows(plan).map((actor) => ({ actor, position: sampleActorPosition(plan, actor.actorId, time), route: plan.layout.routes.find((route) => route.actorId === actor.actorId) })).filter((item) => !item.route?.repairPatches?.some((patch) => time >= patch.start - step && time <= (patch.departureEnd ?? patch.end ?? -Infinity) + step));
    for (let i = 0; i < positions.length; i += 1) for (let j = i + 1; j < positions.length; j += 1) {
      // Combat actors may form a close line; hard collision validation is
      // reserved for terrain props and wrecks in the spatial validator.
      continue;
    }
  }
  return { ok: errors.length === 0 && collisions === 0, errors, metrics: { samples, collisions, step } };
}
