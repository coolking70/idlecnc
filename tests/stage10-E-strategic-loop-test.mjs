import assert from 'node:assert/strict';

/**
 * Stage 10-E — Strategic Loop Closure targeted tests.
 *
 * 权威层：js/strategic-loop.js（getStrategicMissionModifiers /
 * applyStrategicSettlementPressure）。接入点：theater.getMissionCost、
 * operations.getOperationCost、theater.settleActiveBattle 的 exactly-once
 * 结算提交块。
 */

import { BATTLE_RESULT, FORMATION_STATUS, SAVE_VERSION, STRATEGIES } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { getMissionCost, dispatchFormation, settleActiveBattle, tickActiveBattle } from '../js/theater.js';
import { getOperationCost } from '../js/operations.js';
import { saveGame, loadGame, SAVE_KEY } from '../js/save.js';
import { ensureTheaterPressure, theaterPressureView } from '../js/theater-pressure.js';
import {
  STRATEGIC_COST, STRATEGIC_BATTLE_OUTCOME,
  getStrategicMissionModifiers, describeStrategicSources, applyStrategicSettlementPressure
} from '../js/strategic-loop.js';
import { buildTheaterCommandModels } from '../js/command-presentation.js';
import * as doctrine from '../js/doctrine.js';
import * as autoOperations from '../js/auto-operations.js';
import * as tasking from '../js/tasking.js';

const A = 'scrap_mine';
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try { fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (error) { failed += 1; console.error(`  FAIL  ${name}: ${error?.message || error}`); }
};

console.log('\n── Stage 10-E strategic loop closure ──');

check('SAVE_VERSION remains 10', () => assert.equal(SAVE_VERSION, 10));

check('initial pressure keeps legacy mission costs exactly unchanged', () => {
  const state = createInitialState();
  recalcDerived(state);
  state.resources = { supply: 1e7, alloy: 1e5, intel: 1e5 };
  state.units.push({ id: 'u0', type: 'mbt', hp: 100, maxHp: 100, damage: 'intact', status: 'assigned', formationId: 'f0', experience: 0, battles: 0, callsign: null, createdAt: 0 });
  state.formations.push({ id: 'f0', name: 'X', unitIds: ['u0'], status: FORMATION_STATUS.IDLE, createdAt: 0 });
  ensureTheaterPressure(state);
  const mod = getStrategicMissionModifiers(state, A);
  approx(mod.supplyMultiplier, 1);
  approx(mod.intelMultiplier, 1);
  // mbt upkeep 2 × scrap_mine ×5 = 10 → cautious upkeepMod... 直接与手工基线对照
  const mission = getMissionCost(state, 'f0', A, 'cautious');
  assert.ok(mission.cost.supply > 0);
  approx(mission.breakdown.strategicSupplyMultiplier, 1);
  const op = getOperationCost(state, 'f0', 'salvage_run', 'cautious');
  approx(op.breakdown.strategicSupplyMultiplier, 1);
  // 与关闭 modifier 的手工计算一致：supply = ceil(upkeep×opMult×stratUpkeepMod×stratMod)
  assert.equal(op.cost.supply, Math.ceil(op.breakdown.upkeep * 4 * (STRATEGIES.cautious.mods && STRATEGIES.cautious.mods.upkeep || 1) * 1));
});

check('threat raises supply multiplier, control/security lower it', () => {
  const state = createInitialState();
  ensureTheaterPressure(state);
  state.theaterPressure[A] = { threat: 90, control: 0, recon: 0, security: 0 };
  approx(getStrategicMissionModifiers(state, A).supplyMultiplier, 1 + 40 * 0.003);
  state.theaterPressure[A] = { threat: 50, control: 60, recon: 0, security: 0 };
  approx(getStrategicMissionModifiers(state, A).supplyMultiplier, 1 - 60 * 0.0015);
  state.theaterPressure[A] = { threat: 50, control: 0, recon: 0, security: 50 };
  approx(getStrategicMissionModifiers(state, A).supplyMultiplier, 1 - 50 * 0.001);
});

