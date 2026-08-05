/**
 * production.js —— 单位生产（阶段3主体）
 *
 * 职责边界：
 *  - 只处理业务逻辑：资格检查、入队、扣费、推进、完成结算、取消返还、单位实例创建、
 *    库存查询、生产数据容错；
 *  - 不查询 DOM、不操作 Canvas、不弹窗，UI 相关一律由 ui.js / main.js 负责。
 *
 * 阶段3新增：完整的生产队列（当前 + 等待）、按 costPaid 精确返还、单位实例入库、
 * 等待任务取消、生产数据存档容错。
 */

import {
  UNITS, BUILDINGS, PRODUCTION, PRODUCTION_UI, RESOURCE_DEFS, DAMAGE_STATES, BUILDING_STATUS
} from './config.js';
import { canAfford, spend, grant, recalcDerived } from './economy.js';
import { logEvent, emit, LOG_LEVEL } from './events.js';
import { uid, safeNumber, clamp, formatCost, formatDuration, formatInt } from './utils.js';
import { getDamageState } from './unit-status.js';
import { getResearchModifiers, getResearchCompletedAtRevision, ensureResearchRevision } from './research.js';

const R = PRODUCTION_UI ? PRODUCTION_UI.reason : {};

/** 步兵类用“训练”，其余用“制造” */
function categoryVerb(def) {
  return def && def.category === 'infantry' ? '训练' : '制造';
}

function productionResearchSnapshot(state, category, completedOverride = null) {
  const completed = Array.isArray(completedOverride) ? completedOverride
    : (state && state.research && Array.isArray(state.research.completed) ? state.research.completed : []);
  const ids = [];
  if (category === 'infantry' && completed.includes('standardized_training')) ids.push('standardized_training');
  if ((category === 'vehicle' || category === 'armor' || category === 'support') && completed.includes('modular_assembly')) ids.push('modular_assembly');
  return ids;
}

function durationForSnapshot(baseTime, category, snapshot) {
  const mods = getResearchModifiers({ research: { completed: snapshot || [] } });
  const multiplier = category === 'infantry'
    ? mods.infantryProductionTimeMultiplier
    : (category === 'vehicle' || category === 'armor' || category === 'support' ? mods.vehicleProductionTimeMultiplier : 1);
  return Math.max(0.05, baseTime * multiplier);
}

/** 建筑显示名 */
function buildingName(typeId) {
  const b = BUILDINGS[typeId];
  return b ? b.name : (typeId || '生产建筑');
}

/* ============================================================
 * 资格检查
 * ========================================================== */

/**
 * 判断某单位当前能否加入生产队列。
 * @returns {{ok:boolean, code:string, reasons:string[], reason:string}}
 *   code：ready / unknown / locked / producer_missing / producer_offline /
 *         queue_full / resource
 */
export function canQueueUnit(state, unitType) {
  const def = UNITS[unitType];
  const reasons = [];
  if (!def) {
    return { ok: false, code: 'unknown', reasons: [R.unknown || '未知单位类型'], reason: R.unknown || '未知单位类型' };
  }

  let code = 'ready';
  const pushReason = (text, thisCode) => {
    reasons.push(text);
    if (code === 'ready') code = thisCode;
  };

  if (!state.unlocks.units.includes(unitType)) {
    pushReason(R.locked || '尚未解锁该单位', 'locked');
  }

  const producerName = buildingName(def.from);
  const producers = (state.buildings || []).filter((b) => b && b.type === def.from);
  if (producers.length === 0) {
    // 一座都没有：提示先建成
    pushReason(def.from === 'armor_factory' ? (R.needArmorFactory || '需要先建成装甲工厂') : (R.needBarracks || '需要先建成兵营'), 'producer_missing');
  } else if (!producers.some((b) => b.status === BUILDING_STATUS.OPERATIONAL)) {
    // 建筑存在但都在施工中 / 离线：不是缺建筑，而是暂时无法生产
    const text = R.producerOffline ? R.producerOffline(producerName) : `${producerName}当前无法生产`;
    pushReason(text, 'producer_offline');
  }

  const prod = state.production || {};
  const inLine = (prod.current ? 1 : 0) + (Array.isArray(prod.queue) ? prod.queue.length : 0);
  if (inLine >= safeNumber(PRODUCTION.maxQueueSize, 5)) {
    pushReason(R.queueFull ? R.queueFull(PRODUCTION.maxQueueSize) : `生产队列已满：最多${PRODUCTION.maxQueueSize}项`, 'queue_full');
  }

  if (!canAfford(state, def.cost)) {
    Object.keys(def.cost || {}).forEach((key) => {
      const need = safeNumber(def.cost[key], 0);
      const have = safeNumber(state.resources && state.resources[key], 0);
      if (have < need) {
        const name = RESOURCE_DEFS[key] ? RESOURCE_DEFS[key].name : key;
        const text = R.lackResource ? R.lackResource(name, formatInt(need - have)) : `${name}不足，缺少${formatInt(need - have)}`;
        pushReason(text, 'resource');
      }
    });
  }

  const ok = reasons.length === 0;
  return { ok, code: ok ? 'ready' : code, reasons, reason: ok ? '' : reasons[0] };
}

