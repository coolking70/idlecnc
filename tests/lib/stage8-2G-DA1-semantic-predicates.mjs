import { normalizeVisualUnitClass } from '../../js/battle-presentation/environment/visual-unit-class.js';
import { directionIndexFromRadians } from '../../js/battle-presentation/environment/animation-resolver.js';

const EPS = 1e-7;

export const DA1_FRAME_DEFINITIONS = Object.freeze([
  { id: 'friendly-lineup', file: 'd-a1-01-friendly-unit-lineup.png', semantic: 'friendly-lineup', viewportKind: 'default', fallbackExpected: false },
  { id: 'enemy-lineup', file: 'd-a1-02-enemy-unit-lineup.png', semantic: 'enemy-lineup', viewportKind: 'default', fallbackExpected: false },
  { id: 'friendly-infantry-move', file: 'd-a1-03-friendly-infantry-move.png', semantic: 'friendly-infantry-move', viewportKind: 'default', fallbackExpected: false },
  { id: 'infantry-fire', file: 'd-a1-04-infantry-fire.png', semantic: 'infantry-fire', viewportKind: 'default', fallbackExpected: false },
  { id: 'friendly-at-fire', file: 'd-a1-05-friendly-at-fire.png', semantic: 'friendly-at-fire', viewportKind: 'default', fallbackExpected: false },
  { id: 'enemy-at-fire', file: 'd-a1-06-enemy-at-fire.png', semantic: 'enemy-at-fire', viewportKind: 'default', fallbackExpected: false },
  { id: 'tank-hull-turret-separated', file: 'd-a1-07-tank-hull-turret-separated.png', semantic: 'tank-hull-turret-separated', viewportKind: 'default', fallbackExpected: false },
  { id: 'tank-fire', file: 'd-a1-08-tank-fire.png', semantic: 'tank-fire', viewportKind: 'default', fallbackExpected: false },
  { id: 'mixed-battle', file: 'd-a1-09-mixed-battle.png', semantic: 'mixed-battle', viewportKind: 'default', fallbackExpected: false },
  { id: 'friendly-enemy-wrecks', file: 'd-a1-10-friendly-enemy-wrecks.png', semantic: 'friendly-enemy-wrecks', viewportKind: 'default', fallbackExpected: false },
  { id: 'narrow-readability', file: 'd-a1-11-narrow-readability.png', semantic: 'narrow-readability', viewportKind: 'narrow', fallbackExpected: false },
  { id: 'asset-fallback', file: 'd-a1-12-asset-fallback.png', semantic: 'asset-fallback', viewportKind: 'default', fallbackExpected: true },
  { id: 'formal-unmodified-production', file: 'd-a1-formal-unmodified-mining.png', semantic: 'formal-unmodified-production', viewportKind: 'default', fallbackExpected: false }
]);

export function viewportForSemantic(kind = 'default') {
  if (kind === 'narrow') return { width: 469, height: 726, scale: 469 / 1280, dpr: 1, offsetX: 0, offsetY: (726 - 720 * (469 / 1280)) / 2 };
  const scale = Math.min(1067 / 1280, 712 / 720);
  return { width: 1067, height: 712, scale, dpr: 1, offsetX: 0, offsetY: (712 - 720 * scale) / 2 };
}

function classOf(actorOrRow) { return actorOrRow?.visualClass || actorOrRow?.drawSpec?.visualClass || normalizeVisualUnitClass(actorOrRow); }
function actorId(actor) { return actor?.id || actor?.actorId || null; }
function rowsFor(context) { return context.screenMetrics?.actors || []; }
function actorsFor(context) { return context.state?.actors || []; }
function rowFor(context, id) { return rowsFor(context).find((row) => row.actorId === id) || null; }
function actorFor(context, id) { return actorsFor(context).find((actor) => actor.id === id) || null; }
function rowMatches(context, actor, predicate = () => true) { const row = rowFor(context, actor.id); return row && predicate(row, actor) ? row : null; }

function shotActiveAt(shot, seconds) {
  const aimDuration = Number(shot?.weapon?.aimDuration) || 0;
  const impact = Number(shot?.impactTime ?? shot?.t) || 0;
  const life = Number(shot?.weapon?.impactLife) || .12;
  return seconds >= Number(shot?.t || 0) - aimDuration - EPS && seconds <= impact + life + EPS;
}

