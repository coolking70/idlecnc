/**
 * Presentation-only effects runtime for 8.2G-D-C.
 *
 * This module consumes the formal timeline and the already-derived visual shot
 * schedule.  It never creates, edits or reorders authority events.  Every
 * transient is keyed to a formal event/shot so seeking the presentation clock
 * produces the same frame as replaying it from the beginning.
 */

import { deterministicUnit } from '../universal/visual-weapon-profiles.js';

export const EFFECT_RUNTIME_VERSION = '8.2G-D-C';

export const EFFECT_LIMITS = Object.freeze({
  maxEffects: 96,
  maxSmokeParticles: 32,
  maxDebrisParticles: 48,
  maxCameraTranslation: 5,
  maxCameraZoomDelta: 0.018,
  reducedMotionCameraTranslation: 0,
  reducedMotionZoomDelta: 0
});

const EPSILON = 1e-6;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const point = (actor) => ({ ...(actor?.visualCenter || actor?.position || { x: 0, y: 0 }) });
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const EFFECT_PRIORITY = Object.freeze({
  muzzle_flash: 100,
  rocket_trail: 98,
  impact_spark: 96,
  rocket_impact: 95,
  cannon_impact: 95,
  destroy_flash: 100,
  destruction: 100,
  repair_beam: 100,
  repair_spark: 99,
  damage_spark: 94,
  damage_smoke: 82,
  destroy_smoke: 80,
  wreck_fire: 78,
  wreck_smoke: 76
});

function actorsById(actors) { return new Map((actors || []).map((actor) => [actor.id || actor.actorId, actor])); }
function anchorsAt(plan, type) { return (plan?.timeline?.anchors || []).filter((anchor) => !type || anchor.type === type); }
function active(seconds, start, life) { return seconds >= finite(start) - EPSILON && seconds <= finite(start) + Math.max(0, finite(life)) + EPSILON; }
function ageAt(seconds, start) { return seconds - finite(start); }
function progress(seconds, start, life) { return clamp(ageAt(seconds, start) / Math.max(.001, finite(life, 1)), 0, 1); }
function alpha(seconds, start, life) { return 1 - progress(seconds, start, life); }

export function normalizeEffectWeaponFamily(shot = {}) {
  const family = String(shot.weapon?.family || shot.weaponFamily || shot.weapon?.id || '').toLowerCase();
  if (family.includes('tank') || family.includes('cannon') || shot.weaponKind === 'cannon') return 'tank_cannon';
  if (family.includes('anti') || family.includes('rocket') || shot.weaponKind === 'rocket') return 'anti_armor';
  if (family.includes('scout')) return 'scout_autocannon';
  if (family.includes('repair')) return 'repair';
  return 'infantry_light';
}

function effectPosition(actor, fallback = { x: 0, y: 0 }) { return actor ? point(actor) : { ...fallback }; }

function commonEffect(effect, extra = {}) {
  return {
    ...effect,
    ...extra,
    presentationOnly: true,
    runtimeVersion: EFFECT_RUNTIME_VERSION,
    priority: EFFECT_PRIORITY[effect.kind] || 40
  };
}

function actorDamageTier(actor) {
  if (!actor || actor.alive === false || finite(actor.hp) <= 0) return 'destroyed';
  const ratio = finite(actor.hp) / Math.max(1, finite(actor.maxHp, 1));
  return ratio < .35 ? 'critical' : ratio < .72 ? 'damaged' : 'healthy';
}

function formalAnchorForShot(shot, anchors) {
  return anchors.find((anchor) => anchor.id === shot.authorityAnchorId) || null;
}

