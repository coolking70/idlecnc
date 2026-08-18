import assert from 'node:assert/strict';

/**
 * Stage 10-A — Operational Tasking Core targeted tests.
 *
 * 权威层：js/tasking.js（canAssign / assign / recall / get / tick）。
 * 共享文件钩子：theater.js 派遣互斥、offline.js 离线推进。
 * 本文件不重复 Stage9 语义回归（由既有 stage9 套件覆盖）。
 */

import { BUILDING_STATUS, FORMATION_STATUS, SAVE_VERSION } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { saveGame, loadGame, SAVE_KEY } from '../js/save.js';
import { dispatchFormation } from '../js/theater.js';
import { settleOfflineProgress } from '../js/offline.js';
import {
  OPERATIONAL_TASK, OPERATIONAL_TASK_TYPE,
  canAssignOperationalTask, assignOperationalTask, recallOperationalTask,
  getOperationalTask, listOperationalTasks, describeOperationalTask,
  tickOperationalTasks
} from '../js/tasking.js';
import { buildFormationCommandModels } from '../js/command-presentation.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const THEATER = 'scrap_mine';

function readyState({ units = 2 } = {}) {
  const state = createInitialState();
  state.resources = { supply: 9000, alloy: 9000, intel: 900 };
  for (let i = 0; i < units; i += 1) {
    state.units.push({
      id: `u${i + 1}`, type: i === 0 ? 'mbt' : 'infantry', hp: 100, maxHp: 100, damage: 'intact',
      status: 'assigned', formationId: 'f1', experience: 0, battles: 0, callsign: null, createdAt: i + 1
    });
  }
  state.formations.push({ id: 'f1', name: '第一梯队', unitIds: state.units.map((u) => u.id), status: FORMATION_STATUS.IDLE, createdAt: 1 });
  recalcDerived(state);
  return state;
}

function localStorageShim() {
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
  // save.js 通过 window.localStorage 访问存储；补一个最小 window 桩
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const prevWindow = globalThis.window;
  globalThis.window = { localStorage: shim };
  return () => {
    delete globalThis.localStorage;
    if (hadWindow) globalThis.window = prevWindow; else delete globalThis.window;
  };
}

let passed = 0;
let total = 0;
const check = (name, fn) => {
  total += 1;
  try { fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (error) { console.error(`  FAIL  ${name}: ${error?.message || error}`); process.exitCode = 1; }
};

console.log('\n── Stage 10-A operational tasking core ──');

check('SAVE_VERSION remains 10 (tasking is additive)', () => assert.equal(SAVE_VERSION, 10));

check('idle formation accepts PATROL', () => {
  const state = readyState();
  assert.equal(canAssignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER).ok, true);
  assert.equal(assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER).ok, true);
  assert.equal(getOperationalTask(state, 'f1').type, 'patrol');
});

check('idle formation accepts RECON', () => {
  const state = readyState();
  assert.equal(assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.RECON, THEATER).ok, true);
  assert.equal(getOperationalTask(state, 'f1').type, 'recon');
});

check('idle formation accepts SECURITY', () => {
  const state = readyState();
  assert.equal(assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.SECURITY, THEATER).ok, true);
  assert.equal(getOperationalTask(state, 'f1').type, 'security');
});

check('empty formation cannot take a task', () => {
  const state = readyState({ units: 0 });
  const result = assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'formation_empty');
});

check('busy / battle formations cannot take a task', () => {
  const busy = readyState();
  busy.formations[0].status = FORMATION_STATUS.FIGHTING;
  const busyResult = assignOperationalTask(busy, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
  assert.equal(busyResult.code, 'formation_busy');

  const battle = readyState();
  battle.activeBattle = { id: 'b1', formationId: 'f1', settled: false };
  const battleResult = assignOperationalTask(battle, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
  assert.equal(battleResult.ok, false);
  assert.ok(['formation_busy', 'formation_in_battle'].includes(battleResult.code));
});

check('one formation cannot run two tasks at once', () => {
  const state = readyState();
  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
  const dup = assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.RECON, THEATER);
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'already_tasked');
});

