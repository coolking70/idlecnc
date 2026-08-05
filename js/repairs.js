/**
 * repairs.js —— 单位维修与补员（阶段6主体）
 *
 * 职责边界：
 *  - 只处理「损伤判定 + 维修排队 + 并行推进 + 完成/取消」；
 *  - 不触碰 DOM / Canvas，只通过事件总线广播；
 *  - 所有修改型接口统一返回：{ ok, code, reason, ... }；
 *  - 单位一旦进入维修，必须安全脱离编队（释放指挥容量），完成后回到库存待命。
 *
 * 维修任务生命周期：
 *   queueRepair()      → 校验 → 预付费用 → 入队（active 或 queued）
 *   tickRepairs()      → 并行推进 active 槽位（事件步进，保证任意 dt 结果一致）
 *   completeRepair()   → 恢复满耐久、状态回 ready、递补队列
 *   cancelRepair()     → active 退 50%，queued 全额退款
 *
 * 维修任务字段（可 JSON 序列化）：
 *   { id, unitId, unitType, unitName, severity, duration, elapsed,
 *     status: 'active' | 'queued', costPaid, previousFormationId, queuedAt }
 */

import { UNITS, DAMAGE_STATES, REPAIR, BUILDING_STATUS, TECHNOLOGIES } from './config.js';
import { spend, grant, missingResources, recalcDerived } from './economy.js';
import { logEvent, emit, LOG_LEVEL } from './events.js';
import { safeNumber, clamp, uid, formatInt } from './utils.js';
import { getDamageState, damageStateOfUnit } from './unit-status.js';
import { getResearchModifiers, getResearchCompletedAtRevision, ensureResearchRevision } from './research.js';

/* ============================================================
 * 结果码
 * ========================================================== */

export const REPAIR_CODE = {
  OK: 'ok',
  READY: 'ready',
  STATE_INVALID: 'state_invalid',
  UNKNOWN_UNIT: 'unknown_unit',
  UNKNOWN_TYPE: 'unknown_type',
  NOT_DAMAGED: 'not_damaged',
  DESTROYED: 'destroyed',
  ALREADY_QUEUED: 'already_queued',
  UNIT_BUSY: 'unit_busy',
  FORMATION_BUSY: 'formation_busy',
  UNIT_STATUS: 'unit_status',
  QUEUE_FULL: 'queue_full',
  INSUFFICIENT: 'insufficient',
  NOT_FOUND: 'not_found'
};

function fail(code, reason, extra = {}) {
  return { ok: false, code, reason: String(reason || ''), job: null, ...extra };
}

function pass(code = REPAIR_CODE.OK, extra = {}) {
  return { ok: true, code, reason: '', job: null, ...extra };
}

function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function ensureList(state) {
  if (!Array.isArray(state.repairs)) state.repairs = [];
  return state.repairs;
}

function findUnit(state, unitId) {
  if (!state || !Array.isArray(state.units)) return null;
  return state.units.find((u) => u && u.id === unitId) || null;
}

function findFormation(state, formationId) {
  if (!state || !Array.isArray(state.formations) || !formationId) return null;
  return state.formations.find((f) => f && f.id === formationId) || null;
}

function unitName(unit) {
  const def = unit && UNITS[unit.type];
  return def ? def.name : '单位';
}

/* ============================================================
 * 损伤判定
 * ========================================================== */

/**
 * 依据耐久比例判定损伤等级（纯函数）。
 *   hp <= 0            → destroyed
 *   ratio >= 1         → intact
 *   ratio >= 0.5       → light
 *   否则               → heavy
 */
export { getDamageState, damageStateOfUnit };

/** 维修成本（按损伤等级） */
export function getRepairCost(severity) {
  const table = REPAIR.cost[severity];
  return isObject(table) ? { ...table } : {};
}

/** 维修耗时（游戏秒，按损伤等级） */
export function getRepairTime(severity) {
  return Math.max(0.1, safeNumber(REPAIR.times[severity], 15));
}

function repairMultiplierFromSnapshot(snapshot) {
  if (!Array.isArray(snapshot) || !snapshot.length) return 1;
  return getResearchModifiers({ research: { completed: snapshot } }).repairTimeMultiplier;
}

