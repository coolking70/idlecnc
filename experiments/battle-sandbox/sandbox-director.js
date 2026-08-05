import {
  COVER_SLOTS, ENEMY_UNITS, FIRE_PLAN, FRIENDLY_UNITS, INFANTRY_OFFSETS, LATE_VISUAL_EVENTS, OBJECTIVE_NORTH_SLOTS, OBJECTIVE_SOUTH_SLOTS, PATHS, SANDBOX_SEED, fixedSeedSequence
} from './sandbox-config.js';
import { buildPulseTimes } from './sandbox-pulse-scheduler.js';
import { applyDisabledPose, applyVisualHit, createVisualDamageState, updateVisualDamage } from './sandbox-damage-model.js';
import { buildWeldingPulses, getRepairActionAtTime, getRepairArmPose, getRepairContactPoint, getSmokeLevelAtTime } from './sandbox-repair-director.js';
import { getCaptureProgress, getObjectiveStateAtTime, TIME_EPSILON } from './sandbox-objective-director.js';
import { getRetreatAlpha, interpolateRetreatPath, RETREAT_PATHS } from './sandbox-retreat-director.js';
import { createWreck } from './sandbox-wrecks.js';

export const SANDBOX_DURATION = 35;
export const MAX_EFFECTS = 120;
export const COVER_ASSIGNMENTS = Object.freeze({ f_inf_1: 'friendlyNorth', f_inf_2: 'friendlySouth', e_inf_1: 'enemyNorth', e_at_1: 'enemyNorth', e_inf_3: 'enemySouth', e_at_2: 'enemySouth' });
export const COVER_TRANSITIONS = Object.freeze({
  f_inf_1: { start: 4.9, end: 5.5 }, f_inf_2: { start: 5.4, end: 6 },
  e_inf_1: { start: 4.9, end: 5.5 }, e_at_1: { start: 4.9, end: 5.6 },
  e_inf_3: { start: 5.65, end: 6.25 }, e_at_2: { start: 5.9, end: 6.5 }
});
export const PULSE_ACTIONS = Object.freeze([
  { key: 'f_inf_1', source: 'f_inf_1', target: 'e_inf_1', type: 'rifle_burst', lifetime: 0.14 },
  { key: 'e_inf_1', source: 'e_inf_1', target: 'f_inf_1', type: 'rifle_burst', lifetime: 0.14 },
  { key: 'f_inf_2', source: 'f_inf_2', target: 'e_inf_3', type: 'suppression', lifetime: 0.16 },
  { key: 'f_tank_2', source: 'f_tank_2', target: 'e_inf_3', type: 'coax_burst', lifetime: 0.18 },
  { key: 'e_armor_1', source: 'e_armor_1', target: 'f_inf_1', type: 'armor_burst', lifetime: 0.14 },
  { key: 'e_inf_3', source: 'e_inf_3', target: 'f_inf_2', type: 'rifle_burst', lifetime: 0.14 },
  { key: 'f_inf_1_objective', source: 'f_inf_1', target: 'e_at_1', type: 'objective_rifle', lifetime: 0.14 },
  { key: 'f_inf_2_objective', source: 'f_inf_2', target: 'e_at_2', type: 'objective_rifle', lifetime: 0.14 }
]);

export function interpolatePath(path, time) {
  if (!path || !path.length) return { x: 0, y: 0, angle: 0, moving: false };
  if (time <= path[0].t) return { x: path[0].x, y: path[0].y, angle: 0, moving: false };
  for (let i = 1; i < path.length; i += 1) {
    const next = path[i];
    const prev = path[i - 1];
    if (time <= next.t) {
      const p = Math.max(0, Math.min(1, (time - prev.t) / Math.max(0.001, next.t - prev.t)));
      return { x: prev.x + (next.x - prev.x) * p, y: prev.y + (next.y - prev.y) * p, angle: Math.atan2(next.y - prev.y, next.x - prev.x), moving: true };
    }
  }
  const last = path[path.length - 1];
  const prior = path[path.length - 2] || last;
  return { x: last.x, y: last.y, angle: Math.atan2(last.y - prior.y, last.x - prior.x), moving: false };
}

export function getRepairVehicleState(elapsed) {
  if (elapsed < 3.5) return 'idle';
  if (elapsed < 10) return 'moving';
  return 'holding';
}

