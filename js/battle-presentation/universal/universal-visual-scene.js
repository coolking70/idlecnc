/**
 * Production visual scene model for 8.2G-A.
 * Purely derives a frame from a plan, a clock and a precomputed shot schedule.
 */
import { buildVisualShotSchedule, visualWeaponProfile, deterministicUnit } from './visual-weapon-profiles.js';
import { deploymentSemanticEnd, movementVisualState, normalizeVisualState, plannerActionToVisualState } from './visual-state-machine.js';
import { resolveBattlePhase } from './universal-battle-phase-resolver.js';
import { separateVisualFootprints, visualFootprint } from './visual-footprints.js';
import { assignmentAtTime, retreatAtTime, suppressionSourceAtTime, suppressionTargetAtTime } from './universal-engagement-choreographer.js';
import { buildEnvironmentScene } from '../environment/environment-scene-builder.js';
import { buildPersistentDestructionLayer } from '../environment/destruction-layer.js';
import { normalizeVisualUnitClass } from '../environment/visual-unit-class.js';
import { OFFLINE_ASSET_MANIFEST } from '../environment/asset-provider.js';
import { resolveMuzzleAnchor } from '../environment/animation-resolver.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const TAU = Math.PI * 2;

function actorRows(plan) { return [...(plan?.forces?.friendly || []), ...(plan?.forces?.enemy || [])]; }
function point(actor) { return actor?.visualCenter || actor?.position || { x: 0, y: 0 }; }
function distance(a, b) { return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0)); }

function latestAnchor(plan, predicate, seconds) {
  return (plan?.timeline?.anchors || []).filter((anchor) => Number(anchor.t) <= seconds + 1e-9 && predicate(anchor)).at(-1) || null;
}

function latestDestroy(plan, actorId) {
  return (plan?.timeline?.anchors || []).filter((anchor) => anchor.type === 'destroy' && anchor.targetId === actorId).at(-1) || null;
}

function latestDamage(plan, actorId, seconds) {
  return latestAnchor(plan, (anchor) => anchor.type === 'damage' && anchor.targetId === actorId, seconds);
}

function activeShot(schedule, actorId, seconds) {
  return schedule.filter((shot) => shot.actorId === actorId && seconds >= shot.t - shot.weapon.aimDuration && seconds <= shot.impactTime + shot.weapon.impactLife).at(-1) || null;
}

function nextAction(plan, actorId, seconds) {
  return (plan?.timeline?.actions || []).filter((action) => action.actorIds?.includes?.(actorId) && Number(action.t) > seconds).sort((a, b) => Number(a.t) - Number(b.t))[0] || null;
}

function currentAction(plan, actorId, seconds) {
  return (plan?.timeline?.actions || [])
    .filter((action) => Number(action.t) <= seconds + 1e-9 && (!action.actorIds || action.actorIds.includes(actorId)))
    .at(-1)?.type || 'holding';
}

function stateWindow(plan, actorId, seconds) {
  const current = (plan?.timeline?.actions || []).filter((action) => action.actorIds?.includes?.(actorId) && Number(action.t) <= seconds + 1e-9).at(-1);
  const following = nextAction(plan, actorId, seconds);
  const start = Number(current?.t) || 0; const end = Number(following?.t ?? plan?.timeline?.duration ?? start + 1);
  return { progress: clamp((seconds - start) / Math.max(.001, end - start), 0, 1), start, end, action: current?.type || 'holding' };
}

function movementFacingFor(actor, presentationFacing = null) {
  if (Number.isFinite(actor?.movementFacing)) return actor.movementFacing;
  if (Number.isFinite(presentationFacing)) return presentationFacing;
  const current = point(actor); const later = actor.nextPosition || current;
  return distance(current, later) > .01 ? Math.atan2(later.y - current.y, later.x - current.x) : Number(actor.facing) || 0;
}

function aimFacingFor(actor, seconds, shot, visual, movementFacing) {
  if (shot && seconds >= shot.t - shot.weapon.aimDuration) {
    const shotFacing = Number(shot.sourceFacingAtFire);
    return Number.isFinite(shotFacing) ? shotFacing : movementFacing;
  }
  if (Number.isFinite(visual?.presentationFacing)) return visual.presentationFacing;
  if (Number.isFinite(actor?.aimFacing)) return actor.aimFacing;
  return movementFacing;
}

