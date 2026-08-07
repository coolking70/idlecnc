import { buildPresentationContract } from '../contract-battle-adapter.js';
import { buildBattleIntent } from './battle-intent-builder.js';
import { buildForces } from './force-profile-builder.js';
import { getTerrainProfile } from './terrain-profile-registry.js';
import { resolveMissionProfile } from './mission-profile-registry.js';
import { resolveStrategyProfile } from './strategy-doctrine-registry.js';
import { buildSceneGrammar } from './scene-grammar-builder.js';
import { allocateUniversalRoles } from './universal-role-allocator.js';
import { generateTacticalZones } from './tactical-zone-generator.js';
import { planUniversalLayout } from './universal-layout-planner.js';
import { planUniversalRoutes, routeAroundObstacles } from './universal-route-planner.js';
import { mapUniversalTime } from './universal-time-mapper.js';
import { buildPresentationActions } from './presentation-action-builder.js';
import { createUniversalPlan } from './universal-plan-schema.js';
import { validateUniversalPlan } from './universal-plan-validator.js';
import { buildUniversalReportFingerprint, buildUniversalPlanFingerprint } from './universal-plan-fingerprint.js';
import { buildUniversalFinalState } from './universal-authority-state.js';
import { buildUniversalRepairChoreography } from './universal-repair-choreography.js';
import { buildOutcomeChoreography } from './universal-outcome-choreography.js';
import { deconflictUniversalLayout } from './universal-layout-deconflictor.js';
import { analyzeUniversalContact } from './universal-contact-analyzer.js';
import { buildUniversalSceneSpatialObjects, buildUniversalObstacleGeometry } from './universal-scene-object-planner.js';
import { buildUniversalWreckEntities } from './universal-wreck-planner.js';
import { compileUniversalPlan } from './universal-plan-compiler.js';
import { validateUniversalSpatialPlan } from './universal-continuous-validator.js';

export function ensureContract(input) {
  if (input?.normalizedBattle && input?.authorityAnchors) return input;
  const contract = buildPresentationContract(input);
  // The formal contract deliberately normalizes away non-authority diagnostics
  // such as scout confidence. Keep that source fact beside (not inside) the
  // authority payload so the universal planner can describe contact faithfully
  // without changing the report contract or its fingerprint.
  return Object.freeze({ ...contract, universalSource: Object.freeze({
    scout: input?.scout || null,
    // tactics 是正式求解器输出的可验证派生意图；不进入 authority normalized
    // payload，但由通用规划器读取以复现步坦协同队形。
    tactics: input?.tactics || null
  }) });
}