function pushMuzzleAndProjectileEffects(effects, shot, actors, seconds) {
  const sourceActor = actors.get(shot.actorId);
  const family = normalizeEffectWeaponFamily(shot);
  if (!sourceActor || sourceActor.weaponTopology === 'unarmed' || family === 'repair') return;
  const source = { ...(shot.sourcePositionAtFire || point(sourceActor)) };
  const target = { ...(shot.impactPositionAtImpact || source) };
  const profile = shot.weapon?.presentation || {};
  const muzzleLife = finite(shot.weapon?.muzzleLife, family === 'tank_cannon' ? .24 : family === 'anti_armor' ? .16 : .1);
  const impactLife = finite(shot.weapon?.impactLife, family === 'tank_cannon' ? .78 : family === 'anti_armor' ? .46 : .28);
  if (active(seconds, shot.t, muzzleLife)) {
    effects.push(commonEffect({ id: `${shot.id}:muzzle`, kind: 'muzzle_flash', x: source.x, y: source.y, life: muzzleLife - ageAt(seconds, shot.t), maxLife: muzzleLife }, {
      shotId: shot.id, actorId: shot.actorId, targetActorId: shot.targetId, sourceEventId: shot.sourceEventId || null,
      weaponFamily: family, weaponKind: shot.weaponKind, weaponProfileId: shot.weapon?.id || shot.weaponId || null,
      muzzleShape: profile.muzzleShape || (family === 'tank_cannon' ? 'large_flash' : family === 'anti_armor' ? 'launch_flash' : 'small_flash'),
      tracerWidth: finite(profile.tracerWidth, family === 'tank_cannon' ? 4 : family === 'anti_armor' ? 2.5 : 1.5),
      size: family === 'tank_cannon' ? 34 : family === 'anti_armor' ? 23 : 13,
      sourcePositionAtFire: source, visualMuzzlePoint: source, sourceFacingAtFire: finite(shot.sourceFacingAtFire),
      authoritySource: { shotId: shot.id, sourceAnchorId: shot.authorityAnchorId || null, sourceActorId: shot.actorId },
      eventType: 'fire'
    }));
  }
  if (family === 'anti_armor' && seconds <= finite(shot.impactTime) + EPSILON && seconds >= finite(shot.t) - EPSILON) {
    effects.push(commonEffect({ id: `${shot.id}:rocket-trail`, kind: 'rocket_trail', x: source.x, y: source.y, life: Math.max(.001, finite(shot.impactTime) - finite(seconds)), maxLife: Math.max(.001, finite(shot.impactTime) - finite(shot.t)) }, {
      shotId: shot.id, actorId: shot.actorId, targetActorId: shot.targetId, weaponFamily: family,
      start: source, end: target, progress: clamp((seconds - finite(shot.t)) / Math.max(.001, finite(shot.impactTime) - finite(shot.t)), 0, 1),
      authoritySource: { shotId: shot.id, impactAnchorId: shot.authorityAnchorId || null }
    }));
  }
  const impactAge = ageAt(seconds, shot.impactTime);
  if (impactAge >= -EPSILON && impactAge <= impactLife + EPSILON) {
    const kind = shot.hitType === 'destroy' ? 'destruction' : family === 'tank_cannon' ? 'cannon_impact' : family === 'anti_armor' ? 'rocket_impact' : 'impact_spark';
    effects.push(commonEffect({ id: `${shot.id}:impact`, kind, source: 'authority_anchor', x: target.x, y: target.y, size: family === 'tank_cannon' ? 34 : family === 'anti_armor' ? 25 : 12, life: impactLife - Math.max(0, impactAge), maxLife: impactLife }, {
      shotId: shot.id, actorId: shot.actorId, targetActorId: shot.targetId, targetPositionAtImpact: target,
      weaponFamily: family, weaponKind: shot.weaponKind, weaponProfileId: shot.weapon?.id || shot.weaponId || null,
      impactScale: finite(profile.impactScale, family === 'tank_cannon' ? 2.4 : family === 'anti_armor' ? 1.35 : .8),
      hitType: shot.hitType || 'near_miss', impactEventId: shot.authorityAnchorId || null,
      authoritySource: { shotId: shot.id, impactAnchorId: shot.authorityAnchorId || null, targetActorId: shot.targetId }
    }));
  }
}

