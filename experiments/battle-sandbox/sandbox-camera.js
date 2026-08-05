import { CAMERA_KEYFRAMES, WORLD_HEIGHT, WORLD_WIDTH } from './sandbox-config.js';

function mix(a, b, amount) { return a + (b - a) * amount; }

export function cameraAt(time) {
  const t = Math.max(0, Math.min(35, time));
  let a = CAMERA_KEYFRAMES[0];
  let b = CAMERA_KEYFRAMES[CAMERA_KEYFRAMES.length - 1];
  for (let i = 1; i < CAMERA_KEYFRAMES.length; i += 1) {
    if (t <= CAMERA_KEYFRAMES[i].t) { b = CAMERA_KEYFRAMES[i]; a = CAMERA_KEYFRAMES[i - 1]; break; }
  }
  const span = Math.max(0.001, b.t - a.t);
  const p = Math.max(0, Math.min(1, (t - a.t) / span));
  const eased = p * p * (3 - 2 * p);
  return { x: mix(a.x, b.x, eased), y: mix(a.y, b.y, eased), zoom: mix(a.zoom, b.zoom, eased) };
}

export function worldToScreen(point, camera, width, height) {
  return { x: (point.x - camera.x) * camera.zoom + width / 2, y: (point.y - camera.y) * camera.zoom + height / 2 };
}

export function screenToWorld(point, camera, width, height) {
  return { x: (point.x - width / 2) / camera.zoom + camera.x, y: (point.y - height / 2) / camera.zoom + camera.y };
}

export function cameraBounds(camera, width, height) {
  const halfW = width / camera.zoom / 2;
  const halfH = height / camera.zoom / 2;
  return { left: Math.max(0, camera.x - halfW), top: Math.max(0, camera.y - halfH), right: Math.min(WORLD_WIDTH, camera.x + halfW), bottom: Math.min(WORLD_HEIGHT, camera.y + halfH) };
}