export function buildUniversalPlan(input, options = {}) {
  const contract = ensureContract(input);
  const normalized = contract.normalizedBattle || {};
  const battle = normalized.battle || {};
  const intent = buildBattleIntent(contract);
  const forces = buildForces(normalized);
  const terrain = getTerrainProfile(battle.terrain) || { id: battle.terrain || 'generic', name: '通用地形', generic: true, bounds: { width: 1200, height: 700 }, lanes: ['center'], obstacles: ['marker'] };
  const mission = resolveMissionProfile(battle); const strategy = resolveStrategyProfile(battle.strategyId);
  let scene = buildSceneGrammar(intent, terrain, mission, strategy);
  scene.bounds = terrain.bounds || { width: 1200, height: 700 };
  scene.props = buildUniversalObstacleGeometry(scene.terrain, scene.bounds);
  scene = buildUniversalSceneSpatialObjects(scene, terrain, mission, intent, scene.bounds);
  const assignments = allocateUniversalRoles(forces, intent);
  const fingerprint = options.reportFingerprint || buildUniversalReportFingerprint(contract);
  const zones = generateTacticalZones(scene, forces, intent, fingerprint);
  const layout = planUniversalLayout(forces, assignments, zones);
  if (mission.convoy === true) {
    // The escort vehicle owns the bottom movement corridor. Keep the
    // friendly deployment line above its initial footprint so a support unit
    // cannot spawn inside the convoy lane before any tactical routing starts.
    for (const node of layout.nodes.filter((item) => item.side === 'friendly')) node.y = Math.min(node.y, (layout.bounds?.height || 700) - 100);
  }
  layout.geometryHash = zones.metrics.geometryHash;
  layout.zoneMetrics = zones.metrics;
  const timelineBase = mapUniversalTime(normalized, intent, contract.authorityAnchors || []);
  const routes = planUniversalRoutes(layout, assignments, intent, forces, scene.props, timelineBase);
  layout.routes = routes.routes; layout.routeMetrics = routes.metrics;
  const actions = buildPresentationActions(intent, forces, assignments, timelineBase, routes.routes);
  actions.push(...buildOutcomeChoreography(intent, timelineBase, assignments, forces));
  const finalState = buildUniversalFinalState(normalized);
  const planFinalState = JSON.parse(JSON.stringify(finalState));
  const plan = createUniversalPlan({
    source: { reportId: battle.id, reportFingerprint: fingerprint, seed: battle.seed, theaterId: battle.theaterId, missionKind: battle.missionKind, missionId: battle.missionId, strategyId: battle.strategyId, result: battle.result },
    intent, scene, forces: { ...forces, roleGroups: assignments.roleGroups }, assignments: assignments.map((assignment) => ({ ...assignment })), roleGroups: assignments.roleGroups, layout,
    timeline: { ...timelineBase, actions },
    outcome: { result: battle.result, capture: battle.capture === true, endingKind: intent.outcome.endingKind, finalState: planFinalState, choreography: actions.filter((item) => item.source === 'outcome_choreography').map((item) => item.type) },
    authority: { expectedEventCount: normalized.events?.length || 0, expectedAnchorCount: timelineBase.anchors.length, expectedRequiredCount: timelineBase.anchors.filter((anchor) => anchor.required).length, finalState: JSON.parse(JSON.stringify(finalState)), sourceDuration: battle.duration },
    quality: { level: terrain.generic || mission.id === 'generic_operation' || strategy.generic ? 'generic' : 'full', reasons: [...(terrain.generic ? ['unknown_terrain_fallback'] : []), ...(mission.id === 'generic_operation' ? ['unknown_mission_fallback'] : []), ...(strategy.generic ? ['unknown_strategy_fallback'] : [])] }
  });
  plan.scene.sceneObjects = plan.scene.sceneObjects.map((object, index) => ({ ...object, routeId: object.kind === 'convoy_vehicle' ? `scene_route_${index + 1}` : object.routeId }));
  plan.layout.sceneRoutes = plan.scene.sceneObjects.filter((object) => object.kind === 'convoy_vehicle').map((object) => ({ routeId: object.routeId, objectId: object.id, authority: false, points: convoyRoutePoints(plan.source.result), outcomeMode: plan.source.result }));
  plan.layout.sceneObjects = plan.scene.sceneObjects;
  deconflictUniversalLayout(plan);
  plan.timeline.repairs = buildUniversalRepairChoreography(normalized, timelineBase, forces, plan.layout);
  // Repair choreography inserts rendezvous/hold points after the first route
  // pass. Re-run static wreck avoidance on that final route shape so a
  // survivor cannot drive through a same-side wreck during a later advance.
  const wreckAvoidanceProps = buildUniversalWreckEntities(plan).map((wreck) => ({
    ...wreck,
    actorId: wreck.sourceActorId,
    lifecycleStart: wreck.lifecycle.start / Math.max(1, plan.timeline.duration)
  }));
  if (wreckAvoidanceProps.length) for (const route of plan.layout.routes) {
    const actor = forces[route.side]?.find((row) => row.actorId === route.actorId);
    let adjusted = routeAroundObstacles(route.points, plan.scene.props, actor?.footprint?.radius || 12, null, route.actorId);
    // Apply wrecks one at a time: a single visibility-graph fallback cannot
    // always find a path when several newly-created wrecks overlap the same
    // lane, while sequential detours preserve each already-safe segment.
    for (const wreck of wreckAvoidanceProps.filter((item) => item.side === route.side)) adjusted = routeAroundObstacles(adjusted, [wreck], actor?.footprint?.radius || 12, null, route.actorId);
    route.points = adjusted;
    if (route.basePoints) route.basePoints = adjusted.map((item) => ({ ...item }));
  }
  plan.spatialEntities = [...plan.forces.friendly, ...plan.forces.enemy].map((actor) => ({ id: actor.actorId, kind: 'actor', side: actor.side, authority: true, sourceActorId: actor.actorId, solid: true, moving: true, routeId: `route_${actor.actorId}`, footprint: actor.footprint, lifecycle: { start: 0, end: actor.final?.alive === false ? (plan.timeline.anchors.find((anchor) => anchor.type === 'destroy' && anchor.targetId === actor.actorId)?.t ?? 0) : Infinity } }));
  plan.spatialEntities.push(...buildUniversalWreckEntities(plan), ...plan.scene.sceneObjects.map((object) => ({ ...object, visualKind: object.kind, kind: object.kind === 'convoy_vehicle' ? 'convoy' : object.kind === 'objective_area' ? 'objective_area' : 'mission_object', sourceObjectId: object.id, routeId: object.routeId || null })), ...plan.scene.props.map((prop) => ({ ...prop, kind: 'obstacle' })));
  const compiledSpatial = compileUniversalPlan(plan);
  const measuredSpatialValidation = validateUniversalSpatialPlan(plan, { step: 0.05 });
  // Keep serialized plans deterministic; the callable validator still returns
  // its real elapsedMs measurement to performance/audit callers.
  plan.spatialValidation = { ...measuredSpatialValidation, metrics: { ...measuredSpatialValidation.metrics, elapsedMs: 0 } };
  plan.contact = analyzeUniversalContact(plan);
  plan.planFingerprint = buildUniversalPlanFingerprint(plan);
  plan.validation = validateUniversalPlan(plan, contract);
  plan.ok = plan.validation.ok;
  return plan;
}

function convoyRoutePoints(result) {
  if (result === 'wiped') return [{ t: 0, x: 235, y: 665 }, { t: .55, x: 430, y: 665 }, { t: .72, x: 430, y: 665 }, { t: 1, x: 430, y: 665 }];
  if (result === 'withdraw' || result === 'defeat') return [{ t: 0, x: 235, y: 665 }, { t: .42, x: 570, y: 665 }, { t: .62, x: 760, y: 665 }, { t: .82, x: 760, y: 665 }, { t: 1, x: 170, y: 665 }];
  if (result === 'pyrrhic') return [{ t: 0, x: 235, y: 665 }, { t: .55, x: 650, y: 665 }, { t: 1, x: 975, y: 665 }];
  return [{ t: 0, x: 235, y: 665 }, { t: .55, x: 650, y: 665 }, { t: 1, x: 975, y: 665 }];
}

export function buildUniversalPlanSafely(input, options = {}) {
  try { return buildUniversalPlan(input, options); } catch (error) {
    return { ...createUniversalPlan(), ok: false, validation: { ok: false, errors: [{ code: 'planner_exception', message: error instanceof Error ? error.message : String(error) }], warnings: [], metrics: {} } };
  }
}
