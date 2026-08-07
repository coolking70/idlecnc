import { deterministicUnit } from './environment-layout.js';

const MAX_PERSISTENT_DECALS = 128;

function heavyWeapon(shot) { return ['tank_cannon', 'anti_armor'].includes(shot?.weaponFamily) || shot?.weapon?.kind === 'cannon' || shot?.weapon?.impactKind === 'heavy_explosion'; }
function profileMark(shot, destroyed, heavy) { const configured = shot?.weapon?.presentation?.persistentMark; if (configured) return configured; return destroyed ? 'crater' : heavy ? 'crater' : 'small_impact_mark'; }

export function buildBattlefieldDecals(plan, seconds, shots = []) {
  const decals = [];
  for (const shot of shots) {
    const impactTime = Number(shot.impactTime ?? shot.t ?? 0); if (impactTime > seconds + 1e-9 || !shot.impactPositionAtImpact) continue;
    const age = Math.max(0, seconds - impactTime); const heavy = heavyWeapon(shot); const destroyed = shot.hitType === 'destroy' || shot.authorityType === 'destroy';
    const base = { x: Number(shot.impactPositionAtImpact.x) || 0, y: Number(shot.impactPositionAtImpact.y) || 0, source: shot.actorId || null, target: shot.targetId || null, authorityAnchorId: shot.authorityAnchorId || null, createdAt: impactTime, persistent: true, seed: shot.seed ?? deterministicUnit(plan?.source?.seed ?? 0, shot.id) };
    const mark = profileMark(shot, destroyed, heavy); const scale = Math.max(.5, Number(shot.weapon?.presentation?.impactScale) || 1); const markRadius = Math.round((destroyed ? 24 : heavy ? 18 : 8) * scale);
    if (shot.hitType !== 'near_miss' || heavy) decals.push({ ...base, id: `${shot.id}:mark`, kind: mark, radius: markRadius, rotation: (deterministicUnit(base.seed, 'rotation') - .5) * .8, age, weaponProfileId: shot.weapon?.id || null });
    if ((destroyed || heavy || mark === 'scorch') && mark !== 'scorch') decals.push({ ...base, id: `${shot.id}:scorch`, kind: 'scorch', radius: Math.round((destroyed ? 28 : 15) * scale), rotation: (deterministicUnit(base.seed, 'scorch') - .5) * .7, age, weaponProfileId: shot.weapon?.id || null });
    if (destroyed) decals.push({ ...base, id: `${shot.id}:debris-mark`, kind: 'debris', radius: Math.round(16 * scale), rotation: deterministicUnit(base.seed, 'debris') * Math.PI, age, weaponProfileId: shot.weapon?.id || null });
  }
  const unique = [...new Map(decals.map((decal) => [decal.id, decal])).values()];
  return unique.sort((left, right) => Number(left.createdAt) - Number(right.createdAt) || left.id.localeCompare(right.id)).slice(-MAX_PERSISTENT_DECALS);
}

export const PERSISTENT_DECAL_LIMIT = MAX_PERSISTENT_DECALS;
