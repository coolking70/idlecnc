/**
 * battle-visual-director.js
 *
 * 将不可变战报编排成确定性的 RTS 展示计划。这里没有 Canvas / DOM，也不
 * 改写 state 或 report；唯一能改变视觉生命值的事件是 DAMAGE / DESTROY。
 */
import { BATTLE_EVENT } from './battle.js';
import { createRng, clamp, safeNumber, deepClone } from './utils.js';

export const BATTLE_WORLD = Object.freeze({ width: 1200, height: 700 });

const AUTHORITY = new Set([BATTLE_EVENT.DAMAGE, BATTLE_EVENT.DESTROY]);
const PHASE_NAMES = ['scout', 'approach', 'engage', 'resolve'];

function num(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function point(x, y) {
  return { x: clamp(num(x), 20, BATTLE_WORLD.width - 20), y: clamp(num(y), 55, BATTLE_WORLD.height - 30) };
}

function terrainProps(terrain, rng) {
  const props = [];
  const add = (kind, count, spread = 1) => {
    for (let i = 0; i < count; i += 1) {
      const x = 80 + rng.range(0, 1040);
      const y = 130 + rng.range(0, 450);
      props.push({ id: `${kind}_${i}`, kind, x, y, scale: 0.75 + rng.range(0, 0.5) * spread, rotation: rng.range(-0.25, 0.25) });
    }
  };
  if (terrain === 'fortified') {
    add('bunker', 5, 0.6); add('sandbag', 12, 0.7); add('barrier', 7, 0.8); add('watchtower', 2, 0.4);
  } else if (terrain === 'road') {
    add('roadside', 8, 0.8); add('sign', 4, 0.5); add('pylon', 6, 0.5);
  } else {
    add('bush', 14, 1); add('rock', 9, 0.9); add('crater', 5, 0.8);
  }
  return props;
}

function laneY(index, side) {
  const lanes = [150, 240, 330, 430, 530, 610];
  const y = lanes[index % lanes.length] + (index % 2 ? 12 : -8);
  return side === 'friendly' ? y : BATTLE_WORLD.height - y + 20;
}

function routeFor(actor, index, terrain) {
  const side = actor.side === 'enemy' ? 'enemy' : 'friendly';
  const startX = side === 'friendly' ? 90 : 1110;
  const midX = side === 'friendly' ? 460 : 740;
  const targetX = side === 'friendly' ? 760 : 440;
  const y = laneY(index, side);
  const offset = ((index * 37) % 65) - 32;
  const bend = terrain === 'road' ? (index % 2 ? -18 : 18) : offset;
  return [point(startX, y), point(midX, y + bend), point(targetX, y - bend * 0.45), point(side === 'friendly' ? 880 : 320, y)];
}

function visualCategory(snapshot) {
  if (!snapshot) return 'infantry';
  if (snapshot.category === 'armor' || snapshot.shape === 'tank') return 'tank';
  if (snapshot.category === 'vehicle' || snapshot.shape === 'scout') return 'scout_car';
  if (snapshot.category === 'support' || snapshot.shape === 'repair') return 'repair';
  if (snapshot.category === 'at_infantry' || snapshot.shape === 'at') return 'at';
  return 'infantry';
}

function memberOffsets(category) {
  if (category === 'infantry') return [{ x: -13, y: -8 }, { x: 4, y: -11 }, { x: -5, y: 7 }, { x: 13, y: 5 }];
  if (category === 'at') return [{ x: -9, y: -6 }, { x: 8, y: -7 }, { x: 0, y: 8 }];
  return [{ x: 0, y: 0 }];
}

function makeIntervals(duration, index, category) {
  const stagger = Math.min(3.5, (index % 4) * 0.7);
  const scoutEnd = Math.max(4, duration * 0.18 + stagger);
  const approachEnd = Math.max(scoutEnd + 3, duration * 0.39 + stagger);
  const engageEnd = Math.max(approachEnd + 5, duration * 0.84);
  const firing = category === 'repair' ? 'supporting' : 'firing';
  return [
    { state: 'entering', start: 0, end: Math.min(scoutEnd * 0.45, 4) },
    { state: 'advancing', start: Math.min(scoutEnd * 0.45, 4), end: scoutEnd },
    { state: 'taking_cover', start: scoutEnd, end: approachEnd },
    { state: index % 3 === 0 ? firing : 'aiming', start: approachEnd, end: engageEnd },
    { state: 'holding', start: engageEnd, end: duration + 0.01 }
  ];
}

function eventTarget(events, actorId, type) {
  return (events || []).filter((event) => event && event.type === type && (event.actorId === actorId || event.targetId === actorId));
}

function makeActor(snapshot, index, report, rng) {
  const category = visualCategory(snapshot);
  const duration = Math.max(1, num(report.duration, 48));
  const route = routeFor(snapshot, index, report.terrain);
  const offsets = memberOffsets(category);
  const events = Array.isArray(report.events) ? report.events : [];
  const destroy = eventTarget(events, snapshot.id, BATTLE_EVENT.DESTROY)
    .find((event) => event.targetId === snapshot.id);
  return {
    id: snapshot.id,
    realId: snapshot.realId || null,
    side: snapshot.side === 'enemy' ? 'enemy' : 'friendly',
    name: snapshot.name || snapshot.callsign || snapshot.id,
    callsign: snapshot.callsign || null,
    type: snapshot.type || category,
    category,
    shape: snapshot.shape || category,
    maxHp: Math.max(1, num(snapshot.maxHp, 100)),
    initialHp: Math.max(0, num(snapshot.hp, snapshot.maxHp)),
    route,
    visualMembers: offsets.map((offset, memberIndex) => ({ id: `${snapshot.id}_member_${memberIndex}`, ...offset })),
    stateIntervals: makeIntervals(duration, index, category),
    destroyAt: destroy ? clamp(num(destroy.t, duration), 0, duration) : null,
    coverNodeId: `cover_${(index % 5) + 1}`,
    targetId: snapshot.side === 'enemy' ? 'friendly' : 'enemy',
    seedOffset: Math.floor(rng.range(0, 0x7fffffff)),
    visualOnly: true
  };
}

function buildPhases(report) {
  const duration = Math.max(1, num(report && report.duration, 48));
  const phaseEnds = [duration * 0.18, duration * 0.39, duration * 0.84, duration];
  return PHASE_NAMES.map((id, index) => ({ id, start: index ? phaseEnds[index - 1] : 0, end: phaseEnds[index] }));
}

function phaseAt(phases, elapsed) {
  return phases.find((phase) => elapsed < phase.end) || phases[phases.length - 1];
}

export function createBattleVisualPlan(report, options = {}) {
  const source = report || {};
  const seed = Math.max(0, Math.floor(num(source.seed, 1))) >>> 0;
  const rng = createRng(seed ^ 0x51f15e);
  const snapshots = [
    ...((source.initial && source.initial.friendly) || []),
    ...((source.initial && source.initial.enemy) || [])
  ].filter(Boolean);
  const phases = buildPhases(source);
  const actors = snapshots.map((snapshot, index) => makeActor(snapshot, index, source, rng));
  const events = ((source.events || [])
    .filter((event) => event && event.type)
    .map((event, index) => ({
      id: event.id || `event_${index}`,
      type: event.type,
      t: clamp(num(event.t, 0), 0, Math.max(1, num(source.duration, 48))),
      actorId: event.actorId || null,
      targetId: event.targetId || null,
      amount: Math.max(0, num(event.amount, 0)),
      text: event.text || ''
    })));
  const decorative = [];
  for (let i = 0; i < Math.max(10, actors.length * 3); i += 1) {
    const t = rng.range(2, Math.max(3, num(source.duration, 48) - 1));
    decorative.push({
      id: `decor_${i}`, type: i % 3 === 0 ? 'dust' : 'cover_hit', t,
      x: 260 + rng.range(0, 680), y: 130 + rng.range(0, 420),
      duration: 0.35 + rng.range(0, 0.75), visualOnly: true
    });
  }
  return {
    version: 1,
    seed,
    theaterId: source.theaterId || null,
    terrain: source.terrain || 'open',
    duration: Math.max(1, num(source.duration, 48)),
    width: BATTLE_WORLD.width,
    height: BATTLE_WORLD.height,
    phases,
    actors,
    map: { props: terrainProps(source.terrain || 'open', rng), coverNodes: [1, 2, 3, 4, 5].map((id) => ({ id: `cover_${id}`, x: 210 + id * 170, y: id % 2 ? 245 : 470, radius: 34 })) },
    authoritativeEvents: events.filter((event) => AUTHORITY.has(event.type)),
    events,
    decorative,
    objective: { x: 600, y: 350, radius: source.terrain === 'fortified' ? 110 : 78, label: source.terrain === 'fortified' ? '防御阵地' : '战术目标' }
  };
}

function routePosition(route, progress) {
  const p = clamp(progress, 0, 1) * (route.length - 1);
  const index = Math.min(route.length - 2, Math.floor(p));
  const local = p - index;
  const a = route[index]; const b = route[index + 1];
  return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
}

function hpAt(plan, actor, elapsed) {
  let hp = actor.initialHp;
  let alive = true;
  plan.authoritativeEvents.forEach((event) => {
    if (event.t > elapsed) return;
    if (event.targetId !== actor.id) return;
    if (event.type === BATTLE_EVENT.DAMAGE) hp = Math.max(0, hp - event.amount);
    if (event.type === BATTLE_EVENT.DESTROY) { hp = 0; alive = false; }
  });
  return { hp, alive: alive && hp > 0 };
}

export function getVisualActorsAtTime(plan, elapsed, options = {}) {
  if (!plan) return [];
  const battleElapsed = clamp(num(elapsed, 0), 0, plan.duration);
  const returning = options.presentationPhase === 'returning';
  const returnProgress = returning ? clamp(num(options.returnElapsed, 0) / Math.max(0.1, num(options.returnDuration, 5)), 0, 1) : 0;
  return plan.actors.map((actor) => {
    const moveProgress = returning ? 0.82 + returnProgress * 0.18 : clamp(battleElapsed / Math.max(1, plan.duration * 0.92), 0, 1);
    const position = routePosition(actor.route, moveProgress);
    const hpState = hpAt(plan, actor, battleElapsed);
    const interval = actor.stateIntervals.find((item) => battleElapsed >= item.start && battleElapsed < item.end) || actor.stateIntervals.at(-1);
    const state = returning ? 'retreating' : (hpState.alive ? interval.state : 'destroyed');
    const facing = actor.side === 'friendly' ? 1 : -1;
    return { ...actor, x: position.x, y: position.y, hp: hpState.hp, alive: hpState.alive, state, facing, returning, moveProgress, visualMembers: actor.visualMembers.map((member) => ({ ...member, x: position.x + member.x * facing, y: position.y + member.y })) };
  });
}

export function getVisualEffectsAtTime(plan, elapsed) {
  if (!plan) return [];
  const t = num(elapsed, 0);
  const authoritative = plan.events.filter((event) => event.t <= t && [BATTLE_EVENT.FIRE, BATTLE_EVENT.DAMAGE, BATTLE_EVENT.DESTROY, BATTLE_EVENT.REPAIR].includes(event.type));
  const decorative = plan.decorative.filter((event) => t >= event.t && t <= event.t + event.duration);
  return [...authoritative.map((event) => ({ ...event, authoritative: AUTHORITY.has(event.type) })), ...decorative.map((event) => ({ ...event, authoritative: false }))];
}

export function getVisualPhaseAtTime(plan, elapsed) {
  return phaseAt(plan ? plan.phases : [], num(elapsed, 0));
}

export function validateVisualPlan(plan) {
  const problems = [];
  if (!plan || plan.width !== BATTLE_WORLD.width || plan.height !== BATTLE_WORLD.height) problems.push('world size must be 1200x700');
  const ids = new Set();
  (plan && plan.actors || []).forEach((actor) => {
    if (ids.has(actor.id)) problems.push(`duplicate actor: ${actor.id}`);
    ids.add(actor.id);
    if (!Array.isArray(actor.route) || actor.route.length < 3) problems.push(`route missing: ${actor.id}`);
    if (!Array.isArray(actor.visualMembers) || actor.visualMembers.length < 1) problems.push(`members missing: ${actor.id}`);
  });
  if ((plan && plan.actors || []).length > 1) {
    const ys = new Set(plan.actors.map((actor) => Math.round(actor.route[0].y)));
    if (ys.size < Math.min(3, plan.actors.length)) problems.push('actors collapsed into one lane');
  }
  if ((plan && plan.events || []).some((event) => event.type === BATTLE_EVENT.ROUND)) problems.push('round is not a presentation phase');
  return { ok: problems.length === 0, problems };
}

export const BATTLE_VISUAL_API = {
  BATTLE_WORLD, createBattleVisualPlan, getVisualActorsAtTime, getVisualEffectsAtTime,
  getVisualPhaseAtTime, validateVisualPlan
};

