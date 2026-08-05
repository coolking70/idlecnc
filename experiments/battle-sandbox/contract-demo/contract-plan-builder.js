import { mapAuthorityAnchors, validateMappedTimes, TIME_MAP_KNOTS } from './contract-time-mapper.js';
import { buildSemanticTimeMap } from './semantic-time-mapper.js';
import { resolveTemplateSlots, TEMPLATE_ID } from './template-slot-resolver.js';
import { buildVisualActor } from './contract-movement-director.js';
import { damageVisualSeverity, pairFireAndDamageAnchors } from './authority-effect-director.js';
import { compareAuthorityToContractFinal, createAuthorityState, applyAuthorityAnchorsThrough } from './authority-state.js';
import { buildRepairGroups } from './repair-choreography.js';
import { resolveAnchorPositions } from './launch-pose-resolver.js';
import { validateRolePresentationPolicy } from './role-presentation-policy.js';
import { validateVictoryTemplateContract } from './victory-template-validator.js';
import { buildRouteRegistry } from './dynamic-route-registry.js';
import { validateSlotLayout } from './slot-layout-validator.js';
import { deconflictRouteRegistry, validateDeconflictedRegistry } from './route-deconflictor.js';
import { validateContinuousLayout } from './continuous-layout-validator.js';

function allContractActors(contract) { return [...(contract?.normalizedBattle?.actors?.friendly || []), ...(contract?.normalizedBattle?.actors?.enemy || [])]; }
function actorMap(contract) { return Object.fromEntries(allContractActors(contract).map((actor) => [actor.id, actor])); }

function weaponFor(anchor, actors) {
  const source = actors[anchor.actorId]; const target = actors[anchor.targetId];
  if (!source) return 'tracer';
  if (source.type === 'mbt') return target?.category === 'infantry' && anchor.value < 50 ? 'coax' : 'cannon';
  if (source.type === 'at_infantry' || source.type === 'enemy_at') return target?.category === 'armor' && anchor.value >= 20 ? 'rocket' : 'rifle';
  return source.type === 'scout_car' ? 'light_tracer' : 'rifle';
}

function typeCounts(anchors) { return Object.fromEntries(['damage', 'suppress', 'repair', 'destroy', 'result'].map((type) => [type, anchors.filter((anchor) => anchor.type === type).length])); }

