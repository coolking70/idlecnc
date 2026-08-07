/** 阶段8.2F-C.1：战前手动存档恢复与步坦协同战术回归。 */
import assert from 'node:assert/strict';
import * as cfg from '../js/config.js';
import * as st from '../js/state.js';
import * as econ from '../js/economy.js';
import * as save from '../js/save.js';
import * as theater from '../js/theater.js';
import { simulateBattle } from '../js/battle.js';
import { resolveBattleTactics } from '../js/battle-tactics.js';
import { buildPresentationContract } from '../js/battle-presentation/contract-battle-adapter.js';
import { buildVictoryPresentationPlan } from '../js/battle-presentation/core/contract-plan-builder.js';

const storage = new Map();
globalThis.window = {
  localStorage: {
    setItem(key, value) { storage.set(String(key), String(value)); },
    getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
    removeItem(key) { storage.delete(String(key)); },
    clear() { storage.clear(); }
  }
};

function freshBattle() {
  const state = st.createInitialState();
  state.units = ['mbt', 'infantry', 'at_infantry', 'repair_vehicle'].map((type, index) => ({
    id: `u-${index}`, type, hp: cfg.UNITS[type].stats.hp, maxHp: cfg.UNITS[type].stats.hp,
    damage: 'intact', status: 'assigned', formationId: 'f', experience: 0, battles: 0
  }));
  state.formations = [{ id: 'f', name: '步坦测试群', status: cfg.FORMATION_STATUS.IDLE, unitIds: state.units.map((u) => u.id), experience: 0, battles: 0 }];
  econ.recalcDerived(state);
  return state;
}

function checkManualLoadRestoresPreBattleState() {
  storage.clear();
  const state = freshBattle();
  const beforeHp = state.units.map((unit) => unit.hp);
  const beforeSupply = state.resources.supply;
  assert.equal(save.saveGame(state), true);
  const manualBefore = storage.get(save.MANUAL_SAVE_KEY);
  assert.ok(manualBefore, '显式保存应写入手动槽位');

  const dispatch = theater.dispatchFormation(state, 'f', 'scrap_mine', 'cautious', 9301);
  assert.equal(dispatch.ok, true);
  theater.settleActiveBattle(state);
  save.saveGame(state, { silent: true });
  assert.notEqual(storage.get(cfg.SAVE_KEY), manualBefore, '结算后的自动状态应与战前手动状态不同');
  assert.equal(storage.get(save.MANUAL_SAVE_KEY), manualBefore, '自动保存不得覆盖战前手动槽位');

  const auto = save.loadGame();
  assert.equal(auto.ok, true);
  assert.equal(auto.source, 'auto');
  assert.ok(auto.state.battles.length >= 1, '自动槽位应保留最新战斗');
  const restored = save.loadGame({ preferManual: true });
  assert.equal(restored.ok, true);
  assert.equal(restored.source, 'manual');
  assert.equal(restored.state.activeBattle, null, '读战前手动档不应带入战斗中的活动战斗');
  assert.deepEqual(restored.state.units.map((unit) => unit.hp), beforeHp);
  assert.equal(restored.state.resources.supply, beforeSupply);
}

function checkCombinedArmsDoctrine() {
  const state = freshBattle();
  const baseline = simulateBattle({ state, formation: state.formations[0], theaterId: 'scrap_mine', strategyId: 'breakthrough', seed: 9302 });
  assert.equal(baseline.tactics.combinedArms, true);
  assert.equal(baseline.tactics.name, '步坦协同楔形');
  assert.equal(baseline.tactics.roles['unit_u-0'].role, 'vanguard');
  assert.equal(baseline.tactics.roles['unit_u-1'].role, 'infantry_screen');
  assert.equal(baseline.tactics.roles['unit_u-2'].role, 'overwatch');
  assert.equal(baseline.tactics.roles['unit_u-3'].role, 'support');
  assert.ok(baseline.tactics.commands.some((command) => command.id === 'screen'));

  state.research.completed = ['tactical_datalink', 'field_maintenance', 'expanded_command_network'];
  const researched = simulateBattle({ state, formation: state.formations[0], theaterId: 'scrap_mine', strategyId: 'breakthrough', seed: 9302 });
  assert.ok(researched.tactics.metrics.coordination > baseline.tactics.metrics.coordination);
  assert.ok(researched.tactics.metrics.protection > baseline.tactics.metrics.protection);
  assert.ok(researched.tactics.metrics.armorAttack > baseline.tactics.metrics.armorAttack);
  assert.deepEqual(researched.tactics.roles, baseline.tactics.roles, '研究应增强协同，不应改变单位角色分配');
}

function checkFormalMixedArmsLayout() {
  const state = freshBattle();
  const types = ['infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle'];
  state.units = types.map((type, index) => ({
    id: `formal-u-${index}`, type, hp: cfg.UNITS[type].stats.hp, maxHp: cfg.UNITS[type].stats.hp,
    damage: 'intact', status: 'assigned', formationId: 'f', experience: 0, battles: 0
  }));
  state.formations[0].unitIds = state.units.map((unit) => unit.id);
  state.theaters.scrap_mine.captured = true;
  const report = simulateBattle({ state, formation: state.formations[0], theaterId: 'border_road', strategyId: 'breakthrough', seed: 1 });
  const plan = buildVictoryPresentationPlan(buildPresentationContract(report));
  assert.equal(plan.ok, true, plan.validation.errors.join('; '));
  assert.equal(plan.continuousLayout.ok, true);
  assert.deepEqual(plan.continuousLayout.errors, []);
}

checkManualLoadRestoresPreBattleState();
checkCombinedArmsDoctrine();
checkFormalMixedArmsLayout();
console.log('stage8-2F-C-1-test: 3 passed / 3 total');
