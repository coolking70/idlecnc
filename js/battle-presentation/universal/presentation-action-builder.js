const NON_AUTHORITY = 'presentation_only_non_authority';

function action(id, type, t, props = {}) { return { id, type, t, authority: false, source: NON_AUTHORITY, ...props }; }

export function buildPresentationActions(intent, forces, assignments, timeline, routes) {
  const actions = [];
  actions.push(action('action_deploy', 'deploy', 0, { actorIds: assignments.map((item) => item.actorId), groups: assignments.map((item) => item.groupId) }));
  if (forces.friendly.some((row) => row.tags.includes('scout'))) actions.push(action('action_screen', 'screen', timeline.duration * 0.08, { actorIds: forces.friendly.filter((row) => row.tags.includes('scout')).map((row) => row.actorId) }));
  actions.push(action('action_advance', 'advance', timeline.duration * 0.18, { actorIds: assignments.filter((item) => item.side === 'friendly' && !item.reserve).map((item) => item.actorId), routeIds: routes.filter((route) => route.side === 'friendly').map((route) => route.routeId) }));
  const coverZone = intent.terrain === 'fortified' ? 'outer_contact_band' : intent.terrain === 'road' ? 'road_checkpoint' : 'friendly_center_approach';
  actions.push(action('action_take_cover', 'take_cover', timeline.duration * 0.24, { zoneId: coverZone, actorIds: assignments.filter((item) => item.side === 'friendly' && !item.reserve).map((item) => item.actorId) }));
  actions.push(action('action_establish_fire_line', 'establish_fire_line', timeline.duration * 0.34, { actorIds: assignments.filter((item) => item.side === 'friendly' && item.reserve !== true).map((item) => item.actorId), routeIds: routes.filter((route) => route.side === 'friendly' && route.tactical?.firing).map((route) => route.routeId) }));
  if (forces.friendly.some((row) => row.tags.includes('repair'))) actions.push(action('action_repair_approach', 'repair_approach', timeline.duration * 0.48, { actorIds: forces.friendly.filter((row) => row.tags.includes('repair')).map((row) => row.actorId) }));
  if (intent.mission.convoy) actions.push(action('action_convoy', 'escort_convoy', timeline.duration * 0.52, { convoy: { id: 'convoy_scene_object', routeId: routes.find((route) => route.side === 'friendly')?.routeId || null }, actorIds: assignments.filter((item) => item.side === 'friendly').map((item) => item.actorId) }));
  if (intent.outcome.id === 'withdraw') actions.push(action('action_disengage', 'disengage', timeline.duration * 0.72, { actorIds: assignments.filter((item) => item.side === 'friendly').map((item) => item.actorId), retreatRoutes: routes.filter((route) => route.retreat).map((route) => route.routeId) }));
  for (const anchor of timeline.anchors) {
    actions.push({ id: `authority_${anchor.id}`, type: anchor.type, t: anchor.t, authority: true, source: 'formal_report_event', sourceEventId: anchor.sourceEventId, actorId: anchor.actorId, targetId: anchor.targetId, value: anchor.value, required: anchor.required === true, phase: anchor.phase });
  }
  return actions.sort((a, b) => a.t - b.t || Number(a.authority) - Number(b.authority) || a.id.localeCompare(b.id));
}