export function revealAlphaForUnit(unit, elapsed) {
  if (unit.side !== 'enemy' || unit.revealStart === undefined) return 1;
  if (elapsed < unit.revealStart) return 0.08;
  if (elapsed >= unit.revealEnd) return 1;
  return 0.08 + ((elapsed - unit.revealStart) / Math.max(0.001, unit.revealEnd - unit.revealStart)) * 0.92;
}

export function unitStatus(unit, time) {
  if (unit.id === 'f_scout_1') return time >= 32 ? 'scanning' : time >= 29 ? 'moving_forward' : time >= 24 ? 'disengaging' : time >= 22 ? 'marking_target' : time >= 20 ? 'moving_flank' : time >= 8 ? 'moving' : time >= 0.5 && time < 3.2 ? 'scanning' : 'idle';
  if (unit.id === 'f_inf_1') return time >= 31.5 ? 'holding_objective' : time >= 27 ? 'securing_objective' : time >= 23.8 ? 'bounding_advance' : time >= 22.3 ? 'concentrating_fire' : time >= 20 ? 'firing_from_new_cover' : time >= 14.8 ? 'firing_from_new_cover' : time >= 12.2 ? 'bounding_move' : time >= 11.2 ? 'suppressed' : time >= 7.4 ? 'firing' : time >= 1 ? (time >= 5.5 ? 'taking_cover' : 'moving') : 'idle';
  if (unit.id === 'f_inf_2') return time >= 31.5 ? 'holding_objective' : time >= 27.8 ? 'securing_objective' : time >= 24.2 ? 'bounding_advance' : time >= 1 ? (time >= 13 ? 'firing' : time >= 7.4 ? 'suppressing' : time >= 5.5 ? 'taking_cover' : 'moving') : 'idle';
  if (unit.id === 'f_at_1') return time >= 17.1 ? 'reloading' : time >= 16.9 ? 'firing' : time >= 15.8 ? 'aiming' : time >= 3 ? (time >= 7.5 ? 'holding' : 'moving') : 'idle';
  if (unit.id === 'f_tank_1') return time >= 34 ? 'holding_west' : time >= 30 ? 'rejoining_slow' : time >= 19 ? 'stabilized' : time >= 16.2 ? 'being_repaired' : time >= 14.2 ? 'waiting_repair' : time >= 11.8 ? 'retreating_damaged' : time >= 11.45 ? (time < 11.8 ? 'hit' : 'damaged') : time >= 10.85 ? 'under_threat' : time >= 8.1 ? (time < 8.35 ? 'recoiling' : 'holding') : time >= 5.8 ? 'aiming' : time >= 2 ? 'moving' : 'idle';
  if (unit.id === 'f_tank_2') return time >= 28 ? 'overwatch' : time >= 22.72 ? 'advancing_breakthrough' : time >= 22.35 ? 'firing_main_gun' : time >= 21.2 ? 'advancing_slow' : time >= 20.7 ? 'loading_main_gun' : time >= 20 ? 'aiming' : time >= 8.7 ? 'firing' : time >= 2.7 ? 'moving' : 'idle';
  if (unit.id === 'f_repair_1') return time >= 10 ? getRepairActionAtTime(time) : getRepairVehicleState(time);
  if (unit.id === 'e_at_1') return time >= 26 ? 'escaped' : time >= 24.2 ? 'retreating' : time >= 23.2 ? 'suppressed' : time >= 22.3 ? 'under_fire' : time >= 20 ? 'aiming' : time >= 10.85 ? 'firing' : time >= 10.2 ? 'aiming' : time >= 8.5 ? 'firing' : time >= 7.2 ? 'aiming' : time >= 2.5 ? 'taking_cover' : 'idle';
  if (unit.id === 'e_at_2') return time >= 27 ? 'escaped' : time >= 25 ? 'retreating' : time >= 24.05 ? 'suppressed' : time >= 23.5 ? 'firing_rocket' : time >= 3 ? 'taking_cover' : 'idle';
  if (unit.id === 'e_inf_1') return time >= 29 ? 'escaped' : time >= 27 ? 'retreating' : time >= 26 ? 'suppressed' : time >= 7.55 ? 'firing' : time >= 5.5 ? 'taking_cover' : 'moving';
  if (unit.id === 'e_inf_3') return time >= 30 ? 'escaped' : time >= 27.5 ? 'retreating' : time >= 9 ? 'firing' : time >= 6 ? 'taking_cover' : 'moving';
  if (unit.id === 'e_inf_2') return time >= 29.5 ? 'escaped' : time >= 26.8 ? 'retreating' : time >= 4.5 ? 'holding' : 'idle';
  if (unit.id === 'e_armor_1') return time >= 22.72 ? 'destroyed' : time >= 9 ? 'firing' : time >= 4 ? 'moving' : 'idle';
  if (unit.id === 'e_armor_2') return time >= 19.5 ? 'disabled' : time >= 18 ? 'retreating_damaged' : time >= 17.55 ? 'hit' : time >= 16.9 ? 'under_threat' : time >= 9 ? 'firing' : time >= 4 ? 'moving' : 'idle';
  return 'idle';
}

