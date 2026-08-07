/**
 * Stage 8.2G-B.1 deterministic engagement choreographer.
 *
 * This is a presentation-only schedule.  It consumes a validated plan and
 * never writes solver state, HP, result, reward, save data or authority
 * anchors.  Legality is intentionally stricter than the authority timeline:
 * a visual shot must have a mapped combat profile, a legal range and a clear
 * line of sight at the moment it is scheduled.
 */
import { deterministicUnit, visualWeaponProfile, combatProfileFor } from './visual-weapon-profiles.js';
import { deriveBattlePhases } from './universal-battle-phase-resolver.js';

const EPS = 1e-6;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const actorRows = (plan) => [...(plan?.forces?.friendly || []), ...(plan?.forces?.enemy || [])];
const idOf = (actor) => actor?.actorId || actor?.id || '';
const sideOf = (actor) => actor?.side || 'neutral';
const typeOf = (actor) => String(actor?.type || '').toLowerCase();
const enemyOf = (a, b) => sideOf(a) !== 'neutral' && sideOf(b) !== 'neutral' && sideOf(a) !== sideOf(b);
const finalAlive = (actor) => actor?.final?.alive !== false;
const distance = (a, b) => Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
const durationFor = (plan) => Number(plan?.timeline?.duration) || 1;

export const ENGAGEMENT_LIMITS = Object.freeze({
  maxConcurrentProjectiles: 18,
  maxActiveEffects: 72,
  maxSuppressionBursts: 18,
  maxEngagementGroups: 24,
  maxTargetSwitches: 32,
  maxScheduledShots: 180,
  maxShotsPerActorPerPhase: 8,
  maxShotsPerSidePerPhase: 48,
  firstContactShotsPerActor: 3,
  firstContactShotsPerSide: 18,
  coverRetreatShotBudget: 6,
  coverRetreatSideBudget: 24,
  minimumTargetHoldSeconds: 1.6,
  targetSwitchCooldownSeconds: .9
});

export const TARGET_SCORE_WEIGHTS = Object.freeze({
  visibility: 22, rangeSuitability: 20, threat: 18, authoritativeRelevance: 18,
  roleAffinity: 16, overfocusPenalty: 13, obstructionPenalty: 10, distancePenalty: 8
});

function phaseAt(phases, time) {
  return phases.find((phase) => time >= phase.start - EPS && (time < phase.end - EPS || phase.id === 'battle_end')) || phases.at(-1);
}

function sample(positionSampler, actor, time) {
  const value = typeof positionSampler === 'function' ? positionSampler(idOf(actor), time) : null;
  return { ...(value || actor?.position || actor?.visualCenter || { x: 0, y: 0 }) };
}

export function classifyTargetClass(actor) {
  const type = typeOf(actor);
  // Anti-armour infantry is still infantry.  Weapon affinity is carried by
  // the attacker profile; target classification must describe the actor.
  if (type.includes('infantry') || type === 'enemy_at' || actor?.category === 'infantry' || actor?.category === 'at_infantry') return 'infantry';
  if (type.includes('mbt') || type.includes('tank') || actor?.category === 'armor') return 'armor';
  if (type.includes('scout') || type.includes('vehicle') || actor?.category === 'vehicle') return 'vehicle';
  return actor?.category || type || 'unknown';
}

const targetClass = classifyTargetClass;

function destroyedAt(plan, actorId) {
  return (plan?.timeline?.anchors || []).filter((anchor) => anchor.type === 'destroy' && anchor.targetId === actorId).map((anchor) => Number(anchor.t)).filter(Number.isFinite)[0] ?? Infinity;
}

function aliveAt(plan, actor, time) { return finalAlive(actor) || time < destroyedAt(plan, idOf(actor)); }

function segmentCircleHit(a, b, center, radius) {
  const dx = b.x - a.x; const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 < EPS ? 0 : clamp(((center.x - a.x) * dx + (center.y - a.y) * dy) / length2, 0, 1);
  return Math.hypot(a.x + dx * t - center.x, a.y + dy * t - center.y) <= radius;
}