export function buildVictoryPresentationPlan(contract, options = {}) {
  const contractCheck = validateVictoryTemplateContract(contract);
  if (!contractCheck.ok && contractCheck.code === 'unsupported_result') return { ok: false, code: contractCheck.code, reason: contractCheck.reason, validation: contractCheck };
  const errors = [...contractCheck.errors];
  const actors = actorMap(contract);
  const sourceId = options.sourceId || contract?.sourceId || null;
  const timeMap = options.legacyTimeMap ? { duration: 35, milestones: null, knots: TIME_MAP_KNOTS, sourceDuration: TIME_MAP_KNOTS.at(-1).source, sourceId } : buildSemanticTimeMap(contract, { sourceId });
  const mappedAnchors = mapAuthorityAnchors(contract?.authorityAnchors || [], options.legacyTimeMap ? null : timeMap);
  const timing = validateMappedTimes(mappedAnchors, options.legacyTimeMap ? null : timeMap, contract); errors.push(...timing.errors);
  const pairings = pairFireAndDamageAnchors(mappedAnchors);
  const enrichedAnchors = mappedAnchors.map((anchor) => {
    const target = actors[anchor.targetId];
    const nextFire = mappedAnchors.find((candidate) => candidate.type === 'fire' && candidate.targetId === anchor.targetId && candidate.presentationTime > anchor.presentationTime);
    return { ...anchor, weaponKind: weaponFor(anchor, actors), severity: anchor.type === 'damage' ? damageVisualSeverity(anchor, target) : null, suppressedUntil: anchor.type === 'suppress' ? Math.min(nextFire?.presentationTime ?? anchor.presentationTime + 1.4, anchor.presentationTime + 1.4) : undefined };
  });
  const slots = resolveTemplateSlots(contract); errors.push(...slots.errors);
  const routeData = buildRouteRegistry(slots.slots, allContractActors(contract));
  errors.push(...routeData.errors);
  const routePlan = { actors: slots.slots.map((slot) => ({ ...actors[slot.actorId], templateSlot: slot.slotId })), duration: 35, routeRegistry: routeData.registry };
  const deconflicted = deconflictRouteRegistry(routePlan, contract, { routeRegistry: routeData.registry });
  errors.push(...deconflicted.errors);
  const routeRegistry = deconflicted.routeRegistry;
  const visualActors = slots.slots.map((slot) => buildVisualActor(actors[slot.actorId], slot, routeRegistry));
  const actorById = Object.fromEntries(visualActors.map((actor) => [actor.id, actor]));
  const positionedAnchors = resolveAnchorPositions(enrichedAnchors, actorById, pairings, routeRegistry);
  const required = positionedAnchors.filter((anchor) => anchor.required);
  const expectedAll = contract.authorityAnchors.length;
  const expectedRequired = contract.authorityAnchors.filter((anchor) => anchor.required).length;
  if (positionedAnchors.length !== expectedAll) errors.push(`scheduled anchor count mismatch: expected ${expectedAll}, found ${positionedAnchors.length}`);
  if (required.length !== expectedRequired) errors.push(`required anchor count mismatch: expected ${expectedRequired}, found ${required.length}`);
  const sourceIds = new Set(positionedAnchors.map((anchor) => anchor.sourceEventId));
  if (sourceIds.size !== positionedAnchors.length) errors.push('sourceEventId is not unique');
  for (const anchor of positionedAnchors) {
    if (anchor.actorId && !actors[anchor.actorId]) errors.push(`${anchor.id} has unknown actorId`);
    if (anchor.targetId && !actors[anchor.targetId]) errors.push(`${anchor.id} has unknown targetId`);
    const sourceEvent = contract.normalizedBattle.events[anchor.sourceIndex];
    if (sourceEvent && (sourceEvent.actorId !== anchor.actorId || sourceEvent.targetId !== anchor.targetId || sourceEvent.value !== anchor.value)) errors.push(`${anchor.id} changed source event fields`);
  }
  const plan = {
    ok: false,
    scene: 'contract-driven-road-assault', templateId: TEMPLATE_ID, duration: 35, sourceDuration: contract.presentation.sourceDuration,
    sourceId, sourceKind: options.sourceKind || 'formal_fixture', rebuildHash: options.rebuildHash || null, reportId: contract.normalizedBattle.battle.id, seed: contract.normalizedBattle.battle.seed,
    missionKind: contract.normalizedBattle.battle.missionKind, missionId: contract.normalizedBattle.battle.missionId,
    theaterId: contract.normalizedBattle.battle.theaterId, strategyId: contract.normalizedBattle.battle.strategyId,
    result: contract.normalizedBattle.battle.result, capture: contract.normalizedBattle.battle.capture,
    roleBinding: contract.roleBinding, timeMap, milestones: timeMap.milestones,
    actorToSlot: slots.actorToSlot, slotToActor: slots.slotToActor, slots: slots.slots, routeRegistry,
    actors: visualActors, actorById, anchors: positionedAnchors, requiredAnchors: required, pairings,
    counts: { realActors: allContractActors(contract).length, visualActors: visualActors.length, anchors: positionedAnchors.length, requiredAnchors: required.length, ...typeCounts(positionedAnchors) },
    validation: { ok: errors.length === 0, errors }
  };
  plan.repairGroups = buildRepairGroups(plan);
  plan.routeDeconfliction = { adjustments: deconflicted.adjustments, before: deconflicted.before, after: deconflicted.after, validation: validateDeconflictedRegistry(plan, contract, routeRegistry) };
  plan.layoutValidation = validateSlotLayout(plan);
  plan.validation.errors.push(...plan.layoutValidation.errors);
  plan.continuousLayout = validateContinuousLayout(plan, contract);
  plan.validation.errors.push(...plan.continuousLayout.errors);
  const finalState = createAuthorityState(contract); applyAuthorityAnchorsThrough(finalState, positionedAnchors, plan.duration);
  plan.finalAuthority = finalState;
  const finalCompare = compareAuthorityToContractFinal(finalState, contract); plan.validation.errors.push(...finalCompare.errors);
  plan.validation.errors.push(...validateRolePresentationPolicy(plan).errors);
  plan.validation.ok = plan.validation.errors.length === 0; plan.ok = plan.validation.ok;
  return plan;
}

export function buildPresentationPlan(contract, options = {}) { return buildVictoryPresentationPlan(contract, { ...options, legacyTimeMap: true }); }

export function validateContractDrivenPlan(plan, contract) {
  const errors = [...(plan?.validation?.errors || [])];
  const expectedAll = contract?.authorityAnchors?.length ?? 0; const expectedRequired = contract?.authorityAnchors?.filter((anchor) => anchor.required).length ?? 0;
  if (plan?.templateId !== TEMPLATE_ID) errors.push('wrong templateId');
  if (plan?.counts?.realActors !== allContractActors(contract).length || plan?.counts?.visualActors !== allContractActors(contract).length) errors.push('real/visual actor count mismatch');
  const all = allContractActors(contract); const realIds = new Set(all.map((actor) => actor.id));
  if (new Set((plan?.actors || []).map((actor) => actor.sourceActorId)).size !== all.length) errors.push('sourceActorId is not unique');
  if ((plan?.actors || []).some((actor) => !realIds.has(actor.sourceActorId))) errors.push('plan includes a non-report actor');
  if ((plan?.actors || []).some((actor) => actor.type === 'enemy_light_armor' || actor.type === 'enemy_mbt')) errors.push('enemy armor actor is forbidden');
  if (plan?.anchors?.length !== expectedAll || plan?.requiredAnchors?.length !== expectedRequired) errors.push('anchor coverage mismatch');
  if (plan?.result !== 'victory') errors.push('plan result is not victory');
  return { ok: errors.length === 0, errors };
}
