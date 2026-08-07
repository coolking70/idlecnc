const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export const UNIVERSAL_CAMERA_MODES = Object.freeze(['overview', 'focus', 'impact', 'result']);

function mapPoint(point, bounds) {
  const width = Math.max(1, Number(bounds?.width) || 1200);
  const height = Math.max(1, Number(bounds?.height) || 700);
  return { x: (Number(point?.x) || 0) * 1280 / width, y: (Number(point?.y) || 0) * 720 / height };
}

function center(points, fallback = { x: 640, y: 360 }) {
  const valid = points.filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (!valid.length) return fallback;
  return valid.reduce((sum, point) => ({ x: sum.x + point.x / valid.length, y: sum.y + point.y / valid.length }), { x: 0, y: 0 });
}

function activeEffectPoints(state) {
  return (state?.effects || []).filter((effect) => ['impact', 'destruction', 'muzzle', 'welding'].includes(effect.kind)).map((effect) => ({ x: effect.x, y: effect.y }));
}

function targetPoints(state) {
  const ids = new Set((state?.activeAnchors || []).flatMap((anchor) => [anchor.actorId, anchor.targetId]).filter(Boolean));
  return (state?.actors || []).filter((actor) => ids.has(actor.id)).map((actor) => actor.visualCenter);
}

export function clampUniversalCamera(camera) {
  const zoom = clamp(camera.zoom, .76, 1.45); const halfWidth = 640 / zoom; const halfHeight = 360 / zoom;
  const x = halfWidth >= 640 ? 640 : clamp(camera.x, halfWidth, 1280 - halfWidth);
  const y = halfHeight >= 360 ? 360 : clamp(camera.y, halfHeight, 720 - halfHeight);
  return { x, y, zoom };
}

function fitZoom(points, maximum = .94, padding = 72) {
  if (!points.length) return maximum;
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  const width = Math.max(1, Math.max(...xs) - Math.min(...xs)); const height = Math.max(1, Math.max(...ys) - Math.min(...ys));
  return Math.max(.76, Math.min(maximum, (1280 - padding * 2) / width, (720 - padding * 2) / height));
}

export function resolveUniversalCamera(plan, state, requestedMode = 'overview', autoCamera = true, cameraOverride = null) {
  const mode = UNIVERSAL_CAMERA_MODES.includes(requestedMode) ? requestedMode : 'overview';
  const allActors = (state?.actors || []).filter((actor) => actor.alive).map((actor) => mapPoint(actor.visualCenter, plan?.layout?.bounds));
  const effects = activeEffectPoints(state).map((point) => mapPoint(point, plan?.layout?.bounds));
  const targets = targetPoints(state).map((point) => mapPoint(point, plan?.layout?.bounds));
  const objective = plan?.layout?.zones?.find((zone) => zone.objectiveRole || zone.kind === 'objective');
  const objectivePoint = objective?.center ? mapPoint(objective.center, plan?.layout?.bounds) : { x: 960, y: 360 };
  let point = { x: 640, y: 360 }; let zoom = .86; let label = '全局态势';
  if (mode === 'focus') { point = center(targets.length ? targets : allActors, objectivePoint); zoom = 1.12; label = '接敌焦点'; }
  if (mode === 'impact') { point = center(effects.length ? effects : targets, objectivePoint); zoom = 1.28; label = '动作焦点'; }
  if (mode === 'result') { point = center([...allActors, objectivePoint], objectivePoint); zoom = 1.02; label = '结局编舞'; }
  if (mode === 'overview') label = '全局态势';
  if (autoCamera && mode === 'overview') {
    const ratio = Number(state?.time || 0) / Math.max(1, Number(plan?.timeline?.duration) || 30);
    const wholeBattle = [...allActors, objectivePoint];
    if (state?.returning || ratio >= .84) { point = center(wholeBattle, objectivePoint); zoom = fitZoom(wholeBattle, .98, 24); label = '结局编舞'; }
    else if (effects.length) { point = center(wholeBattle, objectivePoint); zoom = fitZoom(wholeBattle, .98, 24); label = '接敌态势'; }
    else if (ratio >= .18) { point = center(wholeBattle, objectivePoint); zoom = fitZoom(wholeBattle, .98, 24); label = '编队态势'; }
    else { point = { x: 640, y: 360 }; zoom = .96; label = '开局总览'; }
  }
  const resolved = clampUniversalCamera({ x: point.x, y: point.y, zoom });
  if (cameraOverride && Number.isFinite(Number(cameraOverride.x)) && Number.isFinite(Number(cameraOverride.y))) {
    return { ...clampUniversalCamera({ ...resolved, ...cameraOverride }), mode, auto: false, manual: true, label: '手动观察' };
  }
  return { ...resolved, mode, auto: autoCamera === true, manual: false, label };
}

export function cameraModeLabel(mode) {
  return { overview: '全局态势', focus: '接敌焦点', impact: '动作焦点', result: '结局编舞' }[mode] || '全局态势';
}