/** 兼容别名 */
export function canProduce(state, unitId) {
  return canQueueUnit(state, unitId);
}

/* ============================================================
 * 入队
 * ========================================================== */

/**
 * 提交生产申请（玩家点击“加入训练队列/制造队列”）。
 * 内部会再做一次 canQueueUnit()，因此对连点、并发调用是安全的。
 * @returns {{ok:boolean, reason?:string, code?:string}}
 */
export function queueUnit(state, unitType) {
  const check = canQueueUnit(state, unitType);
  if (!check.ok) return { ok: false, reason: check.reason, code: check.code };

  const def = UNITS[unitType];
  // 必须挂在真正“运行中”的建筑上，避免把任务记到在建/离线的同类建筑
  const producer = (state.buildings || []).find(
    (b) => b && b.type === def.from && b.status === BUILDING_STATUS.OPERATIONAL
  );
  if (!producer) return { ok: false, reason: '生产建筑不存在', code: 'producer_missing' };

  // 双保险：再次确认队列未超上限
  const prod = state.production;
  const inLine = (prod.current ? 1 : 0) + prod.queue.length;
  if (inLine >= safeNumber(PRODUCTION.maxQueueSize, 5)) {
    return { ok: false, reason: R.queueFull ? R.queueFull(PRODUCTION.maxQueueSize) : '生产队列已满', code: 'queue_full' };
  }

  if (!spend(state, def.cost)) return { ok: false, reason: '资源扣除失败', code: 'resource' };

  const researchRevision = ensureResearchRevision(state);
  const createdGameTime = safeNumber(state.time && state.time.game, 0);
  const completedAtCreation = getResearchCompletedAtRevision(state, researchRevision, createdGameTime);

  const job = {
    id: uid('job'),
    type: unitType,
    elapsed: 0,
    durationBase: Math.max(0.05, safeNumber(def.buildTime, 1)),
    researchRevision,
    createdGameTime,
    researchSnapshot: productionResearchSnapshot(state, def.category, completedAtCreation),
    duration: durationForSnapshot(
      Math.max(0.05, safeNumber(def.buildTime, 1)), def.category, completedAtCreation
    ),
    queuedAt: Date.now(),
    sourceBuildingId: producer.id,
    costPaid: { ...def.cost },
    done: false
  };

  const verb = categoryVerb(def);
  if (!prod.current) {
    prod.current = job;
    job.startedAt = Date.now();
    logEvent(state, `${def.name}开始${verb}。`, LOG_LEVEL.INFO);
    emit('production:started', { unitType, jobId: job.id });
  } else {
    prod.queue.push(job);
    logEvent(state, `${def.name}已加入${verb}队列，当前排在第${prod.queue.length}位。`, LOG_LEVEL.INFO);
    emit('production:queued', { unitType, jobId: job.id, position: prod.queue.length });
  }
  return { ok: true };
}

/* ============================================================
 * 推进与完成
 * ========================================================== */

/**
 * 生产推进（固定步长调用）。
 * 单次 dt 足够完成多个短任务时顺序完成，但用循环保护避免死循环。
 * @param {number} dt 游戏秒；暂停时 main.js 不会调用，速度只影响步数
 */