function makeUnit(def, side) {
  const isInfantry = def.type === 'infantry' || def.type === 'enemy_infantry';
  const members = isInfantry ? INFANTRY_OFFSETS.map((offset, index) => ({ ...offset, index, phase: index * 0.07 })) : [];
  const atMembers = def.type === 'at_infantry' || def.type === 'enemy_at' ? [{ x: -6, y: 0, index: 0, role: 'rocket' }, { x: 9, y: -8, index: 1, role: 'assistant' }, { x: 10, y: 8, index: 2, role: 'assistant' }] : [];
  return { ...def, side, x: def.start.x, y: def.start.y, angle: 0, turretAngle: 0, status: 'idle', alpha: side === 'enemy' ? 0.08 : 1, members: members.length ? members : atMembers, memberPositions: [], visualCenter: { x: def.start.x, y: def.start.y }, coverGroup: COVER_ASSIGNMENTS[def.id] || null, visualDamage: (def.id === 'f_tank_1' || def.id === 'e_armor_2') ? createVisualDamageState() : null, repairArmPose: { extension: 0, angle: -0.85, active: false }, bob: 0, dustClock: 0, destroyedAt: null };
}

export function createSandboxState(seed = SANDBOX_SEED) {
  const rng = fixedSeedSequence(seed);
  const units = [...FRIENDLY_UNITS.map((unit) => makeUnit(unit, 'friendly')), ...ENEMY_UNITS.map((unit) => makeUnit(unit, 'enemy'))];
  return { seed, time: 0, units, effects: [], wrecks: [], scorchMarks: [], objective: getObjectiveStateAtTime(0), dustClock: 0, nextPlanIndex: 0, nextLateEventIndex: 0, weldingCursor: 0, weldingPulses: buildWeldingPulses(seed), pulseCursors: Object.fromEntries(PULSE_ACTIONS.map((action) => [action.key, 0])), rng, ended: false, paused: false };
}

function findUnit(state, id) { return state.units.find((unit) => unit.id === id); }

export function updateVisualCenter(unit) {
  if (!unit.memberPositions?.length) {
    unit.visualCenter = { x: unit.x, y: unit.y };
    return unit.visualCenter;
  }
  const total = unit.memberPositions.reduce((sum, position) => ({ x: sum.x + position.x, y: sum.y + position.y }), { x: 0, y: 0 });
  unit.visualCenter = { x: total.x / unit.memberPositions.length, y: total.y / unit.memberPositions.length };
  return unit.visualCenter;
}

export function getUnitVisualCenter(unit) {
  return unit.visualCenter ? { x: unit.visualCenter.x, y: unit.visualCenter.y } : { x: unit.x, y: unit.y };
}

function effectFromPlan(plan, state) {
  const source = findUnit(state, plan.source);
  const target = findUnit(state, plan.target);
  if (!source || !target) return null;
  const kind = plan.type === 'cannon_shell' ? 'cannon_shell' : plan.type === 'rocket' ? 'rocket' : plan.type === 'enemy_armor_fire' ? 'tracer' : null;
  if (!kind) return null;
  const sourceCenter = getUnitVisualCenter(source); const targetCenter = getUnitVisualCenter(target);
  return { kind, x: sourceCenter.x, y: sourceCenter.y, sx: sourceCenter.x, sy: sourceCenter.y, tx: targetCenter.x, ty: targetCenter.y, life: kind === 'tracer' ? 0.22 : 0.7, maxLife: kind === 'tracer' ? 0.22 : 0.7, angle: Math.atan2(targetCenter.y - sourceCenter.y, targetCenter.x - sourceCenter.x), seed: state.rng() };
}

