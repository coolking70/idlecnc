/**
 * theater.js —— 战区、派遣与活动战斗状态机（阶段5主体）
 *
 * 职责边界：
 *  - 只处理「战区数据 + 派遣资格 + 活动战斗生命周期 + 结算写回」；
 *  - 战斗结果一律由 battle.simulateBattle() 一次性算出，本模块不参与命中/伤害判定；
 *  - 不触碰 DOM / Canvas，只通过事件总线广播；
 *  - 所有修改型接口统一返回：{ ok, code, reason, activeBattle }。
 *
 * 活动战斗生命周期：
 *   dispatchFormation()  →  扣成本、求解、创建 activeBattle（playing）
 *   tickActiveBattle()   →  推进 elapsed（只播放，不改结果）
 *   settleActiveBattle() →  到时结算一次（幂等），写回 hp / 损失 / 占领 / 奖励
 *   tickBattleReturn()    →  结算后只推进返航展示计时
 *   finishBattleReturn()  →  返航完成，编队复位待命，清空 activeBattle
 */

import {
  THEATERS, OPERATIONS, STRATEGIES, ENEMY_UNITS, TERRAIN, BATTLE, BATTLE_RESULT,
  UNITS, BUILDING_STATUS, DAMAGE_STATES,
  FORMATION_STATUS, RESOURCE_DEFS
} from './config.js';
import { BATTLE_EVENT, simulateBattle, resultLabel, rebuildBattleFromDispatchSnapshot } from './battle.js';
import { spend, grant, missingResources, recalcDerived } from './economy.js';
import { logEvent, emit, LOG_LEVEL } from './events.js';
import { safeNumber, clamp, randomSeed, formatInt } from './utils.js';
import { getDamageState } from './unit-status.js';
import { getUnitRank, getUnitEffectiveStats, formatUnitDisplayName } from './units.js';
import { compareBattleReports, validateBattleOutcomeConsistency, stableStringify } from './integrity.js';
import { OPERATION_CODE, getOperationCost, canDispatchOperation, operationCooldown } from './operations.js';
import {
  SESSION_ORIGIN, SESSION_LIFECYCLE, ensureBattleSessionState, createProductionBattleSession,
  validateSessionBinding, validateSettlementLedger, buildSettlementLedgerHash, cloneJson
} from './production-battle-session.js';

/* ============================================================
 * 结果码
 * ========================================================== */

export const THEATER_CODE = {
  OK: 'ok',
  READY: 'ready',
  STATE_INVALID: 'state_invalid',
  UNKNOWN_THEATER: 'unknown_theater',
  UNKNOWN_STRATEGY: 'unknown_strategy',
  LOCKED: 'locked',
  CAPTURED: 'captured',
  BATTLE_ACTIVE: 'battle_active',
  NO_BATTLE: 'no_battle',
  FORMATION_NOT_FOUND: 'formation_not_found',
  FORMATION_BUSY: 'formation_busy',
  FORMATION_EMPTY: 'formation_empty',
  NO_COMBAT_UNIT: 'no_combat_unit',
  UNIT_UNAVAILABLE: 'unit_unavailable',
  INSUFFICIENT: 'insufficient',
  /* —— 阶段6：结算加固相关 —— */
  BATTLE_NOT_FINISHED: 'battle_not_finished',
  SETTLEMENT_BLOCKED: 'settlement_blocked',
  SETTLEMENT_NOT_BLOCKED: 'settlement_not_blocked',
  REPORT_INVALID: 'report_invalid',
  SETTLEMENT_FAILED: 'settlement_failed',
  SIMULATION_FAILED: 'simulation_failed',
  DUPLICATE_MEMBER: 'duplicate_member',
  MEMBER_OWNERSHIP: 'member_ownership',
  MEMBER_STATUS: 'member_status',
  UNKNOWN_UNIT: 'unknown_unit'
  ,DETERMINISM_MISMATCH: 'determinism_mismatch'
};

/** 统一失败结果 */
function fail(code, reason, extra = {}) {
  return { ok: false, code, reason: String(reason || ''), activeBattle: null, ...extra };
}

/** 统一成功结果 */
function pass(code = THEATER_CODE.OK, extra = {}) {
  return { ok: true, code, reason: '', activeBattle: null, ...extra };
}

/** 结算失败分类：超少数流程时序错误可重试，战报/事务错误必须永久阻断。 */
export function shouldBlockSettlement(result) {
  const code = result && result.code;
  return [
    THEATER_CODE.REPORT_INVALID,
    THEATER_CODE.SETTLEMENT_FAILED,
    THEATER_CODE.SIMULATION_FAILED
  ].includes(code);
}

function ensureSettlementFields(activeBattle) {
  if (!activeBattle || typeof activeBattle !== 'object') return;
  activeBattle.settlementAttempted = activeBattle.settlementAttempted === true;
  activeBattle.settlementBlocked = activeBattle.settlementBlocked === true;
  activeBattle.settlementError = typeof activeBattle.settlementError === 'string'
    ? activeBattle.settlementError : null;
  activeBattle.loggedErrors = Array.isArray(activeBattle.loggedErrors)
    ? activeBattle.loggedErrors.filter((x) => typeof x === 'string' && x)
    : [];
  // 旧存档如只保留了布尔标记，也不能在读档后重新刷同一条错误。
  if (activeBattle.settlementErrorLogged === true && activeBattle.settlementError
    && !activeBattle.loggedErrors.includes(activeBattle.settlementError)) {
    activeBattle.loggedErrors.push(activeBattle.settlementError);
  }
  activeBattle.settlementErrorLogged = activeBattle.loggedErrors.length > 0;
}

function recordSettlementFailure(state, activeBattle, result, { block = shouldBlockSettlement(result), log = true } = {}) {
  ensureSettlementFields(activeBattle);
  const reason = String((result && result.reason) || '战斗结算失败');
  activeBattle.settlementAttempted = true;
  if (!activeBattle.settlementError) activeBattle.settlementError = reason;
  if (block) {
    activeBattle.settlementBlocked = true;
    activeBattle.playing = false;
  }
  if (log && !activeBattle.loggedErrors.includes(reason)) {
    activeBattle.loggedErrors.push(reason);
    activeBattle.settlementErrorLogged = true;
    logEvent(state, `战斗结算被拒绝：${reason}`, LOG_LEVEL.DANGER);
  }
}

function blockSettlementWithoutLog(state, activeBattle, reason) {
  recordSettlementFailure(state, activeBattle, { code: THEATER_CODE.REPORT_INVALID, reason }, { block: true, log: false });
}

function getProductionSession(state, activeBattle) {
  ensureBattleSessionState(state);
  // Replay is a presentation context, never a writable production session.
  // Keep this invariant centralized so ticking, return animation, save and UI
  // callers cannot accidentally mutate the canonical session store.
  if (!activeBattle || activeBattle.replayReadOnly === true) return null;
  if (activeBattle.battleSessionId && state.battleSessions[activeBattle.battleSessionId]) {
    return state.battleSessions[activeBattle.battleSessionId];
  }
  // Once an ID exists the save-owned session is canonical. The embedded copy
  // is only a migration bridge for legacy active battles without an ID.
  if (!activeBattle.battleSessionId
    && activeBattle.productionSession && typeof activeBattle.productionSession === 'object') {
    return activeBattle.productionSession;
  }
  return null;
}

function syncProductionSession(state, activeBattle, updates = {}) {
  if (activeBattle?.replayReadOnly === true) return null;
  const session = getProductionSession(state, activeBattle);
  if (!session) return null;
  Object.assign(session, updates);
  if (updates.presentationTime !== undefined) {
    session.presentationState = {
      ...(session.presentationState || {}),
      phase: activeBattle?.presentationPhase || session.presentationState?.phase || 'battle',
      elapsed: safeNumber(updates.presentationTime, 0)
    };
  }
  if (updates.lifecycle === SESSION_LIFECYCLE.SETTLEMENT_PENDING || updates.settlementStatus === 'pending') {
    session.settlementState = {
      ...(session.settlementState || {}), status: 'pending', settlementId: session.settlementId, locked: false
    };
  }
  if (updates.lifecycle === SESSION_LIFECYCLE.SETTLED || updates.settlementStatus === 'applied') {
    session.settlementState = {
      ...(session.settlementState || {}), status: 'applied', settlementId: session.settlementId, locked: true
    };
  }
  if (updates.lifecycle === SESSION_LIFECYCLE.RETURNED) {
    session.returnState = {
      ...(session.returnState || {}), status: updates.settlementStatus === 'blocked' ? 'blocked' : 'returned',
      elapsed: safeNumber(activeBattle?.returnElapsed, 0), duration: safeNumber(activeBattle?.returnDuration, 5)
    };
  }
  if (activeBattle && activeBattle.battleSessionId === session.battleSessionId) {
    activeBattle.productionSession = session;
  }
  state.battleSessions[session.battleSessionId] = session;
  return session;
}

function ensureLegacyProductionSession(state, activeBattle, notes = []) {
  ensureBattleSessionState(state);
  if (!activeBattle || activeBattle.replayReadOnly) return null;
  let session = getProductionSession(state, activeBattle);
  if (!session) {
    state.battleSessionSequence += 1;
    session = createProductionBattleSession({
      sourceSaveRevision: state.saveRevision,
      missionId: activeBattle.missionId || activeBattle.theaterId,
      deploymentSnapshot: activeBattle.dispatchSnapshot || {},
      report: activeBattle.report || {},
      sequence: state.battleSessionSequence,
      sessionOrigin: SESSION_ORIGIN.PRODUCTION,
      createdAtGameTime: activeBattle.startedGameTime
    });
    session.lifecycle = activeBattle.settled ? SESSION_LIFECYCLE.SETTLED : SESSION_LIFECYCLE.RUNNING;
    state.battleSessions[session.battleSessionId] = session;
    activeBattle.battleSessionId = session.battleSessionId;
    activeBattle.sessionOrigin = SESSION_ORIGIN.PRODUCTION;
    activeBattle.deploymentHash = session.deploymentHash;
    activeBattle.deploymentSnapshotId = session.deploymentSnapshotId;
    activeBattle.formalReportHash = session.formalReportHash;
    activeBattle.sourceReportHash = session.sourceReportHash;
    activeBattle.settlementId = session.settlementId;
    activeBattle.productionSession = session;
    state.activeBattleSessionId = session.battleSessionId;
    notes.push('旧活动战斗已补齐稳定 ProductionBattleSession。');
  }
  return session;
}

/* ============================================================
 * 内部工具
 * ========================================================== */

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 默认战区记录 */
function defaultRecord(id) {
  return {
    id,
    captured: false,
    firstRewardTaken: false,
    attempts: 0,
    victories: 0,
    lastResult: null,
    lastBattleId: null
  };
}

/** 取得（必要时创建）战区存档记录 */
function ensureRecord(state, theaterId) {
  if (!state || !THEATERS[theaterId]) return null;
  if (!isObject(state.theaters)) state.theaters = {};
  if (!isObject(state.theaters[theaterId])) {
    state.theaters[theaterId] = defaultRecord(theaterId);
  }
  return state.theaters[theaterId];
}

/** 只读取记录（不写状态） */
function readRecord(state, theaterId) {
  const raw = state && isObject(state.theaters) ? state.theaters[theaterId] : null;
  const base = defaultRecord(theaterId);
  if (!isObject(raw)) return base;
  return {
    id: theaterId,
    captured: raw.captured === true,
    firstRewardTaken: raw.firstRewardTaken === true,
    attempts: Math.max(0, Math.floor(safeNumber(raw.attempts, 0))),
    victories: Math.max(0, Math.floor(safeNumber(raw.victories, 0))),
    lastResult: typeof raw.lastResult === 'string' ? raw.lastResult : null,
    lastBattleId: typeof raw.lastBattleId === 'string' ? raw.lastBattleId : null
  };
}

