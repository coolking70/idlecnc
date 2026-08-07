export const PRESENTATION_WORLD_WIDTH = 1280;
export const PRESENTATION_WORLD_HEIGHT = 720;

export function measurePresentationViewport(canvas) {
  const rect = canvas?.getBoundingClientRect?.() || {};
  const width = Math.max(320, Math.floor(rect.width || canvas?.clientWidth || 960));
  const height = Math.max(240, Math.floor(rect.height || canvas?.clientHeight || 540));
  const dpr = Math.min(2, globalThis.window?.devicePixelRatio || 1);
  const scale = Math.min(width / PRESENTATION_WORLD_WIDTH, height / PRESENTATION_WORLD_HEIGHT);
  return {
    width,
    height,
    dpr,
    scale,
    offsetX: (width - PRESENTATION_WORLD_WIDTH * scale) / 2,
    offsetY: (height - PRESENTATION_WORLD_HEIGHT * scale) / 2
  };
}

export function canvasPointFromEvent(canvas, event) {
  const rect = canvas?.getBoundingClientRect?.() || { left: 0, top: 0 };
  return { x: Number(event?.clientX || 0) - rect.left, y: Number(event?.clientY || 0) - rect.top };
}

export function screenDeltaToWorld(delta, viewport, zoom = 1) {
  return Number(delta || 0) / Math.max(0.0001, Number(viewport?.scale) || 1) / Math.max(0.0001, Number(zoom) || 1);
}

export function applyPresentationWorldTransform(context, viewport) {
  context.setTransform(
    viewport.dpr * viewport.scale, 0, 0, viewport.dpr * viewport.scale,
    viewport.dpr * viewport.offsetX, viewport.dpr * viewport.offsetY
  );
}