export function tickProduction(state, dt) {
  if (!state || !state.production || !(dt > 0)) return;
  // 剩余时间逐项消费：避免把同一段 dt 重复叠加到后续任务上。
  let remaining = dt;
  let guard = 0;
  while (state.production.current && remaining > 1e-9 && guard < 32) {
    guard += 1;
    const job = state.production.current;
    if (job.done) { startNextProduction(state); continue; }

    const duration = safeNumber(job.duration, 0);
    const need = duration - safeNumber(job.elapsed, 0);
    if (need <= 1e-9) {
      // 已到时（容差内）直接结算，避免卡在 99.99%
      completeProduction(state, job);
      continue;
    }
    const consumed = need < remaining ? need : remaining;
    job.elapsed = safeNumber(job.elapsed, 0) + consumed;
    remaining -= consumed;
    // 浮点吸附：接近完成时直接吸附到 duration，避免卡在 99.99%
    if (job.elapsed >= duration - 1e-6) {
      job.elapsed = duration;
      completeProduction(state, job);
    } else {
      break;
    }
  }
}

/**
 * 生产完成结算。
 * 通过 job.done 标记 + 立即清空 current，保证同一任务只结算一次：
 * 不会重复生成单位、不会重复增加 unitsBuilt、不会重复写日志或重复派发事件。
 */
export function completeProduction(state, job) {
  if (!state || !job || job.done) return false;
  // 只允许结算当前任务，防止旧引用被二次调用
  if (state.production.current !== job) return false;

  const def = UNITS[job.type];
  job.done = true;
  job.elapsed = safeNumber(job.duration, 0);

  const unit = createUnit(job.type, job.sourceBuildingId);
  state.units.push(unit);
  state.stats.unitsBuilt = safeNumber(state.stats.unitsBuilt, 0) + 1;
  state.production.current = null;

  const verb = categoryVerb(def);
  const doneVerb = verb === '训练' ? '训练完成' : '生产完成';
  logEvent(state, `${def ? def.name : '单位'}${doneVerb}，已进入单位库存。`, LOG_LEVEL.GOOD);
  // 渲染器根据真实单位类型播放出厂/出营动画
  emit('production:completed', {
    unitType: job.type,
    instanceId: unit.id,
    sourceBuildingId: job.sourceBuildingId,
    sourceBuildingType: def ? def.from : null
  });

  startNextProduction(state);

  if (!state.production.current) {
    const bname = (def && BUILDINGS[def.from]) ? BUILDINGS[def.from].name : '生产线';
    logEvent(state, `${bname}已空闲。`, LOG_LEVEL.INFO);
    emit('production:idle', { sourceBuildingType: def ? def.from : null });
  }
  return true;
}

/**
 * 自动开工队列中的下一项（从 0 开始计算进度，不重复扣费）。
 */
export function startNextProduction(state) {
  if (!state || !state.production) return false;
  if (state.production.current) return false;
  if (!Array.isArray(state.production.queue) || state.production.queue.length === 0) return false;

  const next = state.production.queue.shift();
  next.elapsed = 0;
  next.startedAt = Date.now();
  state.production.current = next;
  const def = UNITS[next.type];
  const verb = categoryVerb(def);
  logEvent(state, `${def ? def.name : '单位'}开始${verb}。`, LOG_LEVEL.INFO);
  emit('production:started', { unitType: next.type, jobId: next.id });
  return true;
}

/* ============================================================
 * 进度查询
 * ========================================================== */

/** 当前生产进度（0~1），无任务返回 null */
export function currentProgress(state) {
  const job = state && state.production && state.production.current;
  if (!job) return null;
  const duration = safeNumber(job.duration, 0);
  return duration > 0 ? Math.min(1, safeNumber(job.elapsed, 0) / duration) : 1;
}

/**
 * 生产进度百分比（用于显示与进度条）。
 * 采用四舍五入并对浮点误差做吸附：未完成时绝不超过 99%，
 * 仅在真正完成（elapsed 已吸附到 duration）时才显示 100%。
 */
function displayPercent(duration, elapsed) {
  const raw = duration > 0 ? (elapsed / duration) * 100 : 100;
  let pct = Math.round(raw);
  if (pct >= 100 && elapsed < duration - 1e-6) pct = 99;
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return pct;
}

/** 兼容别名 */
export function getProductionProgress(state) {
  const job = state && state.production && state.production.current;
  if (!job) return null;
  const def = UNITS[job.type];
  const duration = Math.max(0, safeNumber(job.duration, 0));
  const elapsed = Math.min(duration, Math.max(0, safeNumber(job.elapsed, 0)));
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 1;
  const remaining = Math.max(0, duration - elapsed);

  const producer = (state.buildings || []).find((b) => b.id === job.sourceBuildingId);
  const producerName = producer
    ? (BUILDINGS[producer.type] ? BUILDINGS[producer.type].name : producer.type)
    : '生产设施';

  return {
    typeId: job.type,
    name: def ? def.name : '未知单位',
    sourceBuildingId: job.sourceBuildingId || null,
    sourceBuildingName: producerName,
    elapsed,
    duration,
    remaining,
    progress,
    percent: displayPercent(duration, elapsed),
    elapsedText: formatDuration(elapsed),
    remainingText: formatDuration(Math.ceil(remaining))
  };
}