function quadraticPoint(start, control, end, amount) {
  const inverse = 1 - amount;
  return { x: inverse * inverse * start.x + 2 * inverse * amount * control.x + amount * amount * end.x, y: inverse * inverse * start.y + 2 * inverse * amount * control.y + amount * amount * end.y };
}

function positionForUnit(unit, time) {
  if (RETREAT_PATHS[unit.id] && time >= RETREAT_PATHS[unit.id][0].t) return interpolateRetreatPath(RETREAT_PATHS[unit.id], time);
  return interpolatePath(PATHS[unit.id], time);
}

function spawnLateEvents(state) {
  while (state.nextLateEventIndex < LATE_VISUAL_EVENTS.length && LATE_VISUAL_EVENTS[state.nextLateEventIndex].t <= state.time) {
    const event = LATE_VISUAL_EVENTS[state.nextLateEventIndex];
    if (event.type === 'rocket_curve') state.effects.push({ kind: 'rocket_curve', x: event.start.x, y: event.start.y, start: event.start, control: event.control, end: event.end, life: event.impactTime - event.t, maxLife: event.impactTime - event.t, size: 5, seed: state.rng(), source: event.source });
    if (event.type === 'main_gun_curve' || event.type === 'rocket_curve_miss') {
      state.effects.push({ kind: event.type === 'main_gun_curve' ? 'main_gun_shell' : 'rocket_curve_miss', x: event.start.x, y: event.start.y, start: event.start, control: event.control, end: event.end, life: event.impactTime - event.t, maxLife: event.impactTime - event.t, size: event.type === 'main_gun_curve' ? 7 : 5, seed: state.rng(), source: event.source });
      if (event.type === 'main_gun_curve') state.effects.push({ kind: 'main_gun_muzzle', x: event.start.x, y: event.start.y, life: 0.32, maxLife: 0.32, size: 22, seed: state.rng(), source: event.source });
    }
    if (event.type === 'armor_hit') {
      const target = findUnit(state, event.target);
      if (target?.visualDamage && !target.visualDamage.hitAt) applyVisualHit(target.visualDamage, event.t, event.target === 'e_armor_2' ? { smokeLevel: 0.55, mobilityMultiplier: 0.35, turretOperational: false } : undefined);
      state.effects.push({ kind: 'armor_hit', x: event.x, y: event.y, life: 0.7, maxLife: 0.7, size: event.target === 'f_tank_1' ? 24 : 18, seed: state.rng() });
      state.effects.push({ kind: 'cover_debris', x: event.x, y: event.y, life: 0.8, maxLife: 0.8, size: 12, seed: state.rng() });
    }
    if (event.type === 'target_mark') state.effects.push({ kind: 'target_marker', x: event.x, y: event.y, life: event.life || 0.8, maxLife: event.life || 0.8, size: 14, seed: state.rng() });
    if (event.type === 'armor_destroy') {
      const target = findUnit(state, event.target);
      if (target && !target.destroyedAt) {
        target.destroyedAt = event.t;
        state.wrecks.push(createWreck(event.target, event.x, event.y, target.angle, event.t));
        state.scorchMarks.push({ x: event.x, y: event.y + 9, size: 28, createdAt: event.t });
      }
      state.effects.push({ kind: 'armor_destruction', x: event.x, y: event.y, life: 1.15, maxLife: 1.15, size: 30, seed: state.rng() });
      state.effects.push({ kind: 'wreck_fire', x: event.x, y: event.y - 7, life: 4.28, maxLife: 4.28, size: 16, seed: state.rng() });
    }
    if (event.type === 'road_miss_explosion') {
      state.scorchMarks.push({ x: event.x, y: event.y + 6, size: 18, createdAt: event.t });
      state.effects.push({ kind: 'road_miss_explosion', x: event.x, y: event.y, life: 0.9, maxLife: 0.9, size: 22, seed: state.rng() });
    }
    if (event.type === 'capture_pulse') state.effects.push({ kind: 'capture_pulse', x: event.x, y: event.y, life: 0.8, maxLife: 0.8, size: 34, seed: state.rng() });
    state.nextLateEventIndex += 1;
  }
}