function unitAssetEntry(actor) {
  const visualClass = normalizeVisualUnitClass(actor); const type = visualClass === 'anti_armor_infantry' ? 'at_infantry' : visualClass; return OFFLINE_ASSET_MANIFEST.assets.find((asset) => asset.id === `unit_${actor?.side || 'friendly'}_${type}`) || null;
}

function muzzlePointForShot(shot, actors) {
  const actor = actors.find((item) => item.id === shot.actorId || item.actorId === shot.actorId); const source = shot.sourcePositionAtFire || actor?.visualCenter || { x: 0, y: 0 }; if (!actor) return { point: { ...source }, anchor: { ok: false, reason: 'source_actor_missing' } };
  const entry = unitAssetEntry(actor); const facing = Number(shot.sourceFacingAtFire ?? actor.facing) || 0; const anchoredActor = { ...actor, facing, turretFacing: facing }; const anchor = resolveMuzzleAnchor(anchoredActor, entry, undefined); if (!anchor.ok) return { point: { ...source }, anchor };
  const visualClass = normalizeVisualUnitClass(actor); const width = visualClass === 'mbt' ? 60 : visualClass === 'anti_armor_infantry' ? 34 : visualClass === 'infantry' ? 30 : 44; const height = visualClass === 'mbt' ? 36 : visualClass === 'anti_armor_infantry' ? 40 : visualClass === 'infantry' ? 36 : 22; const forward = anchor.forward * width / 2; const lateral = anchor.lateral * height / 2;
  return { point: { x: source.x + Math.cos(facing) * forward - Math.sin(facing) * lateral, y: source.y + Math.sin(facing) * forward + Math.cos(facing) * lateral }, anchor: { ...anchor, sourceActorId: shot.actorId, sourceFacingAtFire: facing, source: 'manifest.weaponMuzzleAnchor' } };
}

function memberPositions(actor, center, facing, visualState, seconds) {
  const visualClass = normalizeVisualUnitClass(actor);
  const count = visualClass === 'infantry' || visualClass === 'anti_armor_infantry' ? (visualClass === 'anti_armor_infantry' ? 3 : 4) : 0;
  if (!count) return [];
  const offsets = count === 3 ? [[-10, -7], [8, -3], [-4, 9]] : [[-14, -9], [8, -8], [-8, 8], [14, 8]];
  const moving = visualState === 'move'; const walkCycle = moving ? (seconds * (visualClass === 'anti_armor_infantry' ? 4.2 : 5.1)) : 0;
  const cos = Math.cos(facing); const sin = Math.sin(facing);
  return offsets.map(([ox, oy], index) => {
    const step = moving ? Math.sin(walkCycle + index * 1.6) * 2.4 : 0;
    const bob = moving ? Math.abs(Math.sin(walkCycle + index * 1.6)) * 1.4 : 0;
    return {
      x: center.x + ox * cos - oy * sin + step * Math.cos(facing + Math.PI / 2),
      y: center.y + ox * sin + oy * cos + step * Math.sin(facing + Math.PI / 2) - bob,
      facing,
      stance: moving ? (index % 2 ? 'step' : 'stride') : visualState === 'fire' ? 'braced' : 'stand',
      walkPhase: ((walkCycle + index * 1.6) % TAU + TAU) % TAU,
      role: visualClass === 'anti_armor_infantry' && index === 0 ? 'rocket' : 'rifle'
    };
  });
}