/* ============================================================
 * 取消
 * ========================================================== */

/**
 * 取消当前生产任务：按 activeCancelRefundRatio 返还 costPaid（经 grant 钳制）。
 * 不生成单位、不增加统计，自动开工下一项等待任务。
 */
export function cancelCurrentProduction(state) {
  const job = state && state.production && state.production.current;
  if (!job) return { ok: false, reason: '当前没有进行中的生产' };

  const def = UNITS[job.type];
  state.production.current = null;
  job.done = true;

  const refund = {};
  const cost = job.costPaid || {};
  Object.keys(cost).forEach((key) => {
    const back = Math.floor(safeNumber(cost[key], 0) * safeNumber(PRODUCTION.activeCancelRefundRatio, 0.5));
    if (back > 0) refund[key] = back;
  });
  recalcDerived(state);      // 先刷新上限，再按上限钳制返还
  grant(state, refund);

  const refundText = Object.keys(refund).length ? formatCost(refund, RESOURCE_DEFS) : '无资源返还';
  logEvent(state, `${def ? def.name : '项目'}生产已取消，返还${refundText}。`, LOG_LEVEL.WARN);
  emit('production:cancelled', { unitType: job.type, refund });

  startNextProduction(state);
  return { ok: true, name: def ? def.name : '项目', refund };
}

/**
 * 取消等待队列中的任务：按 queuedCancelRefundRatio（100%）返还 costPaid。
 * 不影响当前生产进度。
 */
export function cancelQueuedProduction(state, jobId) {
  const queue = state && state.production && state.production.queue;
  if (!Array.isArray(queue)) return { ok: false, reason: '队列不存在' };
  const idx = queue.findIndex((j) => j && j.id === jobId);
  if (idx < 0) return { ok: false, reason: '未找到该等待任务' };

  const job = queue[idx];
  const def = UNITS[job.type];
  queue.splice(idx, 1);

  const refund = {};
  const cost = job.costPaid || {};
  Object.keys(cost).forEach((key) => {
    const back = Math.floor(safeNumber(cost[key], 0) * safeNumber(PRODUCTION.queuedCancelRefundRatio, 1));
    if (back > 0) refund[key] = back;
  });
  recalcDerived(state);
  grant(state, refund);

  const refundText = Object.keys(refund).length ? formatCost(refund, RESOURCE_DEFS) : '无资源返还';
  logEvent(state, `${def ? def.name : '项目'}已从等待队列移除，返还${refundText}。`, LOG_LEVEL.WARN);
  emit('production:queued_cancelled', { unitType: job.type, refund });
  return { ok: true, name: def ? def.name : '项目', refund };
}

/* ============================================================
 * 单位实例
 * ========================================================== */

/** 创建真实单位实例（可 JSON 序列化，状态完整） */
export function createUnit(typeId, sourceBuildingId = null) {
  const def = UNITS[typeId];
  const hp = def ? safeNumber(def.stats ? def.stats.hp : 100, 100) : 100;
  return {
    id: uid('unit'),
    type: typeId,
    hp,
    maxHp: hp,
    damage: DAMAGE_STATES.INTACT,
    status: 'ready',            // ready / assigned / repairing / deployed
    formationId: null,
    experience: 0,
    battles: 0,
    callsign: null,
    createdAt: Date.now(),
    sourceBuildingId
  };
}

/** 库存中空闲（未编入编队、未维修）的单位 */
export function availableUnits(state) {
  return (state.units || []).filter((u) => !u.formationId && u.status === 'ready');
}

/** 按类型统计库存数量（实时计算，不维护独立计数字段） */
export function inventoryCount(state) {
  const map = {};
  (state.units || []).forEach((u) => {
    map[u.type] = (map[u.type] || 0) + 1;
  });
  return map;
}

/* ============================================================
 * 生产数据容错
 * ========================================================== */

/**
 * 校验并修复生产相关数据（读档时调用，纯数据操作，不写日志）。
 * 处理：production 结构、current/queue 合法性、单位类型/解锁/来源建筑、
 * 进度/时长、costPaid、任务重复、队列上限、单位实例 ID 与生命值等。
 * @returns {{repaired:boolean, notes:string[]}}
 */