function pushDamageEffects(effects, anchors, actors, seconds, shots = []) {
  for (const anchor of anchors) {
    if (!['damage', 'destroy'].includes(anchor.type) || !active(seconds, anchor.t, anchor.type === 'destroy' ? 4.8 : .62)) continue;
    const target = actors.get(anchor.targetId);
    if (!target) continue;
    const targetPosition = effectPosition(target);
    const age = Math.max(0, ageAt(seconds, anchor.t));
    if (anchor.type === 'damage') {
      effects.push(commonEffect({ id: `${anchor.id}:damage-spark`, kind: 'damage_spark', x: targetPosition.x, y: targetPosition.y, size: 15, life: Math.max(.001, .62 - age), maxLife: .62 }, {
        damageEventId: anchor.id || null, targetActorId: anchor.targetId, sourceActorId: anchor.actorId || null,
        damageTier: actorDamageTier(target), authoritySource: { anchorId: anchor.id || null, type: anchor.type, targetActorId: anchor.targetId }
      }));
      const matchingShot = shots.find((shot) => shot.authorityAnchorId === anchor.id || (shot.targetId === anchor.targetId && Math.abs(finite(shot.impactTime) - finite(anchor.t)) < .001));
      if (actorDamageTier(target) !== 'healthy' && matchingShot && matchingShot.weapon?.presentation?.smoke !== 'none') effects.push(commonEffect({ id: `${anchor.id}:damage-smoke`, kind: 'damage_smoke', x: targetPosition.x - 3, y: targetPosition.y - 8, size: 13, life: Math.max(.001, 1.4 - age), maxLife: 1.4 }, {
        damageEventId: anchor.id || null, targetActorId: anchor.targetId, damageTier: actorDamageTier(target), authoritySource: { anchorId: anchor.id || null, type: anchor.type }
      }));
    }
  }
}

function pushDestroyEffects(effects, anchors, actors, seconds) {
  for (const anchor of anchors.filter((item) => item.type === 'destroy')) {
    const target = actors.get(anchor.targetId);
    if (!target) continue;
    const targetPosition = effectPosition(target);
    const age = ageAt(seconds, anchor.t);
    if (age < -EPSILON || age > 6 + EPSILON) continue;
    if (age <= .24) effects.push(commonEffect({ id: `${anchor.id}:destroy-flash`, kind: 'destroy_flash', x: targetPosition.x, y: targetPosition.y, size: 38, life: .24 - Math.max(0, age), maxLife: .24 }, {
      destroyEventId: anchor.id || null, targetActorId: anchor.targetId, sourceActorId: anchor.actorId || null,
      authoritySource: { anchorId: anchor.id || null, type: 'destroy', targetActorId: anchor.targetId }
    }));
    if (age <= 1.15) effects.push(commonEffect({ id: `${anchor.id}:destruction`, kind: 'destruction', source: 'authority_anchor', x: targetPosition.x, y: targetPosition.y, size: 38, life: 1.15 - Math.max(0, age), maxLife: 1.15 }, {
      destroyEventId: anchor.id || null, targetActorId: anchor.targetId, sourceActorId: anchor.actorId || null,
      destroyProgress: clamp(age / 1.15, 0, 1), authoritySource: { anchorId: anchor.id || null, type: 'destroy', targetActorId: anchor.targetId }
    }));
    if (age <= 4.8) effects.push(commonEffect({ id: `${anchor.id}:destroy-smoke`, kind: 'destroy_smoke', x: targetPosition.x, y: targetPosition.y - Math.max(0, age) * 2, size: 17, life: 4.8 - Math.max(0, age), maxLife: 4.8 }, {
      destroyEventId: anchor.id || null, targetActorId: anchor.targetId, wreckReady: age >= .95,
      authoritySource: { anchorId: anchor.id || null, type: 'destroy', targetActorId: anchor.targetId }
    }));
    if (age >= .95 && age <= 6) effects.push(commonEffect({ id: `${anchor.id}:wreck-fire`, kind: 'wreck_fire', x: targetPosition.x, y: targetPosition.y - 4, size: 14, life: 6 - age, maxLife: 5.05 }, {
      destroyEventId: anchor.id || null, targetActorId: anchor.targetId, wreckReady: true,
      wreckFacing: finite(target.facing), authoritySource: { anchorId: anchor.id || null, type: 'destroy', targetActorId: anchor.targetId }
    }));
  }
}

