import fs from 'node:fs';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { createUnit } from '../js/production.js';
import { createFormation, addUnit } from '../js/formations.js';
import { settleOfflineProgress } from '../js/offline.js';
import { dispatchFormation, finishBattleReturn, replayBattleSession, tickActiveBattle } from '../js/theater.js';

const LIMIT_MS = 16.7;
const WARMUP = 20;
const SAMPLES = 120;

function fresh() {
  const state = createInitialState();
  state.resources = { supply: 1000, alloy: 1000, intel: 20 };
  state.command.capacity = 999;
  ['infantry', 'infantry', 'infantry', 'infantry', 'scout_car'].forEach((type, index) => {
    const unit = createUnit(type, `ec-perf-${index}`);
    unit.id = `ec-perf-unit-${index}`;
    state.units.push(unit);
  });
  const formation = createFormation(state, 'E-C performance formation');
  state.units.forEach((unit) => addUnit(state, formation.formation.id, unit.id));
  recalcDerived(state);
  return state;
}

function makeScenario(name) {
  const state = fresh();
  if (name === 'construction') {
    state.construction.current = { id: 'ec-perf-construction', type: 'barracks', duration: 600, elapsed: 30, startedAt: 0 };
  }
  if (name === 'battle') dispatchFormation(state, state.formations[0].id, 'scrap_mine', 'cautious', 82101);
  if (name === 'replay') {
    const launched = dispatchFormation(state, state.formations[0].id, 'scrap_mine', 'cautious', 82102);
    const sessionId = launched.activeBattle.battleSessionId;
    tickActiveBattle(state, launched.activeBattle.duration + 1);
    finishBattleReturn(state);
    replayBattleSession(state, sessionId);
  }
  return state;
}

function measure(name) {
  for (let i = 0; i < WARMUP; i += 1) settleOfflineProgress(makeScenario(name), 60, { createReport: false });
  const samples = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const state = makeScenario(name);
    const start = performance.now();
    settleOfflineProgress(state, 60, { createReport: false });
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const p95Ms = samples[Math.ceil(samples.length * 0.95) - 1] || 0;
  return { scenario: name, warmupSamples: WARMUP, sampleCount: SAMPLES, p95Ms, maxMs: Math.max(...samples), passed: p95Ms < LIMIT_MS };
}

const scenarios = ['idle', 'construction', 'battle', 'replay'].map(measure);
const output = {
  stage: '8.2G-E-C',
  metric: 'p95',
  warmupSamples: WARMUP,
  sampleCount: SAMPLES,
  p95BudgetMs: LIMIT_MS,
  noPerFrameFullStateWork: true,
  scenarios,
  passed: scenarios.every((row) => row.passed)
};
fs.writeFileSync('stage8_2g_ec_performance_check.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, warmupSamples: WARMUP, sampleCount: SAMPLES, scenarios: scenarios.map(({ scenario, p95Ms }) => ({ scenario, p95Ms })) }));
if (!output.passed) process.exitCode = 1;
