/**
 * offline.js —— 完整离线结算（阶段6主体）
 *
 * 职责边界：
 *  - 只负责「离线时长计算 + 按事件步进推进世界 + 生成离线报告」；
 *  - 不触碰 DOM / Canvas；报告只是数据，展示交给 ui.js；
 *  - 结算必须幂等：同一份存档只结算一次，导入存档不得重放离线收益。
 *
 * 为什么用事件步进而不是「一次性乘以秒数」：
 *   施工完成会改变产出与上限，生产完成会改变库存，维修完成会释放工位。
 *   如果直接按 rates × seconds 计算，玩家离线时刚建好的仓库不会提高上限，
 *   刚完工的建筑也不会贡献产量 —— 与在线推进结果不一致。
 *   因此把「下一个施工完成 / 生产完成 / 维修完成 / 离线结束」当作步进点，
 *   每一段内部才用稳定的 rates 推进。
 */

import { TIME, BUILDINGS, UNITS, RESOURCE_DEFS, TECHNOLOGIES, OPERATIONS } from './config.js';
import { recalcDerived, tickEconomy } from './economy.js';
import { advanceOffline as advanceConstruction } from './construction.js';
import { advanceOffline as advanceProduction } from './production.js';
import { tickRepairs, getActiveRepairs, getRepairRemaining } from './repairs.js';
import { tickResearch, getResearchProgress } from './research.js';
import { tickOperationalTasks } from './tasking.js'; // Stage 10-A：离线期间按同一时间粒度推进作战任务
import { logEvent, emit, LOG_LEVEL } from './events.js';
import { safeNumber, clamp, formatDuration, formatInt } from './utils.js';

/** 单次步进的最小时长，避免浮点误差导致死循环 */
const MIN_STEP = 0.001;
/** 步进次数上限（安全阀） */
export const MAX_STEPS = 4096;

function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 计算本次离线的有效秒数（真实时间，已按上限截断）。
 * @param {number} savedAt   上次保存的时间戳（毫秒）
 * @param {number} [now]     当前时间戳（毫秒），默认 Date.now()
 * @param {number} [maxHours] 上限小时数，默认 TIME.offlineMaxHours
 * @returns {{seconds:number, rawSeconds:number, capped:boolean, maxSeconds:number}}
 */
export function calculateOfflineSeconds(savedAt, now, maxHours) {
  const maxH = Math.max(0, safeNumber(maxHours, TIME.offlineMaxHours));
  const maxSeconds = maxH * 3600;
  const saved = Number(savedAt);
  const current = now === undefined ? Date.now() : Number(now);

  if (!Number.isFinite(saved) || saved <= 0) {
    return { seconds: 0, rawSeconds: 0, capped: false, maxSeconds, failClosed: true, reason: 'saved_at_invalid' };
  }
  if (!Number.isFinite(current)) {
    return { seconds: 0, rawSeconds: 0, capped: false, maxSeconds, failClosed: true, reason: 'now_invalid' };
  }
  if (current <= saved) {
    return { seconds: 0, rawSeconds: 0, capped: false, maxSeconds, failClosed: true, reason: 'clock_not_advanced' };
  }
  const rawSeconds = Math.floor((current - saved) / 1000);
  const seconds = Math.min(rawSeconds, maxSeconds);
  return { seconds, rawSeconds, capped: rawSeconds > maxSeconds, maxSeconds, failClosed: false, reason: 'ok' };
}

/**
 * Consume an actual savedAt → now window. This is the only production entry
 * that combines wall-clock validation with offline progression; callers that
 * only need deterministic unit tests may continue to use settleOfflineProgress.
 */
export function settleOfflineWindow(state, savedAt, now, options = {}) {
  const info = calculateOfflineSeconds(savedAt, now, options.maxHours);
  if (info.seconds <= 0) {
    return { ...info, report: null, consumedSeconds: 0, nextSavedAt: Number(savedAt) };
  }
  const token = options.token || `offline:${Number(savedAt)}`;
  const report = settleOfflineProgress(state, info.seconds, {
    ...options,
    token,
    sourceSavedAt: Number(savedAt),
    settledAt: Number(now),
    createReport: options.createReport !== undefined
      ? options.createReport : info.seconds >= TIME.offlineReportMinSeconds
  });
  const truncatedBySteps = report?.truncated === true && info.capped !== true;
  const consumedPreciseSeconds = Math.max(0, safeNumber(report?.consumedPreciseSeconds, report?.seconds || 0));
  const nextSavedAt = truncatedBySteps
    ? Number(savedAt) + consumedPreciseSeconds * 1000
    : Number(now);
  return {
    ...info,
    report,
    consumedSeconds: Math.max(0, Math.floor(safeNumber(report?.seconds, 0))),
    consumedPreciseSeconds,
    nextSavedAt,
    truncatedBySteps
  };
}

