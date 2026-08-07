import { compileUniversalPlan } from './universal-plan-compiler.js';
import { sampleSpatialEntityPosition } from './universal-position-sampler.js';
import { resolveUniversalCamera } from './universal-render-camera.js';
import { buildUniversalVisualScene } from './universal-visual-scene.js';
import { buildVisualShotSchedule } from './visual-weapon-profiles.js';
import { buildUniversalEngagementSchedule, engagementAtTime, assignmentAtTime, suppressionAtTime, retreatAtTime } from './universal-engagement-choreographer.js';
import { buildCameraDirector, resolveDirectedCamera } from './universal-camera-director.js';
import { buildEnvironmentScene } from '../environment/environment-scene-builder.js';
import { buildEnvironmentState } from '../environment/environment-state.js';
import { OFFLINE_ASSET_MANIFEST } from '../environment/asset-provider.js';
import { buildProductionDrawSpecs } from '../environment/production-visual-draw-spec.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function actorRows(plan) {
  return [...(plan?.forces?.friendly || []), ...(plan?.forces?.enemy || [])];
}

function initialAuthority(plan) {
  return Object.fromEntries(actorRows(plan).map((actor) => [actor.actorId, {
    side: actor.side,
    type: actor.type,
    hp: Number(actor.initial?.hp ?? actor.final?.hp ?? 0),
    maxHp: Number(actor.initial?.maxHp ?? actor.final?.maxHp ?? 0),
    alive: actor.initial?.alive !== false
  }]));
}

function applyAuthorityAnchors(plan, seconds) {
  const authority = initialAuthority(plan);
  for (const anchor of plan.timeline?.anchors || []) {
    if (Number(anchor.t) > seconds + 1e-9) break;
    const target = authority[anchor.targetId];
    if (!target) continue;
    if (anchor.type === 'damage') {
      target.hp = Math.max(0, target.hp - Math.max(0, Number(anchor.value) || 0));
      if (target.hp <= 0) target.alive = false;
    } else if (anchor.type === 'repair') {
      target.hp = Math.min(target.maxHp, target.hp + Math.max(0, Number(anchor.value) || 0));
    } else if (anchor.type === 'destroy') {
      target.hp = 0;
      target.alive = false;
    }
  }
  if (seconds >= Number(plan.timeline?.duration || 0) - 1e-9) {
    for (const actor of actorRows(plan)) authority[actor.actorId] = { ...authority[actor.actorId], ...actor.final };
  }
  return authority;
}

function actionFor(plan, actorId, seconds) {
  return (plan.timeline?.actions || [])
    .filter((action) => Number(action.t) <= seconds + 1e-9 && (!action.actorIds || action.actorIds.includes(actorId)))
    .at(-1)?.type || 'holding';
}

function memberCount(actor) {
  if (actor.category === 'infantry' || actor.type === 'at_infantry') return actor.type === 'at_infantry' ? 3 : 4;
  return 0;
}

function facingAt(compiled, actorId, seconds, fallback = 0) {
  const now = sampleSpatialEntityPosition(compiled, actorId, seconds) || { x: 0, y: 0 };
  const next = sampleSpatialEntityPosition(compiled, actorId, seconds + .08) || now;
  const dx = next.x - now.x; const dy = next.y - now.y;
  return Math.hypot(dx, dy) > .001 ? Math.atan2(dy, dx) : fallback;
}

function memberPositions(actor, center, facing, seconds) {
  const count = memberCount(actor); if (!count) return [];
  const offsets = count === 3 ? [[-10, -7], [8, -3], [-4, 9]] : [[-14, -9], [8, -8], [-8, 8], [14, 8]];
  const moving = ['deploy', 'advance', 'screen', 'take_cover', 'repair_approach'].includes(actor.currentAction);
  return offsets.map(([ox, oy], index) => {
    const cos = Math.cos(facing); const sin = Math.sin(facing);
    const sway = moving ? Math.sin(seconds * 5 + index) * 1.3 : 0;
    return { x: center.x + ox * cos - oy * sin + sway, y: center.y + ox * sin + oy * cos + sway, facing, stance: moving ? (index % 2 ? 'moving' : 'stand') : 'stand', role: actor.type === 'at_infantry' && index === 0 ? 'rocket' : 'rifle' };
  });
}

function interpolate(left, right, progress) {
  return { x: left.x + (right.x - left.x) * progress, y: left.y + (right.y - left.y) * progress };
}

