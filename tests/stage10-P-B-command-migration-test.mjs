import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILDING_STATUS, DAMAGE_STATES, SAVE_VERSION, TECHNOLOGIES, UNIT_RANKS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import {
  buildUnitRosterModels, buildFormationCommandModels, buildTheaterCommandModels,
  buildStrategyModels, buildRepairCommandModels, buildResearchCommandModels,
  buildReportModels, buildOverviewCommandModels
} from '../js/command-presentation.js';
import { COMMAND_LONG_PRESS_MS, LongPressController } from '../js/command-ui.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const checks = [];
let passed = 0;
const pending = [];

function check(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(result.then(() => { checks.push({ name, passed: true }); passed += 1; console.log(`  PASS  ${name}`); })
        .catch((error) => { checks.push({ name, passed: false, error: error?.stack || String(error) }); console.error(`  FAIL  ${name}: ${error?.message || error}`); }));
      return;
    }
    checks.push({ name, passed: true }); passed += 1; console.log(`  PASS  ${name}`);
  } catch (error) {
    checks.push({ name, passed: false, error: error?.stack || String(error) });
    console.error(`  FAIL  ${name}: ${error?.message || error}`);
  }
}

function readyState() {
  const state = createInitialState();
  state.resources = { supply: 9000, alloy: 9000, intel: 900 };
  state.units.push(
    { id: 'u1', type: 'infantry', callsign: '尖兵', hp: 100, maxHp: 100, status: 'ready', formationId: null, experience: 0, battles: 0, createdAt: 1 },
    { id: 'u2', type: 'mbt', callsign: '铁锤', hp: 10, maxHp: 100, status: 'ready', formationId: null, experience: 900, battles: 9, createdAt: 2 }
  );
  state.formations.push({ id: 'f1', name: '第一梯队', unitIds: ['u1'], status: 'idle', createdAt: 1 });
  state.buildings.push(
    { id: 'b-barracks', type: 'barracks', status: BUILDING_STATUS.OPERATIONAL, progress: 1 },
    { id: 'b-armor', type: 'armor_factory', status: BUILDING_STATUS.OPERATIONAL, progress: 1 },
    { id: 'b-radar', type: 'radar_station', status: BUILDING_STATUS.OPERATIONAL, progress: 1 },
    { id: 'b-research', type: 'research_center', status: BUILDING_STATUS.OPERATIONAL, progress: 1 }
  );
  state.research.current = { id: 't1', techId: 'logistics_optimization', elapsed: 10, duration: 20, costPaid: {} };
  recalcDerived(state);
  return state;
}

console.log('\n── Stage 10-P-B full command UI migration ──');

check('SAVE_VERSION remains 10', () => assert.equal(SAVE_VERSION, 10));

check('unit roster uses portrait tiles with status/rank/damage badges and inspector archive', () => {
  const models = buildUnitRosterModels(readyState());
  assert.equal(models.length, 2);
  assert.ok(models.every((model) => model.image && model.name && model.badges.length >= 2 && model.inspectOnClick));
  const damaged = models.find((model) => model.id === 'unit-instance:u2');
  assert.ok(damaged.badges.some((badge) => badge.label === '重伤'));
  assert.ok(damaged.inspector.inputs?.some((input) => input.actionId === 'rename-unit' && input.payload.unitId === 'u2'));
  assert.ok(damaged.inspector.rows.some((row) => row.label === '所属编队'));
  assert.ok(Array.isArray(damaged.inspector.sections) && damaged.inspector.sections.length === 1);
});

check('formation tiles expose management operations only through the inspector', () => {
  const state = readyState();
  const models = buildFormationCommandModels(state);
  assert.ok(models.some((model) => model.id === 'formation:new'));
  assert.equal(models.filter((model) => model.id.startsWith('formation-preset:')).length, 3);
  const formation = models.find((model) => model.id === 'formation:f1');
  assert.ok(formation.inspector.actions.some((action) => action.id === 'disband-formation' && action.danger === true));
  assert.ok(formation.inspector.actions.some((action) => action.id === 'remove-unit' && action.payload.unitId === 'u1'));
  assert.ok(formation.inspector.actions.some((action) => action.id === 'add-unit'));
  assert.equal(formation.actionId, null);
});