function spawnWeldingEvents(state) {
  while (state.weldingCursor < state.weldingPulses.length && state.weldingPulses[state.weldingCursor].time <= state.time) {
    const pulse = state.weldingPulses[state.weldingCursor]; const repair = findUnit(state, 'f_repair_1'); const tank = findUnit(state, 'f_tank_1');
    if (repair && tank && state.time < 19) {
      const contact = getRepairContactPoint(repair, tank); const x = contact.x; const y = contact.y;
      state.effects.push({ kind: 'welding_spark', x, y, life: pulse.lifetime, maxLife: pulse.lifetime, size: 9, seed: state.rng(), source: 'f_repair_1' });
      state.effects.push({ kind: 'repair_work_light', x, y, life: pulse.lifetime + 0.08, maxLife: pulse.lifetime + 0.08, size: 14, seed: state.rng(), source: 'f_repair_1' });
    }
    state.weldingCursor += 1;
  }
}

export function formationToCoverTransition(unit, elapsed) {
  const slots = unit.coverGroup ? COVER_SLOTS[unit.coverGroup] : null;
  const transition = COVER_TRANSITIONS[unit.id];
  if (!slots || !transition) return unit.members.map((member) => ({ x: unit.x + member.x, y: unit.y + member.y, facing: unit.angle, stance: 'moving' }));
  const amount = Math.max(0, Math.min(1, (elapsed - transition.start) / Math.max(0.001, transition.end - transition.start)));
  const eased = amount * amount * (3 - 2 * amount);
  return unit.members.map((member, index) => {
    const slot = slots[index % slots.length];
    const startX = unit.x + member.x;
    const startY = unit.y + member.y;
    return { x: startX + (slot.x - startX) * eased, y: startY + (slot.y - startY) * eased, facing: slot.facing, stance: eased > 0.55 ? slot.stance : 'moving' };
  });
}

function secondaryMemberPositions(unit, elapsed) {
  const oldSlots = COVER_SLOTS.friendlyNorth; const newSlots = COVER_SLOTS.friendlyNorthSecondary;
  return unit.members.map((member, index) => {
    const start = oldSlots[index]; const end = newSlots[index]; const startTime = index < 2 ? 12.2 : 13.2; const endTime = index < 2 ? 14.3 : 14.8;
    const amount = Math.max(0, Math.min(1, (elapsed - startTime) / (endTime - startTime))); const eased = amount * amount * (3 - 2 * amount);
    return { x: start.x + (end.x - start.x) * eased, y: start.y + (end.y - start.y) * eased, facing: start.facing + (end.facing - start.facing) * eased, stance: amount > 0.98 ? end.stance : amount > 0 ? 'moving' : start.stance };
  });
}

function objectiveMemberPositions(unit, elapsed, startSlots, slots, firstStart, firstEnd, secondStart, secondEnd) {
  return unit.members.map((member, index) => {
    const start = startSlots[index];
    const end = slots[index]; const startTime = index < 2 ? firstStart : secondStart; const endTime = index < 2 ? firstEnd : secondEnd;
    const amount = Math.max(0, Math.min(1, (elapsed - startTime) / Math.max(0.001, endTime - startTime))); const eased = amount * amount * (3 - 2 * amount);
    return { x: start.x + (end.x - start.x) * eased, y: start.y + (end.y - start.y) * eased, facing: start.facing + (end.facing - start.facing) * eased, stance: amount > 0.98 ? end.stance : amount > 0 ? 'moving' : start.stance };
  });
}

function updateMemberPositions(unit, elapsed) {
  if (unit.id === 'f_inf_1' && elapsed >= 23.8) { unit.memberPositions = objectiveMemberPositions(unit, elapsed, COVER_SLOTS.friendlyNorthSecondary, OBJECTIVE_NORTH_SLOTS, 23.8, 26, 24.8, 27); unit.coverGroup = 'objectiveNorth'; return; }
  if (unit.id === 'f_inf_2' && elapsed >= 24.2) { unit.memberPositions = objectiveMemberPositions(unit, elapsed, COVER_SLOTS.friendlySouth, OBJECTIVE_SOUTH_SLOTS, 24.2, 26.8, 25.2, 27.8); unit.coverGroup = 'objectiveSouth'; return; }
  unit.memberPositions = unit.id === 'f_inf_1' && elapsed >= 10 ? secondaryMemberPositions(unit, elapsed) : formationToCoverTransition(unit, elapsed);
}

function pulseTargetPoint(action, pulse, source, target) {
  const direction = Math.atan2(target.y - source.y, target.x - source.x);
  const spread = pulse.spread || 0;
  return { x: target.x - Math.sin(direction) * spread, y: target.y + Math.cos(direction) * spread };
}

