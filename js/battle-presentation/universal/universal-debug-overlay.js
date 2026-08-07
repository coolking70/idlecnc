/** Debug-only world layer. It consumes the same immutable plan/state as the production renderer. */

const TAU = Math.PI * 2;
function worldPoint(point, bounds) { return { x: (Number(point?.x) || 0) * 1280 / Math.max(1, Number(bounds?.width) || 1200), y: (Number(point?.y) || 0) * 720 / Math.max(1, Number(bounds?.height) || 700) }; }
function line(context, points) { if (!points.length) return; context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.stroke(); }

export const DEFAULT_DEBUG_OVERLAY_OPTIONS = Object.freeze({
  debugOverlay: false, showGrid: true, showRoutes: false, showZones: false, showCollisionShapes: false, showActorIds: false, showEventAnchors: false, showEngagements: true, showTargetScores: false, showSuppression: true, showRetreatOrder: true, showCameraInterest: true
});

export function normalizeDebugOverlayOptions(options = {}) {
  const debug = options.debugOverlay === true || options.debug === true;
  return {
    ...DEFAULT_DEBUG_OVERLAY_OPTIONS,
    ...options,
    debugOverlay: debug,
    showGrid: debug && options.showGrid !== false,
    showRoutes: debug && options.showRoutes !== false,
    showZones: debug && options.showZones !== false,
    showCollisionShapes: debug && options.showCollisionShapes === true,
    showActorIds: debug && options.showActorIds !== false,
    showEventAnchors: debug && options.showEventAnchors !== false,
    showEngagements: debug && options.showEngagements !== false,
    showTargetScores: debug && options.showTargetScores === true,
    showSuppression: debug && options.showSuppression !== false,
    showRetreatOrder: debug && options.showRetreatOrder !== false,
    showCameraInterest: debug && options.showCameraInterest !== false
  };
}