export function sanitizeProduction(saveState) {
  const notes = [];
  if (!saveState || typeof saveState !== 'object') return { repaired: false, notes };
  if (!saveState.production || typeof saveState.production !== 'object') {
    saveState.production = { current: null, queue: [] };
    notes.push('生产数据结构缺失');
  }
  const prod = saveState.production;
  if (!Array.isArray(prod.queue)) prod.queue = [];

  const validTypes = new Set(Object.keys(UNITS));
  const unlocked = new Set(
    Array.isArray(saveState.unlocks && saveState.unlocks.units) ? saveState.unlocks.units : []
  );
  const isUnlocked = (t) => validTypes.has(t) && unlocked.has(t);

  const checkJob = (job, where) => {
    if (!job || typeof job !== 'object' || Array.isArray(job)) { notes.push(`${where}任务格式非法`); return null; }
    if (!job.type || !validTypes.has(job.type)) { notes.push(`${where}任务单位类型无效`); return null; }
    if (!job.sourceBuildingId) { notes.push(`${where}任务缺少来源建筑`); return null; }
    const bld = (saveState.buildings || []).find((b) => b && b.id === job.sourceBuildingId);
    if (!bld) { notes.push(`${where}任务来源建筑不存在`); return null; }
    if (bld.status !== BUILDING_STATUS.OPERATIONAL) { notes.push(`${where}任务来源建筑未运行`); return null; }
    const def = UNITS[job.type];
    // 来源建筑类型必须与单位配置声明的生产建筑一致（坦克不能挂在兵营上）
    if (bld.type !== def.from) { notes.push(`${where}任务来源建筑类型不匹配`); return null; }
    if (!isUnlocked(job.type)) { notes.push(`${where}任务单位未解锁`); return null; }
    if (!job.costPaid || typeof job.costPaid !== 'object') { notes.push(`${where}任务缺少已支付成本`); return null; }
    let costOk = true;
    Object.keys(job.costPaid).forEach((k) => {
      if (!RESOURCE_DEFS[k] || !Number.isFinite(Number(job.costPaid[k])) || Number(job.costPaid[k]) < 0) costOk = false;
    });
    if (!costOk) { notes.push(`${where}任务已支付成本非法`); return null; }

    // 规范化：时长只由任务创建时绑定的科研revision重建，不能信任当前科技或 duration。
    job.durationBase = Math.max(0.0001, safeNumber(def.buildTime, 1));
    job.createdGameTime = Math.max(0, safeNumber(job.createdGameTime, safeNumber(job.queuedAt, saveState.time && saveState.time.game)));
    job.researchRevision = Number.isInteger(Number(job.researchRevision)) ? Number(job.researchRevision) : -1;
    const completedTechs = job.researchRevision >= 0
      ? getResearchCompletedAtRevision(saveState, job.researchRevision, job.createdGameTime) : [];
    const migratedSnapshot = Array.isArray(job.researchSnapshot) ? job.researchSnapshot : [];
    const usedCompleted = job.researchRevision >= 0 ? completedTechs : productionResearchSnapshot(saveState, def.category, migratedSnapshot);
    job.duration = durationForSnapshot(job.durationBase, def.category, usedCompleted);
    job.researchSnapshot = productionResearchSnapshot(saveState, def.category, usedCompleted);
    job.elapsed = clamp(safeNumber(job.elapsed, 0), 0, job.duration);
    job.costPaid = { ...def.cost };

    // 任务 ID 规范化：必须非空且为字符串
    if (!job.id || typeof job.id !== 'string') {
      job.id = uid('job');
      notes.push(`${where}任务缺少ID，已重新生成`);
    }
    return job;
  };

  // 当前任务
  if (prod.current && typeof prod.current === 'object') {
    const fixed = checkJob(prod.current, '当前');
    if (!fixed) prod.current = null;
  } else {
    prod.current = null;
  }

  // 队列任务逐个校验
  const keptQueue = [];
  prod.queue.forEach((job) => {
    const fixed = checkJob(job, '等待');
    if (fixed) keptQueue.push(fixed);
  });
  prod.queue = keptQueue;

  // 队列首项错误恢复：current 为空但有等待任务时，把第一项提升为 current，
  // 保留已支付成本、elapsed 归零、补充 startedAt，不重复扣费、不触发完成事件。
  if (!prod.current && prod.queue.length > 0) {
    const next = prod.queue.shift();
    next.elapsed = 0;
    next.startedAt = safeNumber(next.startedAt, Date.now());
    prod.current = next;
    notes.push('已恢复停滞的生产队列');
  }

  // 同一任务不能同时存在于 current 与 queue
  if (prod.current) prod.queue = prod.queue.filter((j) => j.id !== prod.current.id);
  // 任务 id 去重
  const seenIds = new Set();
  if (prod.current) seenIds.add(prod.current.id);
  const dedupQueue = [];
  prod.queue.forEach((j) => {
    if (seenIds.has(j.id)) { notes.push('发现重复生产任务ID并移除'); return; }
    seenIds.add(j.id);
    dedupQueue.push(j);
  });
  prod.queue = dedupQueue;

  // 队列长度上限（当前 + 等待 ≤ maxQueueSize）
  const maxQ = safeNumber(PRODUCTION.maxQueueSize, 5) - (prod.current ? 1 : 0);
  if (prod.queue.length > maxQ) {
    notes.push(`生产队列超过上限，移除了 ${prod.queue.length - maxQ} 项`);
    prod.queue = prod.queue.slice(0, maxQ);
  }

  // 单位实例校验
  if (!Array.isArray(saveState.units)) saveState.units = [];
  const seenUnitIds = new Set();
  const keptUnits = [];
  const validStatus = new Set(['ready', 'assigned', 'repairing', 'deployed']);
  saveState.units.forEach((u) => {
    if (!u || typeof u !== 'object') { notes.push('单位实例格式非法'); return; }
    if (!u.type || !validTypes.has(u.type)) { notes.push('单位实例类型无效'); return; }
    let uidVal = u.id;
    if (!uidVal || typeof uidVal !== 'string') { uidVal = uid('unit'); notes.push('单位实例缺少ID，已生成'); }
    if (seenUnitIds.has(uidVal)) { uidVal = uid('unit'); notes.push('单位实例ID重复，已重新生成'); }
    seenUnitIds.add(uidVal);
    u.id = uidVal;

    const def = UNITS[u.type];
    const maxHp = safeNumber(def.stats ? def.stats.hp : 100, 100);
    u.maxHp = maxHp;                                   // 恢复 maxHp
    const hp = safeNumber(u.hp, maxHp);
    u.hp = clamp(hp, 0, maxHp);                        // 钳制到 0~maxHp
    u.damage = getDamageState(u.hp, u.maxHp);
    if (u.status && !validStatus.has(u.status)) u.status = 'ready';
    u.formationId = (typeof u.formationId === 'string') ? u.formationId : null;
    u.experience = Number.isFinite(Number(u.experience)) && Number(u.experience) >= 0 ? Number(u.experience) : 0;
    u.battles = Number.isFinite(Number(u.battles)) && Number(u.battles) >= 0 ? Math.floor(Number(u.battles)) : 0;
    u.callsign = typeof u.callsign === 'string' ? u.callsign.trim().slice(0, 12) || null : null;
    keptUnits.push(u);
  });
  saveState.units = keptUnits;

  return { repaired: notes.length > 0, notes };
}