function spawnPulseEffects(state) {
  for (const action of PULSE_ACTIONS) {
    const pulses = buildPulseTimes(action, state.seed);
    let cursor = state.pulseCursors[action.key] || 0;
    while (cursor < pulses.length && pulses[cursor].start <= state.time) {
      const pulse = pulses[cursor];
      const sourceUnit = findUnit(state, action.source);
      const targetUnit = findUnit(state, action.target);
      if (sourceUnit && targetUnit && !['disabled', 'destroyed', 'escaped'].includes(sourceUnit.status) && !['disabled', 'destroyed', 'escaped'].includes(targetUnit.status)) {
        const members = sourceUnit.memberPositions.length ? sourceUnit.memberPositions : [{ x: sourceUnit.x, y: sourceUnit.y, facing: sourceUnit.angle }];
        const member = members[pulse.member % members.length];
      const target = pulseTargetPoint(action, pulse, member, getUnitVisualCenter(targetUnit));
        const angle = Math.atan2(target.y - member.y, target.x - member.x);
        state.effects.push({ kind: 'muzzle_flash', source: action.source, x: member.x + Math.cos(angle) * 8, y: member.y + Math.sin(angle) * 8, life: Math.min(0.12, pulse.lifetime), maxLife: Math.min(0.12, pulse.lifetime), size: action.type === 'coax_burst' ? 5 : 7, seed: state.rng(), pulse: true });
        state.effects.push({ kind: 'tracer', source: action.source, x: member.x, y: member.y, sx: member.x, sy: member.y, tx: target.x, ty: target.y, life: pulse.lifetime, maxLife: pulse.lifetime, angle, seed: state.rng(), pulse: true, fast: action.type === 'coax_burst' });
        if (action.type === 'suppression' && pulse.index % 3 === 0) state.effects.push({ kind: 'impact_spark', source: action.source, x: target.x, y: target.y, life: 0.14, maxLife: 0.14, size: 7, seed: state.rng(), pulse: true });
      }
      cursor += 1;
    }
    state.pulseCursors[action.key] = cursor;
  }
}

function spawnAmbientDust(state, previousTime, currentTime) {
  if (previousTime < 8.8 && currentTime >= 8.8) {
    state.effects.push({ kind: 'smoke', x: 875, y: 390, life: 2, maxLife: 2, size: 13, seed: state.rng() });
    state.effects.push({ kind: 'smoke', x: 620, y: 405, life: 1.8, maxLife: 1.8, size: 10, seed: state.rng() });
  }
  const moving = state.units.filter((unit) => ['moving', 'moving_flank', 'moving_forward', 'advancing_slow', 'advancing_breakthrough', 'rejoining_slow', 'following_damaged_tank', 'bounding_advance'].includes(unit.status) && unit.side === 'friendly');
  const damagedTank = state.units.find((unit) => unit.id === 'f_tank_1' && unit.status === 'retreating_damaged');
  state.dustClock += currentTime - previousTime;
  if ((!moving.length && !damagedTank) || state.dustClock < 0.16) return;
  state.dustClock = 0;
  for (const unit of moving.slice(0, 3)) { const center = getUnitVisualCenter(unit); state.effects.push({ kind: unit.type === 'infantry' ? 'ground_dust' : 'dust', x: center.x - Math.cos(unit.angle) * 16, y: center.y - Math.sin(unit.angle) * 16, life: 0.65, maxLife: 0.65, size: unit.type === 'mbt' ? 8 : 5, seed: state.rng() }); }
  if (damagedTank) state.effects.push({ kind: 'damaged_track_dust', x: damagedTank.x - Math.cos(damagedTank.angle) * 20, y: damagedTank.y - Math.sin(damagedTank.angle) * 20 + 8, life: 0.8, maxLife: 0.8, size: 10, seed: state.rng(), source: 'f_tank_1' });
  for (const unit of state.units.filter((item) => item.side === 'enemy' && ['retreating', 'escaped'].includes(item.status)).slice(0, 2)) state.effects.push({ kind: 'retreat_dust', x: unit.x - Math.cos(unit.angle) * 12, y: unit.y - Math.sin(unit.angle) * 12, life: 0.7, maxLife: 0.7, size: 7, seed: state.rng(), source: unit.id });
}

