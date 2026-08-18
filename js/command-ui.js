/** Reusable Stage 10-P-A Command UI primitives. */

export const COMMAND_TOOLTIP_DELAY_MS = 150;
export const COMMAND_LONG_PRESS_MS = 450;
export const COMMAND_LONG_PRESS_MOVE_PX = 12;

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== '') element.textContent = String(text);
  return element;
}

function replace(element, ...children) {
  if (typeof element.replaceChildren === 'function') element.replaceChildren(...children);
  else {
    element.innerHTML = '';
    children.forEach((child) => element.appendChild(child));
  }
}

export function StatusBadge(model = {}) {
  return node('span', `command-badge is-${model.tone || 'default'}`, model.label || '');
}

export class ProgressOverlay {
  constructor() {
    this.root = node('span', 'command-progress');
    this.bar = node('span', 'command-progress-bar');
    this.label = node('span', 'command-progress-label');
    this.root.append(this.bar, this.label);
  }

  update(progress) {
    const visible = progress !== null && progress !== undefined && Number.isFinite(Number(progress));
    this.root.hidden = !visible;
    if (!visible) return;
    const value = Math.max(0, Math.min(100, Number(progress)));
    this.bar.style.setProperty('--command-progress', `${value}%`);
    this.label.textContent = `${Math.round(value)}%`;
  }
}

export class LongPressController {
  constructor(element, onLongPress, { threshold = COMMAND_LONG_PRESS_MS, moveTolerance = COMMAND_LONG_PRESS_MOVE_PX } = {}) {
    this.element = element;
    this.onLongPress = onLongPress;
    this.threshold = threshold;
    this.moveTolerance = moveTolerance;
    this.timer = null;
    this.pointerId = null;
    this.origin = null;
    this.startedAt = null;
    this.fired = false;
    this._down = (event) => this.pointerDown(event);
    this._move = (event) => this.pointerMove(event);
    this._up = (event) => this.pointerUp(event);
    this._cancel = () => this.cancel();
    element.addEventListener('pointerdown', this._down);
    element.addEventListener('pointermove', this._move);
    element.addEventListener('pointerup', this._up);
    element.addEventListener('pointercancel', this._cancel);
    element.addEventListener('lostpointercapture', this._cancel);
    window.addEventListener('scroll', this._cancel, true);
  }

  pointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    this.cancel();
    if (this.element.dataset) this.element.dataset.longPressState = 'pending';
    this.pointerId = event.pointerId;
    this.origin = { x: event.clientX, y: event.clientY };
    this.startedAt = performance.now();
    this.fired = false;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.fired = true;
      if (this.element.dataset) this.element.dataset.longPressState = 'fired';
      this.element.classList.add('is-long-pressed');
      this.onLongPress?.(event);
    }, this.threshold);
  }

  pointerMove(event) {
    if (event.pointerId !== this.pointerId || !this.origin) return;
    if (Math.hypot(event.clientX - this.origin.x, event.clientY - this.origin.y) > this.moveTolerance) this.cancel();
  }

  pointerUp(event) {
    if (event.pointerId !== this.pointerId) return;
    const delayedTimerFallback = Boolean(this.timer && this.startedAt != null && performance.now() - this.startedAt >= this.threshold);
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    if (delayedTimerFallback) {
      this.fired = true;
      if (this.element.dataset) this.element.dataset.longPressState = 'fired';
      this.onLongPress?.(event);
    }
    this.pointerId = null;
    this.origin = null;
    this.startedAt = null;
    this.element.classList.remove('is-long-pressed');
    if (this.element.dataset) this.element.dataset.longPressState = this.fired ? 'fired-released' : 'short-released';
  }

  consumeClick() {
    if (!this.fired) return false;
    this.fired = false;
    return true;
  }

  cancel() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    this.pointerId = null;
    this.origin = null;
    this.startedAt = null;
    this.element.classList.remove('is-long-pressed');
    if (this.element?.dataset) this.element.dataset.longPressState = 'cancelled';
  }

  destroy() {
    this.cancel();
    this.element.removeEventListener('pointerdown', this._down);
    this.element.removeEventListener('pointermove', this._move);
    this.element.removeEventListener('pointerup', this._up);
    this.element.removeEventListener('pointercancel', this._cancel);
    this.element.removeEventListener('lostpointercapture', this._cancel);
    window.removeEventListener('scroll', this._cancel, true);
  }
}

