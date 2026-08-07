const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const COMBAT_ANCHOR_TYPES = new Set(['fire', 'damage', 'suppress', 'repair', 'destroy']);

function phaseFor(type, ratio) {
  if (type === 'result') return 'resolve';
  if (['reveal', 'ambush'].includes(type) || ratio < 0.16) return 'scout';
  if (['move', 'phase'].includes(type) || ratio < 0.34) return 'deploy';
  if (['fire', 'damage', 'suppress', 'repair', 'destroy'].includes(type) || ratio < 0.82) return 'contact';
  return 'resolve';
}

export function mapUniversalTime(normalized, intent, authorityAnchors = []) {
  const sourceDuration = Number(normalized?.battle?.duration) || 30;
  const desired = clamp(30 + (intent.forceCounts.total * 0.32), 30, 45);
  const duration = Math.max(1, Math.min(sourceDuration, desired));
  const events = normalized?.events || [];
  const firstCombatIndex = events.findIndex((event) => COMBAT_ANCHOR_TYPES.has(event.type));
  const lastCombatIndex = events.reduce((last, event, index) => COMBAT_ANCHOR_TYPES.has(event.type) ? index : last, -1);
  const firstCombatTime = firstCombatIndex >= 0 ? Number(events[firstCombatIndex]?.time) || 0 : null;
  const lastCombatTime = lastCombatIndex >= 0 ? Number(events[lastCombatIndex]?.time) || firstCombatTime : null;
  // The report remains authoritative, but a report can contain its first
  // fire event almost immediately.  A direct source-ratio mapping would then
  // render both forces firing from their deployment lines.  Reserve a real
  // approach/cover lead-in and remap only the presentation clock; source
  // timestamps stay on every anchor for auditability.
  const tacticalLeadIn = firstCombatIndex >= 0 ? 0.40 : null;
  const tacticalContactEnd = firstCombatIndex >= 0 ? 0.86 : null;
  const sourceRatio = (event) => sourceDuration > 0 ? (Number(event?.time) || 0) / sourceDuration : 0;
  const indexRatio = (index, start, end) => index <= start ? 0 : index >= end ? 1 : (index - start) / Math.max(1, end - start);
  const presentationRatio = (event, index) => {
    if (firstCombatIndex < 0) return clamp(sourceRatio(event), 0, 1);
    if (event.type === 'result') return 1;
    if (index < firstCombatIndex) {
      const preRatio = firstCombatTime > 0
        ? (Number(event.time) || 0) / firstCombatTime
        : indexRatio(index, 0, firstCombatIndex);
      return clamp(preRatio * tacticalLeadIn, 0, tacticalLeadIn);
    }
    if (index <= lastCombatIndex) {
      const contactRatio = lastCombatTime > firstCombatTime
        ? ((Number(event.time) || firstCombatTime) - firstCombatTime) / (lastCombatTime - firstCombatTime)
        : indexRatio(index, firstCombatIndex, lastCombatIndex);
      return clamp(tacticalLeadIn + contactRatio * (tacticalContactEnd - tacticalLeadIn), tacticalLeadIn, tacticalContactEnd);
    }
    return tacticalContactEnd;
  };
  let previous = 0;
  const anchors = events.map((event, index) => {
    const authority = authorityAnchors[index] || {};
    const rawRatio = sourceDuration > 0 ? event.time / sourceDuration : index / Math.max(events.length - 1, 1);
    const mapped = Math.max(previous, Math.min(duration, presentationRatio(event, index) * duration));
    previous = mapped;
    return { id: authority.id || `anchor_${String(index + 1).padStart(4, '0')}`, index, sourceEventId: authority.sourceEventId || event.id, type: authority.type || event.type, t: mapped, reportTime: event.time, actorId: authority.actorId ?? event.actorId, targetId: authority.targetId ?? event.targetId, value: authority.value ?? event.value, required: authority.required === true, phase: phaseFor(event.type, rawRatio), authority: true };
  });
  if (anchors.length && anchors.at(-1).type === 'result') anchors[anchors.length - 1].t = duration;
  const phaseNames = ['scout', 'deploy', 'contact', 'resolve'];
  const phases = phaseNames.map((id, index) => ({ id, start: index === 0 ? 0 : duration * [0, 0.14, 0.36, 0.88][index], end: index === 3 ? duration : duration * [0.14, 0.36, 0.88, 1][index], source: 'universal_time_mapping' }));
  const firstOf = (types) => events.find((event) => types.includes(event.type))?.time ?? null; const lastOf = (types) => events.filter((event) => types.includes(event.type)).at(-1)?.time ?? null;
  return { duration, sourceDuration, phases, anchors, milestones: { sourceStart: events[0]?.time ?? 0, firstReveal: firstOf(['reveal']), firstContact: firstOf(['ambush', 'fire', 'damage']), firstDamage: firstOf(['damage']), firstDestroy: firstOf(['destroy']), midCombat: firstOf(['suppress', 'repair', 'damage']), lastFriendlyLoss: lastOf(['destroy']), lastEnemyLoss: lastOf(['destroy']), retreat: firstOf(['retreat']), result: events.at(-1)?.time ?? null }, metrics: { anchorCount: anchors.length, monotonic: anchors.every((item, index) => index === 0 || item.t >= anchors[index - 1].t), tacticalLeadIn: tacticalLeadIn === null ? null : tacticalLeadIn * duration, combatRemapped: firstCombatIndex >= 0 } };
}