function updateEffect(effect, dt) {
  effect.life -= dt;
  if (effect.kind === 'rocket_curve' || effect.kind === 'main_gun_shell' || effect.kind === 'rocket_curve_miss') {
    const progress = Math.max(0, Math.min(1, 1 - effect.life / effect.maxLife)); const point = quadraticPoint(effect.start, effect.control, effect.end, progress); effect.x = point.x; effect.y = point.y;
  } else if (effect.kind === 'cannon_shell' || effect.kind === 'rocket') {
    const progress = Math.max(0, Math.min(1, 1 - effect.life / effect.maxLife));
    effect.x = effect.sx + (effect.tx - effect.sx) * progress;
    effect.y = effect.sy + (effect.ty - effect.sy) * progress;
  }
}

function updateVisualDamageStates(state) {
  const tank = findUnit(state, 'f_tank_1'); const enemyArmor = findUnit(state, 'e_armor_2');
  if (tank?.visualDamage) {
    if (state.time >= 11.45 && !tank.visualDamage.hitAt) applyVisualHit(tank.visualDamage, 11.45);
    updateVisualDamage(tank.visualDamage, state.time, { repairAt: 16.2, stabilizedAt: 19 });
  }
  if (enemyArmor?.visualDamage) {
    if (state.time >= 17.55 && !enemyArmor.visualDamage.hitAt) applyVisualHit(enemyArmor.visualDamage, 17.55, { smokeLevel: 0.55, mobilityMultiplier: 0.35, turretOperational: false });
    if (enemyArmor.visualDamage.hitAt) {
      if (state.time >= 19.5) applyDisabledPose(enemyArmor.visualDamage);
      else { enemyArmor.visualDamage.state = state.time < 17.8 ? 'hit' : 'damaged'; enemyArmor.visualDamage.smokeLevel = 0.55; enemyArmor.visualDamage.mobilityMultiplier = 0.35; enemyArmor.visualDamage.turretOperational = false; }
    }
  }
}

export function updateSandboxState(state, dt) {
  if (state.paused || state.ended || dt <= 0) return state;
  const previousTime = state.time;
  state.time = Math.min(SANDBOX_DURATION, state.time + dt);
  for (const unit of state.units) {
    const position = positionForUnit(unit, state.time);
    unit.x = position.x; unit.y = position.y; unit.angle = position.angle;
    unit.status = unitStatus(unit, state.time);
    unit.bob += dt * (unit.status === 'moving' ? 9 : 2);
    if (unit.side === 'enemy') {
      unit.alpha = revealAlphaForUnit(unit, state.time) * getRetreatAlpha(unit.id, state.time);
      if (previousTime < unit.revealStart && state.time >= unit.revealStart) state.effects.push({ kind: 'reveal_marker', x: unit.x, y: unit.y - 18, life: 0.9, maxLife: 0.9, size: 9, seed: state.rng() });
    }
    updateMemberPositions(unit, state.time);
    updateVisualCenter(unit);
    if (unit.id === 'f_tank_1' && state.time >= 30) unit.turretAngle = Math.atan2(405 - unit.y, 760 - unit.x);
    else if (unit.id === 'f_tank_1' && state.time >= 5.8) unit.turretAngle = Math.atan2(390 - unit.y, 875 - unit.x);
    else if (unit.id === 'f_tank_2' && state.time >= 28) unit.turretAngle = Math.atan2(240 - unit.y, 1040 - unit.x);
    else if (unit.id === 'f_tank_2' && state.time >= 20) unit.turretAngle = Math.atan2(390 - unit.y, 875 - unit.x);
    else if (unit.id === 'f_tank_2' && state.time >= 8.7) unit.turretAngle = Math.atan2(525 - unit.y, 875 - unit.x);
    else if (unit.id === 'e_armor_2' && unit.visualDamage?.state === 'disabled') unit.turretAngle = unit.angle - 0.45;
    else unit.turretAngle = unit.angle;
  }
  spawnAmbientDust(state, previousTime, state.time);
  spawnPulseEffects(state);
  spawnLateEvents(state);
  spawnWeldingEvents(state);
  updateVisualDamageStates(state);
  state.objective = getObjectiveStateAtTime(state.time);
  const repair = findUnit(state, 'f_repair_1'); if (repair) repair.repairArmPose = getRepairArmPose(state.time);
  while (state.nextPlanIndex < FIRE_PLAN.length && FIRE_PLAN[state.nextPlanIndex].t <= state.time) {
    const plan = FIRE_PLAN[state.nextPlanIndex];
    const effect = effectFromPlan(plan, state);
    if (effect) state.effects.push(effect);
    const source = findUnit(state, plan.source);
    const target = findUnit(state, plan.target);
    if (source && target && plan.type === 'enemy_armor_fire') state.effects.push({ kind: 'muzzle_flash', x: source.x, y: source.y, life: 0.28, maxLife: 0.28, size: 8, seed: state.rng() });
    if (plan.type === 'cannon_shell') state.effects.push({ kind: 'large_explosion', x: 875, y: 390, life: 0.8, maxLife: 0.8, size: 20, seed: state.rng() });
    if (plan.type === 'cannon_shell') { state.effects.push({ kind: 'muzzle_flash', x: source?.x || 620, y: source?.y || 405, life: 0.45, maxLife: 0.45, size: 18, seed: state.rng() }); state.effects.push({ kind: 'impact_spark', x: 875, y: 390, life: 0.7, maxLife: 0.7, size: 10, seed: state.rng() }); }
    if (plan.type === 'rocket') state.effects.push({ kind: 'rocket_smoke', x: 850, y: 430, life: 1.2, maxLife: 1.2, size: 10, seed: state.rng() });
    if (plan.type === 'rocket') state.effects.push({ kind: 'impact_spark', x: 620, y: 405, life: 0.8, maxLife: 0.8, size: 11, seed: state.rng() });
    state.nextPlanIndex += 1;
  }
  for (const effect of state.effects) updateEffect(effect, dt);
  state.effects = state.effects.filter((effect) => effect.life > 0);
  if (state.effects.length > MAX_EFFECTS) state.effects.splice(0, state.effects.length - MAX_EFFECTS);
  if (state.time >= SANDBOX_DURATION - TIME_EPSILON) { state.time = SANDBOX_DURATION; state.ended = true; state.paused = true; }
  return state;
}

