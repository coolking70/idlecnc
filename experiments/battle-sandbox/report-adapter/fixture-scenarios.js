import { UNITS, OPERATIONS } from '../../../js/config.js';
import { createInitialState } from '../../../js/state.js';

const strongTypes = ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle'];
const campaignVictoryTypes = ['infantry', 'at_infantry', 'scout_car', 'mbt', 'mbt', 'repair_vehicle'];

export const SCENARIOS = [
  {
    id: 'campaign-victory', unitTypes: campaignVictoryTypes, unitHpRatios: [1, 1, 1, 1, 1, 1],
    theaterId: 'border_road', strategyId: 'breakthrough', missionKind: 'campaign', missionId: 'border_road',
    seed: 1, expectedResult: 'victory', requireValidation: true, requireSupportedContract: true
  },
  {
    id: 'campaign-withdraw', unitTypes: strongTypes, unitHpRatios: [1, 1, 1, 1, 1],
    theaterId: 'border_road', strategyId: 'breakthrough', missionKind: 'campaign', missionId: 'border_road',
    seed: 12, expectedResult: 'withdraw', requireValidation: true, requireSupportedContract: true
  },
  {
    id: 'campaign-defeat-or-wiped', unitTypes: ['infantry'], unitHpRatios: [1],
    theaterId: 'enemy_outpost', strategyId: 'cautious', missionKind: 'campaign', missionId: 'enemy_outpost',
    seed: 1, expectedResult: 'wiped', requireValidation: true, requireSupportedContract: false
  },
  {
    id: 'operation-result', unitTypes: strongTypes, unitHpRatios: [1, 1, 1, 1, 1],
    theaterId: 'scrap_mine', strategyId: 'breakthrough', missionKind: 'operation', missionId: 'salvage_run',
    seed: 1, expectedResult: 'victory', requireValidation: true, requireSupportedContract: true
  }
];

export function rebuildScenarioInput(scenario) {
  const state = createInitialState();
  const unitIds = scenario.unitTypes.map((type, index) => `fixture-u-${index + 1}`);
  state.units.push(...scenario.unitTypes.map((type, index) => {
    const def = UNITS[type];
    const ratio = Number.isFinite(Number(scenario.unitHpRatios?.[index])) ? Number(scenario.unitHpRatios[index]) : 1;
    return {
      id: unitIds[index], type, hp: Math.max(0, Math.round(def.stats.hp * ratio)), maxHp: def.stats.hp,
      damage: 'intact', status: 'assigned', formationId: 'fixture-f', callsign: null,
      experience: 0, battles: 0, createdAt: 1
    };
  }));
  const formation = { id: 'fixture-f', name: 'Fixture 编队', status: 'idle', unitIds };
  return {
    state, formation, theaterId: scenario.theaterId, strategyId: scenario.strategyId,
    missionKind: scenario.missionKind, missionId: scenario.missionId,
    missionConfig: scenario.missionKind === 'operation' ? OPERATIONS[scenario.missionId] : null,
    seed: scenario.seed
  };
}