function returnTarget(actor, index, plan) {
  const bounds = plan.layout?.bounds || { height: 700 };
  return { x: 42, y: Math.min(bounds.height - 28, 70 + index * 64) };
}

function applyReturnPosition(actor, position, progress, index, plan) {
  if (actor.side !== 'friendly' || actor.final?.alive === false) return position;
  return interpolate(position, returnTarget(actor, index, plan), progress);
}

function objectiveState(plan, seconds) {
  const result = plan.source?.result;
  if (['withdraw', 'defeat', 'wiped'].includes(result)) return 'enemy_controlled';
  if (seconds < Number(plan.timeline?.duration || 0) * 0.8) return 'contested';
  return result === 'pyrrhic' ? 'limited_control' : 'controlled';
}

function activeOutcomeAction(plan, seconds) {
  return (plan.timeline?.actions || []).filter((action) => action.source === 'outcome_choreography' && Number(action.t) <= seconds + 1e-9).at(-1) || null;
}

function tacticalCoverState(plan, actorId, seconds) {
  const route = (plan.layout?.routes || []).find((item) => item.actorId === actorId);
  const tactical = route?.tactical;
  if (!tactical?.cover || !tactical.coverPropId) return { inCover: false, phase: 'exposed', value: 0, propId: null };
  const duration = Math.max(1, Number(plan.timeline?.duration) || 30);
  const ratio = clamp(seconds / duration, 0, 1);
  if (ratio < .30) return { inCover: false, phase: 'approach_cover', value: Number(tactical.coverValue) || 0, propId: tactical.coverPropId };
  if (ratio < .45) return { inCover: true, phase: 'in_cover', value: Number(tactical.coverValue) || 0, propId: tactical.coverPropId };
  if (ratio < .56) return { inCover: false, phase: 'fire_from_cover', value: Number(tactical.coverValue) || 0, propId: tactical.coverPropId };
  return { inCover: false, phase: 'advance_from_cover', value: Number(tactical.coverValue) || 0, propId: tactical.coverPropId };
}

function buildEffects(plan, actors, seconds) {
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const effects = [];
  for (const anchor of plan.timeline?.anchors || []) {
    const age = seconds - Number(anchor.t);
    if (age < -.001 || age > 1.25) continue;
    const source = actorById.get(anchor.actorId)?.visualCenter;
    const target = actorById.get(anchor.targetId)?.visualCenter || source;
    if (!target) continue;
    const common = { anchorId: anchor.id, source: 'authority_anchor', x: target.x, y: target.y };
    if (['damage', 'fire', 'ambush', 'suppress'].includes(anchor.type)) {
      if (source && age <= .42) effects.push({ ...common, id: `${anchor.id}:tracer`, kind: anchor.type === 'fire' ? 'cannon' : 'tracer', start: source, end: target, life: .42 - age, maxLife: .42 });
      effects.push({ ...common, id: `${anchor.id}:impact`, kind: 'impact', size: anchor.type === 'suppress' ? 9 : 14, life: 1.05 - age, maxLife: 1.05 });
    } else if (anchor.type === 'repair') {
      effects.push({ ...common, id: `${anchor.id}:welding`, kind: 'welding', start: source, end: target, size: 18, life: .9 - age, maxLife: .9 });
    } else if (anchor.type === 'destroy') {
      effects.push({ ...common, id: `${anchor.id}:destruction`, kind: 'destruction', size: 34, life: 1.2 - age, maxLife: 1.2 });
    } else if (['reveal', 'move', 'retreat'].includes(anchor.type)) {
      effects.push({ ...common, id: `${anchor.id}:pulse`, kind: 'muzzle', size: 13, life: .65 - age, maxLife: .65 });
    }
  }
  const outcome = activeOutcomeAction(plan, seconds);
  if (outcome && seconds - Number(outcome.t) <= 1.8) {
    const objective = plan.layout?.zones?.find((zone) => zone.objectiveRole || zone.kind === 'objective')?.center || { x: 950, y: 360 };
    effects.push({ id: `${outcome.id}:objective`, source: 'outcome_choreography', kind: 'objective_ring', x: objective.x, y: objective.y, size: 38, life: 1.8 - (seconds - Number(outcome.t)), maxLife: 1.8 });
  }
  return effects.filter((effect) => effect.life > 0);
}