function resolveVisualState(plan, actor, seconds, schedule, engagementSchedule) {
  const destroy = latestDestroy(plan, actor.actorId);
  if (destroy) {
    const age = seconds - Number(destroy.t);
    if (age >= 0 && age < 0.95) return { id: 'destroying', progress: clamp(age / 0.95, 0, 1), authorityAnchorId: destroy.id };
    if (age >= 0.95 || seconds >= Number(plan.timeline?.duration || 0) - 1e-9) return { id: 'wreck', progress: 1, authorityAnchorId: destroy.id };
  }
  const damage = latestDamage(plan, actor.actorId, seconds);
  if (damage && seconds - Number(damage.t) < .42) return { id: 'hit', progress: clamp((seconds - damage.t) / .42, 0, 1), authorityAnchorId: damage.id };
  const shot = activeShot(schedule, actor.actorId, seconds);
  if (shot) {
    const age = seconds - shot.t;
    if (age < 0) return { id: 'aim', progress: clamp((age + shot.weapon.aimDuration) / shot.weapon.aimDuration, 0, 1), shot };
    if (age <= shot.weapon.fireDuration) return { id: 'fire', progress: clamp(age / shot.weapon.fireDuration, 0, 1), shot };
    if (seconds <= shot.t + shot.weapon.fireDuration + shot.weapon.reloadDuration) return { id: 'reload', progress: clamp((seconds - shot.t - shot.weapon.fireDuration) / shot.weapon.reloadDuration, 0, 1), shot };
  }
  const action = currentAction(plan, actor.actorId, seconds);
  const window = stateWindow(plan, actor.actorId, seconds);
  const previous = actor.previousPosition || actor.visualCenter;
  const movement = movementVisualState({ seconds, current: actor.visualCenter, previous, next: actor.nextPosition, deploymentEnd: deploymentSemanticEnd(plan, actor.actorId) });
  const actionRecord = (plan.timeline?.actions || []).filter((item) => item.actorIds?.includes?.(actor.actorId) && Number(item.t) <= seconds + 1e-9).at(-1);
  const actionAge = actionRecord ? seconds - Number(actionRecord.t) : Infinity;
  const transition = action === 'advance' && actionAge < .6 ? 'turn' : action === 'take_cover' && actionAge < .7 ? 'brake' : movement;
  const suppressionSource = suppressionSourceAtTime(engagementSchedule, actor.actorId, seconds);
  const suppressionTarget = suppressionTargetAtTime(engagementSchedule, actor.actorId, seconds);
  const retreat = retreatAtTime(engagementSchedule, actor.actorId, seconds);
  if (retreat) return { id: retreat.coverFire ? 'cover_fire' : 'retreat', progress: clamp((seconds - retreat.start) / Math.max(.001, retreat.end - retreat.start), 0, 1), retreat, suppression: suppressionTarget || suppressionSource, presentationFacing: retreat.coverFire ? retreat.presentationFacing.rearGuardEnemyFacing : retreat.presentationFacing.move };
  if (suppressionTarget && !['advance', 'take_cover'].includes(action)) return { id: 'suppressed', progress: clamp((seconds - suppressionTarget.start) / Math.max(.001, suppressionTarget.end - suppressionTarget.start), 0, 1), suppression: suppressionTarget, suppressionSource: false };
  if (suppressionSource) return { id: 'cover_fire', progress: clamp((seconds - suppressionSource.start) / Math.max(.001, suppressionSource.end - suppressionSource.start), 0, 1), suppression: suppressionSource, suppressionSource: true };
  if (transition === 'turn' || transition === 'brake') return { id: transition, progress: window.progress, suppression: null };
  const assignment = assignmentAtTime(engagementSchedule, actor.actorId, seconds);
  return { id: assignment ? 'search_target' : plannerActionToVisualState(action, transition), progress: window.progress, assignment, suppression: null };
}

function interpolate(left, right, progress) {
  return { x: left.x + (right.x - left.x) * progress, y: left.y + (right.y - left.y) * progress };
}

export function pointOnPresentationRoute(route, seconds) {
  if (!route?.length) return null;
  const ordered = [...route].sort((a, b) => a.t - b.t);
  if (seconds <= ordered[0].t) return { x: ordered[0].x, y: ordered[0].y };
  for (let index = 1; index < ordered.length; index += 1) {
    if (seconds <= ordered[index].t) {
      const left = ordered[index - 1]; const right = ordered[index];
      return interpolate(left, right, clamp((seconds - left.t) / Math.max(.001, right.t - left.t), 0, 1));
    }
  }
  const last = ordered.at(-1); return { x: last.x, y: last.y };
}