function pushRepairEffects(effects, formalRepairEvents, actors, seconds) {
  for (const event of formalRepairEvents || []) {
    if (!active(seconds, event.t, .42)) continue;
    const source = actors.get(event.sourceActorId || event.actorId);
    const target = actors.get(event.targetActorId || event.targetId);
    if (!source || !target || source.id === target.id) continue;
    const sourcePosition = point(source); const targetPosition = point(target); const life = .42;
    const common = { repairEventId: event.id || null, repairSourceActorId: source.id, repairTargetActorId: target.id, sourceActorId: source.id, targetActorId: target.id, sourcePosition, targetPosition, authoritySource: { anchorId: event.id || null, type: 'repair', sourceActorId: source.id, targetActorId: target.id } };
    effects.push(commonEffect({ id: `${event.id}:repair-beam`, kind: 'repair_beam', x: targetPosition.x, y: targetPosition.y, size: 18, life: life - Math.max(0, ageAt(seconds, event.t)), maxLife: life }, common));
    effects.push(commonEffect({ id: `${event.id}:repair-spark`, kind: 'repair_spark', x: targetPosition.x, y: targetPosition.y, size: 18, life: life - Math.max(0, ageAt(seconds, event.t)), maxLife: life }, common));
  }
}

function buildCameraFeedback({ shots, anchors, seconds, reducedMotion = false, sceneSeed = 0 }) {
  const impulses = [];
  for (const shot of shots || []) {
    const family = normalizeEffectWeaponFamily(shot);
    const fireAge = ageAt(seconds, shot.t); const impactAge = ageAt(seconds, shot.impactTime);
    const fireLife = family === 'tank_cannon' ? .26 : family === 'anti_armor' ? .2 : 0;
    const fireAmplitude = family === 'tank_cannon' ? 3 : family === 'anti_armor' ? 2 : 0;
    if (fireAmplitude > 0 && fireAge >= -EPSILON && fireAge <= fireLife) impulses.push({ eventId: shot.sourceEventId || shot.id, shotId: shot.id, amplitude: fireAmplitude, phase: deterministicUnit(sceneSeed, `${shot.id}:camera-fire`) * Math.PI * 2, kind: 'fire' });
    const impactAmplitude = family === 'tank_cannon' ? 2.4 : family === 'anti_armor' ? 1.55 : 0;
    if (impactAmplitude > 0 && impactAge >= -EPSILON && impactAge <= .22) impulses.push({ eventId: shot.authorityAnchorId || shot.id, shotId: shot.id, amplitude: impactAmplitude, phase: deterministicUnit(sceneSeed, `${shot.id}:camera-impact`) * Math.PI * 2, kind: 'impact' });
  }
  for (const anchor of anchors.filter((item) => item.type === 'destroy')) {
    const age = ageAt(seconds, anchor.t);
    if (age >= -EPSILON && age <= .3) impulses.push({ eventId: anchor.id || null, amplitude: 4, phase: deterministicUnit(sceneSeed, `${anchor.id}:camera-destroy`) * Math.PI * 2, kind: 'destroy' });
  }
  const amplitude = clamp(impulses.reduce((sum, item) => sum + item.amplitude, 0), 0, EFFECT_LIMITS.maxCameraTranslation);
  const phase = impulses.length ? impulses[0].phase + finite(seconds) * 28 : 0;
  const scale = reducedMotion ? 0 : amplitude;
  return { version: EFFECT_RUNTIME_VERSION, presentationOnly: true, reducedMotionApplied: reducedMotion === true, amplitude: scale, unclampedAmplitude: impulses.reduce((sum, item) => sum + item.amplitude, 0), offsetX: Math.sin(phase) * scale, offsetY: Math.cos(phase * 1.17) * scale * .62, zoomDelta: reducedMotion ? 0 : Math.min(EFFECT_LIMITS.maxCameraZoomDelta, scale * .0025), impulseCount: impulses.length, impulses: impulses.map((item) => ({ ...item, amplitude: reducedMotion ? 0 : item.amplitude })), sourceEventIds: impulses.map((item) => item.eventId).filter(Boolean) };
}