export function synchronizeSandboxStateAtTime(state, time) {
  state.time = Math.max(0, Math.min(SANDBOX_DURATION, time));
  for (const unit of state.units) {
    const position = positionForUnit(unit, state.time);
    unit.x = position.x; unit.y = position.y; unit.angle = position.angle; unit.status = unitStatus(unit, state.time);
    if (unit.side === 'enemy') unit.alpha = revealAlphaForUnit(unit, state.time) * getRetreatAlpha(unit.id, state.time);
    updateMemberPositions(unit, state.time); updateVisualCenter(unit);
    if (unit.id === 'f_tank_1' && state.time >= 30) unit.turretAngle = Math.atan2(405 - unit.y, 760 - unit.x);
    else if (unit.id === 'f_tank_1' && state.time >= 5.8) unit.turretAngle = Math.atan2(390 - unit.y, 875 - unit.x);
    else if (unit.id === 'f_tank_2' && state.time >= 28) unit.turretAngle = Math.atan2(240 - unit.y, 1040 - unit.x);
    else if (unit.id === 'f_tank_2' && state.time >= 20) unit.turretAngle = Math.atan2(390 - unit.y, 875 - unit.x);
    else if (unit.id === 'f_tank_2' && state.time >= 8.7) unit.turretAngle = Math.atan2(525 - unit.y, 875 - unit.x);
    else if (unit.id === 'e_armor_2' && unit.visualDamage?.state === 'disabled') unit.turretAngle = unit.angle - 0.45;
    else unit.turretAngle = unit.angle;
  }
  updateVisualDamageStates(state);
  state.objective = getObjectiveStateAtTime(state.time);
  const repair = findUnit(state, 'f_repair_1'); if (repair) repair.repairArmPose = getRepairArmPose(state.time);
  return state;
}

export function activeFirePlans(time) {
  return FIRE_PLAN.filter((plan) => plan.duration ? time >= plan.t && time <= plan.t + plan.duration : time >= plan.t && time <= plan.t + 0.35);
}

export function buildTimelineSignature(seed = SANDBOX_SEED) {
  const state = createSandboxState(seed);
  const points = [0, 1, 2.5, 5, 7.4, 8.1, 8.5, 10];
  for (const time of points) updateSandboxState(state, time - state.time);
  return JSON.stringify({ seed, positions: state.units.map((unit) => [unit.id, Math.round(unit.x), Math.round(unit.y)]), plans: FIRE_PLAN.map((plan) => [plan.t, plan.type]) });
}
