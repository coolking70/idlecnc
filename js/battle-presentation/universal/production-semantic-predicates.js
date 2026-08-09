import { PROHIBITED_UNARMED_VISUAL_STATES, WEAPON_TOPOLOGY } from '../environment/presentation-facing-policy.js';
import { isRepairCapableActor } from './presentation-action-attribution.js';
import { normalizeEffectWeaponFamily } from '../effects/presentation-effects-runtime.js';

const lower = (value) => String(value || '').toLowerCase();
const activeAt = (item, seconds) => Number(seconds) >= Number(item?.start ?? item?.t ?? item?.time ?? 0) - 1e-6 && Number(seconds) <= Number(item?.end ?? item?.impactTime ?? item?.t ?? item?.time ?? 0) + 1e-6;
const actorClass = (actor) => lower(actor?.drawSpec?.visualClass || actor?.visualClass || actor?.type);
const actorName = (actor) => `${actorClass(actor)} ${lower(actor?.type)} ${lower(actor?.role)}`;
const formalWeaponId = (shot) => lower(shot?.weapon?.id || shot?.weaponId);
const formalWeaponFamily = (shot) => lower(shot?.weapon?.family || shot?.weaponFamily);
const isInfantryActor = (actor) => ['infantry', 'enemy_infantry'].includes(lower(actor?.type)) || actorClass(actor) === 'infantry';
const isAntiArmorActor = (actor) => ['at_infantry', 'enemy_at'].includes(lower(actor?.type)) || actorClass(actor) === 'anti_armor_infantry';
const isScoutActor = (actor) => ['scout_car', 'enemy_scout_car'].includes(lower(actor?.type)) || (actorClass(actor) === 'light_vehicle' && lower(actor?.shape).includes('scout'));
const isMbtActor = (actor) => lower(actor?.type) === 'mbt' || actorClass(actor) === 'mbt';
const formalWeaponMatches = (shot, ids, families, kinds = []) => {
  const id = formalWeaponId(shot); const family = formalWeaponFamily(shot); const kind = lower(shot?.weapon?.kind || shot?.weaponKind);
  return ids.includes(id) || families.includes(family) || kinds.includes(kind);
};

function activeShots(state) {
  const seconds = Number(state?.time) || 0;
  return (state?.shotSchedule || []).filter((shot) => seconds >= Number(shot.t || 0) - Number(shot.weapon?.aimDuration || 0) && seconds <= Number(shot.impactTime || shot.t || 0) + Number(shot.weapon?.impactLife || .12));
}

function result(id, passed, matchedActorIds = [], matchedShotIds = [], details = {}) {
  return { id, passed: Boolean(passed), matchedActorIds: [...new Set(matchedActorIds)].sort(), matchedShotIds: [...new Set(matchedShotIds)].sort(), details };
}

export const PRODUCTION_SEMANTIC_IDS = Object.freeze(['scout-move', 'scout-fire', 'scout-impact', 'repair-action', 'support-unarmed', 'cover-advance', 'retreat-rear-guard', 'infantry-muzzle', 'at-rocket-launch', 'mbt-cannon-fire', 'small-arms-impact', 'rocket-impact', 'tank-impact', 'damaged-smoke', 'unit-destroy', 'wreck-smoke', 'repair-effect', 'battle-intro', 'victory-outro', 'withdraw-outro']);