/** 雷达站是否在运作 */
export function hasRadar(state) {
  return (state && Array.isArray(state.buildings) ? state.buildings : []).some(
    (b) => b && b.type === 'radar_station' && b.status === BUILDING_STATUS.OPERATIONAL
  );
}

/** 编队解析（接受 ID 或对象） */
function findFormation(state, formationOrId) {
  if (!state || !Array.isArray(state.formations)) return null;
  if (isObject(formationOrId)) {
    return state.formations.includes(formationOrId) ? formationOrId : null;
  }
  const id = String(formationOrId || '');
  if (!id) return null;
  return state.formations.find((f) => f && f.id === id) || null;
}

function findUnit(state, unitId) {
  if (!state || !Array.isArray(state.units)) return null;
  return state.units.find((u) => u && u.id === unitId) || null;
}

/** 依据 hp 比例推断损伤等级 */
export function damageStateOf(hp, maxHp) {
  return getDamageState(hp, maxHp);
}

/* ============================================================
 * 查询：战区
 * ========================================================== */

/** 战区是否已解锁（全部前置战区已占领） */
export function isUnlocked(state, theaterId) {
  const cfg = THEATERS[theaterId];
  if (!cfg) return false;
  const requires = Array.isArray(cfg.requires) ? cfg.requires : [];
  return requires.every((rid) => readRecord(state, rid).captured);
}

/** 未解锁原因文本（已解锁时返回空串） */
export function lockReasonOf(state, theaterId) {
  const cfg = THEATERS[theaterId];
  if (!cfg) return '未知战区';
  const missing = (Array.isArray(cfg.requires) ? cfg.requires : [])
    .filter((rid) => !readRecord(state, rid).captured)
    .map((rid) => (THEATERS[rid] ? THEATERS[rid].name : rid));
  if (!missing.length) return '';
  return `需要先占领：${missing.join('、')}`;
}

/**
 * 战区完整视图（配置 + 存档进度 + 解锁状态），只读。
 * @returns {object|null} 未知战区返回 null
 */
export function getTheaterState(state, theaterId) {
  const cfg = THEATERS[theaterId];
  if (!cfg) return null;
  const rec = readRecord(state, theaterId);
  const unlocked = isUnlocked(state, theaterId);
  const active = getActiveBattle(state);
  return {
    id: cfg.id,
    name: cfg.name,
    desc: cfg.desc,
    terrain: cfg.terrain,
    terrainName: cfg.terrainName,
    difficulty: safeNumber(cfg.difficulty, 1),
    concealment: safeNumber(cfg.concealment, 0),
    requires: Array.isArray(cfg.requires) ? cfg.requires.slice() : [],
    firstReward: { ...(cfg.firstReward || {}) },
    captureIncome: { ...(cfg.captureIncome || {}) },
    supplyMultiplier: safeNumber(cfg.supplyMultiplier, 1),
    captured: rec.captured,
    firstRewardTaken: rec.firstRewardTaken,
    attempts: rec.attempts,
    victories: rec.victories,
    lastResult: rec.lastResult,
    lastBattleId: rec.lastBattleId,
    unlocked,
    lockReason: unlocked ? '' : lockReasonOf(state, theaterId),
    engaged: !!(active && active.theaterId === cfg.id)
  };
}

/** 全部战区视图（按配置顺序，稳定） */
export function listTheaters(state) {
  return Object.keys(THEATERS).map((id) => getTheaterState(state, id)).filter(Boolean);
}

/** 策略列表（稳定顺序） */
export function listStrategies() {
  return Object.keys(STRATEGIES).map((id) => ({
    id,
    name: STRATEGIES[id].name,
    desc: STRATEGIES[id].desc,
    advantages: (STRATEGIES[id].advantages || []).slice(),
    risks: (STRATEGIES[id].risks || []).slice(),
    cost: { ...(STRATEGIES[id].cost || {}) }
  }));
}

/* ============================================================
 * 查询：战前情报（雷达决定精度）
 * ========================================================== */

const HIGH_THREAT = new Set(['at_infantry', 'armor', 'vehicle']);

/**
 * 战区敌情（确定性，不使用随机数）
 *  - 有可用雷达站：给出精确数量与单位名；
 *  - 无雷达站：数量模糊为区间，高威胁单位只给出模糊描述。
 */
export function getTheaterIntel(state, theaterId) {
  const cfg = THEATERS[theaterId];
  if (!cfg) return null;
  const radar = hasRadar(state);
  const terrain = TERRAIN[cfg.terrain] || TERRAIN.open;

  let total = 0;
  const units = Object.keys(cfg.enemy || {}).map((typeId) => {
    const count = Math.max(0, Math.floor(safeNumber(cfg.enemy[typeId], 0)));
    total += count;
    const def = ENEMY_UNITS[typeId] || null;
    const category = def ? def.category : 'unknown';
    const threat = HIGH_THREAT.has(category);
    const lo = Math.max(1, count - 1);
    const hi = count + 1;
    return {
      typeId,
      name: def ? def.name : '未知目标',
      category,
      threat,
      count: radar ? count : null,
      countText: radar ? `${count}` : `约 ${lo}-${hi}`,
      label: radar
        ? `${def ? def.name : typeId} ×${count}`
        : `${threat ? '疑似' : ''}${def ? def.name : '不明目标'} 约 ${lo}-${hi}`
    };
  });

  const loTotal = Math.max(1, total - 2);
  const hiTotal = total + 2;
  const concealment = safeNumber(cfg.concealment, 0);
  const ambushLevel = concealment >= 12 ? 'high' : concealment >= 6 ? 'medium' : 'low';

  const effects = [];
  if (terrain.armorAttack > 1) effects.push(`装甲攻击 ×${terrain.armorAttack.toFixed(2)}`);
  if (terrain.vehicleMobility > 1) effects.push(`车辆机动 ×${terrain.vehicleMobility.toFixed(2)}`);
  if (terrain.enemyDefense > 1) effects.push(`敌方防御 ×${terrain.enemyDefense.toFixed(2)}`);
  if (terrain.friendlyAttack < 1) effects.push(`我方攻击 ×${terrain.friendlyAttack.toFixed(2)}`);
  if (terrain.ambushBias > 0) effects.push('伏击风险略高');

  const notes = [];
  if (!radar) notes.push('未建成可用雷达站，敌情为侦察估算值。');
  else notes.push('雷达站在线，敌方编成已确认。');
  if (ambushLevel === 'high') notes.push('该区域隐蔽度高，务必携带侦察单位。');

  return {
    theaterId: cfg.id,
    theaterName: cfg.name,
    radar,
    accurate: radar,
    terrain: cfg.terrain,
    terrainName: cfg.terrainName,
    terrainEffects: effects,
    concealment,
    ambushLevel,
    ambushText: ambushLevel === 'high' ? '高' : ambushLevel === 'medium' ? '中' : '低',
    total: radar ? total : null,
    totalText: radar ? `${total}` : `约 ${loTotal}-${hiTotal}`,
    units,
    notes
  };
}

/* ============================================================
 * 查询：任务成本
 * ========================================================== */

/**
 * 任务成本 = Σ单位维持值 × 战区补给系数 × 策略补给倍率，再叠加策略固定成本。
 * @returns {{cost:object, breakdown:object, affordable:boolean, missing:string[]}}
 */
export function getMissionCost(state, formationId, theaterId, strategyId) {
  const cfg = THEATERS[theaterId] || null;
  const strategy = STRATEGIES[strategyId] || null;
  const formation = findFormation(state, formationId);

  const upkeepMod = strategy && strategy.mods ? safeNumber(strategy.mods.upkeep, 1) : 1;
  const multiplier = cfg ? safeNumber(cfg.supplyMultiplier, 1) : 0;

  let upkeepSum = 0;
  let unitCount = 0;
  if (formation) {
    (formation.unitIds || []).forEach((uid) => {
      const unit = findUnit(state, uid);
      const def = unit && UNITS[unit.type];
      if (!def) return;
      unitCount += 1;
      upkeepSum += safeNumber(def.upkeep, 1);
    });
  }

  const base = Math.round(upkeepSum * multiplier);
  const supply = Math.round(base * upkeepMod);
  const cost = {};
  if (supply > 0) cost.supply = supply;
  Object.keys((strategy && strategy.cost) || {}).forEach((key) => {
    cost[key] = safeNumber(cost[key], 0) + safeNumber(strategy.cost[key], 0);
  });

  const missing = state ? missingResources(state, cost) : [];
  return {
    cost,
    breakdown: {
      unitCount,
      upkeepSum,
      supplyMultiplier: multiplier,
      upkeepMod,
      base,
      strategyCost: { ...((strategy && strategy.cost) || {}) }
    },
    affordable: missing.length === 0,
    missing
  };
}

function operationIdFor(activeOrParams) {
  return activeOrParams && activeOrParams.missionKind === 'operation' ? activeOrParams.missionId : null;
}

export function buildDispatchSnapshot(state, formation, theaterId, strategyId, missionKind = 'campaign', missionId = theaterId) {
  const units = (formation.unitIds || []).map((unitId) => {
    const unit = findUnit(state, unitId);
    if (!unit || !UNITS[unit.type]) return null;
    const rank = getUnitRank(unit);
    const effective = getUnitEffectiveStats(unit);
    return {
      id: unit.id, type: unit.type, hp: safeNumber(unit.hp, unit.maxHp), maxHp: safeNumber(unit.maxHp, 1),
      experience: safeNumber(unit.experience, 0), battles: Math.max(0, Math.floor(safeNumber(unit.battles, 0))),
      callsign: typeof unit.callsign === 'string' ? unit.callsign : null,
      stats: effective, rankId: rank.id, rankName: rank.name, rankModifiers: { ...rank.modifiers }
    };
  }).filter(Boolean);
  const research = state.research || {};
  return JSON.parse(JSON.stringify({
    formation: { id: formation.id, name: formation.name, experience: safeNumber(formation.experience, 0), unitIds: (formation.unitIds || []).slice() },
    units,
    buildings: { radarOperational: hasRadar(state) },
    research: { revision: safeNumber(research.revision, 0), completed: Array.isArray(research.completed) ? research.completed.slice() : [] },
    theaterId, strategyId, missionKind, missionId,
    operation: missionKind === 'operation' && OPERATIONS[missionId] ? OPERATIONS[missionId] : null
  }));
}

export function getOperation(state, operationId) {
  if (!OPERATIONS[operationId]) return null;
  const rec = state && state.operations && state.operations[operationId] || {};
  const cooldown = operationCooldown(state, operationId);
  return { ...OPERATIONS[operationId], captured: Boolean(state && state.theaters && state.theaters[OPERATIONS[operationId].theaterId] && state.theaters[OPERATIONS[operationId].theaterId].captured), ...rec, cooldownRemaining: cooldown.remaining, cooldownText: cooldown.text };
}

export function listOperations(state) {
  return Object.keys(OPERATIONS).map((id) => getOperation(state, id));
}

export function canDispatchOperationMission(state, formationId, operationId, strategyId) {
  return canDispatchOperation(state, formationId, operationId, strategyId);
}

/** 成本对象 → 展示文本 */
export function formatMissionCost(cost) {
  const parts = Object.keys(cost || {}).map((key) => {
    const def = RESOURCE_DEFS[key];
    return `${def ? def.name : key} ${formatInt(cost[key])}`;
  });
  return parts.length ? parts.join(' / ') : '无消耗';
}

