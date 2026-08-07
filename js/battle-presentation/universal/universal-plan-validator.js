function error(errors, code, details = {}) { errors.push({ code, ...details }); }
const actorIdSet = (forces) => new Set([...forces.friendly, ...forces.enemy].map((row) => row.actorId));
import { validateContinuousUniversalLayout } from './universal-layout-deconflictor.js';
import { validateUniversalObstacles } from './universal-obstacle-validator.js';
import { validateUniversalSpatialPlan } from './universal-continuous-validator.js';

export function validateUniversalPlan(plan, contract) {
  const errors = []; const warnings = [];
  const normalized = contract?.normalizedBattle || {};
  if (contract?.validation?.ok !== true) error(errors, 'formal_contract_invalid', { sourceErrors: contract?.validation?.errors || [] });
  const ids = actorIdSet(plan.forces); const assigned = new Set(plan.assignments.map((item) => item.actorId));
  if (ids.size !== assigned.size) error(errors, 'actor_assignment_count_mismatch', { actors: ids.size, assigned: assigned.size });
  for (const id of ids) if (!assigned.has(id)) error(errors, 'actor_missing_assignment', { actorId: id });
  if (plan.assignments.some((item) => !ids.has(item.actorId))) error(errors, 'fabricated_actor_assignment');
  const anchors = plan.timeline.anchors || []; const sourceEvents = normalized.events || [];
  if (anchors.length !== sourceEvents.length) error(errors, 'authority_anchor_count_mismatch', { expected: sourceEvents.length, actual: anchors.length });
  anchors.forEach((anchor, index) => {
    const event = sourceEvents[index];
    if (!event || anchor.sourceEventId !== event.id || anchor.type !== event.type || anchor.actorId !== event.actorId || anchor.targetId !== event.targetId || anchor.value !== event.value) error(errors, 'authority_anchor_changed', { index, anchor, event });
    if (index && anchor.t < anchors[index - 1].t) error(errors, 'timeline_not_monotonic', { index });
  });
  const authorityActions = plan.timeline.actions.filter((item) => item.authority === true);
  if (authorityActions.length !== anchors.length) error(errors, 'authority_action_count_mismatch', { expected: anchors.length, actual: authorityActions.length });
  const requiredAnchors = anchors.filter((anchor) => anchor.required); const requiredActions = authorityActions.filter((action) => action.required || requiredAnchors.some((anchor) => anchor.sourceEventId === action.sourceEventId));
  if (requiredActions.length !== requiredAnchors.length) error(errors, 'required_authority_anchor_count_mismatch', { expected: requiredAnchors.length, actual: requiredActions.length });
  const nodeActors = new Set(plan.layout.nodes.map((node) => node.actorId));
  if (nodeActors.size !== ids.size) error(errors, 'layout_actor_count_mismatch');
  for (const id of ids) if (!nodeActors.has(id)) error(errors, 'actor_missing_layout_node', { actorId: id });
  if ((plan.layout.metrics?.sameSideOverlaps || 0) > 0) error(errors, 'same_side_layout_overlap', { count: plan.layout.metrics.sameSideOverlaps });
  for (const route of plan.layout.routes || []) {
    if (route.points.length < 2 || route.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) error(errors, 'invalid_route', { actorId: route.actorId });
  }
  const result = normalized.battle?.result;
  if (plan.source.result !== result) error(errors, 'result_changed');
  if (result === 'withdraw' && !plan.layout.routes.some((route) => route.retreat)) error(errors, 'withdraw_missing_retreat_route');
  if (result === 'wiped' && plan.outcome.finalState.friendlyAliveIds.length > 0) error(errors, 'wiped_has_survivors');
  if (normalized.events?.some((event) => event.type === 'repair') && !plan.timeline.actions.some((item) => item.type === 'repair_approach' && item.authority === false)) error(errors, 'repair_contact_missing');
  if (plan.scene?.objective?.convoy && plan.timeline.actions.some((item) => item.type === 'escort_convoy' && item.authority !== false)) error(errors, 'convoy_action_must_be_non_authority');
  if ((result === 'victory' || result === 'pyrrhic') && plan.source.missionKind === 'campaign') {
    if (plan.outcome.capture !== true) error(errors, 'winning_capture_missing');
    if (plan.outcome.finalState.enemyAliveIds.length > 0 && !plan.outcome.finalState.friendlyAliveIds.length) error(errors, 'winning_state_inconsistent');
  }
  if (intentMissionMismatch(plan)) warnings.push({ code: 'generic_mission_profile', missionId: plan.source.missionId });
  if (plan.timeline.duration > plan.timeline.sourceDuration) error(errors, 'presentation_exceeds_source_duration');
  for (const actor of [...(normalized.actors?.friendly || []), ...(normalized.actors?.enemy || [])]) { const actual = plan.outcome.finalState.actors?.[actor.id]; if (!actual || actual.hp !== actor.final.hp || actual.maxHp !== actor.final.maxHp || actual.alive !== actor.final.alive || actual.side !== actor.side || actual.type !== actor.type) error(errors, 'final_actor_state_changed', { actorId: actor.id }); }
  const outcomeTypes = new Set(plan.outcome.choreography || []); const requiredOutcome = { victory: ['secure_objective', 'escort_complete', 'salvage_complete', 'sweep_complete'], pyrrhic: ['costly_secure', 'damage_assessment', 'limited_perimeter'], withdraw: ['covering_fire_presentation', 'organized_disengagement', 'withdraw_to_safe_edge'], defeat: ['line_collapse', 'forced_retreat', 'enemy_controls_field'], wiped: ['force_destroyed', 'battlefield_silence', 'enemy_controls_field'] }[result] || [];
  if (result === 'victory') { if (!requiredOutcome.some((type) => outcomeTypes.has(type))) error(errors, 'outcome_choreography_missing', { result }); } else for (const type of requiredOutcome) if (!outcomeTypes.has(type)) error(errors, 'outcome_choreography_missing', { result, type });
  if (['withdraw', 'defeat', 'wiped'].includes(result) && outcomeTypes.has('secure_objective')) error(errors, 'failure_contains_secure_objective', { result });
  if (result === 'wiped' && plan.layout.routes.some((route) => route.side === 'friendly' && route.finalTarget.x < 100 && route.finalTarget.x !== plan.layout.nodes.find((node) => node.actorId === route.actorId)?.x)) error(errors, 'wiped_has_return_route');
  const continuous = validateContinuousUniversalLayout(plan, { step: 0.05 }); const spatial = validateUniversalSpatialPlan(plan, { step: 0.05 }); const obstacles = validateUniversalObstacles(plan); if (!continuous.ok) error(errors, 'continuous_layout_collision', { metrics: continuous.metrics, samples: continuous.errors.slice(0, 3) }); if (!spatial.ok) error(errors, 'continuous_spatial_collision', { metrics: spatial.metrics, samples: spatial.details.slice(0, 3) }); if (!obstacles.ok) error(errors, 'obstacle_validation_failed', { errors: obstacles.errors });
  return { ok: errors.length === 0, errors, warnings, metrics: { actorCount: ids.size, assignmentCount: assigned.size, anchorCount: anchors.length, requiredAnchorCount: requiredAnchors.length, actionCount: plan.timeline.actions.length, nodeCount: nodeActors.size, routeCount: plan.layout.routes.length, continuousSamples: continuous.metrics.samples, continuousCollisions: continuous.metrics.collisions, spatialSamples: spatial.metrics.samples, spatialEntityCount: spatial.metrics.entityCount, spatialPairChecks: spatial.metrics.pairChecks, spatialCollisions: spatial.collisions, obstacleErrors: obstacles.errors.length } };
}

function intentMissionMismatch(plan) { return plan.scene?.objective?.kind === 'secure' && !['campaign', 'operation'].includes(plan.source.missionKind); }
