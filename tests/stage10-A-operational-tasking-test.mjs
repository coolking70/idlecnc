import assert from 'node:assert/strict';

/**
 * Stage 10-A — Operational Tasking Core targeted tests.
 *
 * 权威层：js/tasking.js（canAssign / assign / recall / get / tick）。
 * 共享文件钩子：theater.js 派遣互斥、offline.js 离线推进。
 * 本文件不重复 Stage9 语义回归（由既有 stage9 套件覆盖）。
 */

import { BUILDING_STATUS, FORMATION_STATUS, SAVE_VERSION, OPERATIONS } from '../js/config.js';
import { createInitialState } from '../js/state.js';
import { recalcDerived, tickEconomy } from '../js/economy.js';
import { saveGame, loadGame, SAVE_KEY } from '../js/save.js';
import { dispatchFormation } from '../js/theater.js';
import { settleOfflineProgress } from '../js/offline.js';
import {
  OPERATIONAL_TASK, OPERATIONAL_TASK_TYPE,
  canAssignOperationalTask, assignOperationalTask, recallOperationalTask,
  getOperationalTask, listOperationalTasks, describeOperationalTask,
  tickOperationalTasks, operationalTaskBoundaryRemaining
} from '../js/tasking.js';
import { canQueueRepair, queueRepair, REPAIR_CODE } from '../js/repairs.js';
import {
  canAddUnit, addUnit, removeUnit, disbandFormation, renameFormation,
  FORMATION_CODE
} from '../js/formations.js';
import { canDispatchOperation, OPERATION_CODE } from '../js/operations.js';
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

console.log('\n── Stage 10-A.1 tasking consistency hotfix ──');

/* Stage 10-A.1 targeted hotfix cases: tasking ↔ repair 互斥、编队权威守卫、
 * 派遣结果码、offline 周期边界与 online/offline 等价。 */

function taskedDamagedState({ taskType = OPERATIONAL_TASK_TYPE.RECON } = {}) {
  const state = readyState({ units: 2 });
  state.units[0].hp = 40; state.units[0].damage = 'heavy'; // 受损可送修成员
  recalcDerived(state);
  const assign = assignOperationalTask(state, 'f1', taskType, THEATER);
  assert.equal(assign.ok, true);
  return state;
}

check('A.1 tasked formation member cannot enter repair (both directions blocked)', () => {
  const state = taskedDamagedState();
  const before = clone(state);
  const check1 = canQueueRepair(state, 'u1');
  assert.equal(check1.ok, false);
  assert.equal(check1.code, 'formation_tasked');
  assert.equal(REPAIR_CODE.FORMATION_TASKED, 'formation_tasked');
  const queued = queueRepair(state, 'u1');
  assert.equal(queued.ok, false);
  assert.equal(queued.code, 'formation_tasked');
  // 权威层拒绝后 canonical state 完全不变
  assert.deepEqual(state, before);
});

check('A.1 recalling the task re-enables repair (no permanent lock)', () => {
  const state = taskedDamagedState();
  recallOperationalTask(state, 'f1');
  const check = canQueueRepair(state, 'u1');
  assert.equal(check.ok, true);
  assert.equal(check.code, 'ready');
  const queued = queueRepair(state, 'u1');
  assert.equal(queued.ok, true);
});

check('A.1 tasked formation rejects direct member mutation and disband at authority level', () => {
  const state = readyState({ units: 2 });
  state.units.push({ id: 'free1', type: 'infantry', hp: 100, maxHp: 100, damage: 'intact', status: 'ready', formationId: null, experience: 0, battles: 0, callsign: null, createdAt: 9 });
  recalcDerived(state);
  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
  const before = clone(state);

  assert.equal(removeUnit(state, 'f1', 'u1').code, 'formation_tasked');
  assert.equal(disbandFormation(state, 'f1').code, 'formation_tasked');
  const addCheck = canAddUnit(state, 'f1', 'free1');
  assert.equal(addCheck.ok, false);
  assert.equal(addCheck.code, 'formation_tasked');
  assert.equal(addUnit(state, 'f1', 'free1').code, 'formation_tasked');
  assert.equal(FORMATION_CODE.FORMATION_TASKED, 'formation_tasked');

  // 重命名在任务期间仍然允许（不改变任务 / 成员语义）
  const rename = renameFormation(state, 'f1', '改名测试');
  assert.equal(rename.ok, true);
  assert.equal(state.formations[0].name, '改名测试');
  // 除名字（与重命名日志）外，canonical gameplay 字段保持不变
  const gameplay = (s) => JSON.stringify({ units: s.units, command: s.command, formations: s.formations.map((f) => ({ ...f, name: f.id })) });
  before.formations[0].name = '改名测试';
  assert.equal(gameplay(state), gameplay(before));
});

check('A.1 repeated-operation dispatch returns formation_tasked, never undefined', () => {
  const state = readyState({ units: 2 });
  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.SECURITY, THEATER);
  const opId = Object.keys(OPERATIONS).find((id) => OPERATIONS[id].theaterId === THEATER);
  assert.ok(opId, 'fixture theater must host an operation');
  state.theaters[THEATER].captured = true;
  const blocked = canDispatchOperation(state, 'f1', opId, 'cautious');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, 'formation_tasked');
  assert.equal(OPERATION_CODE.FORMATION_TASKED, 'formation_tasked');
});

function taskingSummary(state) {
  return JSON.stringify((state.formations || []).map((f) => {
    const t = f.tasking;
    return t ? {
      id: f.id,
      type: t.type,
      stats: { intervalsCharged: t.stats.intervalsCharged, missedIntervals: t.stats.missedIntervals },
      // timeSec 会有在线细步长累加的浮点尾差（3600.000000004），按整数语义比较
      results: { ...t.results, patrolTime: Math.floor(t.results.patrolTime || 0), securityTime: Math.floor(t.results.securityTime || 0), reconPoints: t.results.reconPoints || 0 }
    } : null;
  }));
}

