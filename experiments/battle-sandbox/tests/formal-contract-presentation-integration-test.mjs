import assert from 'node:assert/strict';
import { createInitialState, createBuilding } from '../../../js/state.js';
import { UNITS, BUILDING_STATUS } from '../../../js/config.js';
import { recalcDerived } from '../../../js/economy.js';
import { simulateBattle } from '../../../js/battle.js';
import { createContractBattlePresentation } from '../../../js/battle-presentation/contract-battle-adapter.js';
import { presentationTimeFor } from '../../../js/battle-presentation/contract-time-bridge.js';

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${name}`); }

function runtimeState() {
  const state = createInitialState();
  for (const type of ['barracks', 'armor_factory', 'radar_station']) state.buildings.push(createBuilding(type, BUILDING_STATUS.OPERATIONAL));
  const types = ['infantry', 'infantry', 'scout_car', 'mbt', 'at_infantry'];
  state.units = types.map((type, index) => {
    const def = UNITS[type];
    return { id: `integration-unit-${index + 1}`, type, name: def.name, hp: def.stats.hp, maxHp: def.stats.hp, status: 'assigned', formationId: 'integration-formation', experience: 0, battles: 0, callsign: null, createdAt: index + 1, damage: 'intact' };
  });
  state.formations = [{ id: 'integration-formation', name: '集成测试战斗群', unitIds: state.units.map((unit) => unit.id), status: 'idle', strategy: null, theaterId: null, experience: 0, battles: 0, createdAt: 1 }];
  state.theaters.scrap_mine.captured = true;
  state.resources.intel = 100;
  recalcDerived(state);
  return state;
}

console.log('\n════════════════════════════════════════════');
console.log('  正式战斗页面契约演出集成测试');
console.log('════════════════════════════════════════════');

for (const seed of [1, 2, 3]) {
  const state = runtimeState();
  const report = simulateBattle({ state, formation: state.formations[0], theaterId: 'border_road', strategyId: seed === 1 ? 'cautious' : 'breakthrough', seed });
  const activeBattle = { id: report.id, theaterId: 'border_road', report, elapsed: 0, duration: report.duration, presentationPhase: 'battle', returnElapsed: 0, returnDuration: 5 };
  const presentation = createContractBattlePresentation(activeBattle);
  check(`${seed}. dynamic report is accepted or explicitly bounded`, () => assert.equal(typeof presentation.ok, 'boolean'));
  if (!presentation.ok) continue;
  check(`${seed}. template is road victory`, () => assert.equal(presentation.plan.templateId, 'road_assault_v1_infantry_defense'));
  check(`${seed}. actor count is report-derived`, () => assert.equal(presentation.plan.counts.realActors, report.initial.friendly.length + report.initial.enemy.length));
  check(`${seed}. source time zero maps to zero`, () => assert.equal(presentationTimeFor(activeBattle, presentation), 0));
  activeBattle.elapsed = Math.min(12, report.duration);
  check(`${seed}. source time advances presentation`, () => assert.ok(presentationTimeFor(activeBattle, presentation) > 0));
  check(`${seed}. presentation time stays within 35 seconds`, () => assert.ok(presentationTimeFor(activeBattle, presentation) <= 35));
  activeBattle.presentationPhase = 'returning';
  check(`${seed}. returning phase pins presentation at 35`, () => assert.equal(presentationTimeFor(activeBattle, presentation), 35));
  check(`${seed}. returning visual state is available`, () => assert.equal(presentation.renderState.atTime(35).returning, true));
}

const state = runtimeState();
const report = simulateBattle({ state, formation: state.formations[0], theaterId: 'border_road', strategyId: 'cautious', seed: 1 });
const active = { id: report.id, theaterId: 'border_road', report, elapsed: 0, duration: report.duration, presentationPhase: 'battle' };
const first = createContractBattlePresentation(active);
const second = createContractBattlePresentation(active);
check('25 identical runtime report builds identical plan', () => assert.deepEqual(first.plan, second.plan));
check('26 plan has no hard-coded actor ids', () => {
  const ids = new Set([...first.contract.normalizedBattle.actors.friendly, ...first.contract.normalizedBattle.actors.enemy].map((actor) => actor.id));
  assert.ok(first.plan.actors.every((actor) => ids.has(actor.sourceActorId)));
});
check('27 plan has required repair choreography when report has repairs', () => assert.ok(first.plan.repairGroups.length >= 0));
check('28 result remains victory at final state', () => assert.equal(first.renderState.textAt(35).result, 'victory'));
check('29 final objective is captured', () => assert.equal(first.renderState.textAt(35).objective.status, 'captured'));
check('30 integration path contains no experiment import', () => assert.doesNotMatch(first.plan.sourceKind, /experiment/));

console.log(`formal-contract-presentation-integration-test: ${passed} passed / ${passed} total`);