export function applyPresentationCameraFeedback(baseCamera = {}, feedback = {}) {
  const x = finite(baseCamera.x, 640); const y = finite(baseCamera.y, 360); const zoom = finite(baseCamera.zoom, .86);
  const dx = clamp(feedback.offsetX, -EFFECT_LIMITS.maxCameraTranslation, EFFECT_LIMITS.maxCameraTranslation);
  const dy = clamp(feedback.offsetY, -EFFECT_LIMITS.maxCameraTranslation, EFFECT_LIMITS.maxCameraTranslation);
  const dz = clamp(feedback.zoomDelta, -EFFECT_LIMITS.maxCameraZoomDelta, EFFECT_LIMITS.maxCameraZoomDelta);
  return { ...baseCamera, x: x + dx, y: y + dy, zoom: zoom + dz, baseX: x, baseY: y, baseZoom: zoom, feedbackOffsetX: dx, feedbackOffsetY: dy, feedbackZoomDelta: dz, cameraFeedback: { ...feedback }, presentationOnly: true };
}

function buildAudioCues({ shots, anchors, formalRepairEvents, plan, seconds }) {
  const cues = [];
  for (const shot of shots || []) {
    if (active(seconds, shot.t, .28)) cues.push({ id: `${shot.id}:audio-fire`, cueFamily: normalizeEffectWeaponFamily(shot) + '_fire', eventType: 'fire', shotId: shot.id, actorId: shot.actorId, targetActorId: shot.targetId, eventId: shot.sourceEventId || null, time: finite(shot.t), source: 'formal_shot', presentationOnly: true });
    if (active(seconds, shot.impactTime, .32)) cues.push({ id: `${shot.id}:audio-impact`, cueFamily: normalizeEffectWeaponFamily(shot) + '_impact', eventType: 'impact', shotId: shot.id, actorId: shot.actorId, targetActorId: shot.targetId, eventId: shot.authorityAnchorId || null, time: finite(shot.impactTime), source: 'formal_anchor', presentationOnly: true });
  }
  for (const anchor of anchors.filter((item) => item.type === 'destroy')) if (active(seconds, anchor.t, .45)) cues.push({ id: `${anchor.id}:audio-destroy`, cueFamily: 'destruction', eventType: 'destroy', eventId: anchor.id || null, actorId: anchor.actorId || null, targetActorId: anchor.targetId || null, time: finite(anchor.t), source: 'formal_anchor', presentationOnly: true });
  for (const event of formalRepairEvents || []) if (active(seconds, event.t, .45) && event.sourceActorId && event.targetActorId) cues.push({ id: `${event.id}:audio-repair`, cueFamily: 'repair', eventType: 'repair', eventId: event.id || null, actorId: event.sourceActorId, targetActorId: event.targetActorId, time: finite(event.t), source: 'formal_anchor', presentationOnly: true });
  const duration = finite(plan?.timeline?.duration, 0);
  if (seconds >= duration - EPSILON && plan?.source?.result) cues.push({ id: `result:${plan.source.result}:audio`, cueFamily: `result_${plan.source.result}`, eventType: 'result', result: plan.source.result, time: duration, source: 'formal_result', presentationOnly: true });
  return [...new Map(cues.map((cue) => [cue.id, cue])).values()].sort((left, right) => left.time - right.time || left.id.localeCompare(right.id));
}