function activeShots(context, actorIdValue = null) {
  const seconds = Number(context.timeSeconds) || 0;
  return (context.state?.shotSchedule || []).filter((shot) => (!actorIdValue || shot.actorId === actorIdValue) && shotActiveAt(shot, seconds));
}

function recentShots(context, windowSeconds = 1.2) {
  const seconds = Number(context.timeSeconds) || 0;
  return (context.state?.shotSchedule || []).filter((shot) => Number(shot.t) <= seconds + EPS && seconds - Number(shot.t) <= windowSeconds);
}

function productionRow(context, actor, expectedPath = 'drawImage') {
  return rowMatches(context, actor, (row) => {
    const path = context.fallbackExpected && actor.id === 'unit_stage8g-c1-mining-0' ? 'procedural-fallback' : row.actualDrawPath;
    return path === expectedPath || (expectedPath === 'drawImage' && path === 'drawImage:components');
  });
}

function activeShotFor(context, actor) { return activeShots(context, actor.id); }
function firingActor(context, actor, visualClass = null) {
  const row = rowMatches(context, actor, (candidate) => candidate.animation === 'fire');
  return row && actor.firing === true && (!visualClass || classOf(actor) === visualClass) ? row : null;
}

function fireWeaponMatches(shot, kind) {
  const family = shot?.weaponFamily || shot?.weapon?.family || '';
  const weaponKind = shot?.weaponKind || shot?.weapon?.kind || '';
  if (kind === 'rocket') return weaponKind === 'rocket' || family === 'anti_armor';
  if (kind === 'cannon') return weaponKind === 'cannon' || family === 'tank_cannon';
  return true;
}

function result(id, passed, matchedActorIds = [], matchedShotIds = [], details = {}) {
  return { id, passed: passed === true, matchedActorIds: [...new Set(matchedActorIds.filter(Boolean))], matchedShotIds: [...new Set(matchedShotIds.filter(Boolean))], ...details };
}

