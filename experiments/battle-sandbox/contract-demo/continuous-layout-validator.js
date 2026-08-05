import { FRIENDLY_BUILDINGS, ENEMY_BUILDINGS, OBJECTIVE } from '../sandbox-config.js';
import { createAuthorityState, applyAuthorityAnchorsThrough } from './authority-state.js';
import { updateVisualActor, positionAtSlot } from './contract-movement-director.js';
import { getRepairChoreographyAtTime } from './repair-choreography.js';
import { boundsIntersect, distanceBetween, getVisualBounds } from './visual-bounds.js';

const SAMPLE_STEP = 1 / 20;
const OBJECTIVE_FLAG_BOUNDS = Object.freeze({ left: 756, right: 764, top: 368, bottom: 449 });
const BUILDING_BOUNDS = Object.freeze([...FRIENDLY_BUILDINGS, ...ENEMY_BUILDINGS].map((building) => ({ left: building.x, right: building.x + building.w, top: building.y, bottom: building.y + building.h, id: `building_${building.x}_${building.y}` })));

function boundsForRect(rect) { return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.right - rect.left, height: rect.bottom - rect.top }; }
function pairKey(first, second) { return [first.id, second.id].sort().join('::'); }
function relation(first, second) { return first.side === second.side ? 'same_side' : 'cross_side'; }
function axisGap(first, second) { const dx = Math.max(first.left - second.right, second.left - first.right, 0); const dy = Math.max(first.top - second.bottom, second.top - first.bottom, 0); return Math.hypot(dx, dy); }
function cloneActor(actor) { return { ...actor, members: (actor.members || []).map((member) => ({ ...member })) }; }
function authorityAt(plan, contract, time) { const authority = createAuthorityState(contract); return applyAuthorityAnchorsThrough(authority, plan.anchors, time); }

export function getVisibleLogicalActorsAtTime(plan, contract, time) {
  const authority = authorityAt(plan, contract, time);
  const actors = (plan.actors || []).map((source) => updateVisualActor(cloneActor(source), time, authority, plan.routeRegistry));
  const positions = Object.fromEntries(actors.map((actor) => [actor.id, actor.visualCenter]));
  const choreography = getRepairChoreographyAtTime(plan, time, positions);
  if (choreography.repairVehicleId && choreography.repairPosition) {
    const repair = actors.find((actor) => actor.id === choreography.repairVehicleId);
    if (repair) { repair.visualCenter = choreography.repairPosition; repair.anchorPosition = choreography.repairPosition; repair.facing = Math.atan2(choreography.contactPoint.y - choreography.repairPosition.y, choreography.contactPoint.x - choreography.repairPosition.x); repair.turretFacing = repair.facing; }
  }
  return actors.filter((actor) => authority.actors[actor.id]?.alive === true).map((actor) => ({
    ...actor, actor, authority: authority.actors[actor.id], position: actor.visualCenter, bounds: getVisualBounds(actor, actor.visualCenter), choreography
  }));
}

function wrecksAtTime(plan, contract, time) {
  const authority = authorityAt(plan, contract, time); const wrecks = [];
  for (const actor of plan.actors || []) {
    const row = authority.actors[actor.id]; if (!row || row.alive !== false || !Number.isFinite(row.destroyedAt)) continue;
    const position = positionAtSlot(plan.routeRegistry, actor.templateSlot, row.destroyedAt);
    const wreckActor = { ...actor, members: [] };
    wrecks.push({ id: `wreck_${actor.id}`, sourceActorId: actor.id, side: actor.side, position, bounds: getVisualBounds(wreckActor, position) });
  }
  return wrecks;
}