check('repairing member blocks task assignment', () => {
  const state = readyState();
  state.units[0].status = 'repairing';
  const result = assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
  assert.equal(result.code, 'member_repairing');
});

check('locked theater blocks task assignment', () => {
  const state = readyState();
  const result = assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, 'mountain_pass');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'theater_locked');
});

check('task advances with game time and charges deterministic upkeep', () => {
  const state = readyState();
  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
  const supplyBefore = state.resources.supply;
  tickOperationalTasks(state, 30);
  const task = getOperationalTask(state, 'f1');
  assert.equal(Math.floor(task.stats.timeSec), 30);
  assert.equal(task.stats.intervalsCharged, 1);
  assert.equal(Math.round(supplyBefore - state.resources.supply), OPERATIONAL_TASK.upkeepPerInterval.patrol.supply);
  assert.equal(task.results.patrolTime, 30);
  tickOperationalTasks(state, 30);
  assert.equal(getOperationalTask(state, 'f1').stats.intervalsCharged, 2);
});

check('ticking is split-invariant (deterministic accumulation)', () => {
  const whole = readyState();
  assignOperationalTask(whole, 'f1', OPERATIONAL_TASK_TYPE.RECON, THEATER);
  tickOperationalTasks(whole, 60);
  const split = readyState();
  assignOperationalTask(split, 'f1', OPERATIONAL_TASK_TYPE.RECON, THEATER);
  tickOperationalTasks(split, 20); tickOperationalTasks(split, 20); tickOperationalTasks(split, 20);
  const a = getOperationalTask(whole, 'f1');
  const b = getOperationalTask(split, 'f1');
  assert.deepEqual(a.stats, b.stats);
  assert.deepEqual(a.results, b.results);
  assert.equal(a.results.reconPoints, 2);
});

check('pause (dt = 0) does not advance tasks', () => {
  const state = readyState();
  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.SECURITY, THEATER);
  const before = clone(getOperationalTask(state, 'f1'));
  tickOperationalTasks(state, 0);
  assert.deepEqual(getOperationalTask(state, 'f1'), before);
});

check('recall restores the formation to dispatchable idle', () => {
  const state = readyState();
  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
  const recalled = recallOperationalTask(state, 'f1');
  assert.equal(recalled.ok, true);
  assert.equal(getOperationalTask(state, 'f1'), null);
  assert.equal(state.formations[0].status, FORMATION_STATUS.IDLE);
  const second = assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.RECON, THEATER);
  assert.equal(second.ok, true);
  recallOperationalTask(state, 'f1');
});

check('tasked formation cannot be dispatched to a formal battle', () => {
  const state = readyState();
  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
  const blocked = dispatchFormation(state, 'f1', THEATER, 'cautious', 12345);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'formation_tasked');
  recallOperationalTask(state, 'f1');
  assert.equal(dispatchFormation(state, 'f1', THEATER, 'cautious', 12345).ok, true);
});

check('an unrelated tasking does not change the Stage9 battle result', () => {
  const plain = readyState();
  const tasked = readyState();
  tasked.units.push({ id: 'u9', type: 'scout_car', hp: 80, maxHp: 80, damage: 'intact', status: 'assigned', formationId: 'f9', experience: 0, battles: 0, callsign: null, createdAt: 9 });
  tasked.formations.push({ id: 'f9', name: '警戒队', unitIds: ['u9'], status: FORMATION_STATUS.IDLE, createdAt: 2 });
  recalcDerived(tasked);
  assignOperationalTask(tasked, 'f9', OPERATIONAL_TASK_TYPE.SECURITY, THEATER);
  tickOperationalTasks(tasked, 47);

  const a = dispatchFormation(plain, 'f1', THEATER, 'cautious', 777).activeBattle.report;
  const b = dispatchFormation(tasked, 'f1', THEATER, 'cautious', 777).activeBattle.report;
  assert.equal(a.id, b.id);
  assert.deepEqual({ result: a.result, losses: a.losses, rounds: a.rounds.length, events: a.events.length }, { result: b.result, losses: b.losses, rounds: b.rounds.length, events: b.events.length });
});