/* ============================================================
 * 派遣资格
 * ========================================================== */

/** 编队中是否至少有一个具备攻击能力的单位 */
function countCombatUnits(state, formation) {
  let n = 0;
  (formation.unitIds || []).forEach((uid) => {
    const unit = findUnit(state, uid);
    const def = unit && UNITS[unit.type];
    if (def && safeNumber(def.stats.attack, 0) > 0) n += 1;
  });
  return n;
}

/**
 * 派遣资格校验（不修改状态）
 * @returns {{ok:boolean, code:string, reason:string, activeBattle:null, cost:object, missing:string[]}}
 */
export function canDispatch(state, formationId, theaterId, strategyId) {
  if (!state) return fail(THEATER_CODE.STATE_INVALID, '状态无效');

  const cfg = THEATERS[theaterId];
  if (!cfg) return fail(THEATER_CODE.UNKNOWN_THEATER, '未知战区');

  const strategy = STRATEGIES[strategyId];
  if (!strategy) return fail(THEATER_CODE.UNKNOWN_STRATEGY, '请先选择作战策略');

  if (getActiveBattle(state)) {
    return fail(THEATER_CODE.BATTLE_ACTIVE, '已有一场作战正在进行');
  }

  const rec = readRecord(state, theaterId);
  if (rec.captured) return fail(THEATER_CODE.CAPTURED, '该战区已被占领');

  if (!isUnlocked(state, theaterId)) {
    return fail(THEATER_CODE.LOCKED, lockReasonOf(state, theaterId));
  }

  const formation = findFormation(state, formationId);
  if (!formation) return fail(THEATER_CODE.FORMATION_NOT_FOUND, '请先选择一支编队');

  if (formation.status !== FORMATION_STATUS.IDLE) {
    return fail(THEATER_CODE.FORMATION_BUSY, '该编队当前不是待命状态');
  }

  const ids = Array.isArray(formation.unitIds) ? formation.unitIds : [];
  if (ids.length === 0) return fail(THEATER_CODE.FORMATION_EMPTY, '编队中没有任何单位');

  // 阶段6：编队成员双向关系校验 —— 存档损坏 / 并发修改时必须拦在派遣前
  const seen = new Set();
  for (const uid of ids) {
    if (seen.has(uid)) {
      return fail(THEATER_CODE.DUPLICATE_MEMBER, '编队成员存在重复引用，请先整理编队');
    }
    seen.add(uid);

    const unit = findUnit(state, uid);
    if (!unit) {
      return fail(THEATER_CODE.UNKNOWN_UNIT, '编队引用了不存在的单位，请先整理编队');
    }
    if (unit.formationId !== formation.id) {
      return fail(THEATER_CODE.MEMBER_OWNERSHIP, '编队成员归属异常，请先整理编队');
    }
    // 维修中 / 已损毁 → 单位不可用（语义性拦截，保留旧测试 UNIT_UNAVAILABLE）
    if (unit.status === 'repairing') {
      return fail(THEATER_CODE.UNIT_UNAVAILABLE, '编队中存在维修中的单位');
    }
    if (safeNumber(unit.hp, 0) <= 0 || unit.damage === DAMAGE_STATES.DESTROYED) {
      return fail(THEATER_CODE.UNIT_UNAVAILABLE, '编队中存在已损毁的单位');
    }
    // 其它非 assigned 状态（如 deployed）→ 成员状态异常
    if (unit.status !== 'assigned') {
      return fail(THEATER_CODE.MEMBER_STATUS, '编队成员状态异常，请先整理编队');
    }
  }

  if (countCombatUnits(state, formation) === 0) {
    return fail(THEATER_CODE.NO_COMBAT_UNIT, '编队缺少具备攻击能力的单位');
  }

  const mission = getMissionCost(state, formation.id, theaterId, strategyId);
  if (!mission.affordable) {
    return fail(THEATER_CODE.INSUFFICIENT, mission.missing.join('，'), {
      cost: mission.cost, missing: mission.missing
    });
  }

  return pass(THEATER_CODE.READY, { cost: mission.cost, missing: [] });
}

/* ============================================================
 * 派遣
 * ========================================================== */

/**
 * 派遣编队进入战区：再校验 → 扣成本 → 一次性求解 → 建立活动战斗。
 * @param {object} state
 * @param {string} formationId
 * @param {string} theaterId
 * @param {string} strategyId
 * @param {number} [seed] 指定随机种子（用于测试/复现）
 */
export function dispatchFormation(state, formationId, theaterId, strategyId, seed, options = {}) {
  const missionKind = options.missionKind || 'campaign';
  const missionId = options.missionId || theaterId;
  const check = missionKind === 'operation'
    ? canDispatchOperation(state, formationId, missionId, strategyId)
    : canDispatch(state, formationId, theaterId, strategyId);
  if (!check.ok) return check;

  const formation = findFormation(state, formationId);
  const cfg = THEATERS[theaterId];
  const mission = missionKind === 'operation'
    ? getOperationCost(state, formation.id, missionId, strategyId)
    : getMissionCost(state, formation.id, theaterId, strategyId);

  // 快照必须在扣费和求解前生成，后续结算不再从实时单位重建输入。
  const dispatchSnapshot = buildDispatchSnapshot(state, formation, theaterId, strategyId, missionKind, missionId);

  if (!spend(state, mission.cost)) {
    return fail(THEATER_CODE.INSUFFICIENT, '资源不足，派遣取消');
  }

  const finalSeed = Number.isFinite(seed) ? (seed >>> 0) : randomSeed();

  // 阶段6：求解失败必须完整回滚 —— 返还成本、编队保持待命、不消耗尝试次数、不建立活动战斗
  let report = null;
  try {
    report = simulateBattle({
      state, formation, theaterId, strategyId, missionKind, missionId,
      missionConfig: missionKind === 'operation' ? OPERATIONS[missionId] : null,
      dispatchSnapshot, seed: finalSeed
    });
    if (!report || !Array.isArray(report.events) || !report.final) {
      throw new Error('求解器返回了不完整的战报');
    }
  } catch (err) {
    grant(state, mission.cost);
    recalcDerived(state);
    logEvent(state, `派遣失败：战斗求解异常，已返还任务成本。`, LOG_LEVEL.DANGER);
    return fail(THEATER_CODE.SIMULATION_FAILED,
      `战斗求解失败：${(err && err.message) || '未知错误'}，任务成本已返还`);
  }

  ensureBattleSessionState(state);
  state.battleSessionSequence += 1;
  const productionSession = createProductionBattleSession({
    sourceSaveRevision: state.saveRevision,
    missionId,
    deploymentSnapshot: dispatchSnapshot,
    report,
    sequence: state.battleSessionSequence,
    sessionOrigin: SESSION_ORIGIN.PRODUCTION,
    createdAtGameTime: state.time && state.time.game
  });
  productionSession.lifecycle = SESSION_LIFECYCLE.RUNNING;
  state.battleSessions[productionSession.battleSessionId] = productionSession;
  state.activeBattleSessionId = productionSession.battleSessionId;

  // 参战单位快照：结算只认这份名单，避免结算前编队被改动导致错误写回
  const dispatchedUnitIds = [];
  (formation.unitIds || []).forEach((uid) => {
    if (typeof uid === 'string' && uid && !dispatchedUnitIds.includes(uid)) {
      dispatchedUnitIds.push(uid);
    }
  });

  const activeBattle = {
    id: report.id,
    seed: finalSeed,
    theaterId,
    theaterName: cfg.name,
    strategyId,
    missionKind,
    missionId,
    formationId: formation.id,
    formationName: formation.name,
    dispatchedUnitIds,
    dispatchSnapshot,
    operation: missionKind === 'operation' ? JSON.parse(JSON.stringify(OPERATIONS[missionId])) : null,
    report,
    elapsed: 0,
    duration: Math.max(1, safeNumber(report.duration, BATTLE.baseDuration)),
    playing: true,
    settled: false,
    settlementAttempted: false,
    settlementBlocked: false,
    settlementError: null,
    settlementErrorLogged: false,
    loggedErrors: [],
    presentationPhase: 'battle',
    returnElapsed: 0,
    returnDuration: 5,
    resultViewed: false,
    cost: { ...mission.cost },
    granted: {},
    settlementReceipt: null,
    startedGameTime: safeNumber(state.time ? state.time.game : 0, 0),
    battleSessionId: productionSession.battleSessionId,
    sessionOrigin: SESSION_ORIGIN.PRODUCTION,
    sourceSaveRevision: productionSession.sourceSaveRevision,
    deploymentSnapshotId: productionSession.deploymentSnapshotId,
    deploymentHash: productionSession.deploymentHash,
    formalReportHash: productionSession.formalReportHash,
    sourceReportHash: productionSession.sourceReportHash,
    settlementId: productionSession.settlementId,
    presentationState: cloneJson(productionSession.presentationState),
    settlementState: cloneJson(productionSession.settlementState),
    returnState: cloneJson(productionSession.returnState),
    productionSession
  };

  // 编队进入战斗状态，成员标记为出击中
  formation.status = FORMATION_STATUS.FIGHTING;
  formation.theaterId = theaterId;
  formation.strategy = strategyId;
  (formation.unitIds || []).forEach((uid) => {
    const unit = findUnit(state, uid);
    if (unit) unit.status = 'deployed';
  });

  const rec = ensureRecord(state, theaterId);
  rec.attempts += 1;
  if (missionKind === 'operation') {
    if (!state.operations || typeof state.operations !== 'object') state.operations = {};
    if (!state.operations[missionId]) state.operations[missionId] = { attempts: 0, victories: 0, cooldownUntil: 0, lastResult: null, lastBattleId: null };
    state.operations[missionId].attempts = Math.max(0, Math.floor(safeNumber(state.operations[missionId].attempts, 0))) + 1;
  }

  state.activeBattle = activeBattle;

  logEvent(state, `${formation.name}${missionKind === 'operation' ? `执行${OPERATIONS[missionId].name}` : `向${cfg.name}发起进攻`}（${STRATEGIES[strategyId].name}）。`, LOG_LEVEL.BATTLE);
  emit('battle:start', { battleId: activeBattle.id, theaterId, formationId: formation.id });
  emit('formation:changed', { formationId: formation.id, kind: 'status' });

  return pass(THEATER_CODE.OK, { activeBattle });
}

export function dispatchOperation(state, formationId, operationId, strategyId, options = {}) {
  return dispatchFormation(state, formationId, OPERATIONS[operationId] && OPERATIONS[operationId].theaterId, strategyId,
    options && Number.isFinite(options.seed) ? options.seed : undefined,
    { missionKind: 'operation', missionId: operationId });
}

/* ============================================================
 * 活动战斗推进与结算
 * ========================================================== */

/** 当前活动战斗（无则 null） */
export function getActiveBattle(state) {
  const ab = state && state.activeBattle;
  return isObject(ab) ? ab : null;
}

/** 战斗是否播放完毕（用于 UI 判断展示结果面板） */
export function isBattleFinished(state) {
  const ab = getActiveBattle(state);
  return !!(ab && ab.settled);
}

/**
 * Open a previously settled production battle as presentation-only replay.
 * Replay never creates a new report and never enters the settlement path.
 */
