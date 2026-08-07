import { renderContractDemo } from './core/contract-renderer.js';
import { CONTRACT_RENDER_DEFAULTS, WORLD_HEIGHT, WORLD_WIDTH } from './contract-render-assets.js';
import { describePresentationTime } from './contract-time-bridge.js';
import { buildFormalBattleHud, drawFormalBattleHud, validateFormalHud } from './formal-hud-policy.js';
import { clampContractCamera, contractCameraAt, finalStatusCamera } from './core/contract-camera.js';
import { applyPresentationWorldTransform, canvasPointFromEvent, measurePresentationViewport, screenDeltaToWorld } from './presentation-viewport.js';

export class ContractBattleRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.context = canvas?.getContext?.('2d');
    this.options = { ...CONTRACT_RENDER_DEFAULTS, ...options };
    this.presentation = null;
    this.lastState = null;
    this.lastTime = 0;
    this.lastCamera = null;
    this.activeBattle = null;
    this.cameraOverride = null;
    this.viewport = null;
    this.pointer = null;
    this._bindPointer();
    this.resizeObserver = typeof ResizeObserver === 'function' && canvas ? new ResizeObserver(() => this.resize()) : null;
    if (this.resizeObserver) this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    if (!this.canvas) return null;
    this.viewport = measurePresentationViewport(this.canvas);
    const { width, height, dpr } = this.viewport;
    if (this.canvas.width !== Math.floor(width * dpr) || this.canvas.height !== Math.floor(height * dpr)) {
      this.canvas.width = Math.floor(width * dpr); this.canvas.height = Math.floor(height * dpr);
    }
    this.context?.setTransform(dpr, 0, 0, dpr, 0, 0);
    return this.viewport;
  }

  _bindPointer() {
    if (!this.canvas?.addEventListener) return;
    this.canvas.style && (this.canvas.style.touchAction = 'none');
    this._onPointerDown = (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0 && event.button !== 1) return;
      event.preventDefault?.(); const camera = this.lastCamera || contractCameraAt(this.lastTime); this.cameraOverride = clampContractCamera(camera); const point = canvasPointFromEvent(this.canvas, event);
      this.pointer = { id: event.pointerId, x: point.x, y: point.y }; this.canvas.setPointerCapture?.(event.pointerId); this.canvas.classList?.add('is-camera-dragging');
    };
    this._onPointerMove = (event) => {
      if (!this.pointer || event.pointerId !== this.pointer.id) return;
      const point = canvasPointFromEvent(this.canvas, event); const viewport = this.resize(); const dx = screenDeltaToWorld(point.x - this.pointer.x, viewport, this.cameraOverride?.zoom); const dy = screenDeltaToWorld(point.y - this.pointer.y, viewport, this.cameraOverride?.zoom);
      if (Math.abs(dx) + Math.abs(dy) < .001) return;
      event.preventDefault?.(); this.pointer.x = point.x; this.pointer.y = point.y; this.cameraOverride = clampContractCamera({ ...this.cameraOverride, x: this.cameraOverride.x - dx, y: this.cameraOverride.y - dy }); if (this.activeBattle) this.render(this.activeBattle);
    };
    this._finishPointer = (event) => { if (!this.pointer || event.pointerId !== this.pointer.id) return; this.canvas.releasePointerCapture?.(event.pointerId); this.canvas.classList?.remove('is-camera-dragging'); this.pointer = null; };
    this._onWheel = (event) => { if (!this.activeBattle) return; event.preventDefault?.(); const viewport = this.resize(); const current = this.lastCamera || contractCameraAt(this.lastTime); const point = canvasPointFromEvent(this.canvas, event); const logicalX = (point.x - viewport.offsetX) / Math.max(.0001, viewport.scale); const logicalY = (point.y - viewport.offsetY) / Math.max(.0001, viewport.scale); const oldZoom = Number(current.zoom) || .86; const nextZoom = clampContractCamera({ ...current, zoom: oldZoom * (event.deltaY < 0 ? 1.1 : .9) }).zoom; const anchorX = current.x + (logicalX - 640) / oldZoom; const anchorY = current.y + (logicalY - 360) / oldZoom; this.cameraOverride = clampContractCamera({ x: anchorX - (logicalX - 640) / nextZoom, y: anchorY - (logicalY - 360) / nextZoom, zoom: nextZoom }); this.render(this.activeBattle); };
    this._onDoubleClick = (event) => { event.preventDefault?.(); this.resetCamera(); };
    this.canvas.addEventListener('pointerdown', this._onPointerDown); this.canvas.addEventListener('pointermove', this._onPointerMove); this.canvas.addEventListener('pointerup', this._finishPointer); this.canvas.addEventListener('pointercancel', this._finishPointer); this.canvas.addEventListener('wheel', this._onWheel, { passive: false }); this.canvas.addEventListener('dblclick', this._onDoubleClick);
  }

  setPresentation(presentation) { const changed = this.presentation?.plan !== presentation?.plan || this.presentation?.reportFingerprint !== presentation?.reportFingerprint; this.presentation = presentation || null; if (changed) this.cameraOverride = null; this.lastState = null; }
  setCameraMode() {}
  setAutoCamera() {}
  reset() { this.presentation = null; this.activeBattle = null; this.lastState = null; this.lastTime = 0; this.lastCamera = null; this.cameraOverride = null; this.pointer = null; this.canvas?.classList?.remove('is-camera-dragging'); }

  render(activeBattle, dtReal = 0) {
    if (!this.presentation?.ok) return false;
    this.activeBattle = activeBattle;
    // A headless router is used by the deterministic unit tests. In the real
    // page a canvas is always present; a valid plan is still considered a
    // successful render attempt when no drawing surface was supplied.
    if (!this.context) return true;
    this.resize();
    const timing = describePresentationTime(activeBattle, this.presentation);
    const state = this.presentation.renderState.atTime(timing.presentationTime, timing);
    const hud = buildFormalBattleHud(activeBattle, this.presentation, state);
    const hudCheck = validateFormalHud(hud);
    if (!hudCheck.ok) throw new Error(`invalid_runtime_state:${hudCheck.errors.join(',')}`);
    const camera = this.cameraOverride || (this.options.viewMode === 'final_status_focus' ? finalStatusCamera(state) : contractCameraAt(state.time));
    this.lastCamera = camera; this.lastState = { ...state, camera: { ...camera, manual: Boolean(this.cameraOverride) } }; this.lastTime = timing.presentationTime;
    const viewport = this.resize(); const { width, height, dpr } = viewport;
    this.context.save();
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0); this.context.clearRect(0, 0, width, height); this.context.fillStyle = '#0d1716'; this.context.fillRect(0, 0, width, height); this.context.save(); applyPresentationWorldTransform(this.context, viewport);
    renderContractDemo(this.context, this.presentation.plan, state, {
      debug: this.options.debug === true,
      showHud: this.options.showHud !== false,
      viewMode: this.options.viewMode || 'overview',
      cameraOverride: camera,
      hudRenderer: (context, renderState, plan, options) => drawFormalBattleHud(context, hud, renderState, {
        ...options, screenSpace: true, screenWidth: this.canvas.clientWidth || width, screenHeight: this.canvas.clientHeight || height,
        screenDpr: this.canvas.width / Math.max(1, this.canvas.clientWidth || width)
      })
    });
    this.context.restore();
    this.context.restore();
    return true;
  }

  getTextState(options = {}) {
    if (!this.presentation?.ok) return null;
    return { ...this.presentation.renderState.textAt(this.lastTime, options), camera: this.lastCamera ? { ...this.lastCamera, manual: Boolean(this.cameraOverride) } : null };
  }

  resetCamera() { this.cameraOverride = null; if (this.activeBattle) this.render(this.activeBattle); return true; }
  getInteractionState() { return { manual: Boolean(this.cameraOverride), dragging: Boolean(this.pointer), viewport: this.viewport ? { ...this.viewport } : null }; }
  destroy() { this.resizeObserver?.disconnect(); this.resizeObserver = null; if (this.canvas?.removeEventListener) { this.canvas.removeEventListener('pointerdown', this._onPointerDown); this.canvas.removeEventListener('pointermove', this._onPointerMove); this.canvas.removeEventListener('pointerup', this._finishPointer); this.canvas.removeEventListener('pointercancel', this._finishPointer); this.canvas.removeEventListener('wheel', this._onWheel); this.canvas.removeEventListener('dblclick', this._onDoubleClick); } this.reset(); }
}