check('save / load round-trip keeps an active task', () => {
  const restore = localStorageShim();
  try {
    const state = readyState();
    assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.RECON, THEATER);
    tickOperationalTasks(state, 65);
    const before = clone(getOperationalTask(state, 'f1'));
    saveGame(state, { silent: true, savedAtOverride: Date.now() });
    const loaded = loadGame();
    assert.equal(loaded.ok, true);
    const after = getOperationalTask(loaded.state, 'f1');
    assert.equal(after.type, 'recon');
    assert.equal(after.theaterId, THEATER);
    assert.equal(after.status, 'active');
    assert.deepEqual(after.stats, before.stats);
  } finally { restore(); }
});

check('old saves without tasking fields still load and run', () => {
  const restore = localStorageShim();
  try {
    const state = readyState();
    saveGame(state, { silent: true, savedAtOverride: Date.now() });
    const raw = JSON.parse(globalThis.localStorage.getItem(SAVE_KEY));
    raw.formations.forEach((f) => { delete f.tasking; });
    globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadGame();
    assert.equal(loaded.ok, true);
    assert.equal(getOperationalTask(loaded.state, 'f1'), null);
    const assign = assignOperationalTask(loaded.state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
    assert.equal(assign.ok, true);
  } finally { restore(); }
});

check('offline progression advances tasks with the same clock', () => {
  const state = readyState();
  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.RECON, THEATER);
  const report = settleOfflineProgress(state, 3600, { createReport: false });
  assert.equal(report.settled !== false, true);
  const task = getOperationalTask(state, 'f1');
  assert.equal(Math.floor(task.stats.timeSec), 3600);
  assert.equal(task.stats.intervalsCharged, Math.floor(3600 / OPERATIONAL_TASK.costIntervalSec));
  assert.equal(task.results.reconPoints, Math.floor(3600 / OPERATIONAL_TASK.costIntervalSec) * OPERATIONAL_TASK.reconPointsPerInterval);
});

check('tasking selectors / builders never mutate canonical state', () => {
  const state = readyState();
  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
  tickOperationalTasks(state, 45);
  const before = clone(state);
  getOperationalTask(state, 'f1');
  listOperationalTasks(state);
  describeOperationalTask(getOperationalTask(state, 'f1'));
  canAssignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.RECON, THEATER);
  buildFormationCommandModels(state);
  assert.deepEqual(state, before);
});

check('formation command UI exposes task badges, inspector and recall action', () => {
  const state = readyState();
  const idle = buildFormationCommandModels(state).find((m) => m.id === 'formation:f1');
  assert.equal(idle.inspector.actions.filter((a) => a.id === 'choose-task').length, 3);
  assert.ok(idle.inspector.sections.some((s) => s.title === 'OPERATIONAL TASK'));

  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.RECON, THEATER);
  tickOperationalTasks(state, 65);
  const tasked = buildFormationCommandModels(state).find((m) => m.id === 'formation:f1');
  assert.equal(tasked.state, 'active');
  assert.ok(tasked.badges.some((b) => b.label === 'RECON'));
  const section = tasked.inspector.sections.find((s) => s.title === 'OPERATIONAL TASK');
  assert.ok(section.rows.some((r) => r.label === '目标战区'));
  assert.ok(section.rows.some((r) => r.label === '累积侦察点'));
  assert.ok(tasked.inspector.actions.some((a) => a.id === 'recall-task'));
  assert.equal(tasked.inspector.actions.find((a) => a.id === 'disband-formation').disabled, true);
});

console.log(`\nStage 10-A operational tasking: ${passed}/${total} passed`);
if (passed !== total) process.exitCode = 1;