function positionFor(actor, plan, seconds, sampler, engagementSchedule) {
  const current = sampler(actor.actorId, seconds) || actor.position || { x: 0, y: 0 };
  const next = sampler(actor.actorId, seconds + .08) || current;
  let presentation = { ...current }; let presentationFacing = null; let movementFacing = null; let aimFacing = null; let presentationMode = 'route';
  const retreat = retreatAtTime(engagementSchedule, actor.actorId, seconds);
  if (retreat) {
    presentation = pointOnPresentationRoute(retreat.presentationRoute, seconds) || presentation;
    movementFacing = retreat.presentationFacing.move;
    aimFacing = retreat.coverFire ? retreat.presentationFacing.rearGuardEnemyFacing : movementFacing;
    presentationFacing = retreat.coverFire ? retreat.presentationFacing.rearGuardEnemyFacing : movementFacing;
    presentationMode = retreat.coverFire ? 'rear_guard_hold' : 'retreat_route';
  } else {
    const move = (engagementSchedule?.coverMoves || []).find((item) => seconds >= item.start - .000001 && seconds <= item.end + .000001 && (item.fireGroupIds.includes(actor.actorId) || item.maneuverGroupIds.includes(actor.actorId)));
    if (move) {
      if (move.maneuverGroupIds.includes(actor.actorId)) {
        const route = move.presentationRoutes?.[actor.actorId];
        if (route) presentation = pointOnPresentationRoute(route, seconds) || presentation;
        presentationMode = 'cover_advance';
      } else {
        const hold = move.fireGroupHoldPositions?.[actor.actorId];
        if (hold) presentation = { ...hold };
        presentationMode = 'cover_fire';
      }
    }
  }
  if (!Number.isFinite(movementFacing)) movementFacing = distance(current, next) > .01 ? Math.atan2(next.y - current.y, next.x - current.x) : Number(actor.facing) || 0;
  return { ...actor, routePosition: { ...current }, plannedPosition: { ...current }, preSeparationPosition: { ...current }, visualCenter: { ...presentation }, nextPosition: { ...next }, movementFacing, aimFacing, presentationFacing, presentationMode };
}

function projectileFor(shot, seconds, actors) {
  if (seconds < shot.t || seconds > shot.impactTime + .08) return null;
  const muzzle = muzzlePointForShot(shot, actors); const source = muzzle.point; const target = shot.impactPositionAtImpact;
  const progress = clamp((seconds - shot.t) / Math.max(.001, shot.impactTime - shot.t), 0, 1);
  return { id: `${shot.id}:projectile`, shotId: shot.id, kind: shot.weaponKind, x: source.x + (target.x - source.x) * progress, y: source.y + (target.y - source.y) * progress,
    // `start` remains the authoritative battle position for legacy evidence
    // and audit consumers.  Renderer uses visualStart for the muzzle-aligned
    // tracer without changing the combat source of the shot.
    start: { ...shot.sourcePositionAtFire }, visualStart: { ...source }, end: { ...target }, progress, color: shot.weapon.projectileColor, tracerWidth: Number(shot.weapon.presentation?.tracerWidth || 2), weaponProfileId: shot.weapon.id, presentation: { ...(shot.weapon.presentation || {}) }, muzzleAnchor: muzzle.anchor, authoritativeSourcePosition: { ...shot.sourcePositionAtFire }, presentationOnly: true };
}