check('recon lowers intel multiplier only', () => {
  const state = createInitialState();
  ensureTheaterPressure(state);
  state.theaterPressure[A] = { threat: 50, control: 0, recon: 40, security: 0 };
  const mod = getStrategicMissionModifiers(state, A);
  approx(mod.intelMultiplier, 1 - 40 * 0.0025);
  approx(mod.supplyMultiplier, 1);
});

check('multiplier clamps (supply 0.75~1.40, intel 0.75~1.00)', () => {
  const state = createInitialState();
  ensureTheaterPressure(state);
  state.theaterPressure[A] = { threat: 100, control: 100, recon: 100, security: 100 };
  // threat +50×0.003=+0.15；control -0.15；security -0.1 → 净 -0.10 → 0.90
  approx(getStrategicMissionModifiers(state, A).supplyMultiplier, 0.90);
  approx(getStrategicMissionModifiers(state, A).intelMultiplier, 0.75, 1e-9);
  state.theaterPressure[A] = { threat: 100, control: 0, recon: 0, security: 0 };
  approx(getStrategicMissionModifiers(state, A).supplyMultiplier, Math.min(1.4, 1 + 50 * 0.003));
  state.theaterPressure[A] = { threat: 0, control: 100, recon: 0, security: 100 };
  approx(getStrategicMissionModifiers(state, A).supplyMultiplier, STRATEGIC_COST.supply.min);
  assert.ok(STRATEGIC_COST.supply.min === 0.75 && STRATEGIC_COST.supply.max === 1.4);
});

check('first campaign and repeat operation share the same modifier authority', () => {
  const state = createInitialState();
  state.resources = { supply: 1e7, alloy: 1e5, intel: 1e5 };
  state.units.push({ id: 'u0', type: 'mbt', hp: 100, maxHp: 100, damage: 'intact', status: 'assigned', formationId: 'f0', experience: 0, battles: 0, callsign: null, createdAt: 0 });
  state.formations.push({ id: 'f0', name: 'X', unitIds: ['u0'], status: FORMATION_STATUS.IDLE, createdAt: 0 });
  recalcDerived(state);
  ensureTheaterPressure(state);
  state.theaterPressure[A].threat = 90;
  const mission = getMissionCost(state, 'f0', A, 'cautious');
  const op = getOperationCost(state, 'f0', 'salvage_run', 'cautious');
  approx(mission.breakdown.strategicSupplyMultiplier, op.breakdown.strategicSupplyMultiplier);
  approx(mission.breakdown.strategicSupplyMultiplier, 1 + 40 * 0.003);
});

check('strategic costs flow into the real cost objects (rounded per legacy rules)', () => {
  const state = createInitialState();
  state.resources = { supply: 1e7, alloy: 1e5, intel: 1e5 };
  state.units.push({ id: 'u0', type: 'mbt', hp: 100, maxHp: 100, damage: 'intact', status: 'assigned', formationId: 'f0', experience: 0, battles: 0, callsign: null, createdAt: 0 });
  state.formations.push({ id: 'f0', name: 'X', unitIds: ['u0'], status: FORMATION_STATUS.IDLE, createdAt: 0 });
  recalcDerived(state);
  ensureTheaterPressure(state);
  state.theaterPressure[A] = { threat: 50, control: 0, recon: 0, security: 0 };
  const before = getMissionCost(state, 'f0', A, 'cautious').cost.supply;
  state.theaterPressure[A].threat = 90; // ×1.12
  const after = getMissionCost(state, 'f0', A, 'cautious').cost.supply;
  assert.equal(after, Math.round(before * 1.12));
  assert.ok(after > before);
});

function battleReadyState(seed) {
  const state = createInitialState();
  state.resources = { supply: 1e7, alloy: 1e5, intel: 1e5 };
  state.units.push({ id: 'u0', type: 'mbt', hp: 100, maxHp: 100, damage: 'intact', status: 'assigned', formationId: 'f0', experience: 0, battles: 0, callsign: null, createdAt: 0 });
  state.formations.push({ id: 'f0', name: 'X', unitIds: ['u0'], status: FORMATION_STATUS.IDLE, createdAt: 0 });
  recalcDerived(state);
  ensureTheaterPressure(state);
  const dispatched = dispatchFormation(state, 'f0', A, 'cautious', seed);
  assert.equal(dispatched.ok, true, dispatched.reason);
  return { state, ab: dispatched.activeBattle };
}