/** 当前施工任务的剩余时间（无任务返回 Infinity） */
function constructionRemaining(state) {
  const job = state.construction && state.construction.current;
  if (!isObject(job)) return Infinity;
  return Math.max(0, safeNumber(job.duration, 0) - safeNumber(job.elapsed, 0));
}

/** 当前生产任务的剩余时间（无任务返回 Infinity） */
function productionRemaining(state) {
  const job = state.production && state.production.current;
  if (!isObject(job)) return Infinity;
  return Math.max(0, safeNumber(job.duration, 0) - safeNumber(job.elapsed, 0));
}

/** 最快完成的维修任务剩余时间（无任务返回 Infinity） */
function repairRemaining(state) {
  const active = getActiveRepairs(state);
  if (active.length === 0) return Infinity;
  let shortest = Infinity;
  active.forEach((job) => { shortest = Math.min(shortest, getRepairRemaining(job)); });
  return shortest;
}

function researchRemaining(state) {
  const progress = getResearchProgress(state);
  return progress ? progress.remaining : Infinity;
}

function snapshotResources(state) {
  const out = {};
  Object.keys(RESOURCE_DEFS).forEach((key) => {
    out[key] = safeNumber(state.resources ? state.resources[key] : 0, 0);
  });
  return out;
}

/**
 * 按事件步进推进离线进度（会修改 state）。
 *
 * @param {object} state
 * @param {number} seconds 离线游戏秒（1 倍速：1 真实秒 = 1 游戏秒）
 * @returns {object} 离线报告（同时写入 state.offline）
 */