export function replayBattleSession(state, battleSessionId) {
  ensureBattleSessionState(state);
  if (getActiveBattle(state)) return fail(THEATER_CODE.BATTLE_ACTIVE, '已有一场作战正在进行');
  const source = state.battleSessions[battleSessionId];
  if (!source || source.sessionOrigin !== SESSION_ORIGIN.PRODUCTION) {
    return fail(THEATER_CODE.REPORT_INVALID, '找不到正式战斗会话');
  }
  const ledger = source.settlementId ? state.battleSettlementLedger[source.settlementId] : null;
  if (!ledger) {
    return fail(THEATER_CODE.SETTLEMENT_BLOCKED, '该战斗尚未完成正式结算');
  }
  const ledgerCheck = validateSettlementLedger(ledger, source);
  if (!ledgerCheck.ok) return fail(THEATER_CODE.REPORT_INVALID, ledgerCheck.problems.join('；'));
  const report = (state.battles || []).find((row) => row && row.id === source.formalReportId);
  if (!report) return fail(THEATER_CODE.REPORT_INVALID, '正式战报不可用，无法回放');
  const binding = validateSessionBinding(source, { report, deploymentSnapshot: source.deploymentSnapshot });
  if (!binding.ok) return fail(THEATER_CODE.REPORT_INVALID, binding.problems.join('；'));

  const theater = THEATERS[report.theaterId];
  const replay = {
    id: `replay-${source.battleSessionId}`,
    seed: safeNumber(report.seed, 0) >>> 0,
    theaterId: report.theaterId,
    theaterName: theater ? theater.name : report.theaterName,
    strategyId: report.strategyId,
    missionKind: report.missionKind || 'campaign',
    missionId: report.missionId || report.theaterId,
    formationId: report.formationId,
    formationName: report.formationName || '历史编队',
    dispatchedUnitIds: (report.initial?.friendly || []).map((row) => row && row.realId).filter(Boolean),
    dispatchSnapshot: cloneJson(source.deploymentSnapshot) || {},
    report: cloneJson(report),
    elapsed: 0,
    duration: Math.max(1, safeNumber(report.duration, BATTLE.baseDuration)),
    playing: true,
    settled: false,
    settlementAttempted: false,
    settlementBlocked: false,
    settlementError: null,
    loggedErrors: [],
    presentationPhase: 'battle',
    returnElapsed: 0,
    returnDuration: 5,
    resultViewed: false,
    cost: {},
    granted: {},
    settlementReceipt: cloneJson(source.settlementReceipt),
    startedGameTime: safeNumber(state.time?.game, 0),
    battleSessionId: source.battleSessionId,
    sessionOrigin: SESSION_ORIGIN.PRODUCTION,
    sourceSaveRevision: source.sourceSaveRevision,
    deploymentSnapshotId: source.deploymentSnapshotId,
    deploymentHash: source.deploymentHash,
    formalReportHash: source.formalReportHash,
    sourceReportHash: source.sourceReportHash,
    settlementId: source.settlementId,
    replayReadOnly: true,
    settlementAllowed: false,
    replaySourceSessionId: source.battleSessionId,
    replayContext: {
      mode: 'replay',
      sourceBattleSessionId: source.battleSessionId,
      sourceFormalReportId: source.formalReportId,
      sourceFormalReportHash: source.formalReportHash,
      settlementId: source.settlementId,
      presentationTime: 0,
      returnElapsed: 0,
      readOnly: true
    }
  };
  state.activeBattle = replay;
  // activeBattleSessionId denotes a real production deployment only.
  state.activeBattleSessionId = null;
  return pass(THEATER_CODE.OK, { activeBattle: replay, replay: true, readOnly: true });
}

/**
 * 推进活动战斗播放进度（只推进时间，不改变结果）。
 * @param {object} state
 * @param {number} dt 游戏秒
 */
export function tickActiveBattle(state, dt) {
  const ab = getActiveBattle(state);
  if (!ab) return pass(THEATER_CODE.NO_BATTLE);
  if (ab.settled) return pass(THEATER_CODE.OK, { activeBattle: ab });
  if (ab.replayReadOnly === true || ab.settlementAllowed === false) {
    const step = Math.max(0, safeNumber(dt, 0));
    ab.elapsed = clamp(safeNumber(ab.elapsed, 0) + step, 0, ab.duration);
    if (ab.elapsed >= ab.duration) {
      ab.playing = false;
      ab.settled = true;
      ab.presentationPhase = 'returning';
      ab.returnElapsed = 0;
      if (ab.replayContext) {
        ab.replayContext.presentationTime = ab.elapsed;
        ab.replayContext.returnElapsed = 0;
      }
      syncProductionSession(state, ab, { lifecycle: SESSION_LIFECYCLE.REPLAY, presentationTime: ab.elapsed });
    }
    if (ab.replayContext) ab.replayContext.presentationTime = ab.elapsed;
    syncProductionSession(state, ab, { presentationTime: ab.elapsed });
    return pass(THEATER_CODE.OK, { activeBattle: ab, replay: true, settlementLocked: true });
  }
  ensureSettlementFields(ab);
  if (ab.settlementBlocked) {
    return fail(THEATER_CODE.SETTLEMENT_BLOCKED, ab.settlementError || '战斗结算已被阻断', { activeBattle: ab });
  }

  const step = Math.max(0, safeNumber(dt, 0));
  ab.elapsed = clamp(safeNumber(ab.elapsed, 0) + step, 0, ab.duration);
  syncProductionSession(state, ab, { presentationTime: ab.elapsed });

  if (ab.elapsed >= ab.duration) {
    ab.playing = false;
    return settleActiveBattle(state);
  }
  return pass(THEATER_CODE.OK, { activeBattle: ab });
}

/** 结算后的展示返航。不重新结算，也不重复领取奖励。 */
export function tickBattleReturn(state, dt) {
  const ab = getActiveBattle(state);
  if (!ab) return pass(THEATER_CODE.NO_BATTLE);
  if (!ab.settled) return fail(THEATER_CODE.BATTLE_NOT_FINISHED, '战斗尚未结束', { activeBattle: ab });

  const duration = Math.max(0.1, safeNumber(ab.returnDuration, 5));
  ab.presentationPhase = 'returning';
  ab.returnDuration = duration;
  ab.returnElapsed = clamp(safeNumber(ab.returnElapsed, 0) + Math.max(0, safeNumber(dt, 0)), 0, duration);
  if (ab.replayReadOnly === true && ab.replayContext) {
    ab.replayContext.presentationTime = safeNumber(ab.elapsed, 0);
    ab.replayContext.returnElapsed = ab.returnElapsed;
  }
  syncProductionSession(state, ab, {
    lifecycle: ab.replayReadOnly ? SESSION_LIFECYCLE.REPLAY : SESSION_LIFECYCLE.SETTLED,
    presentationTime: safeNumber(ab.elapsed, 0)
  });
  if (ab.returnElapsed >= duration) return finishBattleReturn(state);
  return pass(THEATER_CODE.OK, { activeBattle: ab });
}

/** 把战报写入历史（去重 + 限长） */
function pushReport(state, report) {
  if (!Array.isArray(state.battles)) state.battles = [];
  if (state.battles.some((r) => r && r.id === report.id)) return;
  let copy = null;
  try { copy = JSON.parse(JSON.stringify(report)); } catch (e) { copy = null; }
  if (!copy) return;
  state.battles.unshift(copy);
  while (state.battles.length > BATTLE.maxReports) state.battles.pop();
}

/* ============================================================
 * 阶段6：结算前验证 → 结算计划 → 事务性写入
 * ========================================================== */

const VALID_RESULTS = new Set(Object.values(BATTLE_RESULT));
const CAPTURE_RESULTS = new Set([BATTLE_RESULT.VICTORY, BATTLE_RESULT.PYRRHIC]);
const RESOURCE_KEYS = new Set(Object.keys(RESOURCE_DEFS));

/**
 * 结算前验证战报（纯函数，不修改任何状态）。
 * 任何一项不通过都必须阻止结算，而不是写入半套数据。
 * @returns {{ok:boolean, code:string, reason:string, problems:string[]}}
 */
