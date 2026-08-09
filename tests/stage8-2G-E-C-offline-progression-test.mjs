import assert from 'node:assert/strict';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { createUnit } from '../js/production.js';
import { createFormation, addUnit } from '../js/formations.js';
import {
  MAX_STEPS,
  calculateOfflineSeconds,
  settleOfflineWindow,
  settleOfflineProgress,
  buildOfflineReport
} from '../js/offline.js';
import {
  dispatchFormation,
  finishBattleReturn,
  replayBattleSession,
  settleActiveBattle,
  tickActiveBattle
} from '../js/theater.js';
import { migrate } from '../js/save.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const checks = [];
const check = (name, fn) => {
  try { fn(); checks.push({ name, passed: true }); console.log(`  PASS  ${name}`); }
  catch (error) { checks.push({ name, passed: false, error: String(error) }); console.error(`  FAIL  ${name}: ${error.message}`); }
};

function fresh() {
  const state = createInitialState();
  state.resources = { supply: 99999, alloy: 99999, intel: 99999 };
  state.command.capacity = 999;
  ['infantry', 'infantry', 'infantry', 'infantry', 'scout_car'].forEach((type, index) => {
    const unit = createUnit(type, `ec-probe-${index}`);
    unit.id = `ec-probe-unit-${index}`;
    state.units.push(unit);
  });
  const formation = createFormation(state, 'E-C offline boundary formation');
  assert.equal(formation.ok, true);
  state.units.forEach((unit) => addUnit(state, formation.formation.id, unit.id));
  recalcDerived(state);
  return state;
}

function battleState() {
  const state = fresh();
  const result = dispatchFormation(state, state.formations[0].id, 'scrap_mine', 'cautious', 82099);
  assert.equal(result.ok, true);
  return state;
}

console.log('\n── Stage 8.2G-E-C offline / idle progression ──');

check('invalid or future savedAt fails closed with zero seconds', () => {
  const now = 1_700_000_000_000;
  for (const savedAt of [undefined, null, '', 'NaN', NaN]) {
    const result = calculateOfflineSeconds(savedAt, now, 8);
    assert.equal(result.seconds, 0);
    assert.equal(result.rawSeconds, 0);
    assert.equal(result.failClosed, true);
  }
  assert.equal(calculateOfflineSeconds(now + 1000, now, 8).seconds, 0);
  assert.equal(calculateOfflineSeconds(now, now - 1000, 8).seconds, 0);
});

check('valid window preserves raw seconds and cap truthfully', () => {
  const now = 1_700_000_000_000;
  const result = calculateOfflineSeconds(now - (10 * 3600 * 1000), now, 8);
  assert.equal(result.rawSeconds, 36000);
  assert.equal(result.seconds, 28800);
  assert.equal(result.maxSeconds, 28800);
  assert.equal(result.capped, true);
  assert.equal(result.failClosed, false);
});

check('clock rollback never creates negative or positive progression', () => {
  const result = calculateOfflineSeconds(1_700_000_000_000, 1_699_999_999_999, 8);
  assert.deepEqual({ seconds: result.seconds, rawSeconds: result.rawSeconds }, { seconds: 0, rawSeconds: 0 });
  assert.equal(result.capped, false);
});

check('offline window consumes savedAt through the real window helper', () => {
  const state = fresh();
  state.resources.supply = 1000;
  recalcDerived(state);
  const before = state.resources.supply;
  const savedAt = 1_700_000_000_000;
  const result = settleOfflineWindow(state, savedAt, savedAt + 120_000, { createReport: true });
  assert.equal(result.seconds, 120);
  assert.equal(result.report.settled, true);
  assert.equal(result.report.requestedSeconds, 120);
  assert.equal(result.nextSavedAt, savedAt + 120_000);
  assert.ok(state.resources.supply > before);
});

check('same token is exactly once and does not duplicate gains', () => {
  const state = fresh();
  const first = settleOfflineProgress(state, 120, { token: 'ec-once', createReport: true });
  const supply = state.resources.supply;
  const time = state.time.game;
  const second = settleOfflineProgress(state, 120, { token: 'ec-once', createReport: true });
  assert.equal(first.settled, true);
  assert.equal(second.alreadySettled, true);
  assert.equal(state.resources.supply, supply);
  assert.equal(state.time.game, time);
});

check('pending report survives migration and remains dismissible state', () => {
  const state = fresh();
  state.offline = buildOfflineReport({ seconds: 120, requestedSeconds: 120, before: { supply: 1 }, after: { supply: 241 }, battlePaused: false });
  state.offline.shown = false;
  const migrated = migrate(clone(state));
  assert.equal(migrated.offline.shown, false);
  assert.equal(migrated.offline.seconds, 120);
});