function buildTransition(plan, seconds, returning = false) {
  const duration = Math.max(.001, finite(plan?.timeline?.duration, 1));
  const result = plan?.source?.result || null;
  if (seconds >= duration - EPSILON) return { version: EFFECT_RUNTIME_VERSION, phase: 'completed', kind: result ? `${result}_outro` : 'outro', progress: 1, alpha: 0, result, deterministic: true, presentationOnly: true };
  if (returning || result === 'withdraw' && seconds >= duration * .76) {
    const progress = clamp((seconds - duration * .76) / Math.max(.001, duration * .24), 0, 1);
    return { version: EFFECT_RUNTIME_VERSION, phase: 'outro', kind: 'withdraw_outro', progress, alpha: .18 * (1 - progress), result, deterministic: true, presentationOnly: true };
  }
  if (seconds <= .8) return { version: EFFECT_RUNTIME_VERSION, phase: 'intro', kind: 'battle_intro', progress: clamp(seconds / .8, 0, 1), alpha: .3 * (1 - clamp(seconds / .8, 0, 1)), result, deterministic: true, presentationOnly: true };
  if (seconds >= duration - .8) {
    const progress = clamp((seconds - (duration - .8)) / .8, 0, 1);
    const kind = ['victory', 'pyrrhic'].includes(result) ? 'victory_outro' : result === 'defeat' || result === 'wiped' ? 'defeat_outro' : 'battle_outro';
    return { version: EFFECT_RUNTIME_VERSION, phase: 'outro', kind, progress, alpha: .24 * (1 - progress), result, deterministic: true, presentationOnly: true };
  }
  return { version: EFFECT_RUNTIME_VERSION, phase: 'battle', kind: 'battle_idle', progress: clamp(seconds / duration, 0, 1), alpha: 0, result, deterministic: true, presentationOnly: true };
}

function buildInventory(effects, shots, formalRepairEvents, transition) {
  const effectKinds = [...new Set(effects.map((effect) => effect.kind))].sort();
  const weaponFamilies = [...new Set((shots || []).map(normalizeEffectWeaponFamily))].sort();
  return { version: EFFECT_RUNTIME_VERSION, presentationOnly: true, effectKinds, weaponFamilies, audioCueFamilies: [...new Set(effects.map((effect) => effect.weaponFamily).filter(Boolean))].sort(), fallbackKinds: ['muzzle_flash', 'impact_spark', 'damage_smoke', 'destruction', 'wreck_smoke', 'repair_spark'], formalShotCount: shots.length, formalRepairCount: (formalRepairEvents || []).length, transitionKind: transition.kind, limits: { ...EFFECT_LIMITS }, activeCount: effects.length };
}

export function buildPresentationEffects({ plan, actors = [], shotSchedule = [], formalRepairEvents = [], seconds = 0, sceneSeed = 0, reducedMotion = false, returning = false } = {}) {
  const effects = []; const actorMap = actorsById(actors); const anchors = plan?.timeline?.anchors || [];
  for (const shot of shotSchedule || []) pushMuzzleAndProjectileEffects(effects, shot, actorMap, seconds);
  pushDamageEffects(effects, anchors, actorMap, seconds, shotSchedule);
  pushDestroyEffects(effects, anchors, actorMap, seconds);
  pushRepairEffects(effects, formalRepairEvents, actorMap, seconds);
  const ordered = [...new Map(effects.map((effect) => [effect.id, effect])).values()].sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const retained = ordered.length <= EFFECT_LIMITS.maxEffects ? ordered : ordered.slice(0, EFFECT_LIMITS.maxEffects);
  const cameraFeedback = buildCameraFeedback({ shots: shotSchedule, anchors, seconds, reducedMotion, sceneSeed });
  const transitions = buildTransition(plan, seconds, returning);
  const audioCues = buildAudioCues({ shots: shotSchedule, anchors, formalRepairEvents, plan, seconds });
  const inventory = buildInventory(retained, shotSchedule, formalRepairEvents, transitions);
  return { version: EFFECT_RUNTIME_VERSION, effects: retained, smoke: retained.filter((effect) => ['damage_smoke', 'destroy_smoke', 'wreck_smoke'].includes(effect.kind)).map((effect, index) => ({ id: `${effect.id}:particle`, x: effect.x + (deterministicUnit(sceneSeed, `${effect.id}:x`) - .5) * 12, y: effect.y - index * 3, size: effect.kind === 'destroy_smoke' ? 16 : 11, alpha: clamp(alpha(seconds, seconds - effect.life, Math.max(.001, effect.maxLife)), 0, 1), sourceEffectId: effect.id, presentationOnly: true })).slice(0, EFFECT_LIMITS.maxSmokeParticles), cameraFeedback, transitions, audioCues, effectInventory: inventory, determinism: { version: EFFECT_RUNTIME_VERSION, seed: sceneSeed, replayStable: true, clock: 'presentation_seconds', authorityDriven: true, usesWallClock: false, usesRandom: false } };
}