function sceneObjectState(plan, entity, seconds, index) {
  const duration = Math.max(1, Number(plan.timeline?.duration) || 30); const ratio = seconds / duration;
  const kind = entity.visualKind || entity.kind;
  if (kind === 'search_sector') {
    const count = Math.max(1, plan.scene?.searchSequence?.length || 1); const threshold = (index + 1) / (count + 1);
    return ratio >= threshold ? 'cleared' : ratio >= threshold - .18 ? 'sweeping' : 'unsearched';
  }
  if (kind === 'salvage_site') return ratio >= .8 && ['victory', 'pyrrhic'].includes(plan.source?.result) ? 'recovered' : 'awaiting_recovery';
  if (kind === 'convoy_vehicle' || kind === 'convoy') return entity.position?.state || (ratio >= .8 && ['victory', 'pyrrhic'].includes(plan.source?.result) ? 'arrived' : 'moving');
  if (['objective_area', 'control_node', 'mission_object'].includes(kind)) return ratio >= .8 ? (['victory', 'pyrrhic'].includes(plan.source?.result) ? 'secured' : 'contested') : 'contested';
  return entity.position?.state || 'fixed';
}

export function buildUniversalRenderState(plan, seconds = 0, runtime = {}, precomputed = null) {
  const compiled = compileUniversalPlan(plan);
  const duration = Math.max(1, Number(plan.timeline?.duration) || 30);
  const returning = runtime.presentationPhase === 'returning' || runtime.returning === true;
  const battleTime = returning ? duration : clamp(seconds, 0, duration);
  const returnDuration = Math.max(0.001, Number(runtime.returnDuration) || 5);
  const returnProgress = returning ? clamp(Number(runtime.returnElapsed) / returnDuration, 0, 1) : 0;
  const positionSampler = (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time);
  const engagementSchedule = precomputed || runtime.engagementSchedule || buildUniversalEngagementSchedule(plan, positionSampler);
  const cameraDirector = buildCameraDirector(engagementSchedule);
  const authority = applyAuthorityAnchors(plan, battleTime);
  const actors = actorRows(plan).map((actor, index) => {
    const base = sampleSpatialEntityPosition(compiled, actor.actorId, battleTime) || { x: 0, y: 0 };
    const visualCenter = applyReturnPosition(actor, base, returnProgress, index, plan);
    const facing = facingAt(compiled, actor.actorId, battleTime);
    const currentAction = actionFor(plan, actor.actorId, battleTime);
    const cover = tacticalCoverState(plan, actor.actorId, battleTime);
    const hp = authority[actor.actorId]?.hp ?? actor.final.hp;
    const alive = authority[actor.actorId]?.alive ?? actor.final.alive;
    const presentationActor = { ...actor, currentAction };
    return {
      id: actor.actorId,
      side: actor.side,
      type: actor.type,
      category: actor.category,
      role: plan.assignments?.find((assignment) => assignment.actorId === actor.actorId)?.role || null,
      hp,
      maxHp: authority[actor.actorId]?.maxHp ?? actor.final.maxHp,
      alive,
      visualCenter,
      anchorPosition: { ...visualCenter },
      facing,
      turretFacing: facing,
      memberPositions: memberPositions(presentationActor, visualCenter, facing, battleTime),
      minimumScreenFootprint: actor.type === 'mbt' ? 46 : actor.category === 'infantry' || actor.type === 'at_infantry' ? 24 : 34,
      currentAction,
      cover,
      visualStatus: !alive ? 'destroyed' : cover.inCover ? 'in_cover' : currentAction === 'repair' ? 'being_repaired' : currentAction === 'repair_approach' ? 'repairing' : currentAction === 'damage' || currentAction === 'fire' ? 'engaging' : currentAction
    };
  });
  const authorityShotSchedule = runtime.authorityShotSchedule || buildVisualShotSchedule(plan, positionSampler);
  const visualShotSchedule = (runtime.visualShotSchedule || [...authorityShotSchedule, ...(engagementSchedule.shots || [])].sort((left, right) => Number(left.t) - Number(right.t) || String(left.id).localeCompare(String(right.id)))).map((shot) => ({ ...shot, weapon: { ...(shot.weapon || {}), validTargetClasses: [...(shot.weapon?.validTargetClasses || [])], presentation: { ...(shot.weapon?.presentation || {}) } } }));
  const environment = runtime.environmentScene || buildEnvironmentScene(plan);
  const environmentState = buildEnvironmentState(environment, battleTime);
  const visualScene = buildUniversalVisualScene(plan, battleTime, (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time), {
    visualShotSchedule,
    engagementSchedule,
    environmentScene: environment,
    actorState: new Map(actors.map((actor) => [actor.id, actor]))
  });
  const visualById = new Map(visualScene.actors.map((actor) => [actor.id, actor]));
  const presentationActors = actors.map((actor) => {
    const visual = visualById.get(actor.id) || {};
    return { ...actor, ...visual, visualCenter: returning ? actor.visualCenter : visual.visualCenter, anchorPosition: returning ? actor.anchorPosition : visual.anchorPosition, visualStatus: visual.visualState || actor.visualStatus };
  });
  const wrecks = visualScene.wrecks;
  const sceneObjects = (plan.spatialEntities || [])
    .filter((entity) => entity.kind !== 'actor' && entity.kind !== 'wreck' && entity.kind !== 'obstacle')
    .map((entity, index) => {
      const position = sampleSpatialEntityPosition(compiled, entity.id, battleTime) || entity.position || { x: 0, y: 0 };
      return { ...entity, position, state: sceneObjectState(plan, entity, battleTime, index), progress: clamp(battleTime / duration, 0, 1) };
    });
  const activeAnchors = (plan.timeline?.anchors || []).filter((anchor) => Math.abs(Number(anchor.t) - battleTime) < 0.35);
  const legacyEffects = buildEffects(plan, presentationActors, battleTime).filter((effect) => !['tracer', 'cannon', 'impact', 'destruction'].includes(effect.kind));
  const effects = [...legacyEffects, ...visualScene.effects];
  const outcomeAction = activeOutcomeAction(plan, battleTime);
  const activeEngagement = engagementAtTime(engagementSchedule, battleTime);
  const activeAssignments = actors.map((actor) => assignmentAtTime(engagementSchedule, actor.id, battleTime)).filter(Boolean);
  const activeSuppression = actors.map((actor) => suppressionAtTime(engagementSchedule, actor.id, battleTime)).filter(Boolean);
  const activeRetreats = actors.map((actor) => retreatAtTime(engagementSchedule, actor.id, battleTime)).filter(Boolean).map((item) => ({ ...item, exit: { ...item.exit } }));
  const camera = resolveDirectedCamera(plan, { actors, activeAnchors, effects, time: battleTime, returning }, cameraDirector, { mode: runtime.cameraMode || 'overview', autoCamera: runtime.autoCamera !== false, cameraOverride: runtime.cameraOverride || null });
  const cameraWithFallback = camera || { x: 640, y: 360, zoom: .86 };
  const drawSpecs = buildProductionDrawSpecs({ actors: presentationActors, wrecks, environment: environmentState, camera: cameraWithFallback, options: { manifest: OFFLINE_ASSET_MANIFEST, availableSources: new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source)) } });
  const actorByDrawSpec = new Map(drawSpecs.actorSpecs.map((spec) => [spec.actorId, spec]));
  // Keep the text/evidence state graph tree-shaped.  Sharing a Draw Spec object
  // between `state.drawSpecs` and `actor.drawSpec` is semantically harmless but
  // makes deterministic serializers treat the repeated array as a cycle.
  const copyDrawSpec = (spec) => spec ? { ...spec, hybridComponents: [...(spec.hybridComponents || [])], weaponPresentation: spec.weaponPresentation ? { ...spec.weaponPresentation } : null } : null;
  const actorsWithSpecs = presentationActors.map((actor) => ({ ...actor, drawSpec: copyDrawSpec(actorByDrawSpec.get(actor.id)), weaponPresentation: actor.weapon?.presentation || actor.weaponPresentation ? { ...(actor.weapon?.presentation || actor.weaponPresentation) } : null }));
  const wreckByDrawSpec = new Map(drawSpecs.wreckSpecs.map((spec) => [spec.wreckId, spec]));
  const wrecksWithSpecs = wrecks.map((wreck) => ({ ...wreck, drawSpec: copyDrawSpec(wreckByDrawSpec.get(wreck.id || wreck.sourceActorId)) }));
  return {
    sceneHash: plan.planFingerprint || plan.source?.reportFingerprint || null,
    duration,
    time: battleTime,
    sourceTime: Number((battleTime / duration * Number(plan.timeline?.sourceDuration || duration)).toFixed(3)),
    returning,
    returnProgress,
    returnDuration,
    authority,
    actors: actorsWithSpecs,
    wrecks: wrecksWithSpecs,
    projectiles: visualScene.projectiles,
    decals: visualScene.decals,
    smoke: visualScene.smoke,
    debris: visualScene.debris || [],
    environment: environmentState,
    destruction: visualScene.destruction || null,
    shotSchedule: visualScene.shotSchedule,
    visualStage: visualScene.visualStage,
    visualPhase: visualScene.visualPhase,
    sceneObjects,
    effects,
    activeAnchors,
    activeActions: (plan.timeline?.actions || []).filter((action) => Math.abs(Number(action.t) - battleTime) < .8),
    objectiveState: objectiveState(plan, battleTime),
    choreography: { version: engagementSchedule.version, outcome: plan.source?.result, objectiveState: objectiveState(plan, battleTime), activeOutcome: outcomeAction?.type || null, activeEffectCount: effects.length, visualStage: visualScene.visualStage, activeEngagement: activeEngagement ? { ...activeEngagement, attackerIds: [...activeEngagement.attackerIds], defenderIds: [...activeEngagement.defenderIds], authoritativeAnchorIds: [...activeEngagement.authoritativeAnchorIds] } : null, activeAssignments: activeAssignments.map((item) => ({ ...item })), activeSuppression: activeSuppression.map((item) => ({ ...item, sourceIds: [...item.sourceIds], targetIds: [...item.targetIds], area: { ...item.area, center: { ...(item.area?.center || {}) } } })), activeRetreats, targetSwitches: engagementSchedule.targetSwitches.filter((item) => Math.abs(item.time - battleTime) < .8).map((item) => ({ ...item })), limits: { ...engagementSchedule.limits } },
    engagementSchedule,
    cameraDirector,
    camera,
    drawSpecs,
    finalCompare: { ok: true, errors: [] }
  };
}