function researchSnapshot(state) {
  const completed = state && state.research && Array.isArray(state.research.completed)
    ? state.research.completed : [];
  return completed.filter((id) => TECHNOLOGIES[id] && TECHNOLOGIES[id].effects.repairTimeMultiplier);
}

/** 维修队列中是否已包含该单位 */
export function isUnitQueued(state, unitId) {
  return ensureList(state).some((j) => j && j.unitId === unitId);
}

/* ============================================================
 * 排队校验
 * ========================================================== */

/**
 * 能否把单位送去维修（不修改状态）。
 * @returns {{ok:boolean, code:string, reason:string, severity:string, cost:object, duration:number, missing:string[]}}
 */
export function canQueueRepair(state, unitId) {
  if (!isObject(state)) {
    return fail(REPAIR_CODE.STATE_INVALID, '状态无效', { severity: null, cost: {}, duration: 0, missing: [] });
  }
  const unit = findUnit(state, unitId);
  if (!unit) {
    return fail(REPAIR_CODE.UNKNOWN_UNIT, '单位不存在', { severity: null, cost: {}, duration: 0, missing: [] });
  }
  const def = UNITS[unit.type];
  if (!def) {
    return fail(REPAIR_CODE.UNKNOWN_TYPE, '单位类型无效', { severity: null, cost: {}, duration: 0, missing: [] });
  }

  const severity = damageStateOfUnit(unit);
  const repairBase = getRepairTime(severity);
  const repairMultiplier = getResearchModifiers(state).repairTimeMultiplier;
  const base = { severity, cost: getRepairCost(severity), duration: repairBase * repairMultiplier, durationBase: repairBase, missing: [] };

  if (severity === DAMAGE_STATES.DESTROYED) {
    return fail(REPAIR_CODE.DESTROYED, '该单位已损毁，无法维修', { ...base, cost: {}, duration: 0 });
  }
  if (severity === DAMAGE_STATES.INTACT) {
    return fail(REPAIR_CODE.NOT_DAMAGED, '该单位状态完好，无需维修', { ...base, cost: {}, duration: 0 });
  }
  if (unit.status === 'repairing' || isUnitQueued(state, unit.id)) {
    return fail(REPAIR_CODE.ALREADY_QUEUED, '该单位已在维修队列中', base);
  }
  const formation = unit.formationId ? findFormation(state, unit.formationId) : null;
  if (unit.status === 'ready' && unit.formationId === null) {
    // 空闲库存单位：允许维修。
  } else if (unit.status === 'assigned' && formation && formation.status === 'idle') {
    // 待命编队成员：允许维修，正式入队时会脱离编队。
  } else if (unit.status === 'assigned' && formation && formation.status !== 'idle') {
    return fail(REPAIR_CODE.FORMATION_BUSY, '所属编队尚未返回基地', base);
  } else {
    return fail(REPAIR_CODE.UNIT_STATUS, '单位当前状态不允许维修', base);
  }

  const list = ensureList(state);
  if (list.length >= REPAIR.maxQueueSize) {
    return fail(REPAIR_CODE.QUEUE_FULL, `维修队列已满（最多 ${REPAIR.maxQueueSize} 项）`, base);
  }

  const missing = missingResources(state, base.cost);
  if (missing.length) {
    return fail(REPAIR_CODE.INSUFFICIENT, missing.join('，'), { ...base, missing });
  }

  return pass(REPAIR_CODE.READY, base);
}

/* ============================================================
 * 排队 / 推进 / 完成 / 取消
 * ========================================================== */

/** 当前活跃（占用工位）维修任务 */
export function getActiveRepairs(state) {
  return ensureList(state).filter((j) => j && j.status === 'active');
}

/** 当前排队等待的维修任务 */
export function getQueuedRepairs(state) {
  return ensureList(state).filter((j) => j && j.status === 'queued');
}

