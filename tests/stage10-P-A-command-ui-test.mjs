import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILDING_STATUS, EQUIPMENT, SAVE_VERSION, UNITS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { queueUnit, tickProduction } from '../js/production.js';
import {
  buildConstructionTileModels, buildCurrentConstructionModel,
  buildEquipmentProductionTileModels, buildProductionQueueModels,
  buildUnitProductionTileModels
} from '../js/command-presentation.js';
import {
  COMMAND_LONG_PRESS_MS, COMMAND_TOOLTIP_DELAY_MS, LongPressController
} from '../js/command-ui.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const checks = [];
let passed = 0;
const pending = [];

function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(result.then(() => {
        checks.push({ name, passed: true });
        passed += 1;
        console.log(`  PASS  ${name}`);
      }).catch((error) => {
        checks.push({ name, passed: false, error: error?.stack || String(error) });
        console.error(`  FAIL  ${name}: ${error?.message || error}`);
      }));
      return;
    }
    checks.push({ name, passed: true });
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    checks.push({ name, passed: false, error: error?.stack || String(error) });
    console.error(`  FAIL  ${name}: ${error?.message || error}`);
  }
}

function readyState() {
  const state = createInitialState();
  state.resources = { supply: 9000, alloy: 9000, intel: 900 };
  state.unlocks.units = Object.keys(UNITS);
  state.research.completed = ['modular_assembly', 'field_maintenance', 'composite_armor', 'expanded_storage'];
  state.buildings.push(
    { id: 'stage10-barracks', type: 'barracks', status: BUILDING_STATUS.OPERATIONAL, progress: 1 },
    { id: 'stage10-armor', type: 'armor_factory', status: BUILDING_STATUS.OPERATIONAL, progress: 1 }
  );
  recalcDerived(state);
  return state;
}

console.log('\n── Stage 10-P-A command presentation / interaction foundation ──');

check('SAVE_VERSION remains 10', () => assert.equal(SAVE_VERSION, 10));
check('construction presentation has image, name and inspector for every buildable object', () => {
  const models = buildConstructionTileModels(createInitialState());
  assert.ok(models.length >= 5);
  assert.ok(models.every((model) => model.image && model.name && model.inspector?.rows?.length));
});
check('construction locked visual state is derived from canBuild reasons', () => {
  const armor = buildConstructionTileModels(createInitialState()).find((model) => model.id === 'construction:armor_factory');
  assert.equal(armor.state, 'locked');
  assert.ok(armor.badges.some((badge) => badge.label === 'LOCK'));
  assert.match(armor.tooltip.status, /兵营/);
});
check('construction resource-insufficient state is visual and details stay on demand', () => {
  const state = createInitialState(); state.resources = { supply: 0, alloy: 0, intel: 0 };
  const depot = buildConstructionTileModels(state).find((model) => model.id === 'construction:supply_depot');
  assert.equal(depot.state, 'insufficient');
  assert.ok(depot.badges.some((badge) => badge.tone === 'resource'));
});
check('current construction produces a compact progress model', () => {
  const state = createInitialState();
  state.construction.current = { id: 'work', type: 'supply_depot', elapsed: 10, duration: 20 };
  state.buildings.push({ id: 'work', type: 'supply_depot', status: BUILDING_STATUS.UNDER_CONSTRUCTION, progress: .5 });
  const model = buildCurrentConstructionModel(state);
  assert.equal(model.progress, 50);
  assert.equal(model.inspectOnClick, true);
});
check('unit models render image, name and inventory badge', () => {
  const state = readyState();
  const models = buildUnitProductionTileModels(state);
  assert.equal(models.length, 5);
  assert.ok(models.every((model) => model.image && model.name));
});
check('equipment uses the same command model contract', () => {
  const models = buildEquipmentProductionTileModels(readyState());
  assert.equal(models.length, Object.values(EQUIPMENT).filter((def) => def.acquisition?.kind === 'production').length);
  assert.ok(models.every((model) => model.image && model.tooltip && model.inspector));
});
check('production queue model has active progress overlay and queued position', () => {
  const state = readyState();
  queueUnit(state, 'infantry'); queueUnit(state, 'mbt'); tickProduction(state, 5);
  const models = buildProductionQueueModels(state);
  assert.equal(models.length, 2);
  assert.ok(models[0].progress > 0);
  assert.equal(models[0].inspectOnClick, true);
  assert.match(models[1].tooltip.status, /第 2 位/);
});
check('presentation builders never mutate canonical state', () => {
  const state = readyState(); const before = clone(state);
  buildConstructionTileModels(state); buildUnitProductionTileModels(state);
  buildEquipmentProductionTileModels(state); buildProductionQueueModels(state);
  assert.deepEqual(state, before);
});
check('tooltip and long-press timings use the unified contract', () => {
  assert.equal(COMMAND_TOOLTIP_DELAY_MS, 150);
  assert.equal(COMMAND_LONG_PRESS_MS, 450);
});