function onlineAdvance(state, seconds, stepSec = 0.05) {
  for (let elapsed = 0; elapsed < seconds; elapsed += stepSec) {
    tickEconomy(state, stepSec);
    tickOperationalTasks(state, stepSec);
  }
}

check('A.1 offline task upkeep boundaries match online stepping (resource cap scenario)', () => {
  // 资源充足场景：离线单步会让经济先一次性增长到 cap 再统一扣 120 个周期，
  // 与在线“边增长边扣”产生偏差（旧 bug 实测偏差可达 1190 补给）。
  const make = () => {
    const state = readyState({ units: 2 });
    assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
    return state;
  };
  const online = make();
  onlineAdvance(online, 3600);
  const offline = make();
  settleOfflineProgress(offline, 3600, { createReport: false });

  assert.equal(Math.floor(getOperationalTask(offline, 'f1').stats.timeSec), 3600);
  assert.ok(Math.abs(online.resources.supply - offline.resources.supply) < 0.01, `supply mismatch: online=${online.resources.supply} offline=${offline.resources.supply}`);
  const onTask = getOperationalTask(online, 'f1');
  const offTask = getOperationalTask(offline, 'f1');
  assert.equal(offTask.stats.intervalsCharged, onTask.stats.intervalsCharged);
  assert.equal(offTask.stats.missedIntervals, onTask.stats.missedIntervals);
  assert.equal(Math.floor(offTask.results.patrolTime), Math.floor(onTask.results.patrolTime));
  assert.equal(offTask.results.patrolTime >= 3600 - 1, true);
});

check('A.1 low-resource offline/online equivalence (missed intervals)', () => {
  // 低补给 + 电力 brownout（发电站移除、雷达站耗电）场景：6 支 PATROL
  // 每周期共需 60 补给，而 brownout 下补给增速仅 +30/周期，
  // missed / charged 的结算顺序真实参与结果，offline 必须与 online 一致。
  const make = () => {
    const state = createInitialState();
    state.resources = { supply: 5, alloy: 9000, intel: 900 };
    state.buildings = state.buildings.filter((b) => b.type !== 'power_plant');
    state.buildings.push(
      { id: 'b-radar', type: 'radar_station', status: BUILDING_STATUS.OPERATIONAL, progress: 1 },
      { id: 'b-barracks', type: 'barracks', status: BUILDING_STATUS.OPERATIONAL, progress: 1 }
    );
    for (let i = 0; i < 6; i += 1) {
      state.units.push({ id: `lu${i + 1}`, type: 'infantry', hp: 100, maxHp: 100, damage: 'intact', status: 'assigned', formationId: `lf${i + 1}`, experience: 0, battles: 0, callsign: null, createdAt: i + 1 });
      state.formations.push({ id: `lf${i + 1}`, name: `低补给${i + 1}`, unitIds: [`lu${i + 1}`], status: FORMATION_STATUS.IDLE, createdAt: i + 1 });
    }
    recalcDerived(state);
    assert.equal(state.power.used > state.power.produced, true, 'fixture must be in brownout');
    for (let i = 0; i < 6; i += 1) {
      assert.equal(assignOperationalTask(state, `lf${i + 1}`, OPERATIONAL_TASK_TYPE.PATROL, THEATER).ok, true);
    }
    return state;
  };
  const online = make();
  onlineAdvance(online, 3600);
  const offline = make();
  settleOfflineProgress(offline, 3600, { createReport: false });

  assert.ok(Math.abs(online.resources.supply - offline.resources.supply) < 0.01, `low-supply mismatch: online=${online.resources.supply} offline=${offline.resources.supply}`);
  const onlineSummary = taskingSummary(online);
  const offlineSummary = taskingSummary(offline);
  assert.equal(offlineSummary, onlineSummary);
  const missed = offline.formations.reduce((sum, f) => sum + f.tasking.stats.missedIntervals, 0);
  const charged = offline.formations.reduce((sum, f) => sum + f.tasking.stats.intervalsCharged, 0);
  assert.ok(missed > 0, 'fixture must actually produce missed intervals');
  // intervalsCharged 是 boundary cursor（已处理 interval 总数，含 missed），
  // 每个 30s 周期恰好处理一次：6 编队 × 120 周期。
  assert.equal(charged, 6 * 120);
  assert.ok(missed <= charged, 'missed intervals cannot exceed processed intervals');
});

check('A.1 operationalTaskBoundaryRemaining is a read-only authority cursor', () => {
  const state = readyState({ units: 2 });
  assert.equal(operationalTaskBoundaryRemaining(state), Infinity);
  assignOperationalTask(state, 'f1', OPERATIONAL_TASK_TYPE.PATROL, THEATER);
  const before = clone(state);
  assert.equal(operationalTaskBoundaryRemaining(state), OPERATIONAL_TASK.costIntervalSec);
  tickOperationalTasks(state, 10);
  assert.equal(operationalTaskBoundaryRemaining(state), OPERATIONAL_TASK.costIntervalSec - 10);
  tickOperationalTasks(state, 20);
  assert.equal(operationalTaskBoundaryRemaining(state), OPERATIONAL_TASK.costIntervalSec);
  // 只读：不改变 canonical state（timeSec 除外，那是 tick 的合法推进）
  assert.equal(state.formations[0].tasking.stats.intervalsCharged, before.formations[0].tasking.stats.intervalsCharged + 1);
});

console.log(`\nStage 10-A operational tasking: ${passed}/${total} passed`);
if (passed !== total) process.exitCode = 1;