export function settleOfflineProgress(state, seconds, options = {}) {
  const total = Math.max(0, Math.floor(safeNumber(seconds, 0)));
  const ledger = isObject(state && state.offlineLedger) ? state.offlineLedger : (state.offlineLedger = {
    lastToken: null, lastSourceSavedAt: 0, lastSettledAt: 0
  });
  const token = typeof options.token === 'string' && options.token ? options.token : null;
  if (token && ledger.lastToken === token) {
    return {
      alreadySettled: true, token, settled: false, seconds: 0, consumedSeconds: 0,
      requestedSeconds: 0, remainingSeconds: 0, truncated: false, gains: {}, lines: ['该离线令牌已经结算过。']
    };
  }
  const before = snapshotResources(state);
  const operationBefore = Object.keys(OPERATIONS).filter((id) => {
    const row = state.operations && state.operations[id];
    return safeNumber(row && row.cooldownUntil, 0) > safeNumber(state.time && state.time.game, 0);
  });

  const buildingsCompleted = [];
  const unitsProduced = {};
  const equipmentProduced = {};
  const repairsCompleted = [];
  const completedResearch = [];

  let remaining = total;
  let steps = 0;

  if (total > 0) {
    recalcDerived(state);
    while (remaining > 1e-9 && steps < MAX_STEPS) {
      steps += 1;

      // 下一个事件点：施工完成 / 生产完成 / 维修完成 / 离线结束
      const nextEvent = Math.min(
        constructionRemaining(state),
        productionRemaining(state),
        repairRemaining(state),
        researchRemaining(state)
      );
      const step = Number.isFinite(nextEvent)
        ? Math.min(remaining, Math.max(nextEvent, MIN_STEP))
        : remaining;

      // 世界时间先推进到事件发生时刻，完成日志因此拥有正确时间戳。
      if (isObject(state.time)) state.time.game = safeNumber(state.time.game, 0) + step;

      // 1. 本段资源产出（使用本段起点的 rates —— 段内不会有结构变化）
      tickEconomy(state, step);

      // 2. 施工推进（可能完工 → 改变产量 / 上限 / 解锁）
      const doneBuildings = advanceConstruction(state, step);
      if (Array.isArray(doneBuildings) && doneBuildings.length) {
        doneBuildings.forEach((name) => buildingsCompleted.push(name));
      }

      // 3. 生产推进（可能出厂 → 改变库存）
      const doneUnits = advanceProduction(state, step);
      if (isObject(doneUnits)) {
        Object.keys(doneUnits).filter((type) => UNITS[type]).forEach((type) => {
          unitsProduced[type] = (unitsProduced[type] || 0) + safeNumber(doneUnits[type], 0);
        });
        Object.keys(doneUnits.equipmentProduced || {}).forEach((equipmentId) => {
          equipmentProduced[equipmentId] = (equipmentProduced[equipmentId] || 0)
            + safeNumber(doneUnits.equipmentProduced[equipmentId], 0);
        });
      }

      // 4. 维修推进（可能完成 → 释放工位并递补队列）
      const beforeJobs = (state.repairs || []).map((j) => ({ id: j.id, unitName: j.unitName }));
      const repairResult = tickRepairs(state, step);
      (repairResult.completed || []).forEach((id) => {
        const job = beforeJobs.find((b) => b.id === id);
        repairsCompleted.push(job ? job.unitName : '单位');
      });

      const researchResult = tickResearch(state, step, { ignorePause: true });
      (researchResult.completed || []).forEach((id) => completedResearch.push(TECHNOLOGIES[id] ? TECHNOLOGIES[id].name : id));

      // 5. Stage 10-A：作战任务随离线时长推进（确定性，与其它系统同粒度）
      tickOperationalTasks(state, step);

      // 结构可能已变化，刷新派生数值供下一段使用
      recalcDerived(state);

      remaining -= step;
    }
  }

  const operationsReady = operationBefore.filter((id) => {
    const row = state.operations && state.operations[id];
    return safeNumber(row && row.cooldownUntil, 0) <= safeNumber(state.time && state.time.game, 0);
  });

  const after = snapshotResources(state);
  const consumedPreciseSeconds = Math.max(0, total - Math.max(0, remaining));
  const consumedSeconds = Math.min(total, Math.floor(consumedPreciseSeconds + 1e-9));
  const remainingSeconds = Math.max(0, total - consumedPreciseSeconds);
  const truncated = remaining > 1e-9;
  const report = buildOfflineReport({
    seconds: consumedSeconds, consumedSeconds, consumedPreciseSeconds, requestedSeconds: total,
    remainingSeconds, truncated, maxSteps: MAX_STEPS, before, after, buildingsCompleted,
    unitsProduced, equipmentProduced, repairsCompleted, completedResearch, operationsReady, steps,
    battlePaused: Boolean(state.activeBattle)
  });

  if (token) {
    ledger.lastToken = token;
    ledger.lastSourceSavedAt = safeNumber(options.sourceSavedAt, ledger.lastSourceSavedAt);
    ledger.lastSettledAt = safeNumber(options.settledAt, Date.now());
  }
  const createReport = options.createReport !== undefined
    ? options.createReport === true : total >= TIME.offlineReportMinSeconds;
  state.offline = createReport && total > 0 ? report : null;

  if (total > 0 && createReport) {
    logEvent(state, `离线 ${report.text} 的进度已结算。`, LOG_LEVEL.GOOD);
    if (completedResearch.length) logEvent(state, `离线期间完成研究：${completedResearch.join('、')}。`, LOG_LEVEL.GOOD);
    if (operationsReady.length) logEvent(state, `离线期间重新就绪任务：${operationsReady.map((id) => OPERATIONS[id].name).join('、')}。`, LOG_LEVEL.INFO);
    if (report.battlePaused) logEvent(state, '一场活动战斗在离线期间保持暂停。', LOG_LEVEL.INFO);
    emit('offline:settled', { seconds: consumedSeconds, requestedSeconds: total, report });
  }
  return report;
}

/**
 * 生成离线报告（纯函数，不修改状态）。
 * @returns {object} 可 JSON 序列化的报告
 */
