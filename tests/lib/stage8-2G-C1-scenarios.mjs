import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cfg from '../../js/config.js';
import * as stateApi from '../../js/state.js';
import * as economy from '../../js/economy.js';
import { simulateBattle } from '../../js/battle.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureRoot = path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures');
export const C1_FRAME_SPECS = Object.freeze({
  victory: [['victory-01-environment-opening.png', .08, 'environment-opening'], ['victory-02-mixed-weapon-fire.png', .48, 'mixed-weapon-fire'], ['victory-03-heavy-impact-crater.png', .62, 'heavy-impact-crater'], ['victory-04-sprite-tank.png', .66, 'sprite-tank'], ['victory-05-authoritative-destruction.png', .72, 'authoritative-destruction'], ['victory-06-wreck-sprite-smoke.png', .82, 'wreck-sprite-smoke'], ['victory-07-persistent-battlefield.png', .92, 'persistent-battlefield'], ['victory-08-battle-end.png', 1, 'battle-end']],
  defeat: [['defeat-01-damaged-battlefield.png', .58, 'damaged-battlefield'], ['defeat-02-rear-guard-fire.png', .68, 'rear-guard-fire'], ['defeat-03-retreat-through-smoke.png', .78, 'retreat-through-smoke'], ['defeat-04-critical-loss.png', .88, 'critical-loss'], ['defeat-05-final-wreck-field.png', 1, 'final-wreck-field']],
  assets: [['asset-01-infantry-sprite.png', .48, 'asset-01-infantry'], ['asset-02-tank-hybrid.png', .62, 'asset-02-tank'], ['asset-03-wreck-sprite.png', .82, 'asset-03-wreck'], ['asset-04-industrial-cover.png', .08, 'asset-04-industrial'], ['asset-05-terrain-prop.png', .08, 'asset-05-terrain'], ['asset-06-missing-asset-fallback.png', .48, 'asset-06-missing']]
});

export async function loadFixtureReport(file) { return JSON.parse(await fs.readFile(path.join(fixtureRoot, file), 'utf8')).report; }
export function miningVictoryReport() { const state = stateApi.createInitialState(); const types = ['infantry', 'at_infantry', 'scout_car', 'mbt', 'repair_vehicle']; state.units = types.map((type, index) => ({ id: `stage8g-c1-mining-${index}`, type, hp: cfg.UNITS[type].stats.hp, maxHp: cfg.UNITS[type].stats.hp, damage: 'intact', status: 'assigned', formationId: 'stage8g-c1-mining', experience: 0, battles: 0 })); state.formations = [{ id: 'stage8g-c1-mining', name: 'C.1 矿区混合编队', status: cfg.FORMATION_STATUS.IDLE, unitIds: state.units.map((unit) => unit.id), experience: 0, battles: 0 }]; economy.recalcDerived(state); return simulateBattle({ state, formation: state.formations[0], theaterId: 'scrap_mine', strategyId: 'breakthrough', seed: 1 }); }
export async function buildC1ScenarioReports() { return { victory: miningVictoryReport(), defeat: await loadFixtureReport('campaign-withdraw.json') }; }