function visualEffects(plan, actors, schedule, seconds) {
  const effects = []; const decals = []; const smoke = [];
  for (const shot of schedule) {
    const muzzle = muzzlePointForShot(shot, actors); const source = muzzle.point; const target = shot.impactPositionAtImpact; const presentation = shot.weapon.presentation || {};
    const fireAge = seconds - shot.t; const impactAge = seconds - shot.impactTime;
    if (fireAge >= 0 && fireAge <= shot.weapon.muzzleLife) effects.push({ id: `${shot.id}:muzzle`, kind: 'muzzle_flash', muzzleShape: presentation.muzzleShape || 'small_flash', smokeMode: presentation.smoke || 'none', x: source.x, y: source.y, size: (shot.weapon.kind === 'cannon' ? 26 : 10) * Math.max(.5, Number(presentation.impactScale || 1) ** .35), life: shot.weapon.muzzleLife - fireAge, maxLife: shot.weapon.muzzleLife, weaponKind: shot.weapon.kind, weaponProfileId: shot.weapon.id, source: 'manifest.weaponMuzzleAnchor', muzzleAnchor: muzzle.anchor, authoritativeSourcePosition: { ...shot.sourcePositionAtFire }, actorId: shot.actorId, target: shot.targetId, presentationOnly: true });
    if (impactAge >= 0 && impactAge <= shot.weapon.impactLife) {
      const kind = shot.hitType === 'destroy' ? 'explosion' : shot.weapon.impactKind === 'heavy_explosion' ? 'heavy_impact' : 'hit_spark';
      effects.push({ id: `${shot.id}:impact`, kind, impactScale: Number(presentation.impactScale || 1), persistentMark: presentation.persistentMark || null, x: target.x, y: target.y, size: (shot.hitType === 'destroy' ? 42 : shot.weapon.kind === 'cannon' ? 28 : 12) * Number(presentation.impactScale || 1), life: shot.weapon.impactLife - impactAge, maxLife: shot.weapon.impactLife, source: 'authority_anchor', actorId: shot.actorId, target: shot.targetId, authorityAnchorId: shot.authorityAnchorId, weaponProfileId: shot.weapon.id, presentationOnly: true });
    }
    if (impactAge >= 0 && shot.hitType !== 'near_miss') decals.push({ id: `${shot.id}:decal`, kind: presentation.persistentMark || (shot.hitType === 'destroy' ? 'burn_mark' : 'small_impact_mark'), radius: Math.max(6, 10 * Number(presentation.impactScale || 1)), rotation: (deterministicUnit(shot.seed, 'runtime-decal') - .5) * .9, x: target.x, y: target.y, source: shot.actorId, target: shot.targetId, weaponProfileId: shot.weapon.id, presentationOnly: true });
    if (shot.hitType === 'destroy' && impactAge >= 0 && impactAge < 4.5) {
      const smokeCount = presentation.smoke === 'heavy' ? 8 : presentation.smoke === 'none' ? 0 : 5;
      for (let index = 0; index < smokeCount; index += 1) {
        const drift = deterministicUnit(shot.seed, `smoke:${index}`); smoke.push({ id: `${shot.id}:smoke:${index}`, x: target.x + (drift - .5) * 24, y: target.y - Math.max(0, impactAge) * (8 + drift * 7) - index * 3, size: 14 + drift * 12, alpha: clamp(1 - impactAge / 4.5, 0, 1) * (.45 + drift * .35), presentationOnly: true });
      }
    }
  }
  return { effects, decals: [...new Map(decals.map((item) => [item.id, item])).values()].slice(-48), smoke };
}

