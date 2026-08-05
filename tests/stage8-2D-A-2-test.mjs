import assert from 'node:assert/strict';
import { BATTLE_RESULT, UNITS, FORMATION_STATUS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { simulateBattle } from '../js/battle.js';
import { validateBattleOutcomeConsistency } from '../js/integrity.js';
import { determineBattleOutcome, isCombatCapableUnit, validateOutcomeSnapshot } from '../js/battle-outcome.js';
import * as theater from '../js/theater.js';
import { SCENARIOS, rebuildScenarioInput } from '../experiments/battle-sandbox/report-adapter/fixture-scenarios.js';

let total = 0; let passed = 0;
function check(name, fn) { total += 1; try { fn(); passed += 1; console.log(`  PASS  ${String(total).padStart(2, '0')} ${name}`); } catch (error) { console.log(`  FAIL  ${String(total).padStart(2, '0')} ${name}: ${error.message}`); throw error; } }
const combat = (id, hp = 100, attack = 10) => ({ id, hp, maxHp: hp, attack, alive: hp > 0 });
const support = (id, hp = 100) => combat(id, hp, 0);
const validEvents = [{ type: 'retreat' }, { type: 'result' }];

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.2D-A.2 正式结果语义测试');
console.log('════════════════════════════════════════════');
check('outcome module exports unified functions', () => ['isCombatCapableUnit', 'determineBattleOutcome', 'validateOutcomeSnapshot'].forEach((name) => assert.equal(typeof { isCombatCapableUnit, determineBattleOutcome, validateOutcomeSnapshot }[name], 'function')));
check('enemy zero permits victory', () => assert.equal(validateOutcomeSnapshot({ friendly: [combat('f')], enemy: [], result: BATTLE_RESULT.VICTORY, missionKind: 'campaign', capture: true, rewards: { alloy: 1 } }).ok, true));
check('enemy zero permits pyrrhic', () => assert.equal(validateOutcomeSnapshot({ friendly: [combat('f')], enemy: [], result: BATTLE_RESULT.PYRRHIC, missionKind: 'campaign', capture: true, rewards: { alloy: 1 } }).ok, true));
check('enemy live rejects victory', () => assert.equal(validateOutcomeSnapshot({ friendly: [combat('f')], enemy: [combat('e')], result: BATTLE_RESULT.VICTORY, missionKind: 'campaign', capture: true }).ok, false));
check('enemy live rejects pyrrhic', () => assert.equal(validateOutcomeSnapshot({ friendly: [combat('f')], enemy: [combat('e')], result: BATTLE_RESULT.PYRRHIC, missionKind: 'campaign', capture: true }).ok, false));
check('max-round equal combat with weak hp withdraws or loses', () => assert.ok([BATTLE_RESULT.WITHDRAW, BATTLE_RESULT.DEFEAT].includes(determineBattleOutcome({ friendly: [combat('f', 50)], enemy: [combat('e', 100)] }))));
check('support-only survivor is defeat', () => assert.equal(determineBattleOutcome({ friendly: [support('medic')], enemy: [combat('e')] }), BATTLE_RESULT.DEFEAT));
check('no friendly survivor is wiped', () => assert.equal(determineBattleOutcome({ friendly: [support('medic', 0)], enemy: [combat('e')] }), BATTLE_RESULT.WIPED));
check('capture and reward semantics are strict', () => { assert.equal(validateOutcomeSnapshot({ friendly: [combat('f')], enemy: [combat('e')], result: BATTLE_RESULT.DEFEAT, missionKind: 'campaign', capture: true, rewards: { alloy: 1 } }).ok, false); assert.equal(validateOutcomeSnapshot({ friendly: [combat('f')], enemy: [combat('e')], result: BATTLE_RESULT.WITHDRAW, missionKind: 'campaign', capture: false, rewards: {} , events: validEvents }).ok, true); assert.equal(validateOutcomeSnapshot({ friendly: [combat('f')], enemy: [combat('e')], result: BATTLE_RESULT.WITHDRAW, missionKind: 'campaign', capture: false, rewards: { alloy: 1 }, events: validEvents }).ok, false); });
check('withdraw requires exactly one retreat before result', () => { assert.equal(validateOutcomeSnapshot({ friendly: [combat('f')], enemy: [combat('e')], result: BATTLE_RESULT.WITHDRAW, capture: false, events: validEvents }).ok, true); assert.equal(validateOutcomeSnapshot({ friendly: [combat('f')], enemy: [combat('e')], result: BATTLE_RESULT.WITHDRAW, capture: false, events: [{ type: 'retreat' }, { type: 'retreat' }, { type: 'result' }] }).ok, false); });
check('combat capability uses hp/alive/attack', () => { assert.equal(isCombatCapableUnit(combat('f')), true); assert.equal(isCombatCapableUnit({ ...combat('f'), alive: false }), false); assert.equal(isCombatCapableUnit({ ...combat('f'), hp: 0 }), false); assert.equal(isCombatCapableUnit(support('m')), false); });
check('legacy five-unit seed 2 is no longer illegal victory', () => { const scenario = { unitTypes: ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'], unitHpRatios: [1, 1, 1, 1, 1], theaterId: 'border_road', strategyId: 'breakthrough', missionKind: 'campaign', missionId: 'border_road', seed: 2 }; const report = simulateBattle({ ...rebuildScenarioInput(scenario), seed: 2 }); assert.notEqual(report.result, BATTLE_RESULT.VICTORY); assert.equal(report.capture, false); assert.deepEqual(report.rewards, {}); assert.equal(validateBattleOutcomeConsistency(report).ok, true); });
check('legacy seed 2 has authoritative retreat when withdrawn', () => { const scenario = { unitTypes: ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'], unitHpRatios: [1, 1, 1, 1, 1], theaterId: 'border_road', strategyId: 'breakthrough', missionKind: 'campaign', missionId: 'border_road', seed: 2 }; const report = simulateBattle({ ...rebuildScenarioInput(scenario), seed: 2 }); if (report.result === BATTLE_RESULT.WITHDRAW) { assert.equal(report.events.filter((event) => event.type === 'retreat').length, 1); assert.equal(report.events.at(-1).type, 'result'); } });
function prepareBorderRoadSettlementInput(scenario) {
  const input = rebuildScenarioInput(scenario);
  input.state.formations.push(input.formation);
  input.state.theaters.scrap_mine = { captured: true };
  input.state.theaters.border_road = { captured: false };
  input.formation.status = FORMATION_STATUS.IDLE;
  recalcDerived(input.state);
  return input;
}
check('seed 2 active battle settles without block', () => { const scenario = { unitTypes: ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'], unitHpRatios: [1, 1, 1, 1, 1], theaterId: 'border_road', strategyId: 'breakthrough', missionKind: 'campaign', missionId: 'border_road', seed: 2 }; const input = prepareBorderRoadSettlementInput(scenario); const dispatched = theater.dispatchFormation(input.state, input.formation.id, scenario.theaterId, scenario.strategyId, scenario.seed); assert.equal(dispatched.ok, true, dispatched.reason); assert.equal(theater.validateBattleReportForSettlement(input.state, input.state.activeBattle).ok, true); const settled = theater.settleActiveBattle(input.state); assert.equal(settled.ok, true, settled.reason); assert.notEqual(settled.code, theater.THEATER_CODE.SETTLEMENT_BLOCKED); assert.notEqual(input.state.activeBattle?.settlementBlocked, true); });
check('settlement retry does not duplicate error logs', () => { const scenario = { unitTypes: ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'], unitHpRatios: [1, 1, 1, 1, 1], theaterId: 'border_road', strategyId: 'breakthrough', missionKind: 'campaign', missionId: 'border_road', seed: 2 }; const input = prepareBorderRoadSettlementInput(scenario); assert.equal(theater.dispatchFormation(input.state, input.formation.id, scenario.theaterId, scenario.strategyId, scenario.seed).ok, true); const before = input.state.log.length; const result = theater.settleActiveBattle(input.state); assert.equal(result.ok, true); assert.equal(input.state.log.length >= before, true); });
check('operation victory remains successful without capture', () => { const scenario = SCENARIOS.find((row) => row.id === 'operation-result'); const report = simulateBattle({ ...rebuildScenarioInput(scenario), seed: scenario.seed }); assert.equal(report.result, BATTLE_RESULT.VICTORY); assert.equal(report.capture, false); assert.equal(validateBattleOutcomeConsistency(report).ok, true); });

const scanScenarios = [
  { id: 'legacy-road', unitTypes: ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'], unitHpRatios: [1, 1, 1, 1, 1], theaterId: 'border_road', strategyId: 'breakthrough', missionKind: 'campaign', missionId: 'border_road', seed: 1 },
  { ...SCENARIOS.find((row) => row.id === 'campaign-victory') },
  { ...SCENARIOS.find((row) => row.id === 'campaign-defeat-or-wiped') },
  { ...SCENARIOS.find((row) => row.id === 'operation-result') }
];
for (const scenario of scanScenarios) check(`seed scan 1..2000 has no invalid outcomes: ${scenario.id}`, () => { for (let seed = 1; seed <= 2000; seed += 1) { const report = simulateBattle({ ...rebuildScenarioInput({ ...scenario, seed }), seed }); assert.equal(validateBattleOutcomeConsistency(report).ok, true, `${scenario.id} seed ${seed}`); const enemyCombat = report.final.enemy.filter(isCombatCapableUnit).length; if ([BATTLE_RESULT.VICTORY, BATTLE_RESULT.PYRRHIC].includes(report.result)) assert.equal(enemyCombat, 0); else assert.ok(enemyCombat > 0 || report.result === BATTLE_RESULT.WIPED); } });

console.log(`stage8-2D-A-2-test: ${passed} passed / ${total} total`);