export function createUniversalRenderState(presentation) {
  const { plan } = presentation;
  const compiled = compileUniversalPlan(plan);
  const choreographer = buildUniversalEngagementSchedule(plan, (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time));
  return Object.freeze({
    atTime(seconds, runtime = {}) { return buildUniversalRenderState(plan, seconds, runtime, choreographer); },
    textAt(seconds, options = {}) {
      const state = buildUniversalRenderState(plan, seconds, options.runtime || {}, choreographer);
      return buildUniversalTextState(plan, state, options);
    }
  });
}

function buildUniversalTextState(plan, state, options = {}) {
  return {
    scene: 'universal-tactical-battle',
    sourceId: plan.source?.reportId || null,
    reportId: plan.source?.reportId || null,
    missionKind: plan.source?.missionKind || null,
    missionId: plan.source?.missionId || null,
    theaterId: plan.source?.theaterId || null,
    strategyId: plan.source?.strategyId || null,
    terrain: { id: plan.scene?.terrain?.id || null, name: plan.scene?.terrain?.id === 'open' ? '废弃矿区' : plan.scene?.terrain?.id === 'road' ? '公路' : plan.scene?.terrain?.id === 'fortified' ? '防御阵地' : '战术地域' },
    tacticalSpace: {
      layoutVersion: plan.layout?.tacticalLayout?.version || null,
      laneIds: plan.layout?.tacticalLayout?.laneIds || [],
      firingLines: [plan.layout?.tacticalLayout?.friendlyFireX, plan.layout?.tacticalLayout?.enemyFireX].filter(Number.isFinite),
      coverBands: (plan.scene?.props || []).filter((prop) => prop.tacticalCover === true).length,
      routedActors: (plan.layout?.routes || []).filter((route) => route.tactical?.stage).length,
      stagedActors: (plan.layout?.routes || []).filter((route) => route.tactical?.staging && route.tactical?.covered).length
    },
    result: state.authority ? plan.source?.result : null,
    sceneHash: state.sceneHash,
    capture: plan.outcome?.capture === true,
    presentationTime: Number(state.time.toFixed(3)),
    estimatedSourceTime: state.sourceTime,
    returning: state.returning,
    returnProgress: Number(state.returnProgress.toFixed(3)),
    viewMode: options.viewMode || 'overview',
    camera: state.camera,
    cameraInterest: { id: state.camera?.interestId || null, reason: state.camera?.interestReason || null },
    mode: 'universal',
    rendering: { production: true, debugOverlay: options.debugOverlay === true, layers: ['ground', 'decals', 'terrain_props', 'actors', 'projectiles', 'effects', 'foreground_props', 'hud', ...(options.debugOverlay === true ? ['debug_overlay'] : [])] },
    actorCount: state.actors.length,
    hud: options.showHud !== false,
    quality: plan.quality,
    objective: { status: state.objectiveState },
    activeAnchors: state.activeAnchors,
    actors: state.actors.map((actor) => ({ id: actor.id, side: actor.side, type: actor.type, hp: actor.hp, maxHp: actor.maxHp, alive: actor.alive, visible: actor.visible !== false, x: Math.round(actor.visualCenter.x), y: Math.round(actor.visualCenter.y), routePosition: actor.routePosition, plannedPosition: actor.plannedPosition, preSeparationPosition: actor.preSeparationPosition, visualPosition: actor.visualPosition, visualOffset: actor.visualOffset, currentAction: actor.currentAction, visualState: actor.visualState, stateProgress: Number(actor.stateProgress?.toFixed?.(3) || actor.stateProgress || 0), weapon: actor.weapon, weaponPresentation: actor.weaponPresentation || null, drawSpec: actor.drawSpec || null, targetId: actor.targetId || null, targetAssignmentId: actor.targetAssignmentId || null, suppression: actor.suppression || null, retreat: actor.retreat || null, cover: actor.cover })),
    visualStage: state.visualStage,
    visualPhase: state.visualPhase,
    shotSchedule: state.shotSchedule.map((shot) => ({ id: shot.id, source: shot.source || null, presentationOnly: shot.presentationOnly !== false, authorityAnchorId: shot.authorityAnchorId || null, actorId: shot.actorId, targetId: shot.targetId, t: shot.t, impactTime: shot.impactTime, sourcePositionAtFire: shot.sourcePositionAtFire, sourceFacingAtFire: Number.isFinite(shot.sourceFacingAtFire) ? shot.sourceFacingAtFire : 0, targetPositionAtAim: shot.targetPositionAtAim, impactPositionAtImpact: shot.impactPositionAtImpact })),
    projectiles: state.projectiles.map((projectile) => ({ id: projectile.id, shotId: projectile.shotId, kind: projectile.kind, x: Math.round(projectile.x), y: Math.round(projectile.y), start: projectile.start, end: projectile.end, progress: Number(projectile.progress.toFixed(3)) })),
    decals: state.decals.map((decal) => ({ id: decal.id, kind: decal.kind, x: Math.round(decal.x), y: Math.round(decal.y) })),
    smoke: state.smoke.map((particle) => ({ id: particle.id, x: Math.round(particle.x), y: Math.round(particle.y), alpha: Number(particle.alpha.toFixed(3)) })),
    debris: state.debris.map((item) => ({ id: item.id, x: Math.round(item.x), y: Math.round(item.y), radius: item.radius })),
    environment: { version: state.environment?.version || null, terrainId: state.environment?.terrainId || null, objectCount: state.environment?.objects?.length || 0, zoneCount: state.environment?.zones?.length || 0, windVector: state.environment?.windVector || null, signature: state.environment?.signature || null, objects: state.environment?.objects || [], routeSegmentViolations: state.environment?.metrics?.routeSegmentViolations || [] },
    destruction: { version: state.destruction?.version || null, persistentDecalCount: state.decals.length, craterCount: state.decals.filter((item) => item.kind === 'crater').length, scorchCount: state.decals.filter((item) => item.kind === 'scorch').length, debrisCount: state.debris.length, wreckCount: state.wrecks.length, smokeCount: state.smoke.length, limits: state.destruction?.limits || null },
    effects: state.effects.map((effect) => ({ id: effect.id, kind: effect.kind, source: effect.source, x: Math.round(effect.x), y: Math.round(effect.y) })),
    choreography: { version: state.choreography?.version || null, activeEngagement: state.choreography?.activeEngagement || null, activeAssignments: state.choreography?.activeAssignments || [], activeSuppression: state.choreography?.activeSuppression || [], activeRetreats: state.choreography?.activeRetreats || [], targetSwitches: state.choreography?.targetSwitches || [], limits: state.choreography?.limits || null },
    activeActions: state.activeActions.map((action) => ({ id: action.id, type: action.type, authority: action.authority === true })),
    sceneObjects: state.sceneObjects.map((object) => ({ id: object.id, kind: object.visualKind || object.kind, state: object.state, x: Math.round(object.position.x), y: Math.round(object.position.y) })),
    wrecks: state.wrecks.map((wreck) => ({ sourceActorId: wreck.sourceActorId, x: Math.round(wreck.x), y: Math.round(wreck.y) })),
    drawSpecs: state.drawSpecs || null,
    errors: plan.validation?.ok ? [] : (plan.validation?.errors || [])
  };
}
