const KEYFRAMES = Object.freeze([
  [0, 560, 420, .9], [5, 650, 420, 1.02], [9, 730, 380, 1.1], [15, 590, 430, 1.05], [21, 600, 430, 1.08], [25, 735, 410, 1.06], [30, 790, 420, 1.02], [35, 720, 410, .95]
]);
function mix(a, b, p) { return a + (b - a) * p; }
export function contractCameraAt(time) {
  const safe = Math.max(0, Math.min(35, time)); let index = KEYFRAMES.length - 2;
  for (let i = 1; i < KEYFRAMES.length; i += 1) if (safe <= KEYFRAMES[i][0]) { index = i - 1; break; }
  const a = KEYFRAMES[index]; const b = KEYFRAMES[index + 1]; const p = Math.max(0, Math.min(1, (safe - a[0]) / Math.max(.001, b[0] - a[0]))); const eased = p * p * (3 - 2 * p);
  return { x: mix(a[1], b[1], eased), y: mix(a[2], b[2], eased), zoom: mix(a[3], b[3], eased) };
}
export function finalStatusCamera(state) {
  const points = [...(state.actors || []).filter((actor) => actor.side === 'friendly' && actor.alive).map((actor) => actor.visualCenter), ...(state.wrecks || []).map((wreck) => ({ x: wreck.x, y: wreck.y }))];
  if (!points.length) return contractCameraAt(35);
  const center = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
  return { x: Math.max(430, Math.min(850, center.x)), y: Math.max(300, Math.min(500, center.y)), zoom: 1.08 };
}
export function clampContractCamera(camera) {
  const zoom = Math.max(.76, Math.min(1.45, Number(camera?.zoom) || .86)); const halfWidth = 640 / zoom; const halfHeight = 360 / zoom;
  const x = halfWidth >= 640 ? 640 : Math.max(halfWidth, Math.min(1280 - halfWidth, Number(camera?.x) || 640));
  const y = halfHeight >= 360 ? 360 : Math.max(halfHeight, Math.min(720 - halfHeight, Number(camera?.y) || 360));
  return { x, y, zoom };
}
export function worldToScreen(point, camera, width, height) { return { x: (point.x - camera.x) * camera.zoom + width / 2, y: (point.y - camera.y) * camera.zoom + height / 2 }; }
