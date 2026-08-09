import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { createUnit } from '../js/production.js';
import { createFormation, addUnit } from '../js/formations.js';
import {
  dispatchFormation, tickActiveBattle, settleActiveBattle, finishBattleReturn,
  replayBattleSession, validateBattleReportForSettlement, THEATER_CODE
} from '../js/theater.js';
import { migrate, serialize } from '../js/save.js';
import {
  SESSION_ORIGIN, SESSION_LIFECYCLE, canonicalHash, buildSettlementLedgerHash,
  validateSettlementLedger
} from '../js/production-battle-session.js';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';

const failures = [];
let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failures.push({ name, message: error?.message || String(error) });
    console.log(`  FAIL  ${name}\n        → ${error?.message || error}`);
  }
}

function fresh() {
  const state = createInitialState();
  state.resources = { supply: 99999, alloy: 99999, intel: 99999 };
  ['infantry', 'at_infantry', 'scout_car', 'repair_vehicle'].forEach((type, index) => {
    const unit = createUnit(type, `test-building-${index}`);
    unit.id = `ea-unit-${index}`;
    state.units.push(unit);
  });
  state.command.capacity = 999;
  state.command.used = 0;
  const created = createFormation(state, 'E-A 验证编队');
  assert.equal(created.ok, true);
  state.units.forEach((unit) => addUnit(state, created.formation.id, unit.id));
  recalcDerived(state);
  return state;
}

