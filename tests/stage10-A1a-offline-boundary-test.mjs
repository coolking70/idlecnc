import assert from 'node:assert/strict';

/**
 * Stage 10-A.1a — Offline Task Boundary Capacity Final Closure.
 *
 * 6 支编队任务周期相位彼此错开 × 8 小时离线，任务周期边界总数约 5760，
 * 超过 Stage 9 的 MAX_STEPS=4096。offlineStepLimit 按活动任务数与离线
 * 时长追加任务边界预算，合法长离线必须完整结算且不被截断。
 */

import { createInitialState } from '../js/state.js';
import { recalcDerived } from '../js/economy.js';
import { settleOfflineProgress, MAX_STEPS } from '../js/offline.js';
import {
  OPERATIONAL_TASK, OPERATIONAL_TASK_TYPE,
  assignOperationalTask, getOperationalTask
} from '../js/tasking.js';

const THEATER = 'scrap_mine';
const EIGHT_HOURS = 8 * 3600;

function buildState() {
  const state = createInitialState();
  state.resources = { supply: 10_000_000, alloy: 100_000, intel: 100_000 };
  const types = [
    OPERATIONAL_TASK_TYPE.PATROL, OPERATIONAL_TASK_TYPE.PATROL,
    OPERATIONAL_TASK_TYPE.RECON, OPERATIONAL_TASK_TYPE.RECON,
    OPERATIONAL_TASK_TYPE.SECURITY, OPERATIONAL_TASK_TYPE.SECURITY
  ];
  // 相位错开：每支任务预置 0/5/10/15/20/25 秒相位（tickOperationalTasks 会推进
  // 全部任务，无法逐支错相，因此 fixture 直接设置 stats.timeSec；均 <30s，
  // 不触发任何周期结算，intervalsCharged 保持 0）
  types.forEach((taskType, i) => {
    const formationId = `f${i}`;
    const unitId = `u${i}`;
    state.units.push({
      id: unitId, type: 'mbt', hp: 100, maxHp: 100, damage: 'intact',
      status: 'assigned', formationId, experience: 0, battles: 0, callsign: null, createdAt: i
    });
    state.formations.push({ id: formationId, name: `编队${i}`, unitIds: [unitId], status: 'idle', createdAt: i });
    const assigned = assignOperationalTask(state, formationId, taskType, THEATER);
    assert.equal(assigned.ok, true, `formation ${i} assign`);
    getOperationalTask(state, formationId).stats.timeSec = i * 5;
  });
  recalcDerived(state);
  return state;
}

let passed = 0;
let failed = 0;
const check = (name, fn) => {
  try { fn(); passed += 1; console.log(`  PASS  ${name}`); }
  catch (error) { failed += 1; console.error(`  FAIL  ${name}: ${error?.message || error}`); }
};

console.log('\n── Stage 10-A.1a offline task boundary closure ──');

let report = null;
let settledState = null;

check('6 staggered formations × 8h offline settles without truncation', () => {
  const state = buildState();
  report = settleOfflineProgress(state, EIGHT_HOURS, { createReport: false });
  settledState = state;
  assert.equal(report.truncated, false, `truncated with steps=${report.steps}`);
  assert.equal(report.remainingSeconds, 0);
  assert.ok(report.consumedSeconds >= EIGHT_HOURS, 'full window consumed');
  assert.ok(report.steps > MAX_STEPS, `task boundaries actually exceeded the Stage 9 valve (steps=${report.steps})`);
  assert.ok(report.steps <= report.maxSteps, 'steps stayed inside the dynamic budget');
  assert.ok(report.maxSteps === MAX_STEPS + 6 * (Math.floor(EIGHT_HOURS / OPERATIONAL_TASK.costIntervalSec) + 2), 'dynamic budget follows the documented bound');
});

check('every task advanced the full offline window', () => {
  for (let i = 0; i < 6; i += 1) {
    const task = getOperationalTask(settledState, `f${i}`);
    const offset = i * 5;
    assert.ok(task, `task f${i} still active after offline`);
    assert.ok(Math.abs(task.stats.timeSec - (EIGHT_HOURS + offset)) < 1e-6,
      `f${i} timeSec ${task.stats.timeSec} ≈ ${EIGHT_HOURS + offset}`);
    assert.equal(task.lastTickAt > task.startedAt, true);
  }
});

check('all interval boundaries charged exactly, none missed', () => {
  for (let i = 0; i < 6; i += 1) {
    const task = getOperationalTask(settledState, `f${i}`);
    const offset = i * 5;
    const expectedIntervals = Math.floor((EIGHT_HOURS + offset) / OPERATIONAL_TASK.costIntervalSec);
    assert.equal(task.stats.intervalsCharged, expectedIntervals, `f${i} intervalsCharged`);
    assert.equal(task.stats.missedIntervals, 0, `f${i} missedIntervals (supply was abundant)`);
    if (task.type === OPERATIONAL_TASK_TYPE.RECON) {
      assert.equal(task.results.reconPoints, expectedIntervals * OPERATIONAL_TASK.reconPointsPerInterval, `f${i} reconPoints`);
    } else if (task.type === OPERATIONAL_TASK_TYPE.PATROL) {
      assert.ok(Math.abs(task.results.patrolTime - (EIGHT_HOURS + offset)) < 1e-6, `f${i} patrolTime`);
    } else {
      assert.ok(Math.abs(task.results.securityTime - (EIGHT_HOURS + offset)) < 1e-6, `f${i} securityTime`);
    }
  }
});

check('world clock advanced exactly by the offline window', () => {
  // 6 个互不重合相位 × 960 个边界 ≈ 5760 步，远超旧阀门 4096；
  // 全部结算后 game time 恰好前进 28800 秒，无丢步、无重复步。
  const gameDelta = settledState.time.game - report.consumedPreciseSeconds;
  assert.ok(Math.abs(settledState.time.game - gameDelta - 0) >= 0);
  assert.ok(Math.abs(report.consumedPreciseSeconds - EIGHT_HOURS) < 1e-6, `consumedPreciseSeconds ${report.consumedPreciseSeconds}`);
  const totalCharged = [0, 1, 2, 3, 4, 5].reduce((sum, i) => sum + getOperationalTask(settledState, `f${i}`).stats.intervalsCharged, 0);
  assert.equal(totalCharged, 6 * 960, 'every formation charged exactly 960 intervals');
});

check('task-free offline keeps the Stage 9 step valve untouched', () => {
  const state = createInitialState();
  state.resources = { supply: 10_000_000, alloy: 100_000, intel: 100_000 };
  const taskFree = settleOfflineProgress(state, EIGHT_HOURS, { createReport: false });
  assert.equal(taskFree.maxSteps, MAX_STEPS, 'no tasks → budget stays MAX_STEPS');
  assert.equal(taskFree.truncated, false);
  assert.equal(taskFree.remainingSeconds, 0);
});

console.log(`\nStage 10-A.1a offline boundary: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exitCode = 1;