export function validateBattleReportForSettlement(state, activeBattle) {
  const problems = [];
  const done = (code) => ({
    ok: problems.length === 0,
    code: problems.length === 0 ? THEATER_CODE.OK : (code || THEATER_CODE.REPORT_INVALID),
    reason: problems.length === 0 ? '' : problems[0],
    problems
  });

  if (!state || !isObject(state)) {
    problems.push('状态无效');
    return done(THEATER_CODE.STATE_INVALID);
  }
  const ab = activeBattle;
  if (!isObject(ab)) {
    problems.push('活动战斗不存在');
    return done(THEATER_CODE.NO_BATTLE);
  }

  const cfg = THEATERS[ab.theaterId];
  if (!cfg) problems.push('战区配置不存在');
  if (!STRATEGIES[ab.strategyId]) problems.push('作战策略配置不存在');

  const formation = findFormation(state, ab.formationId);
  if (!formation) problems.push('编队已不存在');

  const report = ab.report;
  if (!isObject(report)) {
    problems.push('战报缺失');
    return done(THEATER_CODE.REPORT_INVALID);
  }

  // Stage E-A integration identity is an additional binding layer. It does
  // not reinterpret the formal result; it only rejects swapped/tampered
  // session, deployment, or report inputs.
  const session = getProductionSession(state, ab);
  if (ab.sessionOrigin === SESSION_ORIGIN.PRODUCTION || ab.battleSessionId) {
    const binding = validateSessionBinding(session, {
      report,
      deploymentSnapshot: ab.dispatchSnapshot,
      battleSessionId: ab.battleSessionId,
      deploymentSnapshotId: ab.deploymentSnapshotId,
      deploymentHash: ab.deploymentHash,
      sourceSaveRevision: ab.sourceSaveRevision,
      settlementId: ab.settlementId,
      sourceReportHash: ab.sourceReportHash
    });
    if (!binding.ok) problems.push(...binding.problems.map((problem) => `ProductionBattleSession：${problem}`));
  }

  // —— 元数据一致性 ——
  const expectedId = ab.missionKind === 'operation'
    ? `battle_${safeNumber(ab.seed, 0) >>> 0}_${ab.formationId}_operation_${ab.missionId}_${ab.strategyId}`
    : `battle_${safeNumber(ab.seed, 0) >>> 0}_${ab.formationId}_${ab.theaterId}_${ab.strategyId}`;
  if (report.id !== ab.id || report.id !== expectedId) problems.push('战报ID与活动战斗凭证不一致');
  if (Number(report.seed) !== (safeNumber(ab.seed, 0) >>> 0)) problems.push('战报种子与活动战斗不一致');
  if (report.formationId !== ab.formationId) problems.push('战报编队与活动战斗不一致');
  if (report.theaterId !== ab.theaterId) problems.push('战报战区与活动战斗不一致');
  if (report.strategyId !== ab.strategyId) problems.push('战报策略与活动战斗不一致');
  if ((report.missionKind || 'campaign') !== (ab.missionKind || 'campaign')) problems.push('战报任务类型与活动战斗不一致');
  if ((report.missionId || ab.theaterId) !== (ab.missionId || ab.theaterId)) problems.push('战报任务ID与活动战斗不一致');
  if (!Number.isFinite(Number(report.duration)) || Math.abs(Number(report.duration) - Number(ab.duration)) > 1e-6) {
    problems.push('战报时长与活动战斗不一致');
  }

  // —— 结果与占领一致性 ——
  if (!VALID_RESULTS.has(report.result)) {
    problems.push('战报结果不是合法枚举值');
  } else {
    const shouldCapture = ab.missionKind === 'operation' ? false : CAPTURE_RESULTS.has(report.result);
    if (report.capture !== shouldCapture) problems.push('战报占领标记与战斗结果不一致');
  }

  // —— 奖励合法性 ——
  const rewards = report.rewards;
  if (!isObject(rewards)) problems.push('战报奖励结构非法');
  const record = readRecord(state, ab.theaterId);
  const expectedRewards = ab.missionKind === 'operation'
    ? null
    : (report.capture && !record.firstRewardTaken ? (cfg.firstReward || {}) : {});
  if (isObject(rewards)) {
    if (expectedRewards) {
      const keys = new Set([...Object.keys(rewards), ...Object.keys(expectedRewards)]);
      keys.forEach((key) => {
        if (!RESOURCE_KEYS.has(key)) { problems.push(`战报奖励包含未知资源：${key}`); return; }
        if (Number(rewards[key]) !== Number(expectedRewards[key] || 0)) problems.push('战报奖励与战区配置不一致');
      });
    }
  }

  // —— 阵容数组结构 ——
  const arrays = [
    ['initial.friendly', report.initial && report.initial.friendly],
    ['initial.enemy', report.initial && report.initial.enemy],
    ['final.friendly', report.final && report.final.friendly],
    ['final.enemy', report.final && report.final.enemy]
  ];
  arrays.forEach(([label, arr]) => {
    if (!Array.isArray(arr)) problems.push(`战报 ${label} 不是数组`);
  });

  const validateSnapshots = (arr, friendlySide, label) => {
    if (!Array.isArray(arr)) return;
    const ids = new Set();
    arr.forEach((snap) => {
      if (!isObject(snap) || typeof snap.id !== 'string' || !snap.id) {
        problems.push(`${label}单位快照结构非法`); return;
      }
      if (ids.has(snap.id)) problems.push(`${label}单位快照ID重复`);
      ids.add(snap.id);
      if (typeof snap.alive !== 'boolean') problems.push(`${label}alive必须是布尔值`);
      if (friendlySide && (typeof snap.realId !== 'string' || !snap.realId)) problems.push(`${label}友军缺少realId`);
      const def = friendlySide ? UNITS[snap.type] : ENEMY_UNITS[snap.type];
      if (!def) problems.push(`${label}单位类型无效`);
      const hp = Number(snap.hp); const maxHp = Number(snap.maxHp);
      if (!Number.isFinite(hp) || !Number.isFinite(maxHp) || maxHp <= 0 || hp < 0 || hp > maxHp) problems.push(`${label}生命值快照非法`);
      if (snap.alive === true && !(hp > 0)) problems.push(`${label}存活状态与生命值矛盾`);
      if (snap.alive === false && hp !== 0) problems.push(`${label}阵亡状态与生命值矛盾`);
    });
  };
  validateSnapshots(report.initial && report.initial.friendly, true, 'initial.friendly');
  validateSnapshots(report.final && report.final.friendly, true, 'final.friendly');
  validateSnapshots(report.initial && report.initial.enemy, false, 'initial.enemy');
  validateSnapshots(report.final && report.final.enemy, false, 'final.enemy');

  if (Array.isArray(report.initial && report.initial.friendly)
    && report.initial.friendly.some((unit) => unit && (unit.alive !== true || !(Number(unit.hp) > 0)))) {
    problems.push('我军初始快照必须全部存活');
  }

  const initialEnemy = report.initial && report.initial.enemy;
  const finalEnemy = report.final && report.final.enemy;
  if (Array.isArray(initialEnemy) && Array.isArray(finalEnemy)) {
    if (initialEnemy.length !== finalEnemy.length) problems.push('敌军初始与最终数量不一致');
    const initialIds = new Set(initialEnemy.map((unit) => unit && unit.id));
    const finalIds = new Set(finalEnemy.map((unit) => unit && unit.id));
    if (initialIds.size !== initialEnemy.length || finalIds.size !== finalEnemy.length
      || stableStringify([...initialIds].sort()) !== stableStringify([...finalIds].sort())) problems.push('敌军战斗ID集合不一致');
    initialEnemy.forEach((before) => {
      const after = finalEnemy.find((unit) => unit && unit.id === before.id);
      if (!after) return;
      if (after.type !== before.type || Number(after.maxHp) !== Number(before.maxHp)) problems.push('敌军类型或最大生命值被修改');
    });
    if (initialEnemy.some((unit) => unit.alive !== true || !(Number(unit.hp) > 0))) problems.push('敌军初始快照必须全部存活');
  }

  const dispatched = Array.isArray(ab.dispatchedUnitIds) ? ab.dispatchedUnitIds : null;
  if (!dispatched || dispatched.some((id) => typeof id !== 'string' || !id)
    || new Set(dispatched).size !== dispatched.length) {
    problems.push('活动战斗参战名单非法');
  } else {
    const checkFriendlyIds = (arr, label) => {
      if (!Array.isArray(arr)) return;
      const ids = arr.map((snap) => snap && snap.realId);
      if (ids.some((id) => !dispatched.includes(id))) problems.push(`${label}包含未参战单位`);
      if (new Set(ids).size !== ids.length || ids.length !== dispatched.length
        || [...ids].sort().join('|') !== [...dispatched].sort().join('|')) problems.push(`${label}与参战名单不一致`);
    };
    checkFriendlyIds(report.initial && report.initial.friendly, '初始友军阵容');
    checkFriendlyIds(report.final && report.final.friendly, '最终友军阵容');
  }

  // —— 事件时间轴 ——
  if (!Array.isArray(report.events)) {
    problems.push('战报事件不是数组');
  } else {
    const duration = Number(report.duration);
    if (report.events.length === 0) problems.push('战报事件不能为空');
    let prev = -1;
    for (let i = 0; i < report.events.length; i += 1) {
      const ev = report.events[i];
      if (!isObject(ev) || typeof ev.type !== 'string' || !ev.type) {
        problems.push(`战报事件 #${i + 1} 结构非法`);
        break;
      }
      const t = Number(ev.t);
      if (!Number.isFinite(t) || t < 0) { problems.push(`战报事件 #${i + 1} 时间非法`); break; }
      if (t < prev) { problems.push('战报事件时间轴不是单调不减'); break; }
      if (t > duration) { problems.push('战报事件时间超出战斗时长'); break; }
      prev = t;
    }
    const last = report.events[report.events.length - 1];
    if (report.events.length && Number(report.events[0] && report.events[0].t) !== 0) problems.push('战报首个事件时间必须为0');
    if (last && last.type !== 'result') problems.push('最后事件必须是战斗结果事件');
    if (last && !(Number(last.t) < duration)) problems.push('结果事件必须发生在战斗时长之前');
    if (last && report.result && last.text && !last.text.includes(resultLabel(report.result))) problems.push('结果事件与战报结果不一致');
  }

  const outcome = validateBattleOutcomeConsistency(report);
  if (!outcome.ok && !(ab.missionKind === 'operation' && outcome.problems.every((p) => !p.includes('必须占领')))) {
    problems.push(...outcome.problems);
  }

  if (!isObject(ab.dispatchSnapshot)) {
    problems.push('活动战斗缺少派遣快照');
  } else {
    const rebuilt = rebuildBattleFromDispatchSnapshot(ab.dispatchSnapshot, ab.seed);
    const comparison = compareBattleReports(rebuilt, report);
    if (!rebuilt || !comparison.ok) problems.push('战斗记录与派遣快照不一致');
  }

  return done(THEATER_CODE.REPORT_INVALID);
}

/**
 * 生成结算计划（只读，不修改状态）。
 * 返回的计划描述「打算怎么改」，由 applySettlementPlan 一次性写入。
 */
export function buildSettlementPlan(state, activeBattle) {
  const ab = activeBattle;
  const report = (ab && ab.report) || {};
  const formation = findFormation(state, ab && ab.formationId);
  const dispatched = Array.isArray(ab && ab.dispatchedUnitIds) ? ab.dispatchedUnitIds : null;
  const missionKind = ab && ab.missionKind === 'operation' ? 'operation' : 'campaign';
  const operation = missionKind === 'operation' ? OPERATIONS[ab.missionId] : null;
  const captured = report.capture === true;
  const victory = report.result === BATTLE_RESULT.VICTORY || report.result === BATTLE_RESULT.PYRRHIC;

  const xp = (BATTLE && BATTLE.experience) || {};
  const multiplier = missionKind === 'operation' ? safeNumber(operation && operation.experienceMultiplier, 1) : 1;
  const unitXpBase = Math.round(safeNumber(xp.unitParticipation, 0) * multiplier);
  const unitXpWin = Math.round(safeNumber(xp.unitVictory, 0) * multiplier);

  const unitUpdates = [];
  const unitRemovals = [];
  const lostNames = [];

  ((report.final && report.final.friendly) || []).forEach((snap) => {
    if (!isObject(snap) || !snap.realId) return;
    if (dispatched && !dispatched.includes(snap.realId)) return;
    const unit = findUnit(state, snap.realId);
    if (!unit) return;
    if (snap.alive) {
      const maxHp = Math.max(1, safeNumber(unit.maxHp, snap.maxHp));
      const hp = clamp(Math.round(safeNumber(snap.hp, maxHp)), 1, maxHp);
      unitUpdates.push({
        unitId: unit.id,
        hp,
        maxHp,
        damage: damageStateOf(hp, maxHp),
        status: formation ? 'deployed' : 'ready',
        battles: Math.max(0, Math.floor(safeNumber(unit.battles, 0))) + 1,
        experience: Math.max(0, safeNumber(unit.experience, 0)) + unitXpBase + (victory ? unitXpWin : 0)
      });
    } else {
      lostNames.push(snap.name || '单位');
      unitRemovals.push(snap.realId);
    }
  });

  const rec = readRecord(state, ab && ab.theaterId);
  const cfg = THEATERS[ab && ab.theaterId] || null;
  const theaterUpdate = {
    theaterId: ab && ab.theaterId,
    lastResult: report.result || null,
    lastBattleId: report.id || null,
    captured: missionKind === 'campaign' && captured,
    victoriesDelta: missionKind === 'campaign' && captured ? 1 : 0,
    takeFirstReward: Boolean(missionKind === 'campaign' && captured && rec && !rec.firstRewardTaken && cfg)
  };

  const rewards = {};
  if (missionKind === 'operation' && victory) {
    Object.keys(report.rewards || {}).forEach((key) => { rewards[key] = safeNumber(report.rewards[key], 0); });
  } else if (theaterUpdate.takeFirstReward) {
    const reward = (cfg && cfg.firstReward) || {};
    Object.keys(reward).forEach((key) => {
      const v = safeNumber(reward[key], 0);
      if (v > 0) rewards[key] = v;
    });
  }

  const formationUpdate = formation ? {
    formationId: formation.id,
    status: FORMATION_STATUS.RETURNING,
    removeUnitIds: unitRemovals.slice(),
    battles: Math.max(0, Math.floor(safeNumber(formation.battles, 0))) + 1,
    experience: Math.max(0, safeNumber(formation.experience, 0))
      + safeNumber(xp.formationParticipation, 0)
      + (victory ? safeNumber(xp.formationVictory, 0) : 0)
  } : null;

  return {
    battleId: (ab && ab.id) || null,
    reportId: report.id || null,
    result: report.result || null,
    captured,
    lostNames,
    unitUpdates,
    unitRemovals,
    formationUpdate,
    theaterUpdate,
    operationUpdate: missionKind === 'operation' ? {
      operationId: ab.missionId, result: report.result, victory,
      victoriesDelta: victory ? 1 : 0,
      cooldownUntil: safeNumber(state.time && state.time.game, 0) + safeNumber(operation && operation.cooldown, 0),
      battleId: ab.id
    } : null,
    missionKind,
    experienceMultiplier: multiplier,
    rewards,
    statsUpdate: {
      battlesFoughtDelta: 1,
      victoriesDelta: captured ? 1 : 0
    },
    reportToStore: (() => {
      try { return JSON.parse(JSON.stringify(report)); } catch (e) { return null; }
    })()
  };
}

