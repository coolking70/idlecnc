/**
 * auto-operations.js —— Stage 10-D：自动作战任务调度权威层
 *
 * 只为空闲、合法且没有 manual hold 的非空编队补充 Stage 10-A
 * Operational Task。绝不派遣 Battle / Operation，也不召回或改编编队。
 * 所有任务写入都通过 assignOperationalTask() authority 完成。
 */

import { FORMATION_STATUS } from './config.js';
import { listTheaters } from './theater.js';
import {
  OPERATIONAL_TASK_TYPE, assignOperationalTask, canAssignOperationalTask,
  getOperationalTask, listOperationalTasks
} from './tasking.js';
import { DOCTRINE_TYPE, getActiveDoctrine } from './doctrine.js';
import { theaterPressureView } from './theater-pressure.js';
import { safeNumber } from './utils.js';

export const AUTO_OPERATIONS_CODE = {
  OK: 'ok',
  STATE_INVALID: 'state_invalid',
  UNKNOWN_FORMATION: 'unknown_formation'
};

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pass(extra = {}) {
  return { ok: true, code: AUTO_OPERATIONS_CODE.OK, reason: '', ...extra };
}

function fail(code, reason, extra = {}) {
  return { ok: false, code, reason: String(reason || ''), ...extra };
}

/** 缺失 / 非法字段一律 fail-closed 为 disabled；selector 不写 state。 */
export function isAutoOperationsEnabled(state) {
  return isObject(state) && isObject(state.autoOperations) && state.autoOperations.enabled === true;
}

/** 新游戏 / 老存档 canonicalize；老存档默认 disabled。 */
export function ensureAutoOperations(state) {
  if (!isObject(state)) return false;
  const enabled = isAutoOperationsEnabled(state);
  if (isObject(state.autoOperations) && state.autoOperations.enabled === enabled
    && Object.keys(state.autoOperations).length === 1) return false;
  state.autoOperations = { enabled };
  return true;
}

export function setAutoOperationsEnabled(state, enabled) {
  if (!isObject(state)) return fail(AUTO_OPERATIONS_CODE.STATE_INVALID, '状态无效');
  state.autoOperations = { enabled: enabled === true };
  return pass({ enabled: state.autoOperations.enabled });
}

export function isFormationOnAutoHold(formation) {
  return Boolean(formation && formation.autoTaskHold === true);
}

export function releaseAutoTaskHold(state, formationId) {
  if (!isObject(state) || !Array.isArray(state.formations)) {
    return fail(AUTO_OPERATIONS_CODE.STATE_INVALID, '状态无效');
  }
  const formation = state.formations.find((row) => row && row.id === formationId);
  if (!formation) return fail(AUTO_OPERATIONS_CODE.UNKNOWN_FORMATION, '编队不存在');
  formation.autoTaskHold = false;
  return pass({ formationId });
}

function compareStable(a, b) {
  const created = safeNumber(a && a.createdAt, 0) - safeNumber(b && b.createdAt, 0);
  if (created !== 0) return created;
  const aId = String(a && a.id);
  const bId = String(b && b.id);
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

/** 只读摘要，供 Overview / tests 使用。 */
export function autoOperationsSummary(state) {
  const autoManaged = listOperationalTasks(state)
    .filter((row) => row.task && row.task.autoAssigned === true).length;
  const manualHold = Array.isArray(state && state.formations)
    ? state.formations.filter(isFormationOnAutoHold).length : 0;
  return { enabled: isAutoOperationsEnabled(state), autoManaged, manualHold };
}

function taskNeed(taskType, pressure) {
  if (taskType === OPERATIONAL_TASK_TYPE.RECON) return 100 - pressure.recon;
  if (taskType === OPERATIONAL_TASK_TYPE.PATROL) return 100 - pressure.control;
  // SECURITY 同时覆盖安全缺口与高威胁，取更紧迫者。
  return Math.max(100 - pressure.security, pressure.threat);
}

function doctrineTask(doctrine) {
  if (doctrine === DOCTRINE_TYPE.RECON) return OPERATIONAL_TASK_TYPE.RECON;
  if (doctrine === DOCTRINE_TYPE.CONTROL) return OPERATIONAL_TASK_TYPE.PATROL;
  if (doctrine === DOCTRINE_TYPE.SECURITY) return OPERATIONAL_TASK_TYPE.SECURITY;
  return null;
}

/**
 * 纯决策：返回下一项任务与目标战区，不修改 state。
 * BALANCED 选择全体已解锁战区中最大的指标缺口；完全相同按
 * RECON → SECURITY → PATROL，再按 theater 列表顺序 / ID 打破平局。
 */
export function planAutoOperationalAssignment(state) {
  const theaters = listTheaters(state).filter((row) => row.unlocked);
  if (theaters.length === 0) return null;
  const fixedTask = doctrineTask(getActiveDoctrine(state));
  const taskOrder = fixedTask
    ? [fixedTask]
    : [OPERATIONAL_TASK_TYPE.RECON, OPERATIONAL_TASK_TYPE.SECURITY, OPERATIONAL_TASK_TYPE.PATROL];
  let best = null;
  taskOrder.forEach((taskType, taskRank) => {
    theaters.forEach((theater, theaterRank) => {
      const candidate = {
        taskType, theaterId: theater.id,
        need: taskNeed(taskType, theaterPressureView(state, theater.id)),
        taskRank, theaterRank
      };
      if (!best || candidate.need > best.need
        || (candidate.need === best.need && candidate.taskRank < best.taskRank)
        || (candidate.need === best.need && candidate.taskRank === best.taskRank
          && (candidate.theaterRank < best.theaterRank
            || (candidate.theaterRank === best.theaterRank
              && String(candidate.theaterId) < String(best.theaterId))))) best = candidate;
    });
  });
  return best ? { taskType: best.taskType, theaterId: best.theaterId } : null;
}

/** 给当前所有合法空闲编队补任务。编队与决策排序稳定。 */
export function runAutoOperationsPlanner(state) {
  const result = { enabled: isAutoOperationsEnabled(state), assigned: [], skipped: [] };
  if (!result.enabled || !isObject(state) || !Array.isArray(state.formations)) return result;

  state.formations.slice().sort(compareStable).forEach((formation) => {
    if (!formation || formation.status !== FORMATION_STATUS.IDLE
      || !Array.isArray(formation.unitIds) || formation.unitIds.length === 0
      || isFormationOnAutoHold(formation) || getOperationalTask(state, formation.id)) {
      result.skipped.push(formation && formation.id);
      return;
    }
    const decision = planAutoOperationalAssignment(state);
    if (!decision) { result.skipped.push(formation.id); return; }
    const check = canAssignOperationalTask(state, formation.id, decision.taskType, decision.theaterId);
    if (!check.ok) { result.skipped.push(formation.id); return; }
    const assigned = assignOperationalTask(
      state, formation.id, decision.taskType, decision.theaterId, { autoAssigned: true }
    );
    if (assigned.ok) result.assigned.push({ formationId: formation.id, ...decision });
    else result.skipped.push(formation.id);
  });
  return result;
}
