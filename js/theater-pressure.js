/**
 * theater-pressure.js —— Stage 10-B：动态战区压力（Dynamic Theater Pressure）权威层
 *
 * 四个 canonical 战区指标（范围 0~100）：
 *   threat   敌方威胁
 *   control  我方控制力
 *   recon    侦察掌握度
 *   security 战区安全度
 *
 * 设计边界：
 *  - 数值规则（速率 / 初值 / clamp）全部集中在本模块，不写入 Stage9 frozen
 *    config.js；
 *  - 状态唯一保存在 canonical state.theaterPressure[theaterId]，随正式
 *    serialize / migrate / load 持久化；老存档无该字段时按默认值补齐；
 *  - 推进完全由 game time 驱动（tick 传入 dt），无 Date.now / Math.random /
 *    定时器；暂停时调用方 dt=0，天然不推进；
 *  - 线性速率：同战区多支任务编队效果叠加，不同战区互不影响，召回后
 *    该编队的持续影响立即停止（tick 只统计当前 active 任务）；
 *  - 二态规则：战区存在执行中任务时只应用任务速率（任务未覆盖的指标
 *    保持不变）；战区无任务时应用自然漂移（威胁回升、其余衰减）；
 *  - Stage10-A 任务语义不变：资源不足时任务保持 active（missed interval），
 *    对 pressure 而言任务仍在执行、效果照常；
 *  - 本轮不接触 battle resolver / 结算 / rewards / capture / 解锁 / salvage /
 *    operation cooldown —— pressure 只是平行状态，不改变任何既有判定。
 *
 * online / offline 等价：main stepLogic 与 offline 结算循环以相同顺序调用
 * tickOperationalTasks → tickTheaterPressure，且速率为线性、无事件边界，
 * 任意 dt 划分得到相同结果（浮点累加顺序固定）。
 */

import { THEATERS } from './config.js';
import { getOperationalTask, OPERATIONAL_TASK_TYPE } from './tasking.js';
import { getTaskEffectMultiplier } from './doctrine.js'; // Stage 10-C：任务效果倍率由 doctrine authority 提供
import { safeNumber } from './utils.js';

export const PRESSURE_METRICS = ['threat', 'control', 'recon', 'security'];