export class QuickTooltip {
  constructor() {
    this.host = node('div', 'command-tooltip');
    this.host.id = 'command-tooltip-host';
    this.host.setAttribute('role', 'tooltip');
    this.host.hidden = true;
    document.body.appendChild(this.host);
    this.timer = null;
  }

  schedule(model, anchor) {
    this.hide();
    this.timer = window.setTimeout(() => this.show(model, anchor), COMMAND_TOOLTIP_DELAY_MS);
  }

  show(model, anchor) {
    if (!model || !anchor) return;
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    replace(this.host);
    this.host.appendChild(node('strong', 'command-tooltip-title', model.title || ''));
    if (model.role) this.host.appendChild(node('span', 'command-tooltip-role', model.role));
    if (model.cost) this.host.appendChild(node('span', 'command-tooltip-line', model.cost));
    if (model.duration) this.host.appendChild(node('span', 'command-tooltip-line', model.duration));
    if (model.status) this.host.appendChild(node('span', 'command-tooltip-status', model.status));
    this.host.hidden = false;
    const rect = anchor.getBoundingClientRect();
    const tipRect = this.host.getBoundingClientRect();
    const left = Math.min(window.innerWidth - tipRect.width - 10, Math.max(10, rect.left - tipRect.width - 10));
    const top = Math.min(window.innerHeight - tipRect.height - 10, Math.max(10, rect.top));
    this.host.style.left = `${left}px`;
    this.host.style.top = `${top}px`;
  }

  hide() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = null;
    this.host.hidden = true;
  }
}

export class CommandInspector {
  constructor(actionHandler = null) {
    this.actionHandler = actionHandler;
    this.host = node('div', 'command-inspector');
    this.host.id = 'command-inspector-host';
    this.host.hidden = true;
    this.host.setAttribute('role', 'presentation');
    this.backdrop = node('button', 'command-inspector-backdrop');
    this.backdrop.type = 'button';
    this.backdrop.setAttribute('aria-label', '关闭详情');
    this.panel = node('section', 'command-inspector-panel');
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-modal', 'true');
    this.host.append(this.backdrop, this.panel);
    document.body.appendChild(this.host);
    this.backdrop.addEventListener('click', () => this.close());
    this._key = (event) => { if (event.key === 'Escape') this.close(); };
  }

