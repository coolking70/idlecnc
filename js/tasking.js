/**
 * tasking.js —— Stage 10-A：持续性作战任务（Operational Tasking）权威层
 *
 * PATROL / RECON / SECURITY：待命编队的持续性非战役任务。
 *
 * 设计边界：
 *  - 任务状态唯一挂在 canonical state 的 formation.tasking 上，
 *    不存在于 UI、localStorage 或任何旁路对象；
 *  - formation.status 保持 Stage 9 生命周期（idle / fighting / returning…），
 *    任务占用通过 formation.tasking.status === 'active' 表达，
 *    本模块是这二者一致性的单一权威来源；
 *  - 与正式 Battle Authority 互斥：任务编队不能派遣（theater.canDispatch
 *    校验），battle lifecycle 编队不能接受任务（本模块校验）；
 *  - 不进入 battle resolver / settlement / salvage / replay；
 *  - 全部时间推进基于 state.time.game（游戏时间），暂停时调用方 dt=0，
 *    tick 内无 Math.random / Date.now，相同输入必然得到相同结果。
 *
 * 所有 mutation API 返回 { ok, code, reason, ... }，与 formations/theater
 * 的既有风格一致。
 */

import { FORMATION_STATUS, RESOURCE_DEFS, THEATERS } from './config.js';
import { listTheaters } from './theater.js';
import { safeNumber } from './utils.js';

export const OPERATIONAL_TASK_TYPE = {
  PATROL: 'patrol',
  RECON: 'recon',
  SECURITY: 'security'
};

/** 任务规则（数值集中在此，UI / 测试不得硬编码） */
export const OPERATIONAL_TASK = {
  types: [OPERATIONAL_TASK_TYPE.PATROL, OPERATIONAL_TASK_TYPE.RECON, OPERATIONAL_TASK_TYPE.SECURITY],
  labels: {
    [OPERATIONAL_TASK_TYPE.PATROL]: 'PATROL · 巡逻',
    [OPERATIONAL_TASK_TYPE.RECON]: 'RECON · 侦察',
    [OPERATIONAL_TASK_TYPE.SECURITY]: 'SECURITY · 警戒'
  },
  shortLabels: {
    [OPERATIONAL_TASK_TYPE.PATROL]: 'PATROL',
    [OPERATIONAL_TASK_TYPE.RECON]: 'RECON',
    [OPERATIONAL_TASK_TYPE.SECURITY]: 'SECURITY'
  },
  descs: {
    [OPERATIONAL_TASK_TYPE.PATROL]: '维持战区巡逻，累积巡逻时长并周期性消耗补给。',
    [OPERATIONAL_TASK_TYPE.RECON]: '在战区执行持续侦察，累积侦察点数为后续情报系统储备。',
    [OPERATIONAL_TASK_TYPE.SECURITY]: '为战区提供警戒，累积警戒时长并周期性消耗补给。'
  },
  /** 每个补给周期的消耗（按任务类型） */
  costIntervalSec: 30,
  upkeepPerInterval: {
    [OPERATIONAL_TASK_TYPE.PATROL]: { supply: 10 },
    [OPERATIONAL_TASK_TYPE.RECON]: { supply: 6 },
    [OPERATIONAL_TASK_TYPE.SECURITY]: { supply: 8 }
  },
  /** RECON 每 30 秒任务时长产生 1 侦察点（确定性整数累积） */
  reconPointsPerInterval: 1
};

export const TASKING_CODE = {
  OK: 'ok',
  STATE_INVALID: 'state_invalid',
  UNKNOWN_FORMATION: 'unknown_formation',
  UNKNOWN_TASK_TYPE: 'unknown_task_type',
  UNKNOWN_THEATER: 'unknown_theater',
  THEATER_LOCKED: 'theater_locked',
  FORMATION_EMPTY: 'formation_empty',
  FORMATION_BUSY: 'formation_busy',
  FORMATION_IN_BATTLE: 'formation_in_battle',
  MEMBER_REPAIRING: 'member_repairing',
  ALREADY_TASKED: 'already_tasked',
  NOT_TASKED: 'not_tasked',
  INVALID_DURATION: 'invalid_duration'
};

function fail(code, reason, extra = {}) {
  return { ok: false, code, reason: String(reason || ''), task: null, ...extra };
}