export function buildUniversalVisualScene(plan, seconds, sampler, runtime = {}) {
  const schedule = runtime.visualShotSchedule || buildVisualShotSchedule(plan, sampler);
  const stateById = runtime.actorState instanceof Map ? runtime.actorState : new Map();
  const rows = actorRows(plan).map((actor) => ({ ...actor, ...(stateById.get(actor.actorId) || {}) })); let raw = rows.map((actor) => positionFor(actor, plan, seconds, sampler, runtime.engagementSchedule));
  for (const actor of raw) { actor.previousPosition = sampler(actor.actorId, Math.max(0, seconds - .08)) || actor.visualCenter; actor.footprint = visualFootprint(actor); }
  const wreckBlockers = raw.filter((actor) => {
    const destroy = latestDestroy(plan, actor.actorId);
    return destroy && seconds >= Number(destroy.t) + .95;
  }).map((actor) => ({ id: `wreck_${actor.actorId}`, actorId: actor.actorId, kind: 'wreck', visualCenter: { ...actor.visualCenter }, footprint: visualFootprint({ kind: 'wreck' }) }));
  raw = separateVisualFootprints(raw, plan.layout?.bounds, { blockers: wreckBlockers });
  const actorById = new Map(raw.map((actor) => [actor.actorId, actor]));
  const actors = rows.map((actor) => {
    const positioned = actorById.get(actor.actorId); const visual = resolveVisualState(plan, positioned, seconds, schedule, runtime.engagementSchedule); const shot = visual.shot || null;
    const weapon = visualWeaponProfile(actor);
    const movementFacing = movementFacingFor(positioned, positioned.movementFacing);
    const aimFacing = aimFacingFor(positioned, seconds, shot, visual, movementFacing);
    const visualClass = normalizeVisualUnitClass(actor);
    // `facing` is the production body's/hull's direction.  A turret may
    // follow an active target/shot without rotating the vehicle body or any
    // route/footprint geometry.
    const facing = movementFacing;
    const turretFacing = visualClass === 'mbt' ? aimFacing : null;
    const recoil = visual.id === 'fire' ? Math.sin(clamp(visual.progress, 0, 1) * Math.PI) * weapon.recoil : 0;
    const visible = visual.id !== 'wreck';
    return {
      id: actor.actorId, side: actor.side, type: actor.type, category: actor.category, role: actor.role || null,
      hp: actor.hp, maxHp: actor.maxHp, alive: actor.alive, visible, visualCenter: { ...positioned.visualCenter },
      routePosition: { ...positioned.routePosition }, plannedPosition: { ...positioned.plannedPosition }, preSeparationPosition: { ...positioned.preSeparationPosition }, visualPosition: { ...positioned.visualCenter }, presentationMode: positioned.presentationMode,
      footprint: positioned.footprint,
      anchorPosition: { ...positioned.preSeparationPosition }, visualOffset: { x: positioned.visualCenter.x - positioned.preSeparationPosition.x, y: positioned.visualCenter.y - positioned.preSeparationPosition.y }, nextPosition: { ...positioned.nextPosition }, facing, hullFacing: facing, movementFacing: facing, aimFacing, turretFacing, shotFacing: shot ? Number(shot.sourceFacingAtFire) || 0 : null,
      visualState: normalizeVisualState(visual.id), stateProgress: visual.progress, currentAction: actor.currentAction, weapon: { id: weapon.id, kind: weapon.kind, label: weapon.label, presentation: { ...(weapon.presentation || {}) } }, weaponPresentation: { ...(weapon.presentation || {}) },
      firing: visual.id === 'fire', aiming: visual.id === 'aim', reloading: visual.id === 'reload', recoil, walkCycle: visual.id === 'move' ? seconds * (actor.type === 'mbt' ? 1.5 : 5) : 0,
      memberPositions: memberPositions(actor, positioned, facing, visual.id === 'retreat' ? 'move' : visual.id, seconds), visualAuthorityAnchorId: visual.authorityAnchorId || shot?.authorityAnchorId || null,
      targetId: shot?.targetId || visual.assignment?.targetId || null, targetAssignmentId: visual.assignment?.id || null, suppression: visual.suppression ? { ...visual.suppression, sourceIds: [...visual.suppression.sourceIds], targetIds: [...visual.suppression.targetIds], area: { ...visual.suppression.area, center: { ...(visual.suppression.area?.center || {}) } } } : null, retreat: visual.retreat ? { ...visual.retreat, exit: { ...visual.retreat.exit } } : null
    };
  });
  const finalActors = actors.filter((actor) => actor.visualState !== 'wreck');
  const fallbackWrecks = actors.filter((actor) => actor.visualState === 'wreck' || (!actor.alive && !latestDestroy(plan, actor.id))).map((actor) => ({ id: `wreck_${actor.id}`, sourceActorId: actor.id, side: actor.side, visualClass: normalizeVisualUnitClass(actor), x: actor.visualCenter.x, y: actor.visualCenter.y, angle: actor.facing || 0, wreckType: normalizeVisualUnitClass(actor) === 'infantry' || normalizeVisualUnitClass(actor) === 'anti_armor_infantry' ? 'infantry_casualty_marker' : normalizeVisualUnitClass(actor) === 'mbt' ? 'tank_wreck' : 'light_vehicle_wreck', persistent: true }));
  // Keep destroyed actors in the lookup used by projectiles/effects: the wreck and
  // its smoke must remain at the last authoritative position after the actor leaves
  // the live-actor layer.
  const projectiles = schedule.map((shot) => projectileFor(shot, seconds, actors)).filter(Boolean);
  const effects = visualEffects(plan, actors, schedule, seconds);
  const environment = runtime.environmentScene || buildEnvironmentScene(plan);
  const destruction = buildPersistentDestructionLayer(plan, seconds, { visualShotSchedule: schedule, actors, windVector: environment.windVector });
  const wrecks = [...new Map([...fallbackWrecks, ...destruction.wrecks].map((wreck) => [wreck.id, wreck])).values()];
  const visualPhase = resolveBattlePhase(plan, seconds);
  return { actors, wrecks, projectiles, effects: [...effects.effects, ...destruction.effects], decals: destruction.decals, smoke: destruction.smoke, debris: destruction.debris, destruction: { version: destruction.version, limits: { ...destruction.limits }, signature: destruction.signature, eventCount: schedule.length }, environment, shotSchedule: schedule, visualStage: visualPhase.id, visualPhase, sceneSeed: plan.source?.seed ?? 0, engagementSchedule: runtime.engagementSchedule || null };
}
