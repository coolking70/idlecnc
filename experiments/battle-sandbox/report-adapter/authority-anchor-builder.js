const REQUIRED = new Set(['damage', 'suppress', 'repair', 'destroy', 'retreat', 'result']);

export function buildAuthorityAnchors(normalized, roleBinding = { actorRoles: {} }) {
  return (normalized?.events || []).map((event, index) => {
    const actorRoles = roleBinding.actorRoles?.[event.actorId] || [];
    const targetRoles = roleBinding.actorRoles?.[event.targetId] || [];
    return {
      id: `anchor_${String(index + 1).padStart(4, '0')}`,
      sourceEventId: event.id,
      sourceEventIds: [event.id],
      type: event.type,
      authorityType: ['reveal', 'ambush'].includes(event.type) ? 'scout' : event.type,
      reportTime: event.time,
      actorId: event.actorId,
      targetId: event.targetId,
      value: event.value,
      actorRole: actorRoles[0] || null,
      targetRole: targetRoles[0] || null,
      required: REQUIRED.has(event.type),
      fallbackPolicy: event.type === 'result' ? 'outcome-banner' : 'event-log'
    };
  });
}