class FakeElement {
  constructor() { this.listeners = new Map(); this.classList = { add() {}, remove() {} }; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter((row) => row !== fn)); }
  emit(type, event = {}) { (this.listeners.get(type) || []).forEach((fn) => fn({ button: 0, pointerId: 1, clientX: 10, clientY: 10, ...event })); }
}

globalThis.window = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  addEventListener() {},
  removeEventListener() {}
};

check('short pointer gesture does not fire long press', async () => {
  const element = new FakeElement(); let fired = 0;
  const controller = new LongPressController(element, () => { fired += 1; }, { threshold: 10 });
  element.emit('pointerdown'); element.emit('pointerup');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fired, 0); assert.equal(controller.consumeClick(), false); controller.destroy();
});
check('long press opens detail once and consumes the following click', async () => {
  const element = new FakeElement(); let fired = 0;
  const controller = new LongPressController(element, () => { fired += 1; }, { threshold: 5 });
  element.emit('pointerdown'); await new Promise((resolve) => setTimeout(resolve, 15)); element.emit('pointerup');
  assert.equal(fired, 1); assert.equal(controller.consumeClick(), true); assert.equal(controller.consumeClick(), false); controller.destroy();
});
check('movement cancels long press', async () => {
  const element = new FakeElement(); let fired = 0;
  const controller = new LongPressController(element, () => { fired += 1; }, { threshold: 5, moveTolerance: 4 });
  element.emit('pointerdown'); element.emit('pointermove', { clientX: 30 });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(fired, 0); controller.destroy();
});
check('pointercancel cancels long press', async () => {
  const element = new FakeElement(); let fired = 0;
  const controller = new LongPressController(element, () => { fired += 1; }, { threshold: 5 });
  element.emit('pointerdown'); element.emit('pointercancel');
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(fired, 0); controller.destroy();
});

const commandSource = fs.readFileSync(path.join(root, 'js/command-ui.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
check('CommandTile is button-based and exposes image/name/progress/badges', () => {
  assert.match(commandSource, /node\('button', 'command-tile'\)/);
  assert.match(commandSource, /command-tile-image/);
  assert.match(commandSource, /command-tile-name/);
  assert.match(commandSource, /command-progress/);
  assert.match(commandSource, /command-badge/);
});
check('keyboard primary action is native Enter/Space button behavior', () => {
  assert.match(commandSource, /this\.root\.type = 'button'/);
  assert.match(commandSource, /aria-disabled/);
});
check('locked and disabled tiles remain tooltip-capable', () => {
  assert.match(commandSource, /pointerenter/);
  assert.doesNotMatch(commandSource, /this\.root\.disabled\s*=/);
});
check('only one tooltip and inspector host are constructed by CommandSurface', () => {
  assert.equal((uiSource.match(/new CommandSurface/g) || []).length, 1);
  assert.match(commandSource, /command-tooltip-host/);
  assert.match(commandSource, /command-inspector-host/);
});
check('Construction, Unit, Equipment and Queue all use CommandGrid', () => {
  for (const marker of ['construction', 'unit-production', 'equipment-production', 'production-queue']) assert.match(uiSource, new RegExp(marker));
});

await Promise.all(pending);
const result = { stage: '10-P-A', passed: passed === checks.length, passedCount: passed, checkCount: checks.length, checks };
console.log(`\nStage 10-P-A command UI: ${passed}/${checks.length} passed`);
if (!result.passed) process.exitCode = 1;