  open(model) {
    if (!model) return;
    this.model = model;
    replace(this.panel);
    const head = node('header', 'command-inspector-head');
    const titles = node('div');
    if (model.eyebrow) titles.appendChild(node('span', 'command-inspector-eyebrow', model.eyebrow));
    const title = node('h3', '', model.title || '详情');
    title.id = 'command-inspector-title';
    titles.appendChild(title);
    const close = node('button', 'command-inspector-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭详情');
    close.addEventListener('click', () => this.close());
    head.append(titles, close);
    this.panel.setAttribute('aria-labelledby', title.id);
    this.panel.appendChild(head);
    if (model.description) this.panel.appendChild(node('p', 'command-inspector-description', model.description));
    const appendRows = (rows) => {
      const list = node('dl', 'command-inspector-rows');
      rows.forEach((row) => {
        list.append(node('dt', '', row.label), node('dd', '', row.value));
      });
      return list;
    };
    this.panel.appendChild(appendRows(model.rows || []));
    (model.sections || []).forEach((section) => {
      if (!section?.rows?.length) return;
      const box = node('section', 'command-inspector-section');
      box.appendChild(node('h4', '', section.title || ''));
      box.appendChild(appendRows(section.rows));
      this.panel.appendChild(box);
    });
    (model.listSections || []).forEach((section) => {
      if (!section?.items?.length) return;
      const box = node('section', 'command-inspector-section');
      box.appendChild(node('h4', '', section.title || ''));
      const ul = node('ul', 'command-inspector-list');
      section.items.forEach((item) => ul.appendChild(node('li', '', item)));
      box.appendChild(ul);
      this.panel.appendChild(box);
    });
    const actionsBar = node('div', 'command-inspector-actions');
    let hasAction = false;
    (model.inputs || []).forEach((inputModel) => {
      const wrap = node('label', 'command-inspector-input');
      wrap.appendChild(node('span', '', inputModel.label || ''));
      const input = node('input');
      input.type = 'text';
      input.maxLength = inputModel.maxLength || 32;
      input.value = inputModel.value || '';
      if (inputModel.placeholder) input.placeholder = inputModel.placeholder;
      const submit = node('button', '', inputModel.submitLabel || '保存');
      submit.type = 'button';
      submit.dataset.inspectorAction = inputModel.actionId;
      submit.addEventListener('click', () => {
        this.actionHandler?.(inputModel.actionId, { ...(inputModel.payload || {}), value: input.value });
        this.close();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.actionHandler?.(inputModel.actionId, { ...(inputModel.payload || {}), value: input.value });
          this.close();
        }
      });
      wrap.append(input, submit);
      actionsBar.appendChild(wrap);
      hasAction = true;
    });
    const pushAction = (label, actionId, payload = {}, { danger = false, disabled = false } = {}) => {
      const action = node('button', `command-inspector-action${danger ? ' is-danger' : ''}`, label);
      action.type = 'button';
      action.dataset.inspectorAction = actionId;
      action.disabled = Boolean(disabled);
      action.addEventListener('click', () => {
        this.actionHandler?.(actionId, payload);
        this.close();
      });
      actionsBar.appendChild(action);
      hasAction = true;
    };
    (model.actions || []).forEach((action) => {
      if (!action?.id) return;
      pushAction(action.label || action.id, action.id, action.payload || {}, {
        danger: Boolean(action.danger) || /^cancel-|disband/.test(action.id),
        disabled: Boolean(action.disabled)
      });
    });
    if (model.actionId) {
      pushAction(
        /^cancel-/.test(model.actionId) ? '取消项目' : '执行',
        model.actionId,
        model.actionPayload || {},
        { danger: /^cancel-/.test(model.actionId) }
      );
    }
    if (hasAction) this.panel.appendChild(actionsBar);
    this.host.hidden = false;
    document.body.classList.add('command-inspector-open');
    document.addEventListener('keydown', this._key);
    close.focus();
  }

  close() {
    if (this.host.hidden) return;
    this.host.hidden = true;
    document.body.classList.remove('command-inspector-open');
    document.removeEventListener('keydown', this._key);
  }
}

export class CommandTile {
  constructor(model, { tooltip, inspector, onPrimary }) {
    this.model = model;
    this.tooltip = tooltip;
    this.inspector = inspector;
    this.onPrimary = onPrimary;
    this.root = node('button', 'command-tile');
    this.root.type = 'button';
    this.root.dataset.commandId = model.id;
    this.media = node('span', 'command-tile-media');
    this.image = node('img', 'command-tile-image');
    this.image.decoding = 'async';
    this.image.draggable = false;
    this.progressOverlay = new ProgressOverlay();
    this.badges = node('span', 'command-badges');
    this.detail = node('span', 'command-detail-trigger', 'ⓘ');
    this.detail.dataset.commandDetail = 'true';
    this.detail.setAttribute('aria-hidden', 'true');
    this.media.append(this.image, this.progressOverlay.root, this.badges, this.detail);
    this.name = node('span', 'command-tile-name');
    this.root.append(this.media, this.name);
    this.longPress = new LongPressController(this.root, () => {
      this.tooltip.hide();
      this.inspector.open(this.model.inspector);
    });
    this.root.addEventListener('pointerenter', () => this.tooltip.schedule(this.model.tooltip, this.root));
    this.root.addEventListener('mouseenter', () => this.tooltip.schedule(this.model.tooltip, this.root));
    this.root.addEventListener('pointerleave', () => this.tooltip.hide());
    this.root.addEventListener('mouseleave', () => this.tooltip.hide());
    this.root.addEventListener('focus', () => this.tooltip.schedule(this.model.tooltip, this.root));
    this.root.addEventListener('blur', () => this.tooltip.hide());
    this.root.addEventListener('contextmenu', (event) => { event.preventDefault(); this.tooltip.hide(); this.inspector.open(this.model.inspector); });
    this.root.addEventListener('click', (event) => {
      if (this.longPress.consumeClick()) { event.preventDefault(); event.stopPropagation(); return; }
      if (event.target.closest('[data-command-detail]')) { event.preventDefault(); event.stopPropagation(); this.tooltip.hide(); this.inspector.open(this.model.inspector); return; }
      if (this.model.inspectOnClick) { this.tooltip.hide(); this.inspector.open(this.model.inspector); return; }
      if (!this.model.actionId || this.model.disabled) { this.tooltip.show(this.model.tooltip, this.root); return; }
      this.tooltip.hide();
      this.onPrimary?.(this.model);
    });
    this.update(model);
  }

