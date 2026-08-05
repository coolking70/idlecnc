function actorPoint(actor) { return actor?.visualCenter || actor?.anchorPosition || { x: 0, y: 0 }; }
const PROJECTILE_DURATIONS = Object.freeze({ rifle: .18, light_tracer: .22, coax: .24, cannon: .36, rocket: .58 });
const PROJECTILE_SEGMENTS = Object.freeze({ rifle: 22, light_tracer: 28, coax: 34, cannon: 28, rocket: 22 });

export function damageVisualSeverity(anchor, targetActor) {
  const ratio = targetActor?.maxHp ? anchor.value / targetActor.maxHp : 0;
  return ratio < 0.08 ? 'light' : ratio < 0.2 ? 'impact' : ratio < 0.35 ? 'heavy' : 'severe';
}

export function pairFireAndDamageAnchors(anchors) {
  const pairs = []; const usedDamage = new Set();
  for (const fire of anchors.filter((anchor) => anchor.type === 'fire')) {
    const damage = anchors.find((anchor) => anchor.type === 'damage' && !usedDamage.has(anchor.id) && anchor.sourceIndex > fire.sourceIndex && anchor.sourceIndex <= fire.sourceIndex + 2 && anchor.actorId === fire.actorId && anchor.targetId === fire.targetId);
    if (damage) { usedDamage.add(damage.id); pairs.push({ fireSourceEventId: fire.sourceEventId, damageSourceEventId: damage.sourceEventId, fireAnchorId: fire.id, damageAnchorId: damage.id }); }
  }
  return { pairs, unpairedFireAnchorIds: anchors.filter((a) => a.type === 'fire' && !pairs.some((p) => p.fireAnchorId === a.id)).map((a) => a.id), unpairedDamageAnchorIds: anchors.filter((a) => a.type === 'damage' && !usedDamage.has(a.id)).map((a) => a.id) };
}

export function buildAuthorityEffects(plan, time, activeChoreography = null) {
  const effects = [];
  const actors = plan.actorById;
  for (const anchor of plan.anchors) {
    const age = time - anchor.presentationTime;
    if (age < 0) continue;
    const source = anchor.launchPosition || anchor.sourcePosition || actorPoint(actors[anchor.actorId]); const target = anchor.impactPosition || anchor.targetPosition || actorPoint(actors[anchor.targetId]);
    if (anchor.type === 'fire') {
      const kind = anchor.weaponKind || 'rifle'; const duration = PROJECTILE_DURATIONS[kind] || .18;
      if (age <= duration) effects.push({ kind, source: anchor.actorId, target: anchor.targetId, start: source, end: target, control: anchor.controlPoint || (kind === 'rocket' ? { x: (source.x + target.x) / 2, y: Math.min(source.y, target.y) - 55 } : null), launchTime: anchor.presentationTime, duration, segmentLength: PROJECTILE_SEGMENTS[kind] || 22, life: duration - age, maxLife: duration, anchorId: anchor.id });
    }
    if (anchor.type === 'damage' && age <= 1.15) effects.push({ kind: anchor.visualKind || 'impact', x: target.x, y: target.y, size: anchor.severity === 'severe' ? 22 : anchor.severity === 'heavy' ? 15 : 10, life: 1.15 - age, maxLife: 1.15, anchorId: anchor.id });
    if (anchor.type === 'repair' && plan.repairGroups) {
      const choreography = plan.repairGroups.find((group) => group.anchors.some((repair) => repair.id === anchor.id));
      const contact = activeChoreography?.targetId === anchor.targetId ? activeChoreography.contactPoint : { x: target.x, y: target.y };
      if (age >= 0 && age <= .7) effects.push({ kind: 'welding', x: contact.x, y: contact.y, size: 14, life: .7 - age, maxLife: .7, anchorId: anchor.id });
    }
    if (anchor.type === 'destroy' && age <= 1.15) effects.push({ kind: 'destruction', x: target.x, y: target.y, size: 34, life: 1.15 - age, maxLife: 1.15, anchorId: anchor.id });
  }
  return effects;
}

export { PROJECTILE_DURATIONS, PROJECTILE_SEGMENTS };