/** 维修进度 0~1 */
export function getRepairProgress(job) {
  if (!isObject(job)) return 0;
  const duration = Math.max(0.0001, safeNumber(job.duration, 1));
  return clamp(safeNumber(job.elapsed, 0) / duration, 0, 1);
}

/** 维修任务剩余时间（游戏秒） */
export function getRepairRemaining(job) {
  if (!isObject(job)) return 0;
  return Math.max(0, safeNumber(job.duration, 0) - safeNumber(job.elapsed, 0));
}

/**
 * 把排队中的任务提升为活跃（在有空闲工位时）。
 * 队列顺序严格 FIFO。
 * @returns {number} 本次提升的任务数
 */
export function startQueuedRepairs(state) {
  const list = ensureList(state);
  const slots = Math.max(1, Math.floor(safeNumber(REPAIR.maxConcurrent, 2)));
  let started = 0;
  let active = list.filter((j) => j && j.status === 'active').length;
  for (const job of list) {
    if (active >= slots) break;
    if (!job || job.status !== 'queued') continue;
    job.status = 'active';
    active += 1;
    started += 1;
    emit('repair:started', { jobId: job.id, unitId: job.unitId });
  }
  return started;
}

/**
 * 把受损单位送去维修：预付费用 → 安全脱离编队 → 入队。
 */
export function queueRepair(state, unitId) {
  const check = canQueueRepair(state, unitId);
  if (!check.ok) return check;

  const unit = findUnit(state, unitId);
  const cost = check.cost;

  if (!spend(state, cost)) {
    return fail(REPAIR_CODE.INSUFFICIENT, '资源不足，维修取消', { severity: check.severity, cost });
  }

  const researchRevision = ensureResearchRevision(state);
  const createdGameTime = safeNumber(state.time && state.time.game, 0);
  const completedAtCreation = getResearchCompletedAtRevision(state, researchRevision, createdGameTime);

  // 安全脱离编队：释放指挥容量，记录原编队以便完成后提示
  const previousFormationId = typeof unit.formationId === 'string' ? unit.formationId : null;
  if (previousFormationId) {
    const formation = findFormation(state, previousFormationId);
    if (formation && Array.isArray(formation.unitIds)) {
      formation.unitIds = formation.unitIds.filter((id) => id !== unit.id);
    }
    unit.formationId = null;
    emit('formation:changed', { formationId: previousFormationId, kind: 'unitRemoved' });
  }
  unit.status = 'repairing';
  unit.damage = check.severity;

  const job = {
    id: uid('rep'),
    unitId: unit.id,
    unitType: unit.type,
    unitName: unitName(unit),
    severity: check.severity,
    duration: check.duration,
    durationBase: getRepairTime(check.severity),
    elapsed: 0,
    status: 'queued',
    // 仅为旧 UI / 旧存档读取保留的展示快照；退款永远只读取规范化后的 costPaid。
    cost: { ...cost },
    costPaid: { ...cost },
    researchRevision,
    createdGameTime,
    researchSnapshot: completedAtCreation.filter((id) => TECHNOLOGIES[id] && TECHNOLOGIES[id].effects.repairTimeMultiplier),
    previousFormationId,
    queuedAt: safeNumber(state.time ? state.time.game : 0, 0)
  };
  ensureList(state).push(job);

  startQueuedRepairs(state);
  recalcDerived(state);

  const sevText = check.severity === DAMAGE_STATES.HEAVY ? '重伤' : '轻伤';
  logEvent(state, `${job.unitName}（${sevText}）已进入维修队列。`, LOG_LEVEL.INFO);
  emit('repair:queued', { jobId: job.id, unitId: unit.id, severity: check.severity });

  return pass(REPAIR_CODE.OK, { job });
}

/**
 * 完成一项维修：恢复满耐久、状态回 ready、递补队列。
 * @returns {{ok:boolean, code:string, reason:string, job:object|null}}
 */