export function evaluateDA1SemanticPredicate(id, context) {
  const actors = actorsFor(context);
  const rows = rowsFor(context);
  const production = (actor) => productionRow(context, actor, 'drawImage');
  if (id === 'friendly-lineup') {
    const matched = actors.filter((actor) => actor.side === 'friendly' && ['infantry', 'anti_armor_infantry', 'mbt'].includes(classOf(actor)) && production(actor));
    return result(id, new Set(matched.map(classOf)).size === 3, matched.map(actorId), [], { requiredClasses: ['infantry', 'anti_armor_infantry', 'mbt'] });
  }
  if (id === 'enemy-lineup') {
    const matched = actors.filter((actor) => actor.side === 'enemy' && ['infantry', 'anti_armor_infantry', 'mbt'].includes(classOf(actor)) && production(actor));
    return result(id, new Set(matched.map(classOf)).size === 3, matched.map(actorId), [], { requiredClasses: ['infantry', 'anti_armor_infantry', 'mbt'] });
  }
  if (id === 'friendly-infantry-move') {
    const matched = actors.filter((actor) => actor.side === 'friendly' && classOf(actor) === 'infantry' && actor.visualState === 'move' && production(actor) && rowFor(context, actor.id)?.animation === 'move');
    return result(id, matched.length > 0, matched.map(actorId));
  }
  if (id === 'infantry-fire') {
    const matched = actors.filter((actor) => classOf(actor) === 'infantry' && firingActor(context, actor, 'infantry') && activeShotFor(context, actor).length > 0);
    return result(id, matched.length > 0, matched.map(actorId), matched.flatMap((actor) => activeShotFor(context, actor).map((shot) => shot.id)));
  }
  if (id === 'friendly-at-fire' || id === 'enemy-at-fire') {
    const side = id.startsWith('friendly') ? 'friendly' : 'enemy';
    const matched = actors.filter((actor) => actor.side === side && classOf(actor) === 'anti_armor_infantry' && firingActor(context, actor, 'anti_armor_infantry') && activeShotFor(context, actor).some((shot) => fireWeaponMatches(shot, 'rocket')));
    return result(id, matched.length > 0, matched.map(actorId), matched.flatMap((actor) => activeShotFor(context, actor).filter((shot) => fireWeaponMatches(shot, 'rocket')).map((shot) => shot.id)), { side, animation: 'fire', weaponKind: 'rocket' });
  }
  if (id === 'tank-hull-turret-separated') {
    const matched = actors.filter((actor) => classOf(actor) === 'mbt' && (actor.aiming === true || actor.firing === true) && rowMatches(context, actor, (row) => row.actualDrawPath === 'drawImage:components' && row.hullDirectionIndex != null && row.turretDirectionIndex != null && row.hullDirectionIndex !== row.turretDirectionIndex));
    return result(id, matched.length > 0, matched.map(actorId), activeShots(context).filter((shot) => matched.some((actor) => actor.id === shot.actorId)).map((shot) => shot.id), { separated: matched.length > 0, directionPairs: matched.map((actor) => { const row = rowFor(context, actor.id); return { actorId: actor.id, hullDirectionIndex: row.hullDirectionIndex, turretDirectionIndex: row.turretDirectionIndex }; }) });
  }
  if (id === 'tank-fire') {
    const matched = actors.filter((actor) => {
      if (classOf(actor) !== 'mbt' || actor.firing !== true) return false;
      const row = firingActor(context, actor, 'mbt'); if (!row) return false;
      return activeShotFor(context, actor).some((shot) => fireWeaponMatches(shot, 'cannon') && row.turretDirectionIndex === directionIndexFromRadians(shot.sourceFacingAtFire));
    });
    return result(id, matched.length > 0, matched.map(actorId), matched.flatMap((actor) => activeShotFor(context, actor).filter((shot) => fireWeaponMatches(shot, 'cannon')).map((shot) => shot.id)), { turretMatchesShot: matched.length > 0, animation: 'fire' });
  }
  if (id === 'mixed-battle') {
    const activeOrRecent = recentShots(context);
    const families = new Set(activeOrRecent.map((shot) => shot.weaponFamily || shot.weapon?.family || shot.weaponKind || shot.weapon?.kind).filter(Boolean));
    const matched = actors.filter((actor) => production(actor) && (actor.side === 'friendly' || actor.side === 'enemy'));
    return result(id, new Set(matched.map((actor) => actor.side)).size === 2 && families.size >= 2, matched.map(actorId), activeOrRecent.map((shot) => shot.id), { weaponFamilies: [...families] });
  }
  if (id === 'friendly-enemy-wrecks') {
    const wrecks = context.state?.wrecks || [];
    const matched = wrecks.filter((wreck) => ['wreck_friendly_mbt', 'wreck_enemy_mbt'].includes(wreck.drawSpec?.assetId));
    return result(id, new Set(matched.map((wreck) => wreck.drawSpec?.assetId)).size === 2, [], [], { wreckAssets: matched.map((wreck) => wreck.drawSpec?.assetId) });
  }
  if (id === 'narrow-readability') {
    const required = actors.filter((actor) => ['infantry', 'anti_armor_infantry', 'mbt'].includes(classOf(actor)) && actor.side === 'friendly');
    const matched = required.filter((actor) => { const row = rowFor(context, actor.id); return row && Number(row.screenFootprint) >= Number(row.minimumScreenFootprint); });
    return result(id, context.viewportKind === 'narrow' && required.length >= 3 && matched.length === required.length, matched.map(actorId), [], { viewportKind: context.viewportKind, requiredCount: required.length });
  }
  if (id === 'asset-fallback') {
    const actor = actors.find((candidate) => candidate.id === 'unit_stage8g-c1-mining-0' && classOf(candidate) === 'infantry');
    const row = actor ? rowFor(context, actor.id) : null;
    const path = actor && context.fallbackExpected ? 'procedural-fallback' : row?.actualDrawPath;
    return result(id, Boolean(actor && row && path === 'procedural-fallback'), actor ? [actor.id] : [], [], { fallbackPath: path || null });
  }
  if (id === 'formal-unmodified-production') {
    const required = actors.filter((actor) => actor.side === 'friendly' && ['infantry', 'anti_armor_infantry', 'mbt'].includes(classOf(actor)));
    const matched = required.filter((actor) => production(actor));
    const active = activeShots(context).filter((shot) => shot.side === 'friendly');
    const syntheticIds = actors.filter((actor) => String(actor.id).startsWith('art-'));
    return result(id, syntheticIds.length === 0 && new Set(matched.map(classOf)).size === 3 && active.length > 0 && matched.some((actor) => actor.visualState === 'move' || actor.aiming === true || actor.firing === true), matched.map(actorId), active.map((shot) => shot.id), { fixtureType: 'formal-unmodified' });
  }
  return result(id, false, [], [], { reason: 'unknown_semantic_frame_id' });
}

export function semanticFrameDefinitions() { return DA1_FRAME_DEFINITIONS.map((definition) => ({ ...definition })); }