export function drawUniversalDebugOverlay(context, plan, state, options = {}) {
  const settings = normalizeDebugOverlayOptions(options); if (!settings.debugOverlay) return false;
  const bounds = plan.layout?.bounds || { width: 1200, height: 700 };
  context.save();
  if (settings.showGrid) {
    context.globalAlpha = .72; context.strokeStyle = 'rgba(221,232,197,.26)'; context.lineWidth = 1;
    for (let x = 0; x <= 1280; x += 64) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, 720); context.stroke(); }
    for (let y = 0; y <= 720; y += 64) { context.beginPath(); context.moveTo(0, y); context.lineTo(1280, y); context.stroke(); }
    context.globalAlpha = 1;
  }
  if (settings.showZones) {
    for (const zone of plan.layout?.zones || []) {
      const points = (zone.polygon || []).map((point) => worldPoint(point, bounds)); if (!points.length) continue;
      context.beginPath(); points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath();
      context.fillStyle = zone.side === 'friendly' ? 'rgba(80,210,150,.10)' : zone.side === 'enemy' ? 'rgba(230,100,100,.10)' : 'rgba(240,205,110,.10)'; context.fill();
      context.strokeStyle = '#e9d27e'; context.lineWidth = 1.3; context.stroke(); context.fillStyle = '#f0d895'; context.font = '10px ui-monospace, monospace'; context.fillText(zone.id || zone.kind || 'zone', worldPoint(zone.center, bounds).x - 24, worldPoint(zone.center, bounds).y);
    }
  }
  if (settings.showRoutes) {
    for (const route of plan.layout?.routes || []) {
      context.strokeStyle = route.side === 'friendly' ? 'rgba(130,235,190,.82)' : 'rgba(240,135,125,.82)'; context.lineWidth = 2; context.setLineDash([7, 5]); line(context, (route.points || []).map((point) => worldPoint(point, bounds))); context.setLineDash([]);
      const start = route.points?.[0]; if (start) { const p = worldPoint(start, bounds); context.fillStyle = context.strokeStyle; context.beginPath(); context.arc(p.x, p.y, 3, 0, TAU); context.fill(); }
    }
  }
  if (settings.showCollisionShapes) {
    context.strokeStyle = 'rgba(255,115,100,.75)'; context.lineWidth = 1; context.setLineDash([3, 3]);
    for (const entity of plan.spatialEntities || []) {
      if (!entity.footprint || !entity.position) continue; const p = worldPoint(entity.position, bounds); const radius = Number(entity.footprint.radius) || 10; context.beginPath(); context.arc(p.x, p.y, radius * 1280 / Math.max(1, Number(bounds.width) || 1200), 0, TAU); context.stroke();
    }
    context.setLineDash([]);
  }
  if (settings.showEventAnchors) {
    for (const anchor of state.activeAnchors || []) {
      const actor = state.actors.find((item) => item.id === anchor.actorId); const target = state.actors.find((item) => item.id === anchor.targetId); if (!actor && !target) continue;
      const point = worldPoint((target || actor).visualCenter, bounds); context.fillStyle = anchor.authority ? '#f8e295' : '#d7a7e9'; context.beginPath(); context.arc(point.x, point.y, 7, 0, TAU); context.fill(); context.fillStyle = '#1c241f'; context.font = '700 9px ui-monospace, monospace'; context.fillText(anchor.type || 'event', point.x + 9, point.y - 8);
    }
  }
  if (settings.showEngagements) {
    for (const assignment of state.choreography?.activeAssignments || []) {
      const attacker = state.actors?.find((actor) => actor.id === assignment.actorId); const target = state.actors?.find((actor) => actor.id === assignment.targetId); if (!attacker || !target) continue;
      const a = worldPoint(attacker.visualCenter, bounds); const b = worldPoint(target.visualCenter, bounds); context.strokeStyle = '#d6a8ee'; context.globalAlpha = .74; context.lineWidth = 1.6; context.setLineDash([3, 4]); context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke(); context.setLineDash([]); context.globalAlpha = 1; context.fillStyle = '#ead1f7'; context.font = '9px ui-monospace, monospace'; context.fillText(`${assignment.actorId} → ${assignment.targetId}  ${assignment.reason || ''}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 5);
    }
  }
  if (settings.showSuppression) {
    for (const window of state.choreography?.activeSuppression || []) { const center = worldPoint(window.area?.center, bounds); context.fillStyle = 'rgba(230,185,104,.12)'; context.strokeStyle = 'rgba(248,204,116,.86)'; context.lineWidth = 1.5; context.beginPath(); context.arc(center.x, center.y, Number(window.area?.radius || 50) * 1280 / Math.max(1, Number(bounds.width) || 1200), 0, TAU); context.fill(); context.stroke(); context.fillStyle = '#f6d88d'; context.font = '10px ui-monospace, monospace'; context.fillText(`SUPPRESS ${window.purpose}`, center.x + 8, center.y - 8); }
  }
  if (settings.showRetreatOrder) {
    for (const order of state.choreography?.activeRetreats || []) { const actor = state.actors?.find((item) => item.id === order.actorId); if (!actor) continue; const from = worldPoint(actor.visualCenter, bounds); const to = worldPoint(order.exit, bounds); context.strokeStyle = order.coverFire ? '#f3bb88' : '#a9e7ca'; context.lineWidth = 2; context.setLineDash([8, 4]); context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.stroke(); context.setLineDash([]); context.fillStyle = context.strokeStyle; context.font = '10px ui-monospace, monospace'; context.fillText(`${order.role}`, from.x + 8, from.y + 18); }
  }
  if (settings.showCameraInterest && state.camera?.interestId) { context.fillStyle = '#ffe5a1'; context.font = '11px ui-monospace, monospace'; context.fillText(`CAMERA ${state.camera.interestId} · ${state.camera.interestReason || ''}`, 18, 20); }
  if (settings.showActorIds) {
    context.font = '10px ui-monospace, monospace';
    for (const actor of state.actors || []) { const p = worldPoint(actor.visualCenter, bounds); context.fillStyle = actor.side === 'friendly' ? '#a8f0ce' : '#ffb1a3'; context.fillText(`${actor.id} · ${actor.visualState || actor.currentAction || 'idle'}`, p.x - 34, p.y - 27); }
  }
  context.restore(); return true;
}