/** 数值规则（速率单位：点 / 游戏秒 / 编队；漂移单位：点 / 游戏秒） */
export const THEATER_PRESSURE = {
  min: 0,
  max: 100,
  /** 老存档 / 新战区的初始值 */
  initial: { threat: 50, control: 0, recon: 0, security: 0 },
  /** 每支执行中任务编队对战区的每秒线性效果（叠加） */
  perTaskPerSecond: {
    [OPERATIONAL_TASK_TYPE.PATROL]: { control: 0.02, threat: -0.005 },
    [OPERATIONAL_TASK_TYPE.RECON]: { recon: 0.02 },
    [OPERATIONAL_TASK_TYPE.SECURITY]: { security: 0.02, threat: -0.015 }
  },
  /** 无任务影响时每个指标的每秒自然漂移（威胁回升，其余衰减） */
  idlePerSecond: { threat: 0.002, control: -0.001, recon: -0.001, security: -0.001 }
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clampMetric(value) {
  return Math.max(THEATER_PRESSURE.min, Math.min(THEATER_PRESSURE.max, safeNumber(value, 0)));
}

/**
 * 只读视图：返回某战区当前 pressure（缺失时返回默认值，不写 state）。
 * Presentation builder / 调试接口必须使用本函数，保证只读。
 */
export function theaterPressureView(state, theaterId) {
  const stored = isObject(state) && isObject(state.theaterPressure) ? state.theaterPressure[theaterId] : null;
  const view = {};
  PRESSURE_METRICS.forEach((metric) => {
    view[metric] = clampMetric(isObject(stored) ? stored[metric] : THEATER_PRESSURE.initial[metric]);
  });
  return view;
}

/**
 * 幂等初始化：为所有战区补齐缺失的 pressure 记录（老存档自动补齐）。
 * 已存在的数值保留并 clamp。返回是否发生写入。
 */
export function ensureTheaterPressure(state) {
  if (!isObject(state)) return false;
  if (!isObject(state.theaterPressure)) state.theaterPressure = {};
  let changed = false;
  Object.keys(THEATERS).forEach((theaterId) => {
    const row = state.theaterPressure[theaterId];
    if (!isObject(row)) {
      state.theaterPressure[theaterId] = { ...THEATER_PRESSURE.initial };
      changed = true;
      return;
    }
    PRESSURE_METRICS.forEach((metric) => {
      if (!Number.isFinite(safeNumber(row[metric], NaN))) {
        row[metric] = THEATER_PRESSURE.initial[metric];
        changed = true;
      } else {
        const clamped = clampMetric(row[metric]);
        if (clamped !== row[metric]) { row[metric] = clamped; changed = true; }
      }
    });
  });
  // 剔除未知战区的残留记录（保持与 state.theaters 一致）
  Object.keys(state.theaterPressure).forEach((theaterId) => {
    if (!THEATERS[theaterId]) { delete state.theaterPressure[theaterId]; changed = true; }
  });
  return changed;
}

/** 某战区当前执行中任务的数量（按类型），供推进与 UI 摘要共用（只读） */
export function theaterTaskCounts(state, theaterId) {
  const counts = { [OPERATIONAL_TASK_TYPE.PATROL]: 0, [OPERATIONAL_TASK_TYPE.RECON]: 0, [OPERATIONAL_TASK_TYPE.SECURITY]: 0 };
  if (!isObject(state) || !Array.isArray(state.formations)) return counts;
  state.formations.forEach((formation) => {
    if (!formation) return;
    const task = getOperationalTask(state, formation.id);
    if (task && task.theaterId === theaterId && counts[task.type] !== undefined) counts[task.type] += 1;
  });
  return counts;
}

/**
 * 随游戏时间推进战区压力（确定性）。
 *  - 线性速率，不需要新增 offline 事件边界，直接适配任意 dt；
 *  - 同战区多支任务叠加；不同战区互不影响；召回后不再计入；
 *  - dt <= 0（暂停）不推进。
 * @returns {{advanced:string[]}} 本步推进过的战区 ID
 */
export function tickTheaterPressure(state, dt) {
  const result = { advanced: [] };
  const delta = safeNumber(dt, 0);
  if (!isObject(state) || delta <= 0) return result;
  ensureTheaterPressure(state);

  Object.keys(THEATERS).forEach((theaterId) => {
    const row = state.theaterPressure[theaterId];
    const counts = theaterTaskCounts(state, theaterId);
    const hasTasks = (counts[OPERATIONAL_TASK_TYPE.PATROL] + counts[OPERATIONAL_TASK_TYPE.RECON] + counts[OPERATIONAL_TASK_TYPE.SECURITY]) > 0;
    PRESSURE_METRICS.forEach((metric) => {
      // 二态规则：战区有执行中任务时只应用任务速率（可叠加、按指标生效，
      // 任务未覆盖的指标保持不变）；战区无任务时应用自然漂移。
      let rate = 0;
      if (hasTasks) {
        Object.keys(counts).forEach((taskType) => {
          // Stage 10-C：任务效果按当前 doctrine 倍率缩放（切换只影响之后的推进）
          const baseRate = (THEATER_PRESSURE.perTaskPerSecond[taskType] || {})[metric] || 0;
          rate += (counts[taskType] || 0) * baseRate * getTaskEffectMultiplier(state, taskType, metric);
        });
      } else {
        rate = THEATER_PRESSURE.idlePerSecond[metric] || 0;
      }
      row[metric] = clampMetric(safeNumber(row[metric], 0) + rate * delta);
    });
    result.advanced.push(theaterId);
  });
  return result;
}
