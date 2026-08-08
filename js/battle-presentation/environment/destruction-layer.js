import { buildBattlefieldDecals } from './battlefield-decals.js';
import { buildPersistentEffects, EFFECT_LIMITS } from './persistent-effects.js';
import { deterministicUnit } from './environment-layout.js';
import { normalizeVisualUnitClass } from './visual-unit-class.js';

function actorById(plan) { return new Map([...(plan?.forces?.friendly || []), ...(plan?.forces?.enemy || [])].map((actor) => [actor.actorId, actor])); }
function wreckType(actor) { const visualClass = normalizeVisualUnitClass(actor); if (!actor) return 'unknown_wreck'; if (visualClass === 'mbt') return 'tank_wreck'; if (visualClass === 'light_vehicle' || visualClass === 'support_vehicle') return 'light_vehicle_wreck'; if (visualClass === 'infantry' || visualClass === 'anti_armor_infantry') return 'infantry_casualty_marker'; return 'structure_wreck'; }
function destroyEvents(plan, shots) {
  const known = new Set(shots.filter((shot) => shot.hitType === 'destroy' || shot.authorityType === 'destroy').map((shot) => shot.targetId));
  return (plan?.timeline?.anchors || []).filter((anchor) => anchor.type === 'destroy' && anchor.targetId && !known.has(anchor.targetId)).map((anchor) => ({ id: anchor.id, targetId: anchor.targetId, t: Number(anchor.t) || 0, point: anchor.impact || anchor.position || null, source: 'authority_anchor' }));
}

export function buildPersistentDestructionLayer(plan, seconds, options = {}) {
  const shots = [...(options.visualShotSchedule || [])].sort((left, right) => Number(left.impactTime ?? left.t) - Number(right.impactTime ?? right.t) || String(left.id).localeCompare(String(right.id))); const actors = actorById(plan); const wind = options.windVector || { x: 0, y: 0 }; const decals = buildBattlefieldDecals(plan, seconds, shots); const persistent = buildPersistentEffects(plan, seconds, shots, options.actors || [], wind); const wrecks = [];
  for (const shot of shots.filter((item) => item.hitType === 'destroy' || item.authorityType === 'destroy')) { const actor = actors.get(shot.targetId); const t = Number(shot.impactTime ?? shot.t) || 0; if (t > seconds + 1e-9 || seconds - t < .95 || !shot.impactPositionAtImpact) continue; wrecks.push({ id: `wreck_${shot.targetId}`, sourceActorId: shot.targetId, side: actor?.side || null, visualClass: normalizeVisualUnitClass(actor), x: shot.impactPositionAtImpact.x, y: shot.impactPositionAtImpact.y, angle: Number(shot.targetFacingAtImpact ?? 0), wreckType: wreckType(actor), smoke: true, persistent: true, createdAt: t, visualFootprint: actor?.footprint || null, seed: shot.seed ?? deterministicUnit(plan?.source?.seed ?? 0, shot.id) }); }
  for (const event of destroyEvents(plan, shots)) { if (event.t > seconds || seconds - event.t < .95 || !event.point) continue; const actor = actors.get(event.targetId); wrecks.push({ id: `wreck_${event.targetId}`, sourceActorId: event.targetId, side: actor?.side || null, visualClass: normalizeVisualUnitClass(actor), x: event.point.x, y: event.point.y, angle: Number(actor?.facing) || 0, wreckType: wreckType(actor), smoke: true, persistent: true, createdAt: event.t, seed: deterministicUnit(plan?.source?.seed ?? 0, event.id) }); }
  const uniqueWrecks = [...new Map(wrecks.map((wreck) => [wreck.id, wreck])).values()];
  return { version: '8.2G-C-destruction-1', decals, effects: [...persistent.effects, ...persistent.dust], smoke: persistent.smoke, debris: persistent.debris, wrecks: uniqueWrecks, limits: { ...EFFECT_LIMITS, maxPersistentDecals: 128 }, signature: JSON.stringify({ decals, effects: persistent.effects, smoke: persistent.smoke, debris: persistent.debris, wrecks: uniqueWrecks }) };
}