export function completeRepair(state, jobId) {
  const list = ensureList(state);
  const idx = list.findIndex((j) => j && j.id === jobId);
  if (idx < 0) return fail(REPAIR_CODE.NOT_FOUND, '维修任务不存在');

  const job = list[idx];
  list.splice(idx, 1);

  const unit = findUnit(state, job.unitId);
  if (unit) {
    const def = UNITS[unit.type];
    const maxHp = Math.max(1, safeNumber(def && def.stats ? def.stats.hp : unit.maxHp, 100));
    unit.maxHp = maxHp;
    unit.hp = maxHp;
    unit.damage = DAMAGE_STATES.INTACT;
    unit.status = 'ready';
    unit.formationId = null;
  }

  startQueuedRepairs(state);
  recalcDerived(state);

  logEvent(state, `${job.unitName}维修完成，已恢复满耐久并返回库存。`, LOG_LEVEL.GOOD);
  emit('repair:completed', { jobId: job.id, unitId: job.unitId, unitType: job.unitType });

  return pass(REPAIR_CODE.OK, { job });
}

/**
 * 取消维修：进行中退还 50%，排队中全额退还。
 * 单位耐久保持原样，状态回到 ready（不会自动归队）。
 */
export function cancelRepair(state, jobId) {
  const list = ensureList(state);
  const idx = list.findIndex((j) => j && j.id === jobId);
  if (idx < 0) return fail(REPAIR_CODE.NOT_FOUND, '维修任务不存在');

  const job = list[idx];
  const wasActive = job.status === 'active';
  const ratio = wasActive
    ? safeNumber(REPAIR.activeCancelRefundRatio, 0.5)
    : safeNumber(REPAIR.queuedCancelRefundRatio, 1);

  const refund = {};
  const paidCost = (job.costPaid && typeof job.costPaid === 'object')
    ? job.costPaid
    : getRepairCost(job.severity);
  if (paidCost) {
    Object.keys(paidCost).forEach((key) => {
      const v = Math.floor(safeNumber(paidCost[key], 0) * ratio);
      if (v > 0) refund[key] = v;
    });
  }
  list.splice(idx, 1);
  if (Object.keys(refund).length) grant(state, refund);

  const unit = findUnit(state, job.unitId);
  if (unit) {
    unit.status = 'ready';
    unit.formationId = null;
    unit.damage = damageStateOfUnit(unit);
  }

  startQueuedRepairs(state);
  recalcDerived(state);

  const parts = Object.keys(refund).map((k) => `${k} ${formatInt(refund[k])}`);
  const refundText = parts.length ? `，返还 ${parts.join(' / ')}` : '，无返还';
  logEvent(state,
    `已取消 ${job.unitName} 的维修（${wasActive ? '进行中' : '排队中'}）${refundText}。`,
    LOG_LEVEL.WARN);
  emit('repair:cancelled', { jobId: job.id, unitId: job.unitId, refund, wasActive });

  return pass(REPAIR_CODE.OK, { job, refund });
}

/**
 * 推进维修队列（并行工位，事件步进）。
 *
 * 关键：多个工位共享同一段时间，必须按「下一个完成事件」切分步长，
 * 否则一次大 dt 会让后续递补的任务凭空少推进或多推进，
 * 导致离线结算与在线结算结果不一致。
 *
 * @param {object} state
 * @param {number} dt 游戏秒
 * @returns {{completed:string[], steps:number}} 完成的任务 ID 列表
 */
export function tickRepairs(state, dt) {
  const completed = [];
  if (!isObject(state)) return { completed, steps: 0 };
  const list = ensureList(state);
  let remaining = Math.max(0, safeNumber(dt, 0));
  if (list.length === 0 || remaining <= 0) return { completed, steps: 0 };

  startQueuedRepairs(state);

  let steps = 0;
  let guard = 0;
  while (remaining > 1e-9 && guard < 4096) {
    guard += 1;
    const active = getActiveRepairs(state);
    if (active.length === 0) break;

    // 下一个完成事件所需的最短时间
    let shortest = Infinity;
    active.forEach((job) => {
      shortest = Math.min(shortest, getRepairRemaining(job));
    });
    if (!Number.isFinite(shortest)) break;

    const step = Math.min(remaining, Math.max(shortest, 1e-6));
    active.forEach((job) => { job.elapsed = safeNumber(job.elapsed, 0) + step; });
    remaining -= step;
    steps += 1;

    // 结算本步内完成的任务（按队列顺序，保证确定性）
    const finished = getActiveRepairs(state)
      .filter((job) => getRepairRemaining(job) <= 1e-9)
      .map((job) => job.id);
    finished.forEach((id) => {
      const r = completeRepair(state, id);
      if (r.ok) completed.push(id);
    });
  }

  return { completed, steps };
}