check('theater tiles stay compact: status badge on tile, intel/rewards in inspector', () => {
  const models = buildTheaterCommandModels(readyState());
  assert.equal(models.length, 6);
  const first = models.find((model) => model.id.startsWith('theater:'));
  assert.ok(first.badges.length >= 2 && first.badges.length <= 3);
  assert.ok(first.inspector.rows.some((row) => row.label === '地形'));
  assert.ok(first.inspector.actions.some((action) => action.id === 'select-theater'));
});

check('strategy tiles use select-strategy as primary and keep pros/risks in inspector', () => {
  const models = buildStrategyModels(readyState(), 'cautious');
  assert.equal(models.length, 3);
  assert.ok(models.every((model) => model.actionId === 'select-strategy' && model.tooltip && model.inspector));
  const selected = models.find((model) => model.selected === true);
  assert.equal(selected.id, 'strategy:cautious');
});

check('repair candidates use visual damage badges and repair-unit authority action', () => {
  const state = readyState();
  const { candidates } = buildRepairCommandModels(state);
  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.ok(candidate.badges.some((badge) => badge.label === '重伤'));
  assert.equal(candidate.actionId, 'repair-unit');
  assert.equal(candidate.actionPayload.unitId, 'u2');
  const poor = readyState(); poor.resources = { supply: 0, alloy: 0, intel: 0 };
  const blocked = buildRepairCommandModels(poor).candidates[0];
  assert.equal(blocked.actionId, null);
  assert.equal(blocked.disabled, true);
  assert.ok(blocked.badges.some((badge) => badge.tone === 'resource'));
});

check('research tiles map authority states to available/locked/researching/completed visuals', () => {
  const noLab = buildResearchCommandModels(createInitialState());
  assert.equal(noLab.tech.length, Object.keys(TECHNOLOGIES).length);
  assert.equal(noLab.labBuilt, false);
  assert.ok(noLab.tech.every((model) => model.disabled === true || model.actionId === null));
  const withLab = buildResearchCommandModels(readyState());
  assert.equal(withLab.labBuilt, true);
  assert.equal(withLab.current.length, 1);
  assert.ok(withLab.current[0].progress > 0);
  assert.ok(withLab.current[0].inspector.actions.some((action) => action.id === 'cancel-current-research'));
  assert.ok(withLab.tech.some((model) => model.state === 'available' && model.actionId === 'research'));
});

check('report tiles are compact history records with the full report in the inspector', () => {
  const state = readyState();
  state.battles.push({
    id: 'battle_x', seed: 7, theaterId: 'north_pass', theaterName: '北岭隘口', missionKind: 'campaign',
    strategyName: '谨慎推进', formationName: '第一梯队', result: 'victory', startedAt: 100, duration: 60,
    summary: '告捷', capture: true, rewards: {}, phases: [{ title: '接敌', summary: '遭遇', details: ['交火'] }],
    events: [{ t: 1, text: '开火' }], losses: { friendly: [], enemy: [] }, initial: { friendly: [], enemy: [] },
    reasons: { advantages: ['火力优势'], problems: [] }, rounds: [{}]
  });
  const models = buildReportModels(state);
  assert.equal(models.length, 1);
  const model = models[0];
  assert.ok(model.badges.some((badge) => badge.label === '胜利'));
  assert.ok(model.inspector.sections.some((section) => section.title === '接敌'));
  assert.ok(model.inspector.listSections.some((section) => section.title === '事件时间轴'));
});