/* ============================================================
 * 其它（供渲染层与阶段6）
 * ========================================================== */

/** 供渲染层查询：生产建筑是否正在工作（用于烟雾/灯光强度） */
export function isFactoryBusy(state, buildingType) {
  const job = state && state.production && state.production.current;
  if (!job) return false;
  const def = UNITS[job.type];
  return Boolean(def && def.from === buildingType);
}

/** 建筑是否处于可生产状态（阶段3使用） */
export function producerReady(state, buildingType) {
  const bld = (state.buildings || []).find((b) => b.type === buildingType);
  return Boolean(bld && bld.status === BUILDING_STATUS.OPERATIONAL);
}

/** 离线期间的生产推进（阶段6接入，阶段3不调用） */
export function advanceOffline(state, seconds) {
  const done = {};
  let remaining = seconds;
  let guard = 0;
  while (remaining > 0 && state.production.current && guard < 64) {
    guard += 1;
    const job = state.production.current;
    const need = safeNumber(job.duration, 0) - safeNumber(job.elapsed, 0);
    if (need > remaining) {
      job.elapsed += remaining;
      remaining = 0;
    } else {
      remaining -= Math.max(0, need);
      const type = job.type;
      completeProduction(state, job);
      if (type) done[type] = (done[type] || 0) + 1;
    }
  }
  return done;
}