export function evaluateProductionSemanticPredicate(name, state) {
  const id = lower(name).replace(/_/g, '-');
  const actors = state?.actors || [];
  const seconds = Number(state?.time) || 0;
  if (id.includes('scout-move')) {
    const matched = actors.filter((actor) => actorName(actor).includes('scout') && actor.visualState === 'move' && actor.drawSpec?.animation === 'move');
    return result('scout-move', matched.length > 0, matched.map((actor) => actor.id), [], { state: 'move', animation: 'move' });
  }
  if (id.includes('scout-fire') && !(state?.effects || []).some((effect) => effect.kind === 'muzzle_flash')) {
    const shots = activeShots(state);
    const matched = actors.filter((actor) => isScoutActor(actor) && actor.visualState === 'fire' && actor.firing === true && actor.weaponTopology !== WEAPON_TOPOLOGY.UNARMED && actor.drawSpec?.animation === 'fire');
    const shotIds = shots.filter((shot) => matched.some((actor) => actor.id === shot.actorId) && normalizeEffectWeaponFamily(shot) === 'scout_autocannon' && formalWeaponMatches(shot, ['scout_machine_gun'], ['scout_autocannon'], ['small_arms'])).map((shot) => shot.id);
    return result('scout-fire', matched.length > 0 && shotIds.length > 0, matched.map((actor) => actor.id), shotIds, { state: 'fire', activeShot: shotIds.length > 0 });
  }
  const presentationEffects = state?.effects || [];
  const hasEffect = (predicate) => presentationEffects.filter((effect) => predicate(effect)).filter((effect) => Number(effect.life ?? 1) > 0);
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const semanticWeapon = (family, stateId, actorPredicate, weaponPredicate) => {
    const matches = hasEffect((effect) => effect.kind === 'muzzle_flash' && effect.weaponFamily === family);
    const shotsById = new Map((state?.shotSchedule || []).map((shot) => [shot.id, shot]));
    const valid = matches.filter((effect) => {
      const shot = shotsById.get(effect.shotId); const actor = actorById.get(effect.actorId);
      return Boolean(shot && actor && effect.actorId === shot.actorId && normalizeEffectWeaponFamily(shot) === family && actorPredicate(actor) && weaponPredicate(shot) && shot.presentationOnly !== false && shot.actorId && shot.targetId && shot.sourcePositionAtFire && shot.impactPositionAtImpact && effect.authoritySource?.shotId === shot.id);
    });
    return result(stateId, matches.length > 0 && valid.length === matches.length, valid.map((effect) => effect.actorId).filter(Boolean), valid.map((effect) => effect.shotId).filter(Boolean), { effectCount: matches.length, weaponFamily: family, formalShotBinding: valid.length === matches.length });
  };
  if (id === 'infantry-muzzle') return semanticWeapon('infantry_light', 'infantry-muzzle', isInfantryActor, (shot) => formalWeaponMatches(shot, ['infantry_light'], ['infantry_light', 'infantry_rifle'], ['small_arms']));
  if (id === 'at-rocket-launch') return semanticWeapon('anti_armor', 'at-rocket-launch', isAntiArmorActor, (shot) => formalWeaponMatches(shot, ['anti_armor_rocket'], ['anti_armor', 'rocket_launcher'], ['rocket']));
  if (id === 'mbt-cannon-fire') return semanticWeapon('tank_cannon', 'mbt-cannon-fire', isMbtActor, (shot) => formalWeaponMatches(shot, ['tank_main_gun'], ['tank_cannon', 'tank_main_gun'], ['cannon']));
  if (id === 'scout-fire') return semanticWeapon('scout_autocannon', 'scout-fire', isScoutActor, (shot) => formalWeaponMatches(shot, ['scout_machine_gun'], ['scout_autocannon'], ['small_arms']));
  const impactSemantic = (stateId, family, kind, actorPredicate, weaponPredicate) => {
    const matches = hasEffect((effect) => effect.kind === kind && effect.weaponFamily === family);
    const shotsById = new Map((state?.shotSchedule || []).map((shot) => [shot.id, shot]));
    const valid = matches.filter((effect) => { const shot = shotsById.get(effect.shotId); const actor = actorById.get(effect.actorId); return Boolean(shot && actor && effect.actorId === shot.actorId && effect.targetActorId === shot.targetId && normalizeEffectWeaponFamily(shot) === family && actorPredicate(actor) && weaponPredicate(shot) && effect.authoritySource?.shotId === shot.id && effect.authoritySource?.impactAnchorId); });
    return result(stateId, matches.length > 0 && valid.length === matches.length, valid.map((effect) => effect.actorId).filter(Boolean), valid.map((effect) => effect.shotId).filter(Boolean), { effectKind: kind, formalAnchorBound: valid.length === matches.length });
  };
  if (id === 'small-arms-impact') return impactSemantic('small-arms-impact', 'infantry_light', 'impact_spark', isInfantryActor, (shot) => formalWeaponMatches(shot, ['infantry_light'], ['infantry_light', 'infantry_rifle'], ['small_arms']));
  if (id === 'rocket-impact') return impactSemantic('rocket-impact', 'anti_armor', 'rocket_impact', isAntiArmorActor, (shot) => formalWeaponMatches(shot, ['anti_armor_rocket'], ['anti_armor', 'rocket_launcher'], ['rocket']));
  if (id === 'scout-impact') return impactSemantic('scout-impact', 'scout_autocannon', 'impact_spark', isScoutActor, (shot) => formalWeaponMatches(shot, ['scout_machine_gun'], ['scout_autocannon'], ['small_arms']));
  if (id === 'tank-impact') return impactSemantic('tank-impact', 'tank_cannon', 'cannon_impact', isMbtActor, (shot) => formalWeaponMatches(shot, ['tank_main_gun'], ['tank_cannon', 'tank_main_gun'], ['cannon']));
  if (id === 'damaged-smoke') {
    const matches = hasEffect((effect) => effect.kind === 'damage_smoke' && ['damaged', 'critical'].includes(effect.damageTier));
    return result('damaged-smoke', matches.length > 0 && matches.every((effect) => Boolean(effect.damageEventId && effect.targetActorId && effect.authoritySource?.anchorId)), matches.map((effect) => effect.targetActorId).filter(Boolean), [], { effectKind: 'damage_smoke', damageAnchorBound: matches.every((effect) => Boolean(effect.damageEventId)) });
  }
  if (id === 'unit-destroy') {
    const matches = hasEffect((effect) => ['destroy_flash', 'destruction'].includes(effect.kind));
    const valid = matches.filter((effect) => effect.destroyEventId && effect.targetActorId);
    return result('unit-destroy', valid.length > 0, valid.map((effect) => effect.targetActorId), [], { destructionEffectCount: matches.length, wreckBound: (state.wrecks || []).some((wreck) => valid.some((effect) => wreck.sourceActorId === effect.targetActorId || wreck.actorId === effect.targetActorId)), destroyEventIds: valid.map((effect) => effect.destroyEventId) });
  }
  if (id === 'wreck-smoke') {
    const matches = hasEffect((effect) => ['destroy_smoke', 'wreck_fire'].includes(effect.kind) && effect.wreckReady === true);
    return result('wreck-smoke', matches.length > 0 && matches.every((effect) => (state.wrecks || []).some((wreck) => wreck.sourceActorId === effect.targetActorId)), matches.map((effect) => effect.targetActorId).filter(Boolean), [], { wreckReady: matches.length > 0, persistent: true });
  }
  if (id === 'repair-effect') {
    const matches = hasEffect((effect) => effect.kind === 'repair_beam' && effect.repairSourceActorId && effect.repairTargetActorId);
    const valid = matches.filter((effect) => effect.repairSourceActorId !== effect.repairTargetActorId && (state.formalRepairEvents || []).some((event) => event.id === effect.repairEventId && event.sourceActorId === effect.repairSourceActorId && event.targetActorId === effect.repairTargetActorId));
    return result('repair-effect', valid.length > 0, valid.flatMap((effect) => [effect.repairSourceActorId, effect.repairTargetActorId]), [], { sourceTargetBound: valid.length > 0, repairEventIds: valid.map((effect) => effect.repairEventId) });
  }
  if (id === 'battle-intro' || id === 'victory-outro' || id === 'withdraw-outro') {
    const transition = state?.transitions;
    const expected = id.replace(/-/g, '_');
    return result(id, transition?.kind === expected || (id !== 'battle-intro' && transition?.kind === 'completed' && transition?.result === (id === 'victory-outro' ? 'victory' : 'withdraw')), [], [], { transition: transition?.kind || null, phase: transition?.phase || null, deterministic: transition?.deterministic === true });
  }
  if (id.includes('repair')) {
    const events = (state?.formalRepairEvents || []).filter((event) => seconds >= Number(event.t) - 1e-6 && seconds <= Number(event.t) + .42 + 1e-6 && event.sourceActorId && event.targetActorId);
    for (const event of events) {
      const source = actors.find((actor) => actor.id === event.sourceActorId);
      const target = actors.find((actor) => actor.id === event.targetActorId);
      const sourceBound = Boolean(source && source.id === event.sourceActorId && isRepairCapableActor(source) && source.repairSource === true && source.formalRepairSourceActive === true && source.visualState === 'repair' && source.visualStatus === 'repairing' && source.drawSpec?.animation === 'repair');
      const targetBound = Boolean(target && target.id === event.targetActorId && target.id !== event.sourceActorId && target.repairTargeted === true && target.visualStatus === 'being_repaired' && target.drawSpec?.animation !== 'repair');
      if (sourceBound && targetBound) return { ...result('repair-action', true, [source.id, target.id], [], { formalRepairEvent: true, formalRepairEventId: event.id || null, sourceActorId: source.id, targetActorId: target.id, sourceType: source.type || null, targetType: target.type || null, sourceAnimation: source.drawSpec.animation, sourceVisualState: source.visualState, targetBound: true, targetAnimation: target.drawSpec?.animation || null }), repairSourceActorId: source.id, repairTargetActorId: target.id, sourceAnimation: source.drawSpec.animation, sourceVisualState: source.visualState, targetBound: true, formalRepairEventId: event.id || null };
    }
    return { ...result('repair-action', false, [], [], { formalRepairEvent: false, targetBound: false, reason: 'repair_source_target_binding_missing' }), repairSourceActorId: null, repairTargetActorId: null, sourceAnimation: null, sourceVisualState: null, targetBound: false, formalRepairEventId: null };
  }
  if (id.includes('support')) {
    const matched = actors.filter((actor) => actorName(actor).includes('support') && actor.weaponTopology === WEAPON_TOPOLOGY.UNARMED && !PROHIBITED_UNARMED_VISUAL_STATES.includes(lower(actor.visualState)) && actor.firing !== true && actor.aiming !== true && actor.reloading !== true);
    return result('support-unarmed', matched.length > 0, matched.map((actor) => actor.id), [], { prohibitedStates: PROHIBITED_UNARMED_VISUAL_STATES });
  }
  if (id.includes('cover-advance')) {
    const activeMoves = (state?.engagementSchedule?.coverMoves || []).filter((move) => activeAt(move, seconds));
    const matched = actors.filter((actor) => actor.presentationMode === 'cover_advance' && activeMoves.some((move) => (move.maneuverGroupIds || []).includes(actor.id)));
    return result('cover-advance', matched.length > 0, matched.map((actor) => actor.id), [], { activeMoveCount: activeMoves.length });
  }
  if (id.includes('retreat') || id.includes('rear-guard')) {
    const activeRetreats = (state?.engagementSchedule?.retreatOrders || []).filter((order) => activeAt(order, seconds));
    const retreatActorIds = activeRetreats.filter((order) => order.role !== 'rear_guard').map((order) => order.actorId).filter((actorId) => actors.some((actor) => actor.id === actorId && actor.presentationMode === 'retreat_route'));
    const rearGuardActorIds = activeRetreats.filter((order) => order.role === 'rear_guard').map((order) => order.actorId).filter((actorId) => actors.some((actor) => actor.id === actorId && actor.presentationMode === 'rear_guard_hold'));
    const distinctPair = retreatActorIds.some((actorId) => rearGuardActorIds.every((guardId) => guardId !== actorId));
    const matchedActorIds = [...new Set([...retreatActorIds, ...rearGuardActorIds])];
    return result('retreat-rear-guard', retreatActorIds.length > 0 && rearGuardActorIds.length > 0 && distinctPair, matchedActorIds, activeShots(state).filter((shot) => rearGuardActorIds.includes(shot.actorId)).map((shot) => shot.id), { retreatPresent: retreatActorIds.length > 0, rearGuardPresent: rearGuardActorIds.length > 0, retreatActorIds, rearGuardActorIds, distinctPair });
  }
  return result(id || 'unknown', false, [], [], { reason: 'unknown_semantic_id' });
}