export function findVisualIntersectionsAtTime(plan, contract, time) {
  const visible = getVisibleLogicalActorsAtTime(plan, contract, time); const intersections = [];
  for (let i = 0; i < visible.length; i += 1) for (let j = i + 1; j < visible.length; j += 1) {
    const first = visible[i]; const second = visible[j];
    if (boundsIntersect(first.bounds, second.bounds)) intersections.push({ kind: 'actor_actor', time, actorA: first.id, actorB: second.id, sideRelation: relation(first, second), boundsA: first.bounds, boundsB: second.bounds, durationEstimate: SAMPLE_STEP });
  }
  for (const actor of visible) {
    for (const building of BUILDING_BOUNDS) if (boundsIntersect(actor.bounds, building)) intersections.push({ kind: 'actor_building', time, actorA: actor.id, actorB: building.id, sideRelation: 'obstacle', boundsA: actor.bounds, boundsB: building, durationEstimate: SAMPLE_STEP });
    if (boundsIntersect(actor.bounds, boundsForRect(OBJECTIVE_FLAG_BOUNDS))) intersections.push({ kind: 'actor_objective_flag', time, actorA: actor.id, actorB: 'objective_flag', sideRelation: 'obstacle', boundsA: actor.bounds, boundsB: boundsForRect(OBJECTIVE_FLAG_BOUNDS), durationEstimate: SAMPLE_STEP });
  }
  for (const actor of visible) for (const wreck of wrecksAtTime(plan, contract, time)) if (boundsIntersect(actor.bounds, wreck.bounds)) intersections.push({ kind: 'actor_wreck', time, actorA: actor.id, actorB: wreck.id, sideRelation: 'obstacle', boundsA: actor.bounds, boundsB: wreck.bounds, durationEstimate: SAMPLE_STEP });
  return intersections;
}

function updateInterval(intervals, hit, time) {
  const key = `${hit.kind}:${hit.actorA}:${hit.actorB}`; const previous = intervals.get(key);
  if (previous && Math.abs(previous.lastTime - (time - SAMPLE_STEP)) < 1e-6) { previous.lastTime = time; previous.count += 1; return; }
  intervals.set(key, { ...hit, startTime: time, lastTime: time, count: 1 });
}

export function validateContinuousLayout(plan, contract, options = {}) {
  const step = Number(options.step || SAMPLE_STEP); const duration = Number(options.duration ?? plan.duration ?? 35); const samples = Math.round(duration / step) + 1; const intervals = new Map(); const minimumByPair = new Map();
  for (let index = 0; index < samples; index += 1) {
    const time = Math.min(duration, index * step); const hits = findVisualIntersectionsAtTime(plan, contract, time);
    for (const hit of hits) updateInterval(intervals, hit, time);
    const visible = getVisibleLogicalActorsAtTime(plan, contract, time);
    for (let i = 0; i < visible.length; i += 1) for (let j = i + 1; j < visible.length; j += 1) {
      if (visible[i].side !== visible[j].side) continue;
      const key = pairKey(visible[i], visible[j]); const current = Math.min(minimumByPair.get(key)?.centerDistance ?? Infinity, distanceBetween(visible[i].position, visible[j].position));
      const boundsGap = Math.min(minimumByPair.get(key)?.boundsGap ?? Infinity, axisGap(visible[i].bounds, visible[j].bounds));
      minimumByPair.set(key, { actorA: visible[i].id, actorB: visible[j].id, centerDistance: current, boundsGap });
    }
  }
  const allIntervals = [...intervals.values()].map((interval) => ({ ...interval, durationEstimate: (interval.lastTime - interval.startTime) + step }));
  const errors = []; const accepted = [];
  for (const interval of allIntervals) {
    if (interval.kind === 'actor_actor' && interval.sideRelation === 'same_side') errors.push(`same_side_visual_overlap:${interval.actorA}:${interval.actorB}@${interval.startTime.toFixed(2)}-${interval.lastTime.toFixed(2)}`);
    else if (interval.kind === 'actor_actor' && interval.sideRelation === 'cross_side' && interval.durationEstimate > 0.20 + 1e-9) errors.push(`cross_side_visual_overlap_too_long:${interval.actorA}:${interval.actorB}:${interval.durationEstimate.toFixed(2)}`);
    else if (interval.kind !== 'actor_actor') errors.push(`${interval.kind}:${interval.actorA}:${interval.actorB}@${interval.startTime.toFixed(2)}`);
    else accepted.push(interval);
  }
  return { ok: errors.length === 0, errors, sampleStep: step, sampleCount: samples, samples, intersections: allIntervals, acceptedCrossSideIntersections: accepted, minimumClearances: [...minimumByPair.values()] };
}

export { BUILDING_BOUNDS, OBJECTIVE_FLAG_BOUNDS, SAMPLE_STEP };