function pass(extra = {}) {
  return { ok: true, code: TASKING_CODE.OK, reason: '', ...extra };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findFormation(state, formationId) {
  return (state.formations || []).find((f) => f && f.id === formationId) || null;
}

/** 读取某编队当前生效的 operational task（无则 null；旧存档天然返回 null） */
export function getOperationalTask(state, formationId) {
  if (!isObject(state)) return null;
  const formation = findFormation(state, formationId);
  const tasking = formation && formation.tasking;
  if (!isObject(tasking) || tasking.status !== 'active') return null;
  if (!OPERATIONAL_TASK.types.includes(tasking.type)) return null;
  return tasking;
}

/** 全部执行中的任务（含编队 ID），供 UI / 测试只读枚举 */
export function listOperationalTasks(state) {
  if (!isObject(state) || !Array.isArray(state.formations)) return [];
  return state.formations
    .filter((f) => f && getOperationalTask(state, f.id))
    .map((f) => ({ formationId: f.id, formationName: f.name, task: f.tasking }));
}

/** 战区是否可承接任务：存在且已解锁（已占领战区同样允许巡逻 / 警戒） */
function theaterTaskable(state, theaterId) {
  const view = listTheaters(state).find((row) => row.id === theaterId);
  if (!view) return { ok: false, code: TASKING_CODE.UNKNOWN_THEATER, reason: '未知战区' };
  if (!view.unlocked) return { ok: false, code: TASKING_CODE.THEATER_LOCKED, reason: view.lockReason || '战区尚未解锁' };
  return { ok: true };
}

/**
 * 任务资格校验（纯函数，不修改状态）。
 * UI 只允许调用本函数获得禁用原因，不得自行推断。
 */
export function canAssignOperationalTask(state, formationId, taskType, theaterId) {
  if (!isObject(state)) return fail(TASKING_CODE.STATE_INVALID, '状态无效');
  if (!OPERATIONAL_TASK.types.includes(taskType)) return fail(TASKING_CODE.UNKNOWN_TASK_TYPE, '未知任务类型');
  if (!THEATERS[theaterId]) return fail(TASKING_CODE.UNKNOWN_THEATER, '未知战区');

  const formation = findFormation(state, formationId);
  if (!formation) return fail(TASKING_CODE.UNKNOWN_FORMATION, '编队不存在');

  if (getOperationalTask(state, formationId)) {
    return fail(TASKING_CODE.ALREADY_TASKED, '该编队已在执行作战任务，请先召回');
  }
  if (formation.status !== FORMATION_STATUS.IDLE) {
    return fail(TASKING_CODE.FORMATION_BUSY, '该编队当前不是待命状态');
  }
  if (state.activeBattle && state.activeBattle.formationId === formationId) {
    return fail(TASKING_CODE.FORMATION_IN_BATTLE, '该编队正在参加战斗');
  }
  const ids = Array.isArray(formation.unitIds) ? formation.unitIds : [];
  if (ids.length === 0) return fail(TASKING_CODE.FORMATION_EMPTY, '编队中没有任何单位');
  for (const unitId of ids) {
    const unit = (state.units || []).find((u) => u && u.id === unitId);
    if (unit && unit.status === 'repairing') {
      return fail(TASKING_CODE.MEMBER_REPAIRING, '编队成员正在维修，无法执行任务');
    }
  }
  const theaterCheck = theaterTaskable(state, theaterId);
  if (!theaterCheck.ok) return fail(theaterCheck.code, theaterCheck.reason);
  return pass({ formation, theater: THEATERS[theaterId] });
}

/**
 * 下达任务：校验通过后写入 formation.tasking（canonical state）。
 * @returns {{ok:boolean, code:string, reason:string, task?:object}}
 */
export function assignOperationalTask(state, formationId, taskType, theaterId) {
  const check = canAssignOperationalTask(state, formationId, taskType, theaterId);
  if (!check.ok) return check;
  const now = safeNumber(state.time && state.time.game, 0);
  const task = {
    type: taskType,
    theaterId,
    status: 'active',
    startedAt: now,
    lastTickAt: now,
    stats: { timeSec: 0, intervalsCharged: 0, missedIntervals: 0 },
    results: {}
  };
  check.formation.tasking = task;
  return pass({ task, formationId });
}

/**
 * 召回任务：清除 formation.tasking，编队立即恢复可用（待命 / 可派遣）。
 * 返回被召回任务的快照，供 UI 提示。
 */
export function recallOperationalTask(state, formationId) {
  if (!isObject(state)) return fail(TASKING_CODE.STATE_INVALID, '状态无效');
  const formation = findFormation(state, formationId);
  if (!formation) return fail(TASKING_CODE.UNKNOWN_FORMATION, '编队不存在');
  const task = getOperationalTask(state, formationId);
  if (!task) return fail(TASKING_CODE.NOT_TASKED, '该编队没有执行中的作战任务');
  formation.tasking = null;
  return pass({ recalled: JSON.parse(JSON.stringify(task)), formationId });
}

function upkeepText(cost) {
  return Object.keys(cost).map((key) => `${RESOURCE_DEFS[key] ? RESOURCE_DEFS[key].name : key} ${cost[key]}`).join(' / ') || '无';
}

/** 任务的可读摘要（纯函数，供 tooltip / inspector / 测试使用） */
export function describeOperationalTask(task) {
  if (!isObject(task) || task.status !== 'active') return null;
  const stats = task.stats || {};
  const results = task.results || {};
  const minutes = Math.floor(safeNumber(stats.timeSec, 0) / 60);
  const seconds = Math.floor(safeNumber(stats.timeSec, 0)) % 60;
  return {
    type: task.type,
    typeLabel: OPERATIONAL_TASK.labels[task.type] || task.type,
    theaterName: (THEATERS[task.theaterId] || {}).name || task.theaterId,
    elapsedText: `${minutes}分${String(seconds).padStart(2, '0')}秒`,
    patrolTime: safeNumber(results.patrolTime, 0),
    reconPoints: safeNumber(results.reconPoints, 0),
    securityTime: safeNumber(results.securityTime, 0),
    intervalsCharged: safeNumber(stats.intervalsCharged, 0),
    missedIntervals: safeNumber(stats.missedIntervals, 0),
    upkeepPerInterval: upkeepText(OPERATIONAL_TASK.upkeepPerInterval[task.type] || {})
  };
}

/**
 * 距离最近一次任务周期结算边界的时间（只读，供 offline 事件步进使用）。
 *
 * 对所有 active task：
 *   nextBoundary = (intervalsCharged + 1) * costIntervalSec - stats.timeSec
 * （intervalsCharged 无论 charged 还是 missed 都代表已处理的 interval，
 * 因此是天然的 boundary cursor），取最小正值。
 * 没有任何 active task 时返回 Infinity。
 * 30 秒规则仍由本模块（tasking authority）唯一提供，调用方不得复制数值。
 */
export function operationalTaskBoundaryRemaining(state) {
  if (!isObject(state) || !Array.isArray(state.formations)) return Infinity;
  let next = Infinity;
  state.formations.forEach((formation) => {
    if (!formation) return;
    const task = getOperationalTask(state, formation.id);
    if (!task) return;
    const timeSec = safeNumber(task.stats && task.stats.timeSec, 0);
    const intervalsCharged = safeNumber(task.stats && task.stats.intervalsCharged, 0);
    const boundary = (intervalsCharged + 1) * OPERATIONAL_TASK.costIntervalSec - timeSec;
    if (boundary > 0) next = Math.min(next, boundary);
  });
  return next;
}

/**
 * 任务时间推进（确定性）。调用方负责传入正式 game time 增量：
 *  - 在线：main tick 的 step（暂停时 step=0，天然不推进）；
 *  - 离线：offline 结算循环内逐段 step（与施工 / 维修 / 科研同粒度）。
 *
 * 每 costIntervalSec 秒任务时长结算一次周期消耗（资源不足则跳过并计数，
 * 不召回任务）；RECON 按同周期累积整数侦察点。
 * @returns {{advanced:Array, chargedIntervals:number, missedIntervals:number}}
 */
export function tickOperationalTasks(state, dt, options = {}) {
  const result = { advanced: [], chargedIntervals: 0, missedIntervals: 0 };
  const delta = safeNumber(dt, 0);
  if (!isObject(state) || delta <= 0) return result;

  (state.formations || []).forEach((formation) => {
    if (!formation) return;
    const task = getOperationalTask(state, formation.id);
    if (!task) return;
    const stats = task.stats || (task.stats = { timeSec: 0, intervalsCharged: 0, missedIntervals: 0 });
    const results = task.results || (task.results = {});
    stats.timeSec = safeNumber(stats.timeSec, 0) + delta;
    task.lastTickAt = safeNumber(state.time && state.time.game, 0);

    // 周期消耗：只在整数个 interval 边界结算，保证确定性
    const intervalsEarned = Math.floor(stats.timeSec / OPERATIONAL_TASK.costIntervalSec);
    while (safeNumber(stats.intervalsCharged, 0) < intervalsEarned) {
      stats.intervalsCharged = safeNumber(stats.intervalsCharged, 0) + 1;
      const cost = OPERATIONAL_TASK.upkeepPerInterval[task.type] || {};
      const affordable = Object.keys(cost).every((key) => safeNumber(state.resources && state.resources[key], 0) >= safeNumber(cost[key], 0));
      if (affordable) {
        Object.keys(cost).forEach((key) => {
          state.resources[key] = safeNumber(state.resources[key], 0) - safeNumber(cost[key], 0);
        });
        result.chargedIntervals += 1;
      } else {
        stats.missedIntervals = safeNumber(stats.missedIntervals, 0) + 1;
        result.missedIntervals += 1;
      }
      if (task.type === OPERATIONAL_TASK_TYPE.RECON) {
        results.reconPoints = safeNumber(results.reconPoints, 0) + OPERATIONAL_TASK.reconPointsPerInterval;
      }
    }

    // 基础结果累积（按任务类型）
    if (task.type === OPERATIONAL_TASK_TYPE.PATROL) results.patrolTime = safeNumber(stats.timeSec, 0);
    else if (task.type === OPERATIONAL_TASK_TYPE.SECURITY) results.securityTime = safeNumber(stats.timeSec, 0);

    result.advanced.push({ formationId: formation.id, timeSec: stats.timeSec });
  });
  return result;
}