  update(model) {
    this.model = model;
    this.root.dataset.commandId = model.id;
    this.root.dataset.commandState = model.state;
    this.root.dataset.action = model.actionId || '';
    this.root.setAttribute('aria-label', model.ariaLabel || model.name);
    this.root.setAttribute('aria-disabled', model.disabled ? 'true' : 'false');
    this.root.className = `command-tile is-${model.state}${model.selected ? ' is-selected' : ''}`;
    this.image.src = model.image || '';
    this.image.alt = model.imageAlt || '';
    this.name.textContent = model.name;
    this.progressOverlay.update(model.progress);
    replace(this.badges);
    (model.badges || []).forEach((badge) => this.badges.appendChild(StatusBadge(badge)));
  }

  destroy() { this.longPress.destroy(); }
}

export class CommandGrid {
  constructor(root, dependencies) {
    this.root = root;
    this.root.classList.add('command-grid');
    this.dependencies = dependencies;
    this.tiles = new Map();
  }

  update(models) {
    const wanted = new Set(models.map((model) => model.id));
    for (const [id, tile] of this.tiles.entries()) {
      if (!wanted.has(id)) { tile.destroy(); tile.root.remove(); this.tiles.delete(id); }
    }
    models.forEach((model, index) => {
      let tile = this.tiles.get(model.id);
      if (!tile) { tile = new CommandTile(model, this.dependencies); this.tiles.set(model.id, tile); }
      else tile.update(model);
      // Keep existing nodes in place. Re-appending every 100ms would create
      // synthetic mouseleave/mouseenter cycles and starve the 150ms tooltip.
      if (this.root.children[index] !== tile.root) {
        const reference = this.root.children[index] || null;
        if (reference && typeof this.root.insertBefore === 'function') this.root.insertBefore(tile.root, reference);
        else this.root.appendChild(tile.root);
      }
    });
  }
}

export class CommandQueue extends CommandGrid {
  constructor(root, dependencies) {
    super(root, dependencies);
    this.root.classList.add('command-queue');
  }
}

export class CategoryBar {
  constructor(root, categories, onChange) {
    this.root = root;
    this.root.classList.add('command-category');
    this.buttons = new Map();
    categories.forEach((category) => {
      const button = node('button', 'command-category-button', category.label);
      button.type = 'button';
      button.dataset.category = category.id;
      button.addEventListener('click', () => onChange(category.id));
      this.root.appendChild(button);
      this.buttons.set(category.id, button);
    });
  }

  select(id) {
    this.buttons.forEach((button, key) => {
      button.classList.toggle('is-active', key === id);
      button.setAttribute('aria-pressed', key === id ? 'true' : 'false');
    });
  }
}

export class CommandSurface {
  constructor(actionHandler) {
    this.tooltip = new QuickTooltip();
    this.inspector = new CommandInspector(actionHandler);
  }

  createGrid(root, onPrimary) {
    return new CommandGrid(root, { tooltip: this.tooltip, inspector: this.inspector, onPrimary });
  }

  createQueue(root, onPrimary) {
    return new CommandQueue(root, { tooltip: this.tooltip, inspector: this.inspector, onPrimary });
  }
}
