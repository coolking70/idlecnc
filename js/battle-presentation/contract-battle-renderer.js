import { renderContractDemo } from './core/contract-renderer.js';
import { CONTRACT_RENDER_DEFAULTS, WORLD_HEIGHT, WORLD_WIDTH } from './contract-render-assets.js';
import { describePresentationTime } from './contract-time-bridge.js';
import { buildFormalBattleHud, drawFormalBattleHud, validateFormalHud } from './formal-hud-policy.js';

export class ContractBattleRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.context = canvas?.getContext?.('2d');
    this.options = { ...CONTRACT_RENDER_DEFAULTS, ...options };
    this.presentation = null;
    this.lastState = null;
    this.lastTime = 0;
    this.resizeObserver = typeof ResizeObserver === 'function' && canvas ? new ResizeObserver(() => this.resize()) : null;
    if (this.resizeObserver) this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect?.();
    const width = Math.max(320, Math.floor(rect?.width || this.canvas.clientWidth || 960));
    const height = Math.max(240, Math.floor(rect?.height || this.canvas.clientHeight || 540));
    const ratio = Math.min(2, globalThis.window?.devicePixelRatio || 1);
    if (this.canvas.width !== Math.floor(width * ratio) || this.canvas.height !== Math.floor(height * ratio)) {
      this.canvas.width = Math.floor(width * ratio); this.canvas.height = Math.floor(height * ratio);
    }
    this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  setPresentation(presentation) { this.presentation = presentation || null; this.lastState = null; }
  setCameraMode() {}
  setAutoCamera() {}
  reset() { this.presentation = null; this.lastState = null; this.lastTime = 0; }

  render(activeBattle, dtReal = 0) {
    if (!this.presentation?.ok) return false;
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
    this.lastState = state; this.lastTime = timing.presentationTime;
    const width = this.canvas.clientWidth || this.canvas.width;
    const height = this.canvas.clientHeight || this.canvas.height;
    this.context.save();
    this.context.setTransform(this.canvas.width / WORLD_WIDTH, 0, 0, this.canvas.height / WORLD_HEIGHT, 0, 0);
    renderContractDemo(this.context, this.presentation.plan, state, {
      debug: this.options.debug === true,
      showHud: this.options.showHud !== false,
      viewMode: this.options.viewMode || 'overview',
      hudRenderer: (context, renderState, plan, options) => drawFormalBattleHud(context, hud, renderState, {
        ...options, screenSpace: true, screenWidth: this.canvas.clientWidth || width, screenHeight: this.canvas.clientHeight || height,
        screenDpr: this.canvas.width / Math.max(1, this.canvas.clientWidth || width)
      })
    });
    this.context.restore();
    return true;
  }

  getTextState(options = {}) {
    if (!this.presentation?.ok) return null;
    return this.presentation.renderState.textAt(this.lastTime, options);
  }

  destroy() { this.resizeObserver?.disconnect(); this.resizeObserver = null; this.reset(); }
}