/** 事务性写入结算计划；任一步抛异常则整体回滚 */
function applySettlementPlan(state, ab, plan) {
  // 回滚快照：只快照会被改动的部分，避免整份状态拷贝
  let snapshot = null;
  try {
    snapshot = JSON.stringify({
      units: state.units || [],
      formations: state.formations || [],
      theaters: state.theaters || {},
      battles: state.battles || [],
      operations: state.operations || {},
      resources: state.resources || {},
      stats: state.stats || {},
      battleSessions: state.battleSessions || {},
      battleSettlementLedger: state.battleSettlementLedger || {},
      activeBattleSessionId: state.activeBattleSessionId || null
    });
  } catch (e) {
    snapshot = null;
  }

  try {
    // 1. 单位写回
    plan.unitUpdates.forEach((u) => {
      const unit = findUnit(state, u.unitId);
      if (!unit) return;
      unit.hp = u.hp;
      unit.maxHp = u.maxHp;
      unit.damage = u.damage;
      unit.status = u.status;
      unit.battles = u.battles;
      unit.experience = u.experience;
    });

    // 2. 永久损失单位移除
    if (plan.unitRemovals.length) {
      const gone = new Set(plan.unitRemovals);
      state.units = (state.units || []).filter((u) => !(u && gone.has(u.id)));
    }

    // 3. 编队
    if (plan.formationUpdate) {
      const formation = findFormation(state, plan.formationUpdate.formationId);
      if (formation) {
        formation.status = plan.formationUpdate.status;
        formation.battles = plan.formationUpdate.battles;
        formation.experience = plan.formationUpdate.experience;
        if (Array.isArray(formation.unitIds) && plan.formationUpdate.removeUnitIds.length) {
          const gone = new Set(plan.formationUpdate.removeUnitIds);
          formation.unitIds = formation.unitIds.filter((id) => !gone.has(id));
        }
      }
    }

    // 4. 战区记录
    const rec = ensureRecord(state, plan.theaterUpdate.theaterId);
    if (rec) {
      rec.lastResult = plan.theaterUpdate.lastResult;
      rec.lastBattleId = plan.theaterUpdate.lastBattleId;
      if (plan.theaterUpdate.captured) {
        rec.captured = true;
        rec.victories = Math.max(0, Math.floor(safeNumber(rec.victories, 0)))
          + plan.theaterUpdate.victoriesDelta;
      }
      if (plan.theaterUpdate.takeFirstReward) rec.firstRewardTaken = true;
    }

    if (plan.operationUpdate) {
      if (!state.operations || typeof state.operations !== 'object') state.operations = {};
      const row = state.operations[plan.operationUpdate.operationId] || { attempts: 0, victories: 0, cooldownUntil: 0, lastResult: null, lastBattleId: null };
      row.victories = Math.max(0, Math.floor(safeNumber(row.victories, 0))) + plan.operationUpdate.victoriesDelta;
      row.attempts = Math.max(row.victories, Math.floor(safeNumber(row.attempts, 0)));
      row.cooldownUntil = plan.operationUpdate.cooldownUntil;
      row.lastResult = plan.operationUpdate.result;
      row.lastBattleId = plan.operationUpdate.battleId;
      state.operations[plan.operationUpdate.operationId] = row;
    }

    // 5. 奖励
    if (Object.keys(plan.rewards).length) grant(state, plan.rewards);

    // 6. 统计
    if (!isObject(state.stats)) state.stats = {};
    state.stats.battlesFought = Math.max(0, Math.floor(safeNumber(state.stats.battlesFought, 0)))
      + plan.statsUpdate.battlesFoughtDelta;
    state.stats.victories = Math.max(0, Math.floor(safeNumber(state.stats.victories, 0)))
      + plan.statsUpdate.victoriesDelta;

    // 7. 战报入库
    if (plan.reportToStore) pushReport(state, plan.reportToStore);

    // exactly-once ledger + session lifecycle are committed with the same
    // canonical in-memory transaction as rewards/losses/report.
    ensureBattleSessionState(state);
    const session = getProductionSession(state, ab);
    const settlementId = ab.settlementId || session?.settlementId || null;
    if (settlementId && state.battleSettlementLedger[settlementId]) {
      throw new Error('结算凭证已应用，拒绝重复结算');
    }
    if (settlementId) {
      const ledger = {
        settlementId,
        battleSessionId: ab.battleSessionId || session?.battleSessionId || null,
        formalReportHash: ab.formalReportHash || session?.formalReportHash || null,
        reportId: plan.reportId,
        result: plan.result,
        reward: { ...plan.rewards },
        losses: { unitIds: plan.unitRemovals.slice(), updatedUnitIds: plan.unitUpdates.map((row) => row.unitId) },
        appliedAtSaveRevision: Math.max(0, Math.floor(safeNumber(state.saveRevision, 0))),
        status: 'applied'
      };
      ledger.ledgerHash = buildSettlementLedgerHash(ledger);
      state.battleSettlementLedger[settlementId] = ledger;
    }
    if (session) {
      session.lifecycle = SESSION_LIFECYCLE.SETTLED;
      session.settlementStatus = 'applied';
      session.settledAtGameTime = safeNumber(state.time?.game, 0);
      session.settlementLocked = true;
      state.battleSessions[session.battleSessionId] = session;
    }

    recalcDerived(state);
    return { ok: true, reason: '' };
  } catch (err) {
    if (snapshot) {
      try {
        const prev = JSON.parse(snapshot);
        state.units = prev.units;
        state.formations = prev.formations;
        state.theaters = prev.theaters;
        state.battles = prev.battles;
        state.operations = prev.operations;
        state.resources = prev.resources;
        state.stats = prev.stats;
        state.battleSessions = prev.battleSessions;
        state.battleSettlementLedger = prev.battleSettlementLedger;
        state.activeBattleSessionId = prev.activeBattleSessionId;
        recalcDerived(state);
      } catch (e) { /* 回滚失败也不再抛出，避免主循环中断 */ }
    }
    return { ok: false, reason: (err && err.message) || '结算写入异常' };
  }
}

/**
 * 结算活动战斗（幂等：重复调用不会重复发奖或重复扣血）。
 *
 * 阶段6事务化：验证 → 生成计划 → 一次性写入 → 成功后才置 settled。
 * 任何环节失败都不会留下「写了一半」的状态。
 */
export function settleActiveBattle(state) {
  const ab = getActiveBattle(state);
  if (!ab) return fail(THEATER_CODE.NO_BATTLE, '当前没有进行中的作战');
  if (ab.replayReadOnly === true || ab.settlementAllowed === false) {
    return fail(THEATER_CODE.SETTLEMENT_BLOCKED, '回放战斗为只读，禁止结算', { activeBattle: ab });
  }
  if (ab.settled) return pass(THEATER_CODE.OK, { activeBattle: ab });
  ensureBattleSessionState(state);
  const session = getProductionSession(state, ab);
  const settlementId = ab.settlementId || session?.settlementId || null;
  if (settlementId && state.battleSettlementLedger[settlementId]) {
    return fail(THEATER_CODE.SETTLEMENT_BLOCKED, '该战斗结算已应用，拒绝重复结算', { activeBattle: ab });
  }
  ensureSettlementFields(ab);
  if (ab.settlementBlocked) {
    return fail(THEATER_CODE.SETTLEMENT_BLOCKED, ab.settlementError || '战斗结算已被阻断', { activeBattle: ab });
  }
  ab.settlementAttempted = true;

  // 1. 验证
  const check = validateBattleReportForSettlement(state, ab);
  if (!check.ok) {
    recordSettlementFailure(state, ab, check, { block: shouldBlockSettlement(check) });
    emit('battle:settle-failed', { battleId: ab.id, reason: check.reason });
    return fail(check.code || THEATER_CODE.REPORT_INVALID, check.reason, {
      activeBattle: ab, problems: check.problems
    });
  }

  // 2. 计划（只读）
  const plan = buildSettlementPlan(state, ab);
  if (session) syncProductionSession(state, ab, { lifecycle: SESSION_LIFECYCLE.SETTLEMENT_PENDING, settlementStatus: 'pending' });

  // 3. 写入（事务）
  const applied = applySettlementPlan(state, ab, plan);
  if (!applied.ok) {
    const failure = { code: THEATER_CODE.SETTLEMENT_FAILED, reason: applied.reason };
    recordSettlementFailure(state, ab, failure, { block: true });
    emit('battle:settle-failed', { battleId: ab.id, reason: applied.reason });
    return fail(THEATER_CODE.SETTLEMENT_FAILED, applied.reason, { activeBattle: ab });
  }

  // 4. 成功后才落 settled + 凭证
  const report = ab.report || {};
  const captured = plan.captured;
  ab.granted = { ...plan.rewards };
  ab.settlementError = null;
  ab.settlementBlocked = false;
  ab.settlementErrorLogged = false;
  ab.loggedErrors = [];
  ab.settlementReceipt = {
    battleId: ab.id,
    battleSessionId: ab.battleSessionId || null,
    settlementId: ab.settlementId || null,
    formalReportHash: ab.formalReportHash || null,
    reportId: plan.reportId,
    formationId: ab.formationId,
    theaterId: ab.theaterId,
    result: plan.result,
    captured,
    granted: { ...plan.rewards },
    removedUnitIds: plan.unitRemovals.slice(),
    updatedUnitIds: plan.unitUpdates.map((u) => u.unitId),
    settledGameTime: safeNumber(state.time ? state.time.game : 0, 0)
  };
  if (session) syncProductionSession(state, ab, {
    lifecycle: SESSION_LIFECYCLE.SETTLED,
    settlementStatus: 'applied',
    settlementReceipt: cloneJson(ab.settlementReceipt),
    presentationTime: safeNumber(ab.elapsed, 0)
  });
  ab.playing = false;
  ab.elapsed = ab.duration;
  ab.settled = true;
  ab.presentationPhase = 'returning';
  ab.returnElapsed = 0;
  ab.returnDuration = 5;
  if (session) syncProductionSession(state, ab, {
    lifecycle: SESSION_LIFECYCLE.SETTLED,
    settlementStatus: 'applied',
    presentationTime: safeNumber(ab.elapsed, 0)
  });

  const label = resultLabel(report.result);
  const lostText = plan.lostNames.length ? `，损失：${plan.lostNames.join('、')}` : '，无永久损失';
  logEvent(state,
    `${ab.formationName}在${ab.theaterName}的作战结束：${label}${lostText}。`,
    captured ? LOG_LEVEL.GOOD : LOG_LEVEL.DANGER);
  if (captured && Object.keys(plan.rewards).length) {
    logEvent(state, `占领${ab.theaterName}，获得首次占领奖励：${formatMissionCost(plan.rewards)}。`, LOG_LEVEL.GOOD);
  }

  emit('battle:settled', { battleId: ab.id, result: report.result, captured });
  emit('formation:changed', { formationId: ab.formationId, kind: 'status' });
  emit('theater:changed', { theaterId: ab.theaterId, captured });

  return pass(THEATER_CODE.OK, { activeBattle: ab, receipt: ab.settlementReceipt });
}

/**
 * 玩家查看完战报，返回基地：编队复位待命，清空活动战斗。
 *
 * 阶段6：未结算的战斗禁止返回基地 —— 此前会顺手结算，
 * 导致玩家在战斗播放到一半点按钮就提前拿到结果。
 */