export function buildOfflineReport(input) {
  const src = isObject(input) ? input : {};
  const seconds = Math.max(0, Math.floor(safeNumber(src.seconds, 0)));
  const consumedPreciseSeconds = Math.max(seconds, safeNumber(src.consumedPreciseSeconds, seconds));
  const requestedSeconds = Math.max(seconds, Math.floor(safeNumber(src.requestedSeconds, seconds)));
  const remainingSeconds = Math.max(0, safeNumber(src.remainingSeconds, Math.max(0, requestedSeconds - consumedPreciseSeconds)));
  const before = isObject(src.before) ? src.before : {};
  const after = isObject(src.after) ? src.after : {};

  const gains = {};
  Object.keys(RESOURCE_DEFS).forEach((key) => {
    const delta = Math.round(safeNumber(after[key], 0) - safeNumber(before[key], 0));
    if (delta !== 0) gains[key] = delta;
  });

  const unitsProduced = [];
  const rawUnits = isObject(src.unitsProduced) ? src.unitsProduced : {};
  Object.keys(rawUnits).forEach((type) => {
    const count = Math.max(0, Math.floor(safeNumber(rawUnits[type], 0)));
    if (count <= 0) return;
    const def = UNITS[type];
    unitsProduced.push({ type, name: def ? def.name : type, count });
  });

  const equipmentProduced = [];
  const rawEquipment = isObject(src.equipmentProduced) ? src.equipmentProduced : {};
  Object.keys(rawEquipment).forEach((equipmentId) => {
    const count = Math.max(0, Math.floor(safeNumber(rawEquipment[equipmentId], 0)));
    if (count <= 0) return;
    equipmentProduced.push({ equipmentId, count });
  });

  const buildings = Array.isArray(src.buildingsCompleted) ? src.buildingsCompleted.slice() : [];
  const repairs = Array.isArray(src.repairsCompleted) ? src.repairsCompleted.slice() : [];
  const completedResearch = Array.isArray(src.completedResearch) ? src.completedResearch.slice() : [];
  const operationsReady = Array.isArray(src.operationsReady) ? src.operationsReady.slice() : [];

  const lines = [];
  const gainParts = Object.keys(gains)
    .filter((k) => gains[k] > 0)
    .map((k) => `${RESOURCE_DEFS[k] ? RESOURCE_DEFS[k].name : k} +${formatInt(gains[k])}`);
  if (gainParts.length) lines.push(`资源产出：${gainParts.join('，')}`);
  if (buildings.length) lines.push(`完成工程：${buildings.join('、')}`);
  if (unitsProduced.length) {
    lines.push(`出厂单位：${unitsProduced.map((u) => `${u.name}×${u.count}`).join('、')}`);
  }
  if (equipmentProduced.length) {
    lines.push(`制造装备：${equipmentProduced.map((item) => `${item.equipmentId}×${item.count}`).join('、')}`);
  }
  if (repairs.length) lines.push(`维修完成：${repairs.join('、')}`);
  if (completedResearch.length) lines.push(`完成研究：${completedResearch.join('、')}`);
  if (operationsReady.length) lines.push(`已重新就绪的任务：${operationsReady.map((id) => OPERATIONS[id] ? OPERATIONS[id].name : id).join('、')}`);
  if (src.battlePaused) lines.push('一场活动战斗在离线期间保持暂停');
  if (!lines.length) lines.push('离线期间没有产生新的进度。');

  return {
    seconds,
    consumedSeconds: seconds,
    consumedPreciseSeconds,
    requestedSeconds,
    remainingSeconds,
    truncated: src.truncated === true || remainingSeconds > 1e-9,
    maxSteps: Math.max(0, Math.floor(safeNumber(src.maxSteps, MAX_STEPS))),
    text: seconds > 0 ? formatDuration(seconds) : '0秒',
    gains,
    buildingsCompleted: buildings,
    unitsProduced,
    equipmentProduced,
    repairsCompleted: repairs,
    completedResearch,
    operationsReady,
    battlePaused: src.battlePaused === true,
    steps: Math.max(0, Math.floor(safeNumber(src.steps, 0))),
    lines,
    settled: seconds > 0,
    shown: false
  };
}

/** 玩家点「知道了」：清除离线报告 */
export function dismissOfflineReport(state) {
  if (!isObject(state)) return { ok: false, code: 'state_invalid', reason: '状态无效' };
  if (!state.offline) return { ok: true, code: 'ok', reason: '' };
  state.offline = null;
  emit('offline:dismissed', {});
  return { ok: true, code: 'ok', reason: '' };
}

/** 是否有待展示的离线报告 */
export function hasPendingOfflineReport(state) {
  const o = state && state.offline;
  return Boolean(isObject(o) && o.shown !== true);
}

/** 汇总导出，便于调试面板一次性读取 */
export const OFFLINE_API = {
  calculateOfflineSeconds, settleOfflineWindow, settleOfflineProgress, buildOfflineReport,
  dismissOfflineReport, hasPendingOfflineReport
};
