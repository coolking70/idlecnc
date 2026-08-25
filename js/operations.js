/** 阶段8可重复作战任务：配置查询、解锁、成本与冷却。 */

import { OPERATIONS, STRATEGIES, THEATERS, FORMATION_STATUS, UNITS } from './config.js';
import { getOperationalTask } from './tasking.js';
import { getStrategicMissionModifiers } from './strategic-loop.js'; // Stage 10-E：repeat Operation 与首次出击共用同一战略成本 modifier 权威 // Stage 10-A：任务编队不可参加重复任务派遣
import { missingResources } from './economy.js';
import { safeNumber, formatDuration } from './utils.js';

export const OPERATION_CODE = {
  UNKNOWN: 'unknown_operation', THEATER_NOT_CAPTURED: 'theater_not_captured',
  COOLDOWN: 'cooldown', BATTLE_ACTIVE: 'battle_active', FORMATION_INVALID: 'formation_invalid',
  FORMATION_TASKED: 'formation_tasked', // Stage 10-A.1：任务编队不可参加重复任务派遣（此前返回 undefined）
  RESOURCE: 'resource', READY: 'ready', UNKNOWN_STRATEGY: 'unknown_strategy'
};

function formatMissing(missing) {
  return (missing || []).map((item) => item && typeof item === 'object' ? item.text || item.resource || '' : String(item)).filter(Boolean).join('，');
}

function record(state, id) {
  const op = state && state.operations && state.operations[id];
  return op && typeof op === 'object' ? op : { attempts: 0, victories: 0, cooldownUntil: 0, lastResult: null, lastBattleId: null };
}

export function operationCooldown(state, operationId) {
  const op = OPERATIONS[operationId];
  if (!op) return { ok: false, code: OPERATION_CODE.UNKNOWN, remaining: 0, text: '未知重复任务' };
  const now = safeNumber(state && state.time && state.time.game, 0);
  const remaining = Math.max(0, safeNumber(record(state, operationId).cooldownUntil, 0) - now);
  return { ok: true, code: remaining > 0 ? OPERATION_CODE.COOLDOWN : OPERATION_CODE.READY, remaining, text: remaining > 0 ? `任务冷却中，剩余${formatDuration(remaining)}` : '任务已就绪' };
}

export function getOperationState(state, operationId) {
  const cfg = OPERATIONS[operationId];
  if (!cfg) return null;
  const rec = record(state, operationId);
  const theater = state && state.theaters && state.theaters[cfg.theaterId];
  const cooldown = operationCooldown(state, operationId);
  return {
    ...cfg, enemy: { ...cfg.enemy }, rewards: JSON.parse(JSON.stringify(cfg.rewards || {})),
    captured: theater ? theater.captured === true : false,
    attempts: Math.max(0, Math.floor(safeNumber(rec.attempts, 0))),
    victories: Math.max(0, Math.floor(safeNumber(rec.victories, 0))),
    cooldownUntil: Math.max(0, safeNumber(rec.cooldownUntil, 0)),
    lastResult: rec.lastResult || null, lastBattleId: rec.lastBattleId || null,
    cooldownRemaining: cooldown.remaining, cooldownText: cooldown.text,
    theaterName: THEATERS[cfg.theaterId] ? THEATERS[cfg.theaterId].name : cfg.theaterId
  };
}

export function listOperations(state) {
  return Object.keys(OPERATIONS).map((id) => getOperationState(state, id));
}

export function getOperationCost(state, formationId, operationId, strategyId) {
  const op = OPERATIONS[operationId];
  const strategy = STRATEGIES[strategyId];
  const formation = (state && state.formations || []).find((item) => item && item.id === formationId);
  if (!op || !strategy || !formation) return { cost: {}, missing: [], affordable: false, breakdown: {} };
  const upkeep = (formation.unitIds || []).reduce((sum, id) => {
    const unit = (state.units || []).find((item) => item && item.id === id);
    return sum + safeNumber(unit && UNITS[unit.type] && UNITS[unit.type].upkeep, 0);
  }, 0);
  // Stage 10-E：战区压力 modifier（初始 pressure 时倍率为 1，旧成本不变；
  // 取整规则沿用 Math.ceil / 整数叠加）
  const strategic = getStrategicMissionModifiers(state, op.theaterId);
  const supply = Math.ceil(upkeep * safeNumber(op.supplyMultiplier, 1) * safeNumber(strategy.mods && strategy.mods.upkeep, 1) * strategic.supplyMultiplier);
  const cost = {};
  if (supply > 0) cost.supply = supply;
  Object.keys(strategy.cost || {}).forEach((key) => {
    const scale = key === 'supply' ? strategic.supplyMultiplier : key === 'intel' ? strategic.intelMultiplier : 1;
    cost[key] = safeNumber(cost[key], 0) + Math.round(safeNumber(strategy.cost[key], 0) * scale);
  });
  if (safeNumber(op.intelCost, 0) > 0) cost.intel = safeNumber(cost.intel, 0) + Math.round(safeNumber(op.intelCost, 0) * strategic.intelMultiplier);
  const missing = missingResources(state, cost);
  return {
    cost, missing, affordable: missing.length === 0,
    breakdown: {
      upkeep, supplyMultiplier: op.supplyMultiplier, strategyCost: { ...(strategy.cost || {}) }, intelCost: op.intelCost || 0,
      strategicSupplyMultiplier: strategic.supplyMultiplier,
      strategicIntelMultiplier: strategic.intelMultiplier
    }
  };
}