function segmentRectHit(a, b, center, width, height) {
  const left = center.x - width / 2; const right = center.x + width / 2;
  const top = center.y - height / 2; const bottom = center.y + height / 2;
  const dx = b.x - a.x; const dy = b.y - a.y;
  let t0 = 0; let t1 = 1;
  for (const [p, q] of [[-dx, a.x - left], [dx, right - a.x], [-dy, a.y - top], [dy, bottom - a.y]]) {
    if (Math.abs(p) < EPS) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return t1 >= 0 && t0 <= 1;
}

function hardObstacleRows(plan) {
  return [...(plan?.scene?.props || []), ...(plan?.scene?.obstacles || []), ...(plan?.layout?.obstacles || [])]
    .filter((row) => row && (row.solid === true || row.blocksLineOfSight === true || row.collisionPolicy === 'hard'));
}

function clearLineOfSight(plan, source, target) {
  for (const obstacle of hardObstacleRows(plan)) {
    const center = obstacle.position || obstacle.center || obstacle;
    if (!Number.isFinite(center?.x) || !Number.isFinite(center?.y)) continue;
    const footprint = obstacle.footprint || obstacle.geometry || {};
    const radius = Number(footprint.radius || obstacle.radius || 0);
    const width = Number(footprint.width || footprint.w || obstacle.width || 0);
    const height = Number(footprint.height || footprint.h || obstacle.height || 0);
    const blocked = width > 0 && height > 0
      ? segmentRectHit(source, target, center, width, height)
      : segmentCircleHit(source, target, center, Math.max(1, radius));
    if (blocked) return { ok: false, obstacleId: obstacle.id || null, reason: 'blocked_line_of_sight' };
  }
  return { ok: true, obstacleId: null, reason: 'clear_line_of_sight' };
}

function authorityRelevance(plan, attackerId, targetId, time) {
  return (plan?.timeline?.anchors || []).some((item) => item.actorId === attackerId && item.targetId === targetId && Math.abs(Number(item.t) - time) < 8) ? 1 : 0;
}

/** Public hard legality check used by the B.1 tests and semantic verifier. */
export function evaluateTargetLegality(plan, attacker, target, time, positionSampler) {
  const profile = combatProfileFor(attacker);
  const source = sample(positionSampler, attacker, time);
  const destination = sample(positionSampler, target, time);
  const d = distance(source, destination);
  const los = clearLineOfSight(plan, source, destination);
  let reason = 'legal';
  if (!enemyOf(attacker, target)) reason = 'same_side';
  else if (!profile.canAttack) reason = 'non_combat_actor';
  else if (!aliveAt(plan, target, time)) reason = 'target_destroyed';
  else if (!profile.validTargetClasses.includes(targetClass(target))) reason = 'weapon_target_mismatch';
  else if (d < profile.minRange) reason = 'below_minimum_range';
  else if (d > profile.maximumRange) reason = 'beyond_maximum_range';
  else if (!los.ok) reason = los.reason;
  return { ok: reason === 'legal', reason, attackerId: idOf(attacker), targetId: idOf(target), time: Number(time.toFixed(3)), distance: Number(d.toFixed(3)), source: { ...source }, target: { ...destination }, weaponId: profile.weaponId, weaponFamily: profile.weaponFamily, targetClass: targetClass(target), lineOfSight: los.ok, obstacleId: los.obstacleId, minRange: profile.minRange, maximumRange: profile.maximumRange };
}

export const isTargetLegal = evaluateTargetLegality;

function targetScore(plan, attacker, target, time, assignedCount, positionSampler) {
  const legality = evaluateTargetLegality(plan, attacker, target, time, positionSampler);
  if (!legality.ok) return { score: -Infinity, legality };
  const profile = combatProfileFor(attacker);
  const cls = targetClass(target);
  const preferred = cls === 'armor' && profile.weaponFamily === 'anti_armor' ? 1 : profile.validTargetClasses.includes(cls) ? .7 : .2;
  const threat = cls === 'armor' ? 1 : cls === 'vehicle' ? .8 : .55;
  const rangeFit = 1 - Math.min(1, Math.abs(legality.distance - profile.preferredRange) / Math.max(1, profile.maximumRange));
  const overfocus = (assignedCount.get(idOf(target)) || 0) * .28;
  return { score: TARGET_SCORE_WEIGHTS.visibility + TARGET_SCORE_WEIGHTS.rangeSuitability * rangeFit + TARGET_SCORE_WEIGHTS.threat * threat + TARGET_SCORE_WEIGHTS.authoritativeRelevance * authorityRelevance(plan, idOf(attacker), idOf(target), time) + TARGET_SCORE_WEIGHTS.roleAffinity * preferred - TARGET_SCORE_WEIGHTS.overfocusPenalty * overfocus - TARGET_SCORE_WEIGHTS.distancePenalty * (legality.distance / profile.maximumRange), legality };
}

function chooseTarget(plan, attacker, candidates, time, assignedCount, positionSampler, previousTargetId = null) {
  const scored = candidates.map((target) => ({ target, ...targetScore(plan, attacker, target, time, assignedCount, positionSampler) })).filter((row) => Number.isFinite(row.score)).sort((a, b) => b.score - a.score || idOf(a.target).localeCompare(idOf(b.target)));
  if (!scored.length) return null;
  const held = scored.find((row) => idOf(row.target) === previousTargetId);
  return held && held.score >= scored[0].score - 8 ? held : scored[0];
}

function phaseWindow(phases, id, duration) {
  const phase = phases.find((row) => row.id === id) || phases.find((row) => row.id === 'main_engagement') || phases[0];
  return { id: phase?.id || id, start: clamp(phase?.start ?? 0, 0, duration), end: clamp(phase?.end ?? duration, 0, duration) };
}

function buildTargetAssignments(plan, phases, positionSampler) {
  const actors = actorRows(plan); const assignments = []; const switches = []; const assignedCount = new Map();
  const duration = Number(plan.timeline?.duration) || 1;
  const moments = [...new Set(['first_contact', 'main_engagement', 'critical_event'].map((id) => phaseWindow(phases, id, duration).start))];
  const destroyMoments = (plan.timeline?.anchors || []).filter((anchor) => anchor.type === 'destroy').map((anchor) => Number(anchor.t) + .12).filter(Number.isFinite);
  const times = [...moments, ...destroyMoments].filter((time) => time >= 0 && time <= duration).sort((a, b) => a - b);
  const open = new Map(); const lastSwitch = new Map();
  for (const time of times) {
    const phase = phaseAt(phases, time);
    if (!['first_contact', 'main_engagement', 'critical_event'].includes(phase.id)) continue;
    for (const attacker of actors.sort((a, b) => idOf(a).localeCompare(idOf(b)))) {
      if (sideOf(attacker) === 'neutral' || !aliveAt(plan, attacker, time) || !combatProfileFor(attacker).canAttack) continue;
      const current = open.get(idOf(attacker));
      const holdSatisfied = current && time - current.start >= ENGAGEMENT_LIMITS.minimumTargetHoldSeconds;
      const currentTarget = current ? actors.find((row) => idOf(row) === current.targetId) : null;
      const currentLegality = currentTarget ? evaluateTargetLegality(plan, attacker, currentTarget, time, positionSampler) : null;
      const chosen = chooseTarget(plan, attacker, actors.filter((target) => enemyOf(attacker, target)), time, assignedCount, positionSampler, current?.targetId);
      if (current && currentLegality?.ok && (!chosen || chosen.target.actorId === current.targetId || !holdSatisfied || time - (lastSwitch.get(idOf(attacker)) || -Infinity) < ENGAGEMENT_LIMITS.targetSwitchCooldownSeconds)) continue;
      if (!chosen) continue;
      if (current && current.targetId !== idOf(chosen.target)) {
        const reason = currentLegality?.reason === 'target_destroyed' ? 'destroyed' : currentLegality?.reason === 'blocked_line_of_sight' ? 'lost_line_of_sight' : currentLegality?.reason === 'beyond_maximum_range' ? 'out_of_range' : 'higher_priority';
        current.end = time;
        switches.push({ id: `target_switch_${switches.length + 1}`, actorId: idOf(attacker), fromTargetId: current.targetId, toTargetId: idOf(chosen.target), time: Number(time.toFixed(3)), reason, minimumHoldDuration: ENGAGEMENT_LIMITS.minimumTargetHoldSeconds, cooldown: ENGAGEMENT_LIMITS.targetSwitchCooldownSeconds });
        lastSwitch.set(idOf(attacker), time);
      }
      const row = { id: `target_assignment_${assignments.length + 1}`, actorId: idOf(attacker), targetId: idOf(chosen.target), start: time, end: duration, phase: phase.id, score: Number(chosen.score.toFixed(3)), reason: chosen.legality.reason, minimumHoldDuration: ENGAGEMENT_LIMITS.minimumTargetHoldSeconds, legalityAtAssignment: chosen.legality };
      assignments.push(row); open.set(idOf(attacker), row); assignedCount.set(idOf(chosen.target), (assignedCount.get(idOf(chosen.target)) || 0) + 1);
    }
  }
  return { assignments: assignments.sort((a, b) => a.start - b.start || a.actorId.localeCompare(b.actorId)), switches: switches.slice(0, ENGAGEMENT_LIMITS.maxTargetSwitches) };
}

/**
 * Split an actor-target interval at semantic phase boundaries.  The
 * assignment remains one continuous hold; slices are only budget/accounting
 * windows and never imply a target switch.
 */
export function assignmentPhaseSlices(assignment, phases, duration) {
  const start = clamp(assignment.start, 0, duration);
  const end = clamp(assignment.end ?? duration, 0, duration);
  return (phases || [])
    .filter((phase) => ['first_contact', 'main_engagement', 'critical_event'].includes(phase.id))
    .map((phase) => ({
      id: `${assignment.id}:${phase.id}`,
      assignmentId: assignment.id,
      phase: phase.id,
      start: Math.max(start, phase.start),
      end: Math.min(end, phase.end)
    }))
    .filter((slice) => slice.end - slice.start > EPS);
}

function appendRetreatAssignments(plan, assignments, retreatOrders, positionSampler) {
  const duration = Number(plan.timeline?.duration) || 1;
  const actors = actorRows(plan);
  const rear = retreatOrders.find((order) => order.role === 'rear_guard' && order.coverFire);
  if (!rear) return assignments;
  const attacker = actors.find((actor) => idOf(actor) === rear.actorId);
  if (!attacker || !combatProfileFor(attacker).canAttack) return assignments;
  const coverEnd = Math.min(duration, rear.start + 2.8);
  let target = chooseTarget(
    plan,
    attacker,
    actors.filter((candidate) => enemyOf(attacker, candidate)),
    rear.start,
    new Map(),
    positionSampler
  );
  if (!target) {
    // A formal withdraw may leave the rear guard already far beyond the
    // visual weapon envelope.  Reposition only its presentation cover
    // station along the existing enemy-facing line, then re-run the same
    // hard legality check.  The authoritative route and outcome are intact.
    const candidate = actors.filter((row) => enemyOf(attacker, row) && aliveAt(plan, row, rear.start)).sort((left, right) => idOf(left).localeCompare(idOf(right)))[0];
    if (candidate) {
      const source = sample(positionSampler, attacker, rear.start); const destination = sample(positionSampler, candidate, rear.start); const dx = source.x - destination.x; const dy = source.y - destination.y; const length = Math.max(EPS, Math.hypot(dx, dy)); const desired = clamp(combatProfileFor(attacker).preferredRange, combatProfileFor(attacker).minRange + 1, combatProfileFor(attacker).maximumRange - 1);
      rear.coverHoldPosition = { x: clamp(destination.x + dx / length * desired, 24, plan.layout?.bounds?.width || 1200 - 24), y: clamp(destination.y + dy / length * desired, 24, plan.layout?.bounds?.height || 700 - 24) };
      target = chooseTarget(plan, attacker, actors.filter((row) => enemyOf(attacker, row)), rear.start, new Map(), positionSampler);
    }
  }
  if (!target) return assignments;
  return [...assignments, {
    id: `target_assignment_retreat_${rear.actorId}`,
    actorId: rear.actorId,
    targetId: idOf(target.target),
    start: rear.start,
    end: coverEnd,
    phase: 'retreat',
    role: 'rear_guard',
    coverFire: true,
    score: Number(target.score.toFixed(3)),
    reason: target.legality.reason,
    minimumHoldDuration: ENGAGEMENT_LIMITS.minimumTargetHoldSeconds,
    legalityAtAssignment: target.legality
  }];
}

function routeFor(plan, actorId) { return (plan.layout?.routes || []).find((route) => route.actorId === actorId); }

function buildRetreatOrders(plan, phases, positionSampler) {
  if (!['withdraw', 'defeat'].includes(plan.source?.result)) return [];
  const duration = Number(plan.timeline?.duration) || 1; const phase = phaseWindow(phases, 'critical_event', duration);
  const exit = plan.layout?.zones?.find((zone) => zone.kind === 'exit' || String(zone.id || '').includes('exit'))?.center || { x: 46, y: Math.max(30, (plan.layout?.bounds?.height || 700) - 70) };
  const survivors = (plan.forces?.friendly || []).filter((actor) => finalAlive(actor) && combatProfileFor(actor).mappingStatus === 'mapped');
  if (!survivors.length) return [];
  const rearGuard = survivors.filter((actor) => combatProfileFor(actor).canAttack).sort((a, b) => (combatProfileFor(b).maximumRange - combatProfileFor(a).maximumRange) || idOf(a).localeCompare(idOf(b)))[0];
  return survivors.map((actor, index) => {
    const route = routeFor(plan, idOf(actor)); const role = rearGuard && idOf(actor) === idOf(rearGuard) && survivors.length > 1 ? 'rear_guard' : index === 0 ? 'first_withdrawal' : 'main_withdrawal';
    const start = clamp(phase.start + (role === 'rear_guard' ? Math.max(.8, survivors.length * .35) : index * .22), 0, duration);
    // The formal route has already begun moving the rear guard toward the
    // exit.  Keep its presentation at a legal firing station for the cover
    // window, then hand it back to the exit route.
    const coverHoldTime = Math.max(phase.start - 4, 0);
    const point = sample(positionSampler, actor, role === 'rear_guard' ? coverHoldTime : phase.start);
    const hold = { ...point }; const direction = Math.atan2(exit.y - hold.y, exit.x - hold.x); const lateral = role === 'rear_guard' ? 0 : (index % 2 ? 1 : -1) * 18;
    const mid = { x: (hold.x + exit.x) / 2 - Math.sin(direction) * lateral, y: (hold.y + exit.y) / 2 + Math.cos(direction) * lateral };
    const presentationRoute = [{ t: start, x: hold.x, y: hold.y }, { t: Math.min(duration, start + Math.max(.6, (duration - start) * .4)), x: mid.x, y: mid.y }, { t: duration, x: exit.x, y: exit.y }];
    const enemyRows = (plan.forces?.enemy || []).filter((candidate) => aliveAt(plan, candidate, start)); const enemyCenter = enemyRows.reduce((sum, candidate) => { const p = sample(positionSampler, candidate, start); return { x: sum.x + p.x / Math.max(1, enemyRows.length), y: sum.y + p.y / Math.max(1, enemyRows.length) }; }, { x: 0, y: 0 });
    return { id: `retreat_order_${index + 1}`, actorId: idOf(actor), role, start, end: duration, exit: { ...exit }, coverHoldPosition: role === 'rear_guard' ? { ...hold } : null, distanceToExit: Number(distance(point, exit).toFixed(3)), distanceToExitAtStart: Number(distance(point, exit).toFixed(3)), distanceToExitAtEnd: 0, coverFire: role === 'rear_guard', presentationFacing: { hold: Math.atan2(hold.y - point.y, hold.x - point.x), move: direction, rearGuardEnemyFacing: role === 'rear_guard' ? Math.atan2(enemyCenter.y - hold.y, enemyCenter.x - hold.x) : direction }, presentationRoute, sourceRouteId: route?.routeId || null };
  }).sort((a, b) => a.start - b.start || a.actorId.localeCompare(b.actorId));
}

function retreatShotSampler(positionSampler, retreatOrders) {
  return (actorId, time) => {
    const order = retreatOrders.find((row) => row.actorId === actorId && row.coverFire && time >= row.start - EPS && time <= Math.min(row.end, row.start + 2.8) + EPS);
    if (order?.coverHoldPosition) return { ...order.coverHoldPosition, actorId, entityId: actorId, state: 'cover_fire' };
    return typeof positionSampler === 'function' ? positionSampler(actorId, time) : null;
  };
}

function buildCoverMoves(plan, phases, assignments, retreatOrders, positionSampler) {
  const duration = Number(plan.timeline?.duration) || 1; const main = phaseWindow(phases, 'main_engagement', duration);
  const friendly = (plan.forces?.friendly || []).filter((actor) => finalAlive(actor));
  const combat = friendly.filter((actor) => combatProfileFor(actor).canAttack); if (combat.length < 2) return [];
  const fireGroup = combat.filter((actor) => ['tank_cannon', 'anti_armor', 'scout_autocannon'].includes(combatProfileFor(actor).weaponFamily)).length ? combat.filter((actor) => ['tank_cannon', 'anti_armor', 'scout_autocannon'].includes(combatProfileFor(actor).weaponFamily)) : combat.slice(0, Math.max(1, Math.ceil(combat.length / 2)));
  const maneuver = combat.filter((actor) => !fireGroup.includes(actor));
  if (!maneuver.length) maneuver.push(fireGroup.pop());
  const positionForRole = (actor, role) => {
    const tactical = routeFor(plan, idOf(actor))?.tactical || {}; const base = role === 'fire' ? tactical.firing || tactical.covered : tactical.approach || tactical.covered;
    return base ? { x: base.x, y: base.y } : sample(positionSampler, actor, main.start);
  };
  const move = { id: 'cover_move_1', start: clamp(main.start + Math.min(.35, Math.max(.05, (main.end - main.start) * .04)), 0, duration), end: clamp(main.start + Math.max(2.2, (main.end - main.start) * .28), 0, duration), fireGroupIds: fireGroup.map(idOf), maneuverGroupIds: maneuver.map(idOf), fireGroupHoldPositions: Object.fromEntries(fireGroup.map((actor) => [idOf(actor), positionForRole(actor, 'fire')])), maneuverTargetPositions: Object.fromEntries(maneuver.map((actor) => [idOf(actor), positionForRole(actor, 'maneuver')])), purpose: 'cover_advance', state: 'cover_fire', station: 'covered_to_firing', displacementPolicy: 'maneuver_only' };
  const moves = [move];
  if (retreatOrders.length) {
    const rear = retreatOrders.filter((order) => order.coverFire).map((order) => order.actorId); const moving = retreatOrders.filter((order) => !order.coverFire).map((order) => order.actorId);
    if (rear.length && moving.length) moves.push({ id: 'cover_retreat_1', start: retreatOrders[0].start, end: Math.min(duration, retreatOrders.at(-1).start + 2.8), fireGroupIds: rear, maneuverGroupIds: moving, fireGroupHoldPositions: Object.fromEntries(rear.map((id) => [id, sample(positionSampler, (plan.forces.friendly || []).find((actor) => idOf(actor) === id), retreatOrders.find((order) => order.actorId === id).start)])), maneuverTargetPositions: Object.fromEntries(moving.map((id) => [id, retreatOrders.find((order) => order.actorId === id)?.presentationRoute?.at(-1) || { x: 0, y: 0 }])), purpose: 'cover_retreat', state: 'cover_fire', station: 'retreat_exit', displacementPolicy: 'maneuver_only' });
  }
  return moves.filter((item) => item.fireGroupIds.length && item.maneuverGroupIds.length);
}

function buildSuppression(plan, phases, assignments, coverMoves, positionSampler) {
  const duration = Number(plan.timeline?.duration) || 1; const windows = [];
  for (const move of coverMoves) {
    const targetIds = [...new Set(assignments.filter((row) => move.fireGroupIds.includes(row.actorId) && row.start <= move.end && row.end >= move.start).map((row) => row.targetId))];
    const target = actorRows(plan).find((actor) => targetIds.includes(idOf(actor)));
    if (!target) continue;
    windows.push({ id: `suppression_${windows.length + 1}`, sourceIds: [...move.fireGroupIds], targetIds, start: clamp(move.start, 0, duration), end: clamp(move.end, 0, duration), intensity: .62, area: { center: sample(positionSampler, target, move.start), radius: 78 }, purpose: move.purpose, sourceTargetSeparation: true });
  }
  const main = phaseWindow(phases, 'main_engagement', duration);
  for (const row of assignments.filter((item) => item.start <= main.end && item.end >= main.start).slice(0, 5)) {
    const attacker = actorRows(plan).find((actor) => idOf(actor) === row.actorId); if (!attacker || !combatProfileFor(attacker).canSuppress) continue;
    const target = actorRows(plan).find((actor) => idOf(actor) === row.targetId); if (!target) continue;
    windows.push({ id: `suppression_${windows.length + 1}`, sourceIds: [row.actorId], targetIds: [row.targetId], start: Math.max(main.start, row.start), end: Math.min(main.end, Math.max(main.start + 1, row.start + 2.2)), intensity: .48, area: { center: sample(positionSampler, target, row.start), radius: 58 }, purpose: 'disrupt', sourceTargetSeparation: true });
  }
  return windows.slice(0, ENGAGEMENT_LIMITS.maxSuppressionBursts);
}

function buildEngagements(plan, phases, assignments, suppressionWindows, retreatOrders) {
  const groups = []; const duration = Number(plan.timeline?.duration) || 1; const byPair = new Map();
  for (const row of assignments) { const phase = phaseAt(phases, row.start); const key = `${row.actorId}:${row.targetId}:${phase.id}`; if (!byPair.has(key)) byPair.set(key, []); byPair.get(key).push(row); }
  for (const [key, rows] of byPair) {
    const [attackerId, targetId, phaseId] = key.split(':'); const mode = retreatOrders.length && phaseId === 'critical_event' ? 'covering_retreat' : suppressionWindows.some((window) => window.sourceIds.includes(attackerId)) ? 'suppression' : phaseId === 'first_contact' ? 'probe' : phaseId === 'main_engagement' ? 'assault' : 'exchange';
    groups.push({ id: `engagement_${groups.length + 1}`, start: clamp(Math.min(...rows.map((row) => row.start)), 0, duration), end: clamp(Math.max(...rows.map((row) => row.end)), 0, duration), attackerIds: rows.map((row) => row.actorId), defenderIds: [targetId], focusTargetId: targetId, mode, priority: mode === 'covering_retreat' ? 5 : mode === 'assault' ? 4 : mode === 'suppression' ? 3 : 2, authoritativeAnchorIds: (plan.timeline?.anchors || []).filter((anchor) => rows.some((row) => row.actorId === anchor.actorId) && anchor.targetId === targetId).map((anchor) => anchor.id) });
  }
  return groups.sort((a, b) => a.start - b.start || b.priority - a.priority || a.id.localeCompare(b.id)).slice(0, ENGAGEMENT_LIMITS.maxEngagementGroups);
}

function shotFacing(source, impact) { const dx = impact.x - source.x; const dy = impact.y - source.y; return Math.hypot(dx, dy) > EPS ? Math.atan2(dy, dx) : 0; }

function safeShotPosition(positionSampler, attacker, target, time, nearMiss, salt) {
  const source = sample(positionSampler, attacker, time); const aim = sample(positionSampler, target, Math.max(0, time - .16)); const impact = sample(positionSampler, target, time + visualWeaponProfile(attacker).projectileDuration);
  if (!nearMiss) return { source, aim, impact };
  const drift = deterministicUnit(`${idOf(attacker)}:${idOf(target)}`, salt); return { source, aim, impact: { x: impact.x + (drift - .5) * 42, y: impact.y + (deterministicUnit(drift, 'y') - .5) * 30 } };
}

function buildShots(plan, phases, assignments, switches, suppressionWindows, retreatOrders, positionSampler) {
  const actors = actorRows(plan); const byId = new Map(actors.map((actor) => [idOf(actor), actor])); const duration = Number(plan.timeline?.duration) || 1; const shots = []; const perActorPhase = new Map(); const perSidePhase = new Map();
  for (const assignment of assignments) {
    const attacker = byId.get(assignment.actorId); const target = byId.get(assignment.targetId); if (!attacker || !target) continue;
    const weapon = visualWeaponProfile(attacker); const profile = combatProfileFor(attacker); if (!profile.canAttack) continue;
    const slices = assignment.phase === 'retreat'
      ? [{ id: `${assignment.id}:retreat`, assignmentId: assignment.id, phase: 'retreat', start: assignment.start, end: assignment.end }]
      : assignmentPhaseSlices(assignment, phases, duration);
    for (const slice of slices) {
    const phaseId = slice.phase;
    const actorLimit = phaseId === 'retreat' ? ENGAGEMENT_LIMITS.coverRetreatShotBudget : phaseId === 'first_contact' ? ENGAGEMENT_LIMITS.firstContactShotsPerActor : ENGAGEMENT_LIMITS.maxShotsPerActorPerPhase;
    const sideLimit = phaseId === 'retreat' ? ENGAGEMENT_LIMITS.coverRetreatSideBudget : phaseId === 'first_contact' ? ENGAGEMENT_LIMITS.firstContactShotsPerSide : ENGAGEMENT_LIMITS.maxShotsPerSidePerPhase;
    const start = Math.max(assignment.start + weapon.aimDuration, slice.start + .08); const end = Math.min(duration, assignment.end, slice.end); if (end <= start) continue;
    const key = `${assignment.actorId}:${phaseId}`; const sideKey = `${sideOf(attacker)}:${phaseId}`; let actorCount = perActorPhase.get(key) || 0; let sideCount = perSidePhase.get(sideKey) || 0;
    const interval = Math.max(.32, Number(weapon.reloadDuration) || .5); const burst = Math.max(1, Math.min(2, Number(weapon.burst) || 1)); const salt = `${plan.source?.seed ?? 0}:${assignment.id}`; let time = start + deterministicUnit(salt, 'offset') * Math.min(.55, interval * .35); let burstIndex = 0;
    while (time < end - EPS && actorCount < actorLimit && sideCount < sideLimit && shots.length < ENGAGEMENT_LIMITS.maxScheduledShots) {
      const legality = evaluateTargetLegality(plan, attacker, target, time, positionSampler); if (!legality.ok) { time += interval; continue; }
      const nearMiss = suppressionWindows.some((window) => window.sourceIds.includes(assignment.actorId) && window.targetIds.includes(assignment.targetId) && time >= window.start && time <= window.end);
      for (let index = 0; index < burst && time + index * .075 < end && actorCount < actorLimit && sideCount < sideLimit; index += 1) {
        const t = time + index * .075; const fireLegality = evaluateTargetLegality(plan, attacker, target, t, positionSampler); if (!fireLegality.ok) continue;
        const positions = safeShotPosition(positionSampler, attacker, target, t, nearMiss, `${burstIndex}:${index}`); const impactTime = Math.min(duration, t + weapon.projectileDuration); const shot = { id: `choreographed_shot_${shots.length + 1}`, source: 'engagement_choreographer', presentationOnly: true, actorId: assignment.actorId, targetId: assignment.targetId, side: attacker.side, phase: phaseId, phaseSliceId: slice.id, weaponId: weapon.id, weaponFamily: weapon.family, weaponKind: weapon.kind, weapon, t, impactTime, sourcePositionAtFire: positions.source, sourceFacingAtFire: shotFacing(positions.source, positions.impact), targetPositionAtAim: positions.aim, impactPositionAtImpact: positions.impact, hitType: nearMiss ? 'near_miss' : 'presentation_exchange', authorityAnchorId: null, targetAssignmentId: assignment.id, suppressionId: nearMiss ? suppressionWindows.find((window) => window.sourceIds.includes(assignment.actorId) && window.targetIds.includes(assignment.targetId) && t >= window.start && t <= window.end)?.id || null : null, targetSwitchId: switches.find((item) => item.actorId === assignment.actorId && item.toTargetId === assignment.targetId && Math.abs(item.time - t) < 2)?.id || null, legality: fireLegality, seed: deterministicUnit(salt, `${burstIndex}:${index}`) }; shots.push(shot); actorCount += 1; sideCount += 1;
      }
      burstIndex += 1; time += interval + deterministicUnit(salt, `cooldown:${burstIndex}`) * .3;
    }
    perActorPhase.set(key, actorCount); perSidePhase.set(sideKey, sideCount);
    }
  }
  return shots.sort((a, b) => a.t - b.t || a.side.localeCompare(b.side) || a.id.localeCompare(b.id));
}

function buildCameraInterests(plan, phases, engagements, retreatOrders) {
  const duration = Number(plan.timeline?.duration) || 1; const interests = []; const add = (id, start, end, subjectIds, priority, reason) => interests.push({ id, start: clamp(start, 0, duration), end: clamp(end, 0, duration), subjectIds: [...new Set(subjectIds.filter(Boolean))], position: null, priority, reason });
  const contact = phaseWindow(phases, 'first_contact', duration); const main = phaseWindow(phases, 'main_engagement', duration); add('camera_first_contact', contact.start, contact.end, engagements.filter((row) => row.mode === 'probe').flatMap((row) => [...row.attackerIds, ...row.defenderIds]), 50, 'first_contact'); add('camera_main_engagement', main.start, main.end, engagements.flatMap((row) => [...row.attackerIds, ...row.defenderIds]), 60, 'main_engagement');
  for (const anchor of (plan.timeline?.anchors || []).filter((row) => ['damage', 'destroy'].includes(row.type)).slice(-8)) add(`camera_${anchor.id}`, Number(anchor.t) - .6, Number(anchor.t) + 1.4, [anchor.actorId, anchor.targetId], anchor.type === 'destroy' ? 100 : 80, anchor.type === 'destroy' ? 'destroy' : 'critical_hit');
  if (retreatOrders.length) add('camera_retreat', retreatOrders[0].start, duration, retreatOrders.map((row) => row.actorId), 90, 'retreat'); add('camera_battle_end', duration * .85, duration, actorRows(plan).filter(finalAlive).map(idOf), 70, 'battle_end'); return interests.sort((a, b) => a.start - b.start || b.priority - a.priority || a.id.localeCompare(b.id));
}

export function buildUniversalEngagementSchedule(plan, positionSampler) {
  const phases = deriveBattlePhases(plan); const base = buildTargetAssignments(plan, phases, positionSampler); const retreatOrders = buildRetreatOrders(plan, phases, positionSampler); const shotSampler = retreatShotSampler(positionSampler, retreatOrders); const assignments = appendRetreatAssignments(plan, base.assignments, retreatOrders, shotSampler); const switches = base.switches; const coverMoves = buildCoverMoves(plan, phases, assignments, retreatOrders, shotSampler); const suppressionBursts = buildSuppression(plan, phases, assignments, coverMoves, shotSampler); const engagements = buildEngagements(plan, phases, assignments, suppressionBursts, retreatOrders); const shots = buildShots(plan, phases, assignments, switches, suppressionBursts, retreatOrders, shotSampler);
  const budgetPhaseIds = [...phases.map((phase) => phase.id), 'retreat'];
  const phaseBudgets = Object.fromEntries(budgetPhaseIds.map((phaseId) => [phaseId, { scheduledShots: shots.filter((shot) => shot.phase === phaseId).length, shotLimit: phaseId === 'approach' ? 0 : phaseId === 'retreat' ? ENGAGEMENT_LIMITS.coverRetreatSideBudget * 2 : phaseId === 'first_contact' ? ENGAGEMENT_LIMITS.firstContactShotsPerSide * 2 : ENGAGEMENT_LIMITS.maxShotsPerSidePerPhase * 2, sides: Object.fromEntries(['friendly', 'enemy'].map((side) => [side, shots.filter((shot) => shot.phase === phaseId && shot.side === side).length])) }]));
  const serializable = { version: '8.2G-B.1.1', deterministic: true, seed: plan.source?.seed ?? 0, phases, limits: { ...ENGAGEMENT_LIMITS }, phaseBudgets, engagements, shots, targetAssignmentSlices: assignments.flatMap((assignment) => assignment.phase === 'retreat' ? [{ id: `${assignment.id}:retreat`, assignmentId: assignment.id, phase: 'retreat', start: assignment.start, end: assignment.end, actorId: assignment.actorId, targetId: assignment.targetId }] : assignmentPhaseSlices(assignment, phases, durationFor(plan)).map((slice) => ({ ...slice, actorId: assignment.actorId, targetId: assignment.targetId }))), targetAssignments: assignments, targetSwitches: switches, reloadWindows: shots.map((shot) => ({ actorId: shot.actorId, start: shot.t + shot.weapon.fireDuration, end: shot.t + shot.weapon.fireDuration + shot.weapon.reloadDuration, shotId: shot.id })), suppressionBursts, coverMoves, retreatOrders, cameraInterests: buildCameraInterests(plan, phases, engagements, retreatOrders), legality: { hardRange: true, hardLineOfSight: true, supportCannotAttack: true, facingFromProjectileVector: true } };
  return Object.freeze(JSON.parse(JSON.stringify(serializable)));
}

export function engagementAtTime(schedule, seconds) { return (schedule?.engagements || []).filter((row) => seconds >= row.start - EPS && seconds <= row.end + EPS).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0] || null; }
export function assignmentAtTime(schedule, actorId, seconds) { return (schedule?.targetAssignments || []).filter((row) => row.actorId === actorId && seconds >= row.start - EPS && seconds <= row.end + EPS).at(-1) || null; }
export function suppressionSourceAtTime(schedule, actorId, seconds) { return (schedule?.suppressionBursts || []).filter((row) => row.sourceIds.includes(actorId) && seconds >= row.start - EPS && seconds <= row.end + EPS).at(-1) || null; }
export function suppressionTargetAtTime(schedule, actorId, seconds) { return (schedule?.suppressionBursts || []).filter((row) => row.targetIds.includes(actorId) && seconds >= row.start - EPS && seconds <= row.end + EPS).at(-1) || null; }
export function suppressionAtTime(schedule, actorId, seconds) { return suppressionTargetAtTime(schedule, actorId, seconds); }
export function retreatAtTime(schedule, actorId, seconds) { return (schedule?.retreatOrders || []).find((row) => row.actorId === actorId && seconds >= row.start - EPS && seconds <= row.end + EPS) || null; }
export function scheduleAuthorityFingerprint(schedule) { return JSON.stringify({ engagements: schedule.engagements, assignments: schedule.targetAssignments, switches: schedule.targetSwitches, shots: schedule.shots.map((shot) => ({ id: shot.id, actorId: shot.actorId, targetId: shot.targetId, t: shot.t, impactTime: shot.impactTime, anchor: shot.authorityAnchorId })) }); }