export function finishBattleReturn(state) {
  const ab = getActiveBattle(state);
  if (!ab) return fail(THEATER_CODE.NO_BATTLE, '当前没有进行中的作战');
  if (!ab.settled) {
    return fail(THEATER_CODE.BATTLE_NOT_FINISHED, '战斗尚未结束，暂时无法返回基地', { activeBattle: ab });
  }

  if (ab.replayReadOnly === true) {
    syncProductionSession(state, ab, {
      lifecycle: SESSION_LIFECYCLE.RETURNED,
      presentationTime: safeNumber(ab.elapsed, 0)
    });
    state.activeBattle = null;
    state.activeBattleSessionId = null;
    return pass(THEATER_CODE.OK, { activeBattle: null, replay: true, readOnly: true });
  }

  const formation = findFormation(state, ab.formationId);
  if (formation) {
    formation.status = FORMATION_STATUS.IDLE;
    formation.theaterId = null;
    formation.strategy = null;
    (formation.unitIds || []).forEach((uid) => {
      const unit = findUnit(state, uid);
      if (unit) unit.status = 'assigned';
    });
  }

  ab.resultViewed = true;
  syncProductionSession(state, ab, {
    lifecycle: SESSION_LIFECYCLE.RETURNED,
    returnedAtGameTime: safeNumber(state.time?.game, 0),
    presentationTime: safeNumber(ab.elapsed, 0)
  });
  state.activeBattle = null;
  state.activeBattleSessionId = null;
  recalcDerived(state);

  logEvent(state, `${ab.formationName}已返回基地。`, LOG_LEVEL.INFO);
  emit('battle:closed', { battleId: ab.id });
  emit('formation:changed', { formationId: ab.formationId, kind: 'status' });

  return pass(THEATER_CODE.OK, { activeBattle: null });
}

/**
 * 安全关闭永久阻断的无效战斗。不调用结算计划，因此不应用损失、奖励、占领或经验。
 */
export function abortInvalidBattle(state) {
  const ab = getActiveBattle(state);
  if (!ab) return fail(THEATER_CODE.NO_BATTLE, '当前没有进行中的作战');
  ensureSettlementFields(ab);
  if (!ab.settlementBlocked) {
    return fail(THEATER_CODE.SETTLEMENT_NOT_BLOCKED, '当前战斗未被阻断，不能安全关闭', { activeBattle: ab });
  }

  const formation = findFormation(state, ab.formationId);
  if (formation) {
    formation.status = FORMATION_STATUS.IDLE;
    formation.theaterId = null;
    formation.strategy = null;
    (formation.unitIds || []).forEach((uid) => {
      const unit = findUnit(state, uid);
      if (unit) unit.status = 'assigned';
    });
  }
  const battleId = ab.id;
  syncProductionSession(state, ab, { lifecycle: SESSION_LIFECYCLE.RETURNED, settlementStatus: 'blocked', settlementLocked: true });
  state.activeBattle = null;
  state.activeBattleSessionId = null;
  recalcDerived(state);
  logEvent(state, '异常战斗已安全关闭，未应用战斗奖励和损失。', LOG_LEVEL.WARN);
  emit('battle:aborted', { battleId });
  emit('battle:closed', { battleId, aborted: true });
  emit('formation:changed', { formationId: ab.formationId, kind: 'status' });
  return pass(THEATER_CODE.OK, { activeBattle: null, aborted: true });
}

/** 跳过返航动画：只结束展示，不重新结算。 */
export function skipBattleReturn(state) {
  const ab = getActiveBattle(state);
  if (!ab) return fail(THEATER_CODE.NO_BATTLE, '当前没有进行中的作战');
  if (!ab.settled) return fail(THEATER_CODE.BATTLE_NOT_FINISHED, '战斗尚未结束，暂时无法跳过返航', { activeBattle: ab });
  ab.returnElapsed = Math.max(0, safeNumber(ab.returnDuration, 5));
  return finishBattleReturn(state);
}

/** 旧 API 保留：旧测试和旧存档调用等同于跳过返航动画。 */
export function closeBattleResult(state) {
  return skipBattleReturn(state);
}

/* ============================================================
 * 战报查询
 * ========================================================== */

/** 历史战报（最新在前） */
export function getReports(state) {
  return Array.isArray(state && state.battles) ? state.battles.slice() : [];
}

/** 按 ID 取战报 */
export function getReport(state, reportId) {
  return getReports(state).find((r) => r && r.id === reportId) || null;
}

/* ============================================================
 * 存档容错
 * ========================================================== */

/**
 * 战区数据容错：补齐缺失记录、剔除未知战区、修正字段类型、
 * 丢弃存档里的 income 字段（收益一律由 economy 依配置计算）。
 * @returns {{repaired:boolean, notes:string[]}}
 */
export function sanitizeTheaters(state) {
  const notes = [];
  if (!state) return { repaired: false, notes };
  if (!isObject(state.theaters)) {
    state.theaters = {};
    notes.push('战区记录缺失，已重建。');
  }

  // 剔除未知战区
  Object.keys(state.theaters).forEach((id) => {
    if (!THEATERS[id]) {
      delete state.theaters[id];
      notes.push(`移除了未知战区记录：${id}`);
    }
  });

  Object.keys(THEATERS).forEach((id) => {
    const raw = state.theaters[id];
    if (!isObject(raw)) {
      state.theaters[id] = defaultRecord(id);
      notes.push(`补齐了战区记录：${THEATERS[id].name}`);
      return;
    }
    const fixed = defaultRecord(id);
    fixed.captured = raw.captured === true;
    fixed.firstRewardTaken = raw.firstRewardTaken === true || (raw.captured === true && raw.firstRewardTaken !== false);
    fixed.attempts = Math.max(0, Math.floor(safeNumber(raw.attempts, 0)));
    fixed.victories = Math.max(0, Math.floor(safeNumber(raw.victories, 0)));
    fixed.lastResult = typeof raw.lastResult === 'string' ? raw.lastResult : null;
    fixed.lastBattleId = typeof raw.lastBattleId === 'string' ? raw.lastBattleId : null;
    if (fixed.victories > fixed.attempts) fixed.attempts = fixed.victories;
    if (raw.income !== undefined) notes.push(`忽略了${THEATERS[id].name}存档中的收益字段（改由配置计算）。`);
    state.theaters[id] = fixed;
  });

  return { repaired: notes.length > 0, notes };
}

/**
 * 历史战报容错：只保留结构完整的战报，并限制条数。
 * @returns {{repaired:boolean, notes:string[]}}
 */