/**
 * 离线期间的维修推进（与在线共用同一套推进逻辑，保证一致）。
 * @returns {{completed:string[], units:object[]}}
 */
export function advanceOffline(state, seconds) {
  const before = ensureList(state).map((j) => ({ id: j.id, unitType: j.unitType, unitName: j.unitName }));
  const { completed } = tickRepairs(state, seconds);
  const units = completed
    .map((id) => before.find((b) => b.id === id))
    .filter(Boolean);
  return { completed, units };
}

/* ============================================================
 * 存档容错
 * ========================================================== */

/**
 * 维修队列容错：
 *  - 丢弃结构损坏 / 单位不存在 / 类型未知 / 已完好或已损毁的任务；
 *  - 去重（同一单位只能有一项）、限长、修正状态与进度；
 *  - 活跃任务数量不得超过 maxConcurrent，多出的降级为排队；
 *  - 单位与任务的双向状态必须一致（unit.status='repairing' 且不属于任何编队）。
 *
 * 必须在 sanitizeFormations 之前调用：先释放维修单位的编队归属，
 * 再让编队校验去处理剩余成员，否则会出现「维修中的单位仍占指挥容量」。
 *
 * @returns {{repaired:boolean, notes:string[]}}
 */
export function sanitizeRepairs(state) {
  const notes = [];
  if (!isObject(state)) return { repaired: false, notes };

  if (!Array.isArray(state.repairs)) {
    if (state.repairs !== undefined && state.repairs !== null) notes.push('维修队列结构非法，已重置。');
    state.repairs = [];
    return { repaired: notes.length > 0, notes };
  }

  const validSeverity = new Set([DAMAGE_STATES.LIGHT, DAMAGE_STATES.HEAVY]);
  const seenIds = new Set();
  const seenUnits = new Set();
  const kept = [];

  state.repairs.forEach((raw) => {
    if (!isObject(raw)) { notes.push('维修任务结构非法，已丢弃。'); return; }

    const unit = findUnit(state, raw.unitId);
    if (!unit) { notes.push('维修任务引用了不存在的单位，已丢弃。'); return; }
    const def = UNITS[unit.type];
    if (!def) { notes.push('维修任务单位类型无效，已丢弃。'); return; }
    if (seenUnits.has(unit.id)) { notes.push('同一单位存在重复维修任务，已合并。'); return; }

    const job = { ...raw };
    job.id = (typeof job.id === 'string' && job.id && !seenIds.has(job.id)) ? job.id : uid('rep');
    seenIds.add(job.id);
    seenUnits.add(unit.id);

    job.unitId = unit.id;
    job.unitType = unit.type;
    job.unitName = unitName(unit);

    // 损伤等级：以单位实际耐久为准（存档里的值不可信）
    const maxHp = Math.max(1, safeNumber(def.stats ? def.stats.hp : unit.maxHp, 100));
    unit.maxHp = maxHp;
    unit.hp = clamp(safeNumber(unit.hp, maxHp), 0, maxHp);
    const severity = getDamageState(unit.hp, maxHp);
    if (!validSeverity.has(severity)) {
      notes.push(`${job.unitName}已无需维修或已损毁，维修任务已丢弃。`);
      if (unit.status === 'repairing') unit.status = 'ready';
      unit.damage = severity;
      return;
    }
    if (job.severity !== severity) notes.push('维修任务损伤等级与单位实际耐久不符，已修正。');
    job.severity = severity;
    unit.damage = severity;

    job.durationBase = getRepairTime(severity);
    job.createdGameTime = Math.max(0, safeNumber(job.createdGameTime, safeNumber(job.queuedAt, state.time && state.time.game)));
    job.researchRevision = Number.isInteger(Number(job.researchRevision)) ? Number(job.researchRevision) : -1;
    const versionCompleted = job.researchRevision >= 0
      ? getResearchCompletedAtRevision(state, job.researchRevision, job.createdGameTime) : [];
    const legacySnapshot = Array.isArray(job.researchSnapshot) ? job.researchSnapshot : [];
    const version = job.researchRevision >= 0 ? versionCompleted : legacySnapshot;
    job.duration = Math.max(0.1, job.durationBase * repairMultiplierFromSnapshot(version));
    job.researchSnapshot = version.filter((id) => TECHNOLOGIES[id] && TECHNOLOGIES[id].effects.repairTimeMultiplier);
    job.elapsed = clamp(safeNumber(job.elapsed, 0), 0, job.duration);
    job.status = job.status === 'active' ? 'active' : 'queued';
    job.costPaid = getRepairCost(severity);
    job.cost = { ...job.costPaid };
    job.previousFormationId = typeof job.previousFormationId === 'string' ? job.previousFormationId : null;
    job.queuedAt = safeNumber(job.queuedAt, 0);

    // 双向状态一致：维修中的单位不得属于任何编队
    if (unit.status !== 'repairing') {
      unit.status = 'repairing';
      notes.push(`${job.unitName}处于维修队列但状态不符，已修正为维修中。`);
    }
    if (unit.formationId) {
      const formation = findFormation(state, unit.formationId);
      if (formation && Array.isArray(formation.unitIds)) {
        formation.unitIds = formation.unitIds.filter((id) => id !== unit.id);
      }
      unit.formationId = null;
      notes.push(`${job.unitName}正在维修但仍被编队引用，已释放归属。`);
    }

    kept.push(job);
  });

  // 限长
  const maxQ = Math.max(1, Math.floor(safeNumber(REPAIR.maxQueueSize, 8)));
  if (kept.length > maxQ) {
    kept.slice(maxQ).forEach((job) => {
      const unit = findUnit(state, job.unitId);
      if (unit && unit.status === 'repairing') unit.status = 'ready';
    });
    kept.length = maxQ;
    notes.push(`维修队列超出上限，已截断为 ${maxQ} 项。`);
  }

  // 活跃工位限额
  const slots = Math.max(1, Math.floor(safeNumber(REPAIR.maxConcurrent, 2)));
  let activeCount = 0;
  kept.forEach((job) => {
    if (job.status !== 'active') return;
    activeCount += 1;
    if (activeCount > slots) {
      job.status = 'queued';
      notes.push('进行中的维修任务超出工位数量，多余项已降级为排队。');
    }
  });

  // 排队任务不得有进度
  kept.forEach((job) => {
    if (job.status === 'queued' && job.elapsed > 0) {
      job.elapsed = 0;
      notes.push('排队中的维修任务携带进度，已清零。');
    }
  });

  state.repairs = kept;

  // 还原「状态是 repairing 但没有对应任务」的孤儿单位
  (state.units || []).forEach((u) => {
    if (!u || u.status !== 'repairing') return;
    if (kept.some((job) => job.unitId === u.id)) return;
    u.status = 'ready';
    u.formationId = null;
    notes.push(`${unitName(u)}标记为维修中但没有对应任务，已恢复待命。`);
  });

  // 补齐空闲工位
  startQueuedRepairs(state);

  return { repaired: notes.length > 0, notes };
}

/** 维修车间是否已建成（用于 UI 提示，不作为维修前置条件） */
export function hasRepairShop(state) {
  return (state && Array.isArray(state.buildings) ? state.buildings : []).some(
    (b) => b && b.type === 'armor_factory' && b.status === BUILDING_STATUS.OPERATIONAL
  );
}

/** 汇总导出，便于调试面板一次性读取 */
export const REPAIR_API = {
  getDamageState, damageStateOfUnit, canQueueRepair, queueRepair, tickRepairs,
  startQueuedRepairs, completeRepair, cancelRepair, getActiveRepairs, getQueuedRepairs,
  getRepairProgress, getRepairRemaining, getRepairCost, getRepairTime, sanitizeRepairs
};
