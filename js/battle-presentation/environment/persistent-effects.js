import { deterministicUnit } from './environment-layout.js';

export const EFFECT_LIMITS = Object.freeze({ maxActiveParticles: 96, maxSmokeColumns: 24, maxDustEffects: 18, maxDebrisObjects: 64 });

function heavyWeapon(shot) { return ['tank_cannon', 'anti_armor'].includes(shot?.weaponFamily) || shot?.weapon?.kind === 'cannon' || shot?.weapon?.impactKind === 'heavy_explosion'; }
function smokeColumn(event, age, index, kind, wind) {
  const seed = event.seed ?? 0; const wobble = deterministicUnit(seed, `smoke:${index}`) - .5; const life = kind === 'wreck_smoke' ? 12 : kind === 'heavy_impact_smoke' ? 2.8 : 1.2; const ratio = Math.max(0, Math.min(1, age / life));
  return { id: `${event.id}:${kind}:${index}`, kind, x: event.x + wobble * (kind === 'wreck_smoke' ? 15 : 9) + (wind.x || 0) * age * 8, y: event.y - ratio * (kind === 'wreck_smoke' ? 46 : 24) + (wind.y || 0) * age * 4, size: (kind === 'wreck_smoke' ? 12 : 8) + deterministicUnit(seed, `size:${index}`) * 12 + ratio * 6, alpha: (1 - ratio) * (kind === 'wreck_smoke' ? .52 : .42), life: life - age, maxLife: life, createdAt: event.t, persistent: kind === 'wreck_smoke' };
}

export function buildPersistentEffects(plan, seconds, shots = [], actors = [], wind = { x: 0, y: 0 }) {
  const effects = []; const smoke = []; const debris = [];
  for (const shot of shots) {
    const impactTime = Number(shot.impactTime ?? shot.t ?? 0); if (impactTime > seconds + 1e-9 || !shot.impactPositionAtImpact) continue; const age = seconds - impactTime; const point = shot.impactPositionAtImpact; const heavy = heavyWeapon(shot); const destroyed = shot.hitType === 'destroy' || shot.authorityType === 'destroy'; const seed = shot.seed ?? deterministicUnit(plan?.source?.seed ?? 0, shot.id); const event = { id: shot.id, x: Number(point.x) || 0, y: Number(point.y) || 0, t: impactTime, seed };
    if (age <= (destroyed ? 1.4 : heavy ? .9 : .38)) effects.push({ id: `${shot.id}:flash`, kind: destroyed ? 'destruction' : heavy ? 'heavy_impact' : 'impact', x: event.x, y: event.y, size: destroyed ? 42 : heavy ? 28 : 12, life: (destroyed ? 1.4 : heavy ? .9 : .38) - age, maxLife: destroyed ? 1.4 : heavy ? .9 : .38, source: 'persistent_destruction', shotId: shot.id, actorId: shot.actorId || null, targetActorId: shot.targetId || null, authoritySource: { shotId: shot.id, impactAnchorId: shot.authorityAnchorId || null, targetActorId: shot.targetId || null }, presentationOnly: true });
    const smokeMode = shot.weapon?.presentation?.smoke || 'default';
    if (smokeMode !== 'none' && heavy && age <= 2.8) smoke.push(smokeColumn(event, age, 0, 'heavy_impact_smoke', wind));
    if (smokeMode !== 'none' && destroyed && age <= 12) for (let index = 0; index < 3; index += 1) smoke.push(smokeColumn(event, age, index, 'wreck_smoke', wind));
    if (destroyed) for (let index = 0; index < 4; index += 1) debris.push({ id: `${shot.id}:debris:${index}`, x: event.x + (deterministicUnit(seed, `dx:${index}`) - .5) * 34, y: event.y + (deterministicUnit(seed, `dy:${index}`) - .5) * 24, radius: 2 + deterministicUnit(seed, `r:${index}`) * 4, angle: deterministicUnit(seed, `a:${index}`) * Math.PI, createdAt: impactTime, persistent: true });
  }
  const dust = actors.filter((actor) => actor.alive && ['move', 'advance', 'retreat', 'cover_advance'].includes(actor.visualState || actor.currentAction) && ['mbt', 'scout_car', 'enemy_scout_car', 'repair_vehicle'].includes(actor.type)).slice(0, EFFECT_LIMITS.maxDustEffects).map((actor) => ({ id: `dust:${actor.id}:${Math.floor(seconds * 2)}`, kind: 'dust_cloud', x: actor.visualCenter.x - Math.cos(actor.facing || 0) * 18, y: actor.visualCenter.y - Math.sin(actor.facing || 0) * 18, size: actor.type === 'mbt' ? 12 : 7, alpha: .18, life: .4, maxLife: .4, createdAt: seconds, sourcePhase: actor.visualState || actor.currentAction || 'movement', actorId: actor.id, persistent: false }));
  return { effects: effects.slice(-EFFECT_LIMITS.maxActiveParticles), smoke: smoke.slice(-EFFECT_LIMITS.maxSmokeColumns), debris: debris.slice(-EFFECT_LIMITS.maxDebrisObjects), dust };
}