check('MAX_STEPS truncation exposes consumed and remaining time', () => {
  const state = fresh();
  // A long valid research queue creates more event boundaries than the safety cap.
  state.buildings.push({ id: 'lab-ec', type: 'research_lab', status: 'operational', progress: 1, level: 1, builtAt: 0, fx: { spawn: 0 }, slot: { gx: 0, gy: 0, w: 2, h: 2, height: 24 } });
  state.research.current = { id: 'ec-research-0', techId: 'logistics_optimization', duration: 0.1, elapsed: 0, costPaid: {} };
  state.research.queue = Array.from({ length: MAX_STEPS + 8 }, (_, index) => ({
    id: `ec-research-${index + 1}`, techId: 'logistics_optimization', duration: 0.1, elapsed: 0, costPaid: {}
  }));
  const report = settleOfflineProgress(state, 1000, { createReport: true });
  assert.equal(report.truncated, true);
  assert.equal(report.steps, MAX_STEPS);
  assert.ok(report.remainingSeconds > 0);
  assert.ok(report.consumedSeconds < report.requestedSeconds);
});

check('MAX_STEPS next savedAt retains the unconsumed window', () => {
  const state = fresh();
  state.buildings.push({ id: 'lab-ec-2', type: 'research_lab', status: 'operational', progress: 1, level: 1, builtAt: 0, fx: { spawn: 0 }, slot: { gx: 0, gy: 0, w: 2, h: 2, height: 24 } });
  state.research.current = { id: 'ec-research-x', techId: 'logistics_optimization', duration: 0.1, elapsed: 0, costPaid: {} };
  state.research.queue = Array.from({ length: MAX_STEPS + 4 }, (_, index) => ({ id: `ec-r-${index}`, techId: 'logistics_optimization', duration: 0.1, elapsed: 0, costPaid: {} }));
  const savedAt = 1_700_000_000_000;
  const result = settleOfflineWindow(state, savedAt, savedAt + 1_000_000, { createReport: true });
  assert.equal(result.truncatedBySteps, true);
  assert.ok(result.nextSavedAt < savedAt + 1_000_000);
  assert.ok(result.report.remainingSeconds > 0);
});

check('active battle boundary preserves session, hashes, report and elapsed', () => {
  const state = battleState();
  const before = clone({
    activeBattle: state.activeBattle,
    session: state.battleSessions[state.activeBattle.battleSessionId],
    reports: state.battles,
    ledger: state.battleSettlementLedger,
    formations: state.formations,
    units: state.units
  });
  const report = settleOfflineProgress(state, 600, { createReport: true });
  const after = { activeBattle: state.activeBattle, session: state.battleSessions[state.activeBattle.battleSessionId], reports: state.battles, ledger: state.battleSettlementLedger, formations: state.formations, units: state.units };
  assert.equal(report.battlePaused, true);
  assert.deepEqual(after, before);
});

check('settlement result boundary does not settle a second time', () => {
  const state = battleState();
  tickActiveBattle(state, state.activeBattle.duration + 1);
  assert.equal(state.activeBattle.settled, true);
  const ledgerCount = Object.keys(state.battleSettlementLedger).length;
  const reportCount = state.battles.length;
  const before = clone({ session: state.battleSessions[state.activeBattle.battleSessionId], ledger: state.battleSettlementLedger, reports: state.battles });
  settleOfflineProgress(state, 600, { createReport: true });
  assert.equal(Object.keys(state.battleSettlementLedger).length, ledgerCount);
  assert.equal(state.battles.length, reportCount);
  assert.deepEqual({ session: state.battleSessions[state.activeBattle.battleSessionId], ledger: state.battleSettlementLedger, reports: state.battles }, before);
});

check('replay boundary preserves canonical session, formation, units and ledger', () => {
  const state = battleState();
  const sessionId = state.activeBattle.battleSessionId;
  tickActiveBattle(state, state.activeBattle.duration + 1);
  finishBattleReturn(state);
  assert.equal(replayBattleSession(state, sessionId).ok, true);
  const before = clone({ session: state.battleSessions[sessionId], formation: state.formations, units: state.units, ledger: state.battleSettlementLedger, elapsed: state.activeBattle.elapsed });
  settleOfflineProgress(state, 600, { createReport: true });
  assert.deepEqual({ session: state.battleSessions[sessionId], formation: state.formations, units: state.units, ledger: state.battleSettlementLedger, elapsed: state.activeBattle.elapsed }, before);
});

check('offline report builder is pure and exposes honest truncation metadata', () => {
  const input = { seconds: 12, requestedSeconds: 20, consumedPreciseSeconds: 12.5, remainingSeconds: 7.5, truncated: true, maxSteps: MAX_STEPS, before: { supply: 1 }, after: { supply: 25 } };
  const copy = clone(input);
  const report = buildOfflineReport(input);
  assert.deepEqual(input, copy);
  assert.equal(report.seconds, 12);
  assert.equal(report.requestedSeconds, 20);
  assert.equal(report.remainingSeconds, 7.5);
  assert.equal(report.truncated, true);
});

const passed = checks.every((item) => item.passed);
console.log(`\nStage 8.2G-E-C result: ${checks.filter((item) => item.passed).length} passed / ${checks.filter((item) => !item.passed).length} failed / ${checks.length} total`);
if (!passed) process.exitCode = 1;