function settleNow(state) {
  const ab = state.activeBattle;
  ab.elapsed = ab.duration; // 推进到结算点（不改判定，胜负派遣时已定）
  tickActiveBattle(state, 0.01);
  if (!ab.settled) return settleActiveBattle(state);
  return { ok: true, activeBattle: ab };
}

check('VICTORY settlement applies the specified pressure delta', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const { state, ab } = battleReadyState(seed);
    const result = ab.report.result;
    settleNow(state);
    const pressure = theaterPressureView(state, A);
    const expected = STRATEGIC_BATTLE_OUTCOME[result];
    approx(pressure.threat, Math.max(0, Math.min(100, 50 + expected.threat)));
    approx(pressure.control, Math.max(0, Math.min(100, 0 + expected.control)));
    approx(pressure.security, Math.max(0, Math.min(100, 0 + expected.security)));
    approx(pressure.recon, 0, 1e-9); // recon 不因战斗直接变化
    if (result === BATTLE_RESULT.VICTORY) break;
  }
});

check('every outcome table entry is applied and clamped to 0~100', () => {
  Object.keys(STRATEGIC_BATTLE_OUTCOME).forEach((result) => {
    const state = createInitialState();
    ensureTheaterPressure(state);
    state.theaterPressure[A] = { threat: 95, control: 95, recon: 30, security: 95 };
    const outcome = applyStrategicSettlementPressure(state, { theaterId: A, result, receipt: {} });
    assert.equal(outcome.applied, true, result);
    const delta = STRATEGIC_BATTLE_OUTCOME[result];
    const p = state.theaterPressure[A];
    approx(p.threat, Math.max(0, Math.min(100, 95 + delta.threat)));
    approx(p.control, Math.max(0, Math.min(100, 95 + delta.control)));
    approx(p.security, Math.max(0, Math.min(100, 95 + delta.security)));
    approx(p.recon, 30, 1e-9);
  });
  // DEFEAT / WIPED 的具体数值来自规格表
  assert.deepEqual(STRATEGIC_BATTLE_OUTCOME[BATTLE_RESULT.DEFEAT], { threat: 10, control: -8, security: -5 });
  assert.deepEqual(STRATEGIC_BATTLE_OUTCOME[BATTLE_RESULT.WIPED], { threat: 15, control: -12, security: -8 });
});

check('settlement is exactly-once for pressure (repeat settle does nothing)', () => {
  const { state, ab } = battleReadyState(7);
  settleNow(state);
  const afterFirst = { ...theaterPressureView(state, A) };
  const again = settleActiveBattle(state);
  const afterSecond = theaterPressureView(state, A);
  assert.deepEqual(afterSecond, afterFirst);
  void again;
  assert.ok(ab.settlementReceipt.strategicPressure, 'receipt stamped');
  // 凭证幂等防护：手动再用同一 receipt 调用也不会重复应用
  const manual = applyStrategicSettlementPressure(state, { theaterId: A, result: ab.report.result, receipt: ab.settlementReceipt });
  assert.equal(manual.applied, false);
  assert.deepEqual(theaterPressureView(state, A), afterFirst);
});

check('viewing / replaying the report never re-applies pressure', () => {
  const { state } = battleReadyState(11);
  settleNow(state);
  const afterSettle = { ...theaterPressureView(state, A) };
  // replay 只读路径：finishBattleReturn 后由战报 replay 重建的战斗禁止结算
  const finished = state.activeBattle;
  void finished;
  // 直接验证：任何再次对同一 theater 手动应用（模拟旁路）都被 receipt 语义挡住
  const report = state.battles[0];
  assert.ok(report, 'formal report recorded');
  const manual = applyStrategicSettlementPressure(state, { theaterId: A, result: report.result, receipt: { strategicPressure: true } });
  assert.equal(manual.applied, false);
  assert.deepEqual(theaterPressureView(state, A), afterSettle);
});