check('overview only surfaces actionable current operations', () => {
  const models = buildOverviewCommandModels(readyState());
  assert.ok(models.some((model) => model.id === 'overview:research'));
  assert.ok(models.some((model) => model.id === 'overview:formations'));
  assert.ok(models.every((model) => !model.inspector?.rows?.some((row) => /阶段|核对|统计/.test(row.label))));
});

check('P-B presentation builders never mutate canonical state', () => {
  const state = readyState(); const before = clone(state);
  buildUnitRosterModels(state); buildFormationCommandModels(state); buildTheaterCommandModels(state);
  buildStrategyModels(state, 'cautious'); buildRepairCommandModels(state); buildResearchCommandModels(state);
  buildReportModels(state); buildOverviewCommandModels(state);
  assert.deepEqual(state, before);
});

class FakeElement {
  constructor() { this.listeners = new Map(); this.classList = { add() {}, remove() {} }; }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { this.listeners.set(type, (this.listeners.get(type) || []).filter((row) => row !== fn)); }
  emit(type, event = {}) { (this.listeners.get(type) || []).forEach((fn) => fn({ button: 0, pointerId: 1, clientX: 10, clientY: 10, ...event })); }
}
globalThis.window = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, addEventListener() {}, removeEventListener() {} };

check('long press still never triggers the tap primary action (shared controller)', async () => {
  const element = new FakeElement(); let fired = 0;
  const controller = new LongPressController(element, () => { fired += 1; }, { threshold: 5 });
  element.emit('pointerdown'); await new Promise((resolve) => setTimeout(resolve, 15)); element.emit('pointerup');
  assert.equal(fired, 1); assert.equal(controller.consumeClick(), true);
  controller.destroy();
});
check('long-press threshold unchanged from P-A', () => assert.equal(COMMAND_LONG_PRESS_MS, 450));

const commandSource = fs.readFileSync(path.join(root, 'js/command-ui.js'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
check('inspector gained generic sections / actions / inputs capabilities', () => {
  assert.match(commandSource, /model\.sections/);
  assert.match(commandSource, /model\.actions/);
  assert.match(commandSource, /model\.inputs/);
  assert.match(commandSource, /command-inspector-actions/);
});
check('dangerous actions are visually separated in the inspector', () => {
  assert.match(commandSource, /is-danger/);
  assert.match(commandSource, /cancel-|disband/);
});
check('every migrated page reuses the shared CommandSurface grids', () => {
  for (const marker of [
    'command-roster-grid', 'command-formation-grid', 'command-theater-grid',
    'command-strategy-grid', 'command-repair-grid', 'research-tree-compact',
    'command-report-grid', 'command-overview-grid'
  ]) assert.match(uiSource, new RegExp(marker));
  assert.equal((uiSource.match(/new CommandSurface/g) || []).length, 1);
});
check('UI actions route to existing authority handler APIs', () => {
  for (const marker of [
    'onRenameUnit', 'onEquipEquipment', 'onUnequipEquipment', 'onRepair', 'onCancelRepair',
    'onResearch', 'onCancelCurrentResearch', 'onCancelQueuedResearch',
    'onCreateFormation', 'onApplyPreset', 'onDisbandFormation', 'onRemoveUnit', 'onAddUnit',
    'onReplayReport', 'onClaimBattleSalvage'
  ]) assert.match(uiSource, new RegExp(marker));
});
check('no page-local duplicate tile/tooltip/long-press framework was introduced', () => {
  assert.equal((uiSource.match(/new LongPressController/g) || []).length, 0);
  assert.equal((uiSource.match(/new QuickTooltip/g) || []).length, 0);
  assert.equal((uiSource.match(/class .*Tile/g) || []).length, 0);
});

await Promise.all(pending);
const result = { stage: '10-P-B', passed: passed === checks.length, passedCount: passed, checkCount: checks.length, checks };
console.log(`\nStage 10-P-B command migration: ${passed}/${checks.length} passed`);
if (!result.passed) process.exitCode = 1;
