/** Semantic battle phase resolver. Boundaries come from actions and authority events. */
const COMBAT = new Set(['fire', 'damage', 'destroy', 'repair', 'retreat']);
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

function times(plan, predicate) {
  return (plan?.timeline?.anchors || []).filter(predicate).map((item) => Number(item.t)).filter(Number.isFinite).sort((a, b) => a - b);
}

function firstAction(plan, names) {
  return (plan?.timeline?.actions || []).filter((item) => names.has(item.type)).map((item) => Number(item.t)).filter(Number.isFinite).sort((a, b) => a - b)[0];
}

export function deriveBattlePhases(plan) {
  const duration = Math.max(1, Number(plan?.timeline?.duration) || 30);
  const combat = times(plan, (anchor) => COMBAT.has(anchor.type));
  const fires = times(plan, (anchor) => anchor.type === 'fire');
  const damage = times(plan, (anchor) => anchor.type === 'damage');
  const destruction = times(plan, (anchor) => anchor.type === 'destroy');
  const deployEnd = clamp(firstAction(plan, new Set(['advance', 'screen', 'take_cover', 'repair_approach'])) ?? (combat[0] ?? Math.min(duration, 1.25)), 0, duration);
  const firstContact = fires[0] ?? damage[0] ?? combat[0] ?? deployEnd;
  // First contact is the opening exchange, not a single frame: keep the
  // first few authoritative hits in this phase so it remains observable on
  // direct seeks and on slow evidence captures.
  const openingExchangeEnd = damage[Math.min(2, Math.max(0, damage.length - 1))] ?? fires[Math.min(2, Math.max(0, fires.length - 1))] ?? firstContact;
  const contactEnd = Math.max(firstContact, openingExchangeEnd);
  const criticalEvent = destruction.at(-1) ?? (damage.length > 1 ? damage.at(-1) : undefined);
  const battleEndAnchor = times(plan, (anchor) => anchor.type === 'result' || anchor.type === 'retreat').at(-1);
  const end = clamp(battleEndAnchor ?? duration, 0, duration);
  const mainStart = clamp(Math.max(contactEnd, firstContact + (damage[0] !== undefined ? 0.01 : 0.8)), 0, end);
  const criticalStart = criticalEvent === undefined ? end : clamp(criticalEvent, mainStart, end);
  const boundaries = [
    { id: 'deploy', start: 0, end: deployEnd, authority: 'formation_entry' },
    { id: 'approach', start: deployEnd, end: firstContact, authority: 'route_progress' },
    { id: 'first_contact', start: firstContact, end: mainStart, authority: 'first_fire_or_damage' },
    { id: 'main_engagement', start: mainStart, end: criticalStart, authority: 'combat_exchange' },
    { id: 'critical_event', start: criticalStart, end, authority: criticalEvent === undefined ? 'result_boundary' : 'damage_or_destroy' },
    { id: 'battle_end', start: end, end: duration, authority: 'result_or_duration' }
  ];
  return boundaries.map((phase) => ({ ...phase, start: Number(phase.start.toFixed(3)), end: Number(Math.max(phase.start, phase.end).toFixed(3)), duration: Number(Math.max(0, phase.end - phase.start).toFixed(3)) }));
}

export function resolveBattlePhase(plan, seconds) {
  const phases = deriveBattlePhases(plan);
  const time = clamp(seconds, 0, Number(plan?.timeline?.duration) || 30);
  return phases.find((phase) => time >= phase.start && (time < phase.end || phase.id === 'battle_end')) || phases.at(-1);
}