function launch(state, seed = 8127) {
  const formation = state.formations[0];
  const result = dispatchFormation(state, formation.id, 'scrap_mine', 'cautious', seed);
  assert.equal(result.ok, true, result.reason);
  return result.activeBattle;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function complete(state) {
  const active = state.activeBattle;
  assert.ok(active);
  tickActiveBattle(state, active.duration + 1);
  assert.equal(state.activeBattle.settled, true);
  return state.activeBattle;
}

console.log('\n── Stage 8.2G-E-A production battle loop integration ──');

check('session uses deterministic identity and required state surfaces', () => {
  const state = fresh();
  const active = launch(state);
  const session = state.battleSessions[active.battleSessionId];
  assert.equal(session.sessionOrigin, SESSION_ORIGIN.PRODUCTION);
  assert.equal(session.lifecycle, SESSION_LIFECYCLE.RUNNING);
  for (const key of ['battleSessionId', 'missionId', 'deploymentSnapshotId', 'sourceSaveRevision', 'formalReportId', 'formalReportHash', 'sourceReportHash', 'presentationState', 'settlementState', 'returnState']) {
    assert.ok(session[key] !== undefined, `missing ${key}`);
  }
  assert.match(session.battleSessionId, /^battle-session-0-scrap_mine-/);
  assert.equal(session.battleSessionId.includes(String(Date.now())), false);
});

check('deployment snapshot is canonical and immutable against live unit changes', () => {
  const state = fresh();
  const active = launch(state);
  const session = state.battleSessions[active.battleSessionId];
  const beforeHash = canonicalHash(session.deploymentSnapshot);
  state.units[0].hp = 1;
  assert.equal(canonicalHash(session.deploymentSnapshot), beforeHash);
  active.dispatchSnapshot.units?.[0] && (active.dispatchSnapshot.units[0].hp = 1);
  const checkResult = validateBattleReportForSettlement(state, active);
  assert.equal(checkResult.ok, false);
  assert.match(checkResult.reason, /deployment|ProductionBattleSession/i);
});

check('formal report binding rejects report swap and source hash tamper', () => {
  const state = fresh();
  const active = launch(state);
  active.report = clone(active.report);
  active.report.summary = `${active.report.summary || ''} tampered`;
  const result = settleActiveBattle(state);
  assert.equal(result.ok, false);
  assert.equal(result.code, THEATER_CODE.REPORT_INVALID);
  assert.equal(state.activeBattle.settlementBlocked, true);
});

check('formal result is consumed by production presentation without recalculation', () => {
  const state = fresh();
  const active = launch(state);
  const reportRef = active.report;
  tickActiveBattle(state, active.duration / 2);
  assert.equal(state.activeBattle.report, reportRef);
  assert.equal(state.activeBattle.productionSession.formalReportId, reportRef.id);
  assert.equal(state.activeBattle.productionSession.presentationState.elapsed, active.duration / 2);
});

check('settlement writes one ledger entry atomically with report and reward', () => {
  const state = fresh();
  launch(state);
  const active = complete(state);
  const session = state.battleSessions[active.battleSessionId];
  const ledger = state.battleSettlementLedger[session.settlementId];
  assert.ok(ledger);
  assert.equal(ledger.status, 'applied');
  assert.equal(validateSettlementLedger(ledger, session).ok, true);
  assert.equal(ledger.ledgerHash, buildSettlementLedgerHash(ledger));
  assert.equal(state.battles[0].id, active.report.id);
  assert.equal(session.lifecycle, SESSION_LIFECYCLE.SETTLED);
  assert.equal(session.settlementState.locked, true);
});

check('exactly-once protection rejects a forced second settlement', () => {
  const state = fresh();
  launch(state);
  const active = complete(state);
  const before = JSON.stringify({ resources: state.resources, stats: state.stats, units: state.units });
  active.settled = false;
  active.playing = false;
  const result = settleActiveBattle(state);
  assert.equal(result.ok, false);
  assert.equal(result.code, THEATER_CODE.SETTLEMENT_BLOCKED);
  assert.equal(JSON.stringify({ resources: state.resources, stats: state.stats, units: state.units }), before);
});

check('reload while running preserves session, snapshot and presentation time', () => {
  const state = fresh();
  const active = launch(state);
  tickActiveBattle(state, active.duration / 3);
  const saved = serialize(state);
  const loaded = migrate(clone(saved), {});
  assert.equal(loaded.activeBattle.battleSessionId, active.battleSessionId);
  assert.equal(loaded.battleSessions[active.battleSessionId].deploymentHash, active.deploymentHash);
  assert.equal(loaded.activeBattle.elapsed, active.duration / 3);
  assert.equal(loaded.activeBattle.settled, false);
});

check('reload after formal completion applies settlement once', () => {
  const state = fresh();
  const active = launch(state);
  active.elapsed = active.duration;
  active.playing = false;
  const loaded = migrate(clone(serialize(state)), {});
  const resumed = loaded.activeBattle;
  tickActiveBattle(loaded, 0);
  assert.equal(loaded.activeBattle.settled, true);
  assert.equal(Object.keys(loaded.battleSettlementLedger).length, 1);
  assert.equal(loaded.battles[0].id, resumed.report.id);
});

check('replay is read-only, same report/session, and cannot settle', () => {
  const state = fresh();
  launch(state);
  const active = complete(state);
  const sessionId = active.battleSessionId;
  finishBattleReturn(state);
  const before = JSON.stringify({ resources: state.resources, stats: state.stats, units: state.units, ledger: state.battleSettlementLedger });
  const replay = replayBattleSession(state, sessionId);
  assert.equal(replay.ok, true);
  assert.equal(replay.readOnly, true);
  assert.equal(state.activeBattle.report.id, state.battles[0].id);
  tickActiveBattle(state, state.activeBattle.duration + 1);
  const denied = settleActiveBattle(state);
  assert.equal(denied.ok, false);
  assert.equal(JSON.stringify({ resources: state.resources, stats: state.stats, units: state.units, ledger: state.battleSettlementLedger }), before);
});

check('tampered ledger reward is rejected before replay', () => {
  const state = fresh();
  launch(state);
  const active = complete(state);
  const session = state.battleSessions[active.battleSessionId];
  state.battleSettlementLedger[session.settlementId].reward.alloy = 999999;
  finishBattleReturn(state);
  const result = replayBattleSession(state, session.battleSessionId);
  assert.equal(result.ok, false);
  assert.match(result.reason, /ledger hash/i);
});

check('tampered settlement ID, source revision, and debug origin fail closed', () => {
  const cases = [
    ['settlement ID', (state, active, session) => { active.settlementId = `${session.settlementId}-tampered`; }],
    ['source save revision', (state, active, session) => { active.sourceSaveRevision = session.sourceSaveRevision + 1; }],
    ['debug origin', (state, active, session) => { session.sessionOrigin = SESSION_ORIGIN.DEBUG; }]
  ];
  cases.forEach(([label, mutate]) => {
    const state = fresh();
    const active = launch(state);
    const session = state.battleSessions[active.battleSessionId];
    mutate(state, active, session);
    const result = settleActiveBattle(state);
    assert.equal(result.ok, false, label);
    assert.equal(result.code, THEATER_CODE.REPORT_INVALID, label);
  });
});

check('production source does not use fixture/debug settlement path', () => {
  const state = fresh();
  const active = launch(state);
  assert.equal(active.sessionOrigin, SESSION_ORIGIN.PRODUCTION);
  assert.equal(state.battleSessions[active.battleSessionId].sessionOrigin, SESSION_ORIGIN.PRODUCTION);
});

check('session hash matches independent SHA-256 implementation', () => {
  const state = fresh();
  const active = launch(state);
  const session = state.battleSessions[active.battleSessionId];
  const expected = createHash('sha256').update(stableStringify(session.deploymentSnapshot)).digest('hex');
  // canonicalHash is deliberately stable-stringify based; this assertion
  // checks the implementation against the same one-key canonical form.
  assert.equal(canonicalHash(session.deploymentSnapshot), expected);
});

console.log(`\nStage 8.2G-E-A result: ${passed} passed / ${failures.length} failed / ${passed + failures.length} total`);
if (failures.length) {
  console.error(JSON.stringify({ stage: '8.2G-E-A', passed, failures }, null, 2));
  process.exitCode = 1;
}