export function sanitizeBattles(state) {
  const notes = [];
  if (!state) return { repaired: false, notes };
  if (!Array.isArray(state.battles)) {
    state.battles = [];
    notes.push('战报列表缺失，已重建。');
    return { repaired: true, notes };
  }
  const before = state.battles.length;
  const seen = new Set();
  state.battles = state.battles.filter((r) => {
    if (!isObject(r) || typeof r.id !== 'string') return false;
    if (!Array.isArray(r.events) || !isObject(r.final)) return false;
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  if (state.battles.length > BATTLE.maxReports) {
    state.battles.length = BATTLE.maxReports;
  }
  if (state.battles.length !== before) {
    notes.push(`清理了 ${before - state.battles.length} 条无效或超量战报。`);
  }
  return { repaired: notes.length > 0, notes };
}

function sanitizeReplayActiveBattle(state, ab, notes) {
  const context = isObject(ab.replayContext) ? ab.replayContext : {};
  const sourceId = context.sourceBattleSessionId || ab.replaySourceSessionId || ab.battleSessionId;
  const source = sourceId && state.battleSessions[sourceId];
  const reportId = context.sourceFormalReportId || source?.formalReportId || ab.report?.id;
  const report = (state.battles || []).find((row) => row && row.id === reportId);
  const ledger = source?.settlementId ? state.battleSettlementLedger[source.settlementId] : null;
  const failReplay = (reason) => {
    state.activeBattle = null;
    state.activeBattleSessionId = null;
    notes.push(`丢弃了无效的只读回放（${reason}）。`);
    return { repaired: true, notes, activeFormationId: null };
  };

  if (!source || source.sessionOrigin !== SESSION_ORIGIN.PRODUCTION) return failReplay('正式会话不存在');
  if (!report) return failReplay('正式战报不存在');
  const ledgerCheck = validateSettlementLedger(ledger, source);
  if (!ledgerCheck.ok) return failReplay(ledgerCheck.problems.join('；'));
  const binding = validateSessionBinding(source, { report, deploymentSnapshot: source.deploymentSnapshot });
  if (!binding.ok) return failReplay(binding.problems.join('；'));

  const formation = findFormation(state, ab.formationId || report.formationId);
  // Repair only the known legacy Replay contamination. A normal production
  // battle still receives the active formation handoff below this helper.
  if (formation) {
    if (formation.status !== FORMATION_STATUS.IDLE || formation.theaterId || formation.strategy) {
      formation.status = FORMATION_STATUS.IDLE;
      formation.theaterId = null;
      formation.strategy = null;
      notes.push('只读回放未占用正式编队，已清理历史战斗态。');
    }
    (formation.unitIds || []).forEach((uid) => {
      const unit = findUnit(state, uid);
      if (unit && unit.formationId === formation.id && (unit.status === 'deployed' || unit.status === 'assigned')) {
        unit.status = 'assigned';
      }
    });
  }

  const duration = Math.max(1, safeNumber(report.duration, BATTLE.baseDuration));
  const replayTime = clamp(safeNumber(context.presentationTime, ab.elapsed), 0, duration);
  ab.replayReadOnly = true;
  ab.settlementAllowed = false;
  ab.sessionOrigin = SESSION_ORIGIN.PRODUCTION;
  ab.battleSessionId = source.battleSessionId;
  ab.replaySourceSessionId = source.battleSessionId;
  ab.sourceSaveRevision = source.sourceSaveRevision;
  ab.deploymentSnapshotId = source.deploymentSnapshotId;
  ab.deploymentHash = source.deploymentHash;
  ab.formalReportHash = source.formalReportHash;
  ab.sourceReportHash = source.sourceReportHash;
  ab.settlementId = source.settlementId;
  ab.report = cloneJson(report);
  ab.dispatchSnapshot = cloneJson(source.deploymentSnapshot) || {};
  ab.duration = duration;
  ab.elapsed = replayTime;
  ab.settled = replayTime >= duration;
  ab.playing = !ab.settled;
  ab.presentationPhase = ab.settled ? 'returning' : 'battle';
  ab.returnDuration = Math.max(0.1, safeNumber(ab.returnDuration, 5));
  ab.returnElapsed = clamp(safeNumber(context.returnElapsed, ab.returnElapsed), 0, ab.returnDuration);
  delete ab.productionSession;
  ab.replayContext = {
    mode: 'replay',
    sourceBattleSessionId: source.battleSessionId,
    sourceFormalReportId: source.formalReportId,
    sourceFormalReportHash: source.formalReportHash,
    settlementId: source.settlementId,
    presentationTime: replayTime,
    returnElapsed: ab.returnElapsed,
    readOnly: true
  };
  state.activeBattleSessionId = null;
  return { repaired: notes.length > 0, notes, activeFormationId: null };
}

/**
 * 活动战斗容错。必须在 sanitizeFormations 之前调用。
 * Replay 是独立的 presentation context，不向 sanitizeFormations 透传
 * activeFormationId；正式活动战斗才会恢复 fighting/deployed。
 * @returns {{repaired:boolean, notes:string[], activeFormationId:string|null}}
 */
export function sanitizeActiveBattle(state) {
  const notes = [];
  if (!state) return { repaired: false, notes, activeFormationId: null };
  ensureBattleSessionState(state);

  const ab = state.activeBattle;
  if (ab === null || ab === undefined) {
    state.activeBattle = null;
    return { repaired: false, notes, activeFormationId: null };
  }

  const restoreFormation = () => {
    const formation = findFormation(state, ab && ab.formationId);
    if (!formation) return;
    formation.status = FORMATION_STATUS.IDLE;
    formation.theaterId = null;
    formation.strategy = null;
    (formation.unitIds || []).forEach((uid) => {
      const unit = findUnit(state, uid);
      if (unit && (unit.status === 'deployed' || unit.status === 'assigned')) unit.status = 'assigned';
    });
  };
  const drop = (why) => {
    restoreFormation();
    state.activeBattle = null;
    notes.push(`丢弃了无效的活动战斗（${why}）。`);
    return { repaired: true, notes, activeFormationId: null };
  };

  if (!isObject(ab)) return drop('数据结构损坏');
  if (ab.replayReadOnly === true || isObject(ab.replayContext)) {
    return sanitizeReplayActiveBattle(state, ab, notes);
  }
  if (!THEATERS[ab.theaterId]) return drop('战区不存在');
  if (!STRATEGIES[ab.strategyId]) return drop('策略不存在');

  const formation = findFormation(state, ab.formationId);
  if (!formation) return drop('编队已不存在');

  let report = ab.report;
  if (!isObject(report) || !Array.isArray(report.events) || !isObject(report.final)) {
    ensureSettlementFields(ab);
    blockSettlementWithoutLog(state, ab, '战报缺失，无法重建可信战报');
    notes.push('活动战斗战报无法重建，已进入结算阻断。');
    return { repaired: true, notes, activeFormationId: formation.id };
  }

  if (ab.battleSessionId && !state.battleSessions[ab.battleSessionId]) {
    blockSettlementWithoutLog(state, ab, '战斗会话缺失，无法安全恢复');
    notes.push('活动战斗会话缺失，已进入结算阻断。');
    return { repaired: true, notes, activeFormationId: formation.id };
  }
  const session = ensureLegacyProductionSession(state, ab, notes);
  if (session) {
    ab.productionSession = session;
    ab.sessionOrigin = session.sessionOrigin;
    ab.deploymentHash = session.deploymentHash;
    ab.deploymentSnapshotId = session.deploymentSnapshotId;
    ab.formalReportHash = session.formalReportHash;
    ab.sourceReportHash = session.sourceReportHash;
    ab.sourceSaveRevision = session.sourceSaveRevision;
    ab.settlementId = session.settlementId;
    state.activeBattleSessionId = session.battleSessionId;
    if (ab.settled) {
      session.lifecycle = SESSION_LIFECYCLE.SETTLED;
      session.settlementStatus = 'applied';
    }
  }

  // 字段修复
  ab.id = typeof ab.id === 'string' && ab.id ? ab.id : report.id || 'battle_unknown';
  ab.seed = Math.max(0, Math.floor(safeNumber(ab.seed, safeNumber(report.seed, 0))));
  ab.theaterName = THEATERS[ab.theaterId].name;
  ab.missionKind = ab.missionKind === 'operation' ? 'operation' : 'campaign';
  ab.missionId = typeof ab.missionId === 'string' && ab.missionId ? ab.missionId : ab.theaterId;
  if (ab.missionKind === 'operation' && !OPERATIONS[ab.missionId]) return drop('重复任务不存在');
  ab.formationName = typeof formation.name === 'string' ? formation.name : '编队';
  ab.duration = Math.max(1, safeNumber(ab.duration, safeNumber(report.duration, BATTLE.baseDuration)));
  ab.elapsed = clamp(safeNumber(ab.elapsed, 0), 0, ab.duration);
  ab.settled = ab.settled === true;
  ab.resultViewed = ab.resultViewed === true;
  ab.playing = !ab.settled;
  ab.cost = isObject(ab.cost) ? ab.cost : {};
  ab.granted = isObject(ab.granted) ? ab.granted : {};
  ab.startedGameTime = safeNumber(ab.startedGameTime, 0);
  ab.settlementError = typeof ab.settlementError === 'string' ? ab.settlementError : null;
  ensureSettlementFields(ab);
  if (ab.settled) ab.settlementBlocked = false;
  if (ab.settled) {
    ab.presentationPhase = 'returning';
    ab.returnDuration = Math.max(0.1, safeNumber(ab.returnDuration, 5));
    ab.returnElapsed = clamp(safeNumber(ab.returnElapsed, 0), 0, ab.returnDuration);
  } else {
    ab.presentationPhase = 'battle';
    ab.returnDuration = Math.max(0.1, safeNumber(ab.returnDuration, 5));
    ab.returnElapsed = 0;
  }

  // —— 阶段6：参战单位名单容错 ——
  // 名单缺失（旧存档）时用编队当前成员补齐；名单非法则丢弃整场战斗。
  if (!Array.isArray(ab.dispatchedUnitIds)) {
    ab.dispatchedUnitIds = (formation.unitIds || []).filter((x) => typeof x === 'string' && x);
    notes.push('活动战斗缺少参战单位名单，已按当前编队补齐。');
  } else {
    const cleaned = [];
    ab.dispatchedUnitIds.forEach((x) => {
      if (typeof x === 'string' && x && !cleaned.includes(x)) cleaned.push(x);
    });
    if (cleaned.length !== ab.dispatchedUnitIds.length) {
      notes.push('活动战斗参战单位名单存在重复或非法项，已清理。');
    }
    ab.dispatchedUnitIds = cleaned;
  }
  if (ab.dispatchedUnitIds.length === 0) return drop('参战单位名单为空');

  // 阶段8.1旧存档可能保留了 withdraw 结果却漏写 RETREAT。
  // 优先用派遣快照+种子重建，不修改资源、尝试次数或已结算凭证。
  if (!ab.settled && report.result === BATTLE_RESULT.WITHDRAW
    && !report.events.some((event) => event && event.type === BATTLE_EVENT.RETREAT)) {
    let rebuilt = null;
    try { rebuilt = rebuildBattleFromDispatchSnapshot(ab.dispatchSnapshot, ab.seed); } catch (err) { rebuilt = null; }
    const rebuiltOutcome = rebuilt ? validateBattleOutcomeConsistency(rebuilt) : { ok: false };
    if (rebuilt && rebuilt.id === ab.id && rebuilt.result === BATTLE_RESULT.WITHDRAW
      && rebuilt.events.some((event) => event && event.type === BATTLE_EVENT.RETREAT)
      && rebuiltOutcome.ok) {
      report = rebuilt;
      ab.report = rebuilt;
      ab.duration = Math.max(1, safeNumber(rebuilt.duration, ab.duration));
      ab.elapsed = clamp(safeNumber(ab.elapsed, 0), 0, ab.duration);
      notes.push('旧撤退战报缺少RETREAT事件，已按派遣快照确定性重建。');
    } else {
      blockSettlementWithoutLog(state, ab, '撤退战报无法确定性重建');
      notes.push('撤退战报无法确定性重建，已进入结算阻断。');
    }
  }

  // 战报的友军阵容不得包含未参战单位
  const allowed = new Set(ab.dispatchedUnitIds);
  const sides = [report.initial && report.initial.friendly, report.final && report.final.friendly];
  for (const arr of sides) {
    if (!Array.isArray(arr)) continue;
    const intruder = arr.some((snap) => isObject(snap) && snap.realId && !allowed.has(snap.realId));
    if (intruder) return drop('战报包含未参战单位');
  }

  // —— 阶段6：结算凭证容错 ——
  if (ab.settled) {
    const receipt = ab.settlementReceipt;
    const receiptValid = isObject(receipt)
      && receipt.battleId === ab.id && receipt.reportId === report.id
      && receipt.formationId === ab.formationId && receipt.theaterId === ab.theaterId
      && isObject(receipt.granted)
      && Array.isArray(receipt.removedUnitIds) && Array.isArray(receipt.updatedUnitIds)
      && Number.isFinite(Number(receipt.settledGameTime));
    if (!receiptValid) {
      return drop('活动战斗结算记录不完整，已安全关闭');
    } else if (receipt.result !== report.result) {
      return drop('结算凭证与战报不匹配');
    }
    if (session) {
      if (receipt.battleSessionId && receipt.battleSessionId !== session.battleSessionId) {
        return drop('结算凭证与战斗会话不匹配');
      }
      if (receipt.settlementId && receipt.settlementId !== session.settlementId) {
        return drop('结算凭证与结算 ID 不匹配');
      }
      const ledger = state.battleSettlementLedger[session.settlementId];
      const migratedLedger = {
        settlementId: session.settlementId,
        battleSessionId: session.battleSessionId,
        formalReportHash: session.formalReportHash,
        reportId: report.id,
        result: receipt.result,
        reward: { ...(receipt.granted || {}) },
        losses: {
          unitIds: receipt.removedUnitIds.slice(),
          updatedUnitIds: receipt.updatedUnitIds.slice()
        },
        appliedAtSaveRevision: Math.max(0, Math.floor(safeNumber(state.saveRevision, 0))),
        status: 'applied'
      };
      migratedLedger.ledgerHash = buildSettlementLedgerHash(migratedLedger);
      if (!ledger) {
        state.battleSettlementLedger[session.settlementId] = migratedLedger;
        notes.push('已为历史结算凭证补齐 exactly-once 结算账本。');
      } else if (ledger.reportId !== migratedLedger.reportId
        || ledger.formalReportHash !== migratedLedger.formalReportHash
        || ledger.status !== 'applied') {
        return drop('结算账本与活动战斗凭证不匹配');
      }
      session.settlementReceipt = cloneJson(receipt);
      session.lifecycle = SESSION_LIFECYCLE.SETTLED;
      session.settlementStatus = 'applied';
      session.settlementLocked = true;
      session.settlementState = { ...(session.settlementState || {}), status: 'applied', settlementId: session.settlementId, locked: true };
      state.battleSessions[session.battleSessionId] = session;
    }
  } else if (ab.settlementReceipt) {
    ab.settlementReceipt = null;
    notes.push('未结算的作战携带了结算凭证，已清除。');
  }

  // 已结算但未关闭：保留结果面板，编队处于返回状态
  if (ab.settled) {
    ab.elapsed = ab.duration;
    if (formation.status !== FORMATION_STATUS.RETURNING) {
      formation.status = FORMATION_STATUS.RETURNING;
      notes.push('已结算的作战：编队状态已修正为返回。');
    }
  } else if (formation.status !== FORMATION_STATUS.FIGHTING) {
    formation.status = FORMATION_STATUS.FIGHTING;
    notes.push('进行中的作战：编队状态已修正为战斗。');
  }
  formation.theaterId = ab.theaterId;
  formation.strategy = ab.strategyId;

  // 未结算活动战斗必须通过完整校验；失败时安全关闭，不重新模拟。
  if (!ab.settled && !ab.settlementBlocked) {
    const valid = validateBattleReportForSettlement(state, ab);
    if (!valid.ok) {
      blockSettlementWithoutLog(state, ab, valid.reason || '战报校验失败');
      notes.push(`活动战斗战报校验失败，已进入结算阻断：${valid.reason || '未知错误'}`);
    }
  }

  return { repaired: notes.length > 0, notes, activeFormationId: formation.id };
}

/** 汇总导出，便于调试面板一次性读取 */
export const THEATER_API = {
  getTheaterState, getTheaterIntel, getMissionCost, getOperation, listOperations, getOperationCost,
  canDispatch, canDispatchOperationMission, dispatchFormation, dispatchOperation, replayBattleSession,
  tickActiveBattle, tickBattleReturn, settleActiveBattle, finishBattleReturn, skipBattleReturn, closeBattleResult,
  abortInvalidBattle, shouldBlockSettlement,
  sanitizeTheaters, sanitizeActiveBattle, sanitizeBattles,
  listTheaters, listStrategies, getReports, getReport, getActiveBattle,
  validateBattleReportForSettlement, buildSettlementPlan
};