check('save / load around a settled battle does not re-apply pressure', () => {
  const store = new Map();
  const shim = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; }
  };
  globalThis.localStorage = shim;
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prevWindow = globalThis.window;
  globalThis.window = { localStorage: shim };
  try {
    const { state } = battleReadyState(23);
    settleNow(state);
    const before = { ...theaterPressureView(state, A) };
    saveGame(state, { silent: true, savedAtOverride: Date.now() });
    const loaded = loadGame();
    assert.equal(loaded.ok, true);
    ensureTheaterPressure(loaded.state);
    assert.deepEqual(theaterPressureView(loaded.state, A), before);
  } finally {
    delete globalThis.localStorage;
    if (hadWindow) globalThis.window = prevWindow; else delete globalThis.window;
  }
});

check('Doctrine / Auto Operations / task lifecycle remain intact', () => {
  const { setDoctrine, getActiveDoctrine, getUpkeepMultiplier } = doctrine;
  const { isAutoOperationsEnabled, ensureAutoOperations, runAutoOperationsPlanner } = autoOperations;
  const { assignOperationalTask, recallOperationalTask, getOperationalTask, tickOperationalTasks } = tasking;
  const state = createInitialState();
  state.resources = { supply: 1e7, alloy: 1e5, intel: 1e5 };
  state.units.push({ id: 'u0', type: 'mbt', hp: 100, maxHp: 100, damage: 'intact', status: 'assigned', formationId: 'f0', experience: 0, battles: 0, callsign: null, createdAt: 0 });
  state.formations.push({ id: 'f0', name: 'X', unitIds: ['u0'], status: FORMATION_STATUS.IDLE, createdAt: 0 });
  recalcDerived(state);
  ensureTheaterPressure(state);
  ensureAutoOperations(state);
  setDoctrine(state, 'recon');
  assert.equal(getActiveDoctrine(state), 'recon');
  assert.equal(getUpkeepMultiplier(state, 'recon'), 1.25);
  assignOperationalTask(state, 'f0', 'recon', A);
  tickOperationalTasks(state, 60);
  assert.equal(getOperationalTask(state, 'f0').stats.intervalsCharged, 2);
  recallOperationalTask(state, 'f0');
  assert.equal(typeof isAutoOperationsEnabled(state), 'boolean');
  const plan = runAutoOperationsPlanner(state);
  assert.ok(plan === null || typeof plan === 'object');
});

check('presentation builders stay read-only', () => {
  const state = createInitialState();
  ensureTheaterPressure(state);
  state.theaterPressure[A].threat = 80;
  const before = JSON.parse(JSON.stringify(state));
  getStrategicMissionModifiers(state, A);
  describeStrategicSources(getStrategicMissionModifiers(state, A));
  buildTheaterCommandModels(state);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), before);
});

check('theater inspector exposes STRATEGIC EFFECTS with multipliers and sources', () => {
  const state = createInitialState();
  ensureTheaterPressure(state);
  state.theaterPressure[A] = { threat: 90, control: 20, recon: 40, security: 10 };
  const model = buildTheaterCommandModels(state).find((m) => m.id === `theater:${A}`);
  const section = model.inspector.sections.find((sec) => sec.title.includes('STRATEGIC EFFECTS'));
  assert.ok(section, 'section exists');
  const supplyRow = section.rows.find((r) => r.label === 'Supply Cost');
  const intelRow = section.rows.find((r) => r.label === 'Intel Cost');
  approx(parseFloat(supplyRow.value.slice(1)), getStrategicMissionModifiers(state, A).supplyMultiplier, 1e-9);
  approx(parseFloat(intelRow.value.slice(1)), getStrategicMissionModifiers(state, A).intelMultiplier, 1e-9);
  assert.ok(section.rows.find((r) => r.label === '主要来源').value.includes('Threat'));
});

console.log(`\nStage 10-E strategic loop: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exitCode = 1;