export function canDispatchOperation(state, formationId, operationId, strategyId) {
  const op = OPERATIONS[operationId];
  if (!op) return { ok: false, code: OPERATION_CODE.UNKNOWN, reason: '未知重复任务' };
  if (!STRATEGIES[strategyId]) return { ok: false, code: OPERATION_CODE.UNKNOWN_STRATEGY, reason: '未知作战策略' };
  if (state && state.activeBattle) return { ok: false, code: OPERATION_CODE.BATTLE_ACTIVE, reason: '已有一场作战正在进行' };
  const theater = state && state.theaters && state.theaters[op.theaterId];
  if (!theater || theater.captured !== true) return { ok: false, code: OPERATION_CODE.THEATER_NOT_CAPTURED, reason: '必须先占领对应战区' };
  const cooldown = operationCooldown(state, operationId);
  if (cooldown.remaining > 0) return { ok: false, code: OPERATION_CODE.COOLDOWN, reason: cooldown.text, remaining: cooldown.remaining };
  const formation = (state.formations || []).find((item) => item && item.id === formationId);
  if (!formation || formation.status !== FORMATION_STATUS.IDLE || !(formation.unitIds || []).length) {
    return { ok: false, code: OPERATION_CODE.FORMATION_INVALID, reason: '编队不存在或当前不可派遣' };
  }
  if (getOperationalTask(state, formationId)) {
    return { ok: false, code: OPERATION_CODE.FORMATION_TASKED, reason: '该编队正在执行作战任务，请先召回' };
  }
  const ids = new Set();
  for (const unitId of formation.unitIds) {
    if (ids.has(unitId)) return { ok: false, code: OPERATION_CODE.FORMATION_INVALID, reason: '编队成员ID重复' };
    ids.add(unitId);
    const unit = (state.units || []).find((item) => item && item.id === unitId);
    if (!unit || unit.formationId !== formation.id || unit.status !== 'assigned') {
      return { ok: false, code: OPERATION_CODE.FORMATION_INVALID, reason: '编队成员状态或归属异常' };
    }
    const def = UNITS[unit.type];
    if (!def || safeNumber(def.stats && def.stats.attack, 0) <= 0) {
      return { ok: false, code: OPERATION_CODE.FORMATION_INVALID, reason: '编队缺少可作战单位' };
    }
  }
  const cost = getOperationCost(state, formationId, operationId, strategyId);
  if (!cost.affordable) return { ok: false, code: OPERATION_CODE.RESOURCE, reason: formatMissing(cost.missing), cost: cost.cost, missing: cost.missing };
  return { ok: true, code: OPERATION_CODE.READY, reason: '', cost: cost.cost, missing: [] };
}

export function sanitizeOperations(state) {
  const notes = [];
  if (!state || typeof state !== 'object') return { repaired: false, notes };
  if (!state.operations || typeof state.operations !== 'object' || Array.isArray(state.operations)) { state.operations = {}; notes.push('重复任务记录缺失，已重建。'); }
  Object.keys(state.operations).forEach((id) => { if (!OPERATIONS[id]) { delete state.operations[id]; notes.push(`移除未知重复任务记录：${id}`); } });
  Object.keys(OPERATIONS).forEach((id) => {
    const raw = state.operations[id];
    const row = raw && typeof raw === 'object' ? raw : {};
    const attempts = Math.max(0, Math.floor(safeNumber(row.attempts, 0)));
    const victories = Math.min(attempts, Math.max(0, Math.floor(safeNumber(row.victories, 0))));
    state.operations[id] = {
      attempts, victories, cooldownUntil: Math.max(0, safeNumber(row.cooldownUntil, 0)),
      lastResult: ['victory', 'pyrrhic', 'defeat', 'withdraw', 'wiped'].includes(row.lastResult) ? row.lastResult : null,
      lastBattleId: typeof row.lastBattleId === 'string' ? row.lastBattleId : null
    };
    if (JSON.stringify(row) !== JSON.stringify(state.operations[id])) notes.push(`重复任务${OPERATIONS[id].name}记录已规范化。`);
  });
  return { repaired: notes.length > 0, notes };
}

export const OPERATIONS_API = { listOperations, getOperationState, operationCooldown, getOperationCost, canDispatchOperation, sanitizeOperations };
