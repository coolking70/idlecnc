/**
 * formations.js —— 编队系统（阶段4主体）
 *
 * 设计要点：
 *  - 玩家不能操作单个单位，只能通过编队下达任务；
 *  - 同一个单位不能同时属于两个编队；
 *  - 编队指挥占用不能超过基地剩余指挥容量；
 *  - 库存单位不占用指挥容量，只有正式加入编队的单位才占用；
 *  - 本模块只做数据与规则，不触碰 DOM / Canvas，只通过事件总线广播变化。
 *
 * 所有会改变状态的接口统一返回结果对象：
 *   { ok:boolean, code:string, reason:string, formation:object|null, ...extra }
 */

import {
  UNITS, BUILDINGS, BUILDING_STATUS, DAMAGE_STATES,
  FORMATION, FORMATION_STATUS, FORMATION_STATUS_LABEL,
  FORMATION_PRESETS, FORMATION_WARNINGS
} from './config.js';
import { recalcDerived } from './economy.js';
import { logEvent, emit, LOG_LEVEL } from './events.js';
import { uid, safeNumber } from './utils.js';
import { damageStateOfUnit } from './unit-status.js';

/* ============================================================
 * 结果码与结果对象
 * ========================================================== */

export const FORMATION_CODE = {
  OK: 'ok',
  LIMIT_REACHED: 'limit_reached',
  NAME_INVALID: 'name_invalid',
  NOT_FOUND: 'not_found',
  NOT_IDLE: 'not_idle',
  UNIT_INVALID: 'unit_invalid',
  UNIT_ASSIGNED: 'unit_assigned',
  UNIT_NOT_READY: 'unit_not_ready',
  UNIT_REPAIRING: 'unit_repairing',
  ALREADY_MEMBER: 'already_member',
  NOT_MEMBER: 'not_member',
  CAPACITY: 'capacity',
  PRESET_UNKNOWN: 'preset_unknown',
  INSUFFICIENT: 'insufficient_inventory',
  STATE_INVALID: 'state_invalid'
};

const R = FORMATION.reasons;
const M = FORMATION.messages;

function fail(code, reason, extra = {}) {
  return { ok: false, code, reason: String(reason || ''), formation: null, ...extra };
}

function pass(extra = {}) {
  return { ok: true, code: FORMATION_CODE.OK, reason: '', formation: null, ...extra };
}

/* ============================================================
 * 内部工具
 * ========================================================== */

/** 有效的编队状态集合 */
const VALID_STATUS = new Set(Object.values(FORMATION_STATUS));

/** 单位排序：createdAt 升序 → ID 升序（保证选取结果确定、可复现） */
function compareUnits(a, b) {
  const ca = safeNumber(a && a.createdAt, 0);
  const cb = safeNumber(b && b.createdAt, 0);
  if (ca !== cb) return ca - cb;
  const ia = String(a && a.id);
  const ib = String(b && b.id);
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

/** 编队解析：接受编队对象或编队 ID */
export function resolveFormation(state, formationOrId) {
  if (!state || !Array.isArray(state.formations)) return null;
  if (formationOrId && typeof formationOrId === 'object') {
    return state.formations.includes(formationOrId) ? formationOrId : null;
  }
  const id = String(formationOrId || '');
  if (!id) return null;
  return state.formations.find((f) => f && f.id === id) || null;
}

/** 单位解析 */
function findUnit(state, unitId) {
  if (!state || !Array.isArray(state.units)) return null;
  return state.units.find((u) => u && u.id === unitId) || null;
}

/** 编队是否可编辑（阶段4只有待命状态可编辑） */
export function isEditable(formation) {
  if (!formation) return false;
  return FORMATION.editableStatuses.includes(formation.status);
}

/** 单位显示名 */
function unitName(unit) {
  const def = unit && UNITS[unit.type];
  return def ? def.name : '未知单位';
}

/** 剩余指挥容量 */
export function getFreeCommand(state) {
  const cmd = (state && state.command) || {};
  return safeNumber(cmd.capacity, 0) - safeNumber(cmd.used, 0);
}

/** 生成默认编队名：第一战斗群 / 第二战斗群 …（跳过已占用的名字） */
export function nextDefaultName(state) {
  const used = new Set((state && state.formations ? state.formations : []).map((f) => f && f.name));
  const ordinals = FORMATION.nameOrdinals || [];
  for (let i = 0; i < ordinals.length; i += 1) {
    const candidate = `${ordinals[i]}${FORMATION.defaultPrefix}`;
    if (!used.has(candidate)) return candidate;
  }
  let n = ordinals.length + 1;
  while (used.has(`${FORMATION.defaultPrefix}${n}`)) n += 1;
  return `${FORMATION.defaultPrefix}${n}`;
}

/** 名称规范化：去首尾空格 + 截断到上限；返回空串表示非法 */
export function normalizeName(name) {
  const text = String(name === null || name === undefined ? '' : name).trim();
  if (!text) return '';
  return text.slice(0, safeNumber(FORMATION.maxNameLength, 20));
}

/** 内部：仅创建编队对象并入列（不写日志，供预设复用） */
function spawnFormation(state, name) {
  const formation = {
    id: uid('fm'),
    name,
    unitIds: [],
    status: FORMATION_STATUS.IDLE,
    strategy: null,
    theaterId: null,
    experience: 0,
    battles: 0,
    createdAt: Date.now()
  };
  state.formations.push(formation);
  return formation;
}

/** 内部：直接建立归属关系（调用前必须已完成全部校验） */
function attachUnit(formation, unit) {
  unit.formationId = formation.id;
  unit.status = 'assigned';
  formation.unitIds.push(unit.id);
}

/** 内部：解除归属关系 */
function detachUnit(unit) {
  if (!unit) return;
  unit.formationId = null;
  unit.status = 'ready';
}

/* ============================================================
 * 创建 / 重命名 / 解散
 * ========================================================== */

/** 是否还能新建编队 */
export function canCreateFormation(state) {
  if (!state || !Array.isArray(state.formations)) {
    return fail(FORMATION_CODE.STATE_INVALID, '状态数据异常');
  }
  const max = safeNumber(FORMATION.maxFormations, 6);
  if (state.formations.length >= max) {
    return fail(FORMATION_CODE.LIMIT_REACHED, R.limitReached(max), { max });
  }
  return pass({ max });
}

/**
 * 创建空编队
 * @param {object} state
 * @param {string} [name] 不传时自动生成“第N战斗群”
 */
export function createFormation(state, name) {
  const can = canCreateFormation(state);
  if (!can.ok) return can;

  let finalName;
  if (name === undefined || name === null) {
    finalName = nextDefaultName(state);
  } else {
    finalName = normalizeName(name);
    if (!finalName) return fail(FORMATION_CODE.NAME_INVALID, R.nameInvalid);
  }

  const formation = spawnFormation(state, finalName);
  logEvent(state, M.created(formation.name), LOG_LEVEL.INFO);
  emit('formation:created', { formationId: formation.id, name: formation.name });
  emit('formation:changed', { formationId: formation.id, kind: 'created' });
  return pass({ formation });
}

/** 重命名编队 */
export function renameFormation(state, formationId, name) {
  const formation = resolveFormation(state, formationId);
  if (!formation) return fail(FORMATION_CODE.NOT_FOUND, R.notFound);
  if (!isEditable(formation)) return fail(FORMATION_CODE.NOT_IDLE, R.notIdle, { formation });

  const finalName = normalizeName(name);
  if (!finalName) return fail(FORMATION_CODE.NAME_INVALID, R.nameInvalid, { formation });
  if (finalName === formation.name) return pass({ formation, unchanged: true });

  const previous = formation.name;
  formation.name = finalName;
  logEvent(state, M.renamed(previous, finalName), LOG_LEVEL.INFO);
  emit('formation:renamed', { formationId: formation.id, name: finalName, previous });
  emit('formation:changed', { formationId: formation.id, kind: 'renamed' });
  return pass({ formation });
}

/** 解散编队：成员全部返回库存并释放指挥容量 */
export function disbandFormation(state, formationId) {
  const formation = resolveFormation(state, formationId);
  if (!formation) return fail(FORMATION_CODE.NOT_FOUND, R.notFound);
  if (!isEditable(formation)) return fail(FORMATION_CODE.NOT_IDLE, R.notIdle, { formation });

  const unitIds = formation.unitIds.slice();
  unitIds.forEach((unitId) => detachUnit(findUnit(state, unitId)));

  const idx = state.formations.indexOf(formation);
  if (idx >= 0) state.formations.splice(idx, 1);
  formation.unitIds = [];

  recalcDerived(state);
  logEvent(state, M.disbanded(formation.name, unitIds.length), LOG_LEVEL.WARN);
  emit('formation:disbanded', { formationId: formation.id, name: formation.name, unitIds });
  emit('formation:changed', { formationId: formation.id, kind: 'disbanded' });
  return pass({ formation, released: unitIds.length });
}

/* ============================================================
 * 成员管理
 * ========================================================== */

/** 判断单位能否加入指定编队（不修改任何状态） */
export function canAddUnit(state, formationId, unitId) {
  const formation = resolveFormation(state, formationId);
  if (!formation) return fail(FORMATION_CODE.NOT_FOUND, R.notFound);
  if (!isEditable(formation)) return fail(FORMATION_CODE.NOT_IDLE, R.notIdle, { formation });

  const unit = findUnit(state, unitId);
  if (!unit) return fail(FORMATION_CODE.UNIT_INVALID, R.unitInvalid, { formation });
  const def = UNITS[unit.type];
  if (!def) return fail(FORMATION_CODE.UNIT_INVALID, R.unitInvalid, { formation });

  // 单向损坏关系（unitIds 含该单位但 formationId 为 null）会触发重复加入；
  // 必须先在编队层面拦截，避免重复写入 ID / 重复占用指挥容量。
  if (formation.unitIds.includes(unitId)) {
    return fail(FORMATION_CODE.ALREADY_MEMBER, R.alreadyMember, { formation, unitId });
  }

  if (unit.formationId !== null && unit.formationId !== undefined) {
    return fail(FORMATION_CODE.UNIT_ASSIGNED, R.unitAssigned, { formation });
  }
  if (unit.status === 'repairing') {
    return fail(FORMATION_CODE.UNIT_REPAIRING, R.unitRepairing, { formation });
  }
  if (unit.status !== 'ready') {
    return fail(FORMATION_CODE.UNIT_NOT_READY, R.unitNotReady, { formation });
  }

  const cost = safeNumber(def.command, 0);
  const free = getFreeCommand(state);
  if (cost > free) {
    return fail(FORMATION_CODE.CAPACITY, R.capacity(cost, free), { formation, cost, free });
  }
  return pass({ formation, cost, free });
}

/** 把库存单位加入编队 */
export function addUnit(state, formationId, unitId) {
  const check = canAddUnit(state, formationId, unitId);
  if (!check.ok) return check;

  const formation = check.formation;
  const unit = findUnit(state, unitId);
  attachUnit(formation, unit);
  recalcDerived(state);

  const free = getFreeCommand(state);
  logEvent(state, M.addedCapacity(unitName(unit), formation.name, free), LOG_LEVEL.INFO);
  emit('formation:unitAdded', {
    formationId: formation.id, formationName: formation.name,
    unitId: unit.id, unitType: unit.type
  });
  emit('formation:changed', { formationId: formation.id, kind: 'unitAdded' });
  return pass({ formation, free, unitId: unit.id, unitName: unitName(unit) });
}

/** 从编队移除单位，单位返回库存 */
export function removeUnit(state, formationId, unitId) {
  const formation = resolveFormation(state, formationId);
  if (!formation) return fail(FORMATION_CODE.NOT_FOUND, R.notFound);
  if (!isEditable(formation)) return fail(FORMATION_CODE.NOT_IDLE, R.notIdle, { formation });

  const pos = formation.unitIds.indexOf(unitId);
  if (pos < 0) return fail(FORMATION_CODE.NOT_MEMBER, '该单位不在此编队中', { formation });

  formation.unitIds.splice(pos, 1);
  const unit = findUnit(state, unitId);
  const label = unitName(unit);
  detachUnit(unit);
  recalcDerived(state);

  logEvent(state, M.removed(label, formation.name), LOG_LEVEL.INFO);
  emit('formation:unitRemoved', {
    formationId: formation.id, formationName: formation.name,
    unitId, unitType: unit ? unit.type : null
  });
  emit('formation:changed', { formationId: formation.id, kind: 'unitRemoved' });
  return pass({ formation, free: getFreeCommand(state), unitId, unitName: label });
}

/* ============================================================
 * 查询
 * ========================================================== */

/**
 * 可加入编队的库存单位（未编入任何编队且状态为 ready）
 * @param {string} [typeId] 传入时只返回该类型
 * @returns {object[]} 按 createdAt → ID 升序（确定性）
 */
export function getAvailableUnits(state, typeId) {
  if (!state || !Array.isArray(state.units)) return [];
  return state.units
    .filter((u) => u && !u.formationId && u.status === 'ready' && UNITS[u.type])
    .filter((u) => (typeId ? u.type === typeId : true))
    .sort(compareUnits);
}

/** 编队汇总属性（界面与阶段5战斗共用，避免重复实现） */
export function getFormationStats(state, formationOrId) {
  const stats = {
    count: 0, command: 0,
    hp: 0, maxHp: 0, avgHp: 0,
    attack: 0, antiArmor: 0, defense: 0, scouting: 0, repair: 0,
    mobility: 0, avgMobility: 0,
    upkeep: 0,
    byType: {}, byCategory: {}
  };
  const formation = resolveFormation(state, formationOrId)
    || (formationOrId && typeof formationOrId === 'object' && Array.isArray(formationOrId.unitIds)
      ? formationOrId : null);
  if (!formation) return stats;

  (formation.unitIds || []).forEach((unitId) => {
    const unit = findUnit(state, unitId);
    const def = unit && UNITS[unit.type];
    if (!def) return;
    const s = def.stats || {};
    stats.count += 1;
    stats.command += safeNumber(def.command, 0);
    stats.attack += safeNumber(s.attack, 0);
    stats.antiArmor += safeNumber(s.antiArmor, 0);
    stats.defense += safeNumber(s.defense, 0);
    stats.scouting += safeNumber(s.scouting, 0);
    stats.repair += safeNumber(s.repair, 0);
    stats.mobility += safeNumber(s.mobility, 0);
    stats.upkeep += safeNumber(def.upkeep, 0);
    stats.hp += safeNumber(unit.hp, 0);
    stats.maxHp += safeNumber(unit.maxHp, safeNumber(s.hp, 0));
    stats.byType[unit.type] = (stats.byType[unit.type] || 0) + 1;
    stats.byCategory[def.category] = (stats.byCategory[def.category] || 0) + 1;
  });

  stats.avgHp = stats.maxHp > 0 ? stats.hp / stats.maxHp : 0;
  stats.avgMobility = stats.count > 0 ? stats.mobility / stats.count : 0;
  return stats;
}

/** 编队占用的指挥容量 */
export function getFormationCommandCost(state, formationOrId) {
  return getFormationStats(state, formationOrId).command;
}

/** 预设模板需要的指挥容量（按配置数量静态计算） */
export function getPresetCommandCost(presetId) {
  const preset = FORMATION_PRESETS.find((p) => p.id === presetId);
  if (!preset) return 0;
  return Object.keys(preset.units).reduce((sum, type) => {
    const def = UNITS[type];
    return sum + (def ? safeNumber(def.command, 0) * safeNumber(preset.units[type], 0) : 0);
  }, 0);
}

/**
 * 编队评估提示（只给建议，不改变任何属性）
 * @returns {string[]}
 */
export function getFormationWarnings(state, formationOrId) {
  const formation = resolveFormation(state, formationOrId)
    || (formationOrId && typeof formationOrId === 'object' && Array.isArray(formationOrId.unitIds)
      ? formationOrId : null);
  const msg = FORMATION_WARNINGS.messages;
  if (!formation) return [];

  const stats = getFormationStats(state, formation);
  if (stats.count === 0) return [msg.empty];

  const warnings = [];
  const armorCount = safeNumber(stats.byCategory.armor, 0);
  const infantryCount = safeNumber(stats.byCategory.infantry, 0);
  const repairCount = safeNumber(stats.byType.repair_vehicle, 0);

  if (stats.scouting < safeNumber(FORMATION_WARNINGS.scoutingLow, 8)) warnings.push(msg.scouting);
  if (armorCount > 0 && infantryCount === 0) warnings.push(msg.armorNoInfantry);
  if (armorCount > 0 && repairCount === 0) warnings.push(msg.armorNoRepair);
  if (stats.antiArmor < safeNumber(FORMATION_WARNINGS.antiArmorLow, 25)) warnings.push(msg.antiArmor);

  return warnings;
}

/** 状态中文名 */
export function statusLabel(status) {
  return FORMATION_STATUS_LABEL[status] || '未知';
}

/* ============================================================
 * 预设模板（原子操作）
 * ========================================================== */

/**
 * 预检预设模板是否可用（不修改任何状态）
 * 检查顺序：模板存在 → 编队数量 → 库存充足 → 指挥容量
 */
export function canApplyPreset(state, presetId) {
  const preset = FORMATION_PRESETS.find((p) => p.id === presetId);
  if (!preset) return fail(FORMATION_CODE.PRESET_UNKNOWN, R.presetUnknown);

  const can = canCreateFormation(state);
  if (!can.ok) return { ...can, preset };

  const missing = [];
  const picked = [];
  let need = 0;

  Object.keys(preset.units).forEach((type) => {
    const want = safeNumber(preset.units[type], 0);
    const def = UNITS[type];
    const pool = getAvailableUnits(state, type);
    if (pool.length < want) {
      missing.push({ type, name: def ? def.name : type, lack: want - pool.length });
    }
    const take = pool.slice(0, want);
    take.forEach((u) => {
      picked.push(u.id);
      need += def ? safeNumber(def.command, 0) : 0;
    });
  });

  if (missing.length > 0) {
    const list = missing.map((m) => `${m.name}缺少${m.lack}`).join('，');
    return fail(FORMATION_CODE.INSUFFICIENT, R.insufficientInventory(list), { preset, missing });
  }

  const free = getFreeCommand(state);
  if (need > free) {
    return fail(FORMATION_CODE.CAPACITY, R.presetCapacity(need, free), { preset, need, free });
  }

  return pass({ preset, unitIds: picked, need, free, missing: [] });
}

/**
 * 按预设模板一次性组建编队。
 * 原子性：全部预检通过后才创建编队并编入单位；任何一项不满足都不会产生副作用。
 */
export function applyPreset(state, presetId) {
  const check = canApplyPreset(state, presetId);
  if (!check.ok) return check;

  const preset = check.preset;
  const formation = spawnFormation(state, normalizeName(preset.name) || nextDefaultName(state));

  check.unitIds.forEach((unitId) => {
    const unit = findUnit(state, unitId);
    if (unit) attachUnit(formation, unit);
  });
  recalcDerived(state);

  logEvent(state, M.presetDone(preset.name), LOG_LEVEL.GOOD);
  emit('formation:created', { formationId: formation.id, name: formation.name, presetId: preset.id });
  check.unitIds.forEach((unitId) => {
    const unit = findUnit(state, unitId);
    emit('formation:unitAdded', {
      formationId: formation.id, formationName: formation.name,
      unitId, unitType: unit ? unit.type : null
    });
  });
  emit('formation:changed', { formationId: formation.id, kind: 'preset' });

  return pass({ formation, unitIds: check.unitIds.slice(), preset });
}

/** 修改编队状态（阶段5战区派遣使用，阶段4只会被容错逻辑复位） */
export function setStatus(state, formationId, status) {
  const formation = resolveFormation(state, formationId);
  if (!formation) return fail(FORMATION_CODE.NOT_FOUND, R.notFound);
  if (!VALID_STATUS.has(status)) return fail(FORMATION_CODE.STATE_INVALID, '未知编队状态', { formation });
  formation.status = status;
  emit('formation:changed', { formationId: formation.id, kind: 'status' });
  return pass({ formation });
}

/* ============================================================
 * 存档容错
 * ========================================================== */

/** 依据已建成建筑计算指挥容量（不依赖存档里的 command 字段） */
function computeCapacity(state) {
  let capacity = 0;
  (state && Array.isArray(state.buildings) ? state.buildings : []).forEach((b) => {
    const def = b && BUILDINGS[b.type];
    if (!def) return;
    if (b.status !== BUILDING_STATUS.OPERATIONAL) return;
    capacity += safeNumber((def.effects || {}).commandCapacity, 0);
  });
  return capacity;
}

/**
 * 编队数据容错（读档时调用，必须在 sanitizeProduction 之后）
 *
 * 检查项：
 *  1. 基本结构：数组 / 对象 / ID / 名称 / unitIds / 状态 / 数值字段；
 *  2. 单位存在性：unitIds 里不存在的单位 ID 一律剔除；
 *  3. 双向归属：单位只能属于一支编队，unit.formationId 与 unitIds 必须一致；
 *  4. 非法状态：阶段4没有战区，一律复位为 idle 并清空 strategy / theaterId；
 *  5. 编队数量与指挥容量超限：按确定性顺序移除多余成员 / 多余编队；
 *  6. 返回修复提示，供界面提示玩家。
 *
 * @returns {{repaired:boolean, notes:string[]}}
 */
/**
 * 编队数据容错（读档时调用，必须在 sanitizeProduction 之后）
 *
 * 检查项：
 *  1. 基本结构：数组 / 对象 / ID / 名称 / unitIds / 状态 / 数值字段；
 *  2. 单位存在性：unitIds 里不存在的单位 ID 一律剔除；
 *  3. 双向归属：单位只能属于一支编队，unit.formationId 与 unitIds 必须一致；
 *  4. 非法状态：非待命且非活动战斗的编队一律复位为 idle 并清空 strategy / theaterId；
 *  5. 维修中 / 已摧毁单位：不允许被任何编队引用，也不强制恢复为 assigned；
 *  6. 编队数量与指挥容量超限：按确定性顺序移除多余成员 / 多余编队；
 *  7. 与活动战斗协调：options.activeFormationId 指向的编队保持 fighting，
 *     其 strategy / theaterId 与活动战斗一致，成员状态恢复 deployed。
 *
 * @param {object} saveState
 * @param {{activeFormationId?:string}} [options] 当前活动战斗所属编队 ID
 * @returns {{repaired:boolean, notes:string[]}}
 */
export function sanitizeFormations(saveState, options = {}) {
  const notes = [];
  if (!saveState || typeof saveState !== 'object') return { repaired: false, notes };

  if (!Array.isArray(saveState.formations)) {
    if (saveState.formations !== undefined && saveState.formations !== null) notes.push('编队数据非法，已重置');
    saveState.formations = [];
  }
  if (!Array.isArray(saveState.units)) saveState.units = [];

  const maxFormations = safeNumber(FORMATION.maxFormations, 6);
  const maxNameLength = safeNumber(FORMATION.maxNameLength, 20);
  const activeFormationId = (options && options.activeFormationId) || null;
  const unitById = new Map();
  saveState.units.forEach((u) => { if (u && u.id) unitById.set(u.id, u); });

  const isDestroyed = (u) => !u || damageStateOfUnit(u) === DAMAGE_STATES.DESTROYED;

  /* --- 1. 基本结构 --- */
  const seenIds = new Set();
  const kept = [];
  saveState.formations.forEach((f) => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) { notes.push('编队格式非法，已移除'); return; }

    if (!f.id || typeof f.id !== 'string') { f.id = uid('fm'); notes.push('编队缺少ID，已重新生成'); }
    if (seenIds.has(f.id)) { f.id = uid('fm'); notes.push('编队ID重复，已重新生成'); }
    seenIds.add(f.id);

    if (typeof f.name !== 'string' || !f.name.trim()) {
      f.name = `${FORMATION.defaultPrefix}${kept.length + 1}`;
      notes.push('编队名称非法，已使用默认名');
    } else if (f.name.length > maxNameLength) {
      f.name = f.name.trim().slice(0, maxNameLength);
      notes.push('编队名称过长，已截断');
    } else {
      f.name = f.name.trim();
    }

    if (!Array.isArray(f.unitIds)) { f.unitIds = []; notes.push('编队成员列表非法，已清空'); }

    if (!VALID_STATUS.has(f.status)) { f.status = FORMATION_STATUS.IDLE; notes.push('编队状态非法，已复位为待命'); }
    // 与活动战斗协调：指定的活动编队保持 fighting，其余非待命一律复位
    if (f.status !== FORMATION_STATUS.IDLE) {
      if (f.id === activeFormationId) {
        if (f.status !== FORMATION_STATUS.FIGHTING) {
          f.status = FORMATION_STATUS.FIGHTING;
          notes.push('活动编队状态已恢复为战斗');
        }
        // 保留 strategy / theaterId（派遣时写入，与活动战斗一致）
      } else {
        f.status = FORMATION_STATUS.IDLE;
        notes.push('编队处于未开放的状态，已复位为待命');
        if (f.strategy !== null && f.strategy !== undefined) { f.strategy = null; notes.push('编队作战策略尚未开放，已清空'); }
        if (f.theaterId !== null && f.theaterId !== undefined) { f.theaterId = null; notes.push('编队战区归属尚未开放，已清空'); }
      }
    }
    if (f.strategy !== null && f.strategy !== undefined && f.id !== activeFormationId) {
      f.strategy = null; notes.push('编队作战策略尚未开放，已清空');
    }
    if (f.theaterId !== null && f.theaterId !== undefined && f.id !== activeFormationId) {
      f.theaterId = null; notes.push('编队战区归属尚未开放，已清空');
    }

    f.experience = Number.isFinite(Number(f.experience)) && Number(f.experience) >= 0 ? Number(f.experience) : 0;
    f.battles = Number.isFinite(Number(f.battles)) && Number(f.battles) >= 0 ? Math.floor(Number(f.battles)) : 0;
    f.createdAt = safeNumber(f.createdAt, 0) > 0 ? safeNumber(f.createdAt, 0) : Date.now();

    kept.push(f);
  });
  saveState.formations = kept;

  /* --- 5a. 编队数量超限：从后向前移除（确定性） --- */
  if (saveState.formations.length > maxFormations) {
    const removed = saveState.formations.splice(maxFormations);
    removed.forEach((f) => {
      (f.unitIds || []).forEach((id) => detachUnit(unitById.get(id)));
    });
    notes.push(`编队数量超过上限，移除了 ${removed.length} 支`);
  }

  /* --- 2 & 3. 单位存在性 + 双向归属（一个单位只能属于一支编队） --- */
  const owner = new Map();   // unitId -> formation
  saveState.formations.forEach((f) => {
    const isActive = (f.id === activeFormationId);
    const list = [];
    f.unitIds.forEach((unitId) => {
      if (typeof unitId !== 'string' || !unitId) { notes.push('编队成员ID非法，已移除'); return; }
      const unit = unitById.get(unitId);
      if (!unit) { notes.push('编队引用了不存在的单位，已移除'); return; }
      if (owner.has(unitId)) { notes.push('同一单位被多支编队占用，已保留首支编队'); return; }
      if (list.includes(unitId)) { notes.push('编队内出现重复成员，已去重'); return; }

      // 维修中 / 已摧毁单位：不得保留在编队，也不强制恢复为 assigned
      if (isDestroyed(unit) || unit.status === 'repairing') {
        if (unit.formationId === f.id) unit.formationId = null;
        notes.push(isDestroyed(unit) ? '编队引用了已摧毁单位，已移除' : '维修中单位不可被编队引用，已移除');
        return;
      }

      owner.set(unitId, f);
      list.push(unitId);
      if (unit.formationId !== f.id) { unit.formationId = f.id; notes.push('单位归属与编队不一致，已修正'); }
      const want = isActive ? 'deployed' : 'assigned';
      if (unit.status !== want) {
        unit.status = want;
        notes.push(isActive ? '出击成员状态已恢复为 deployed' : '编队成员状态异常，已修正为在编');
      }
    });
    f.unitIds = list;
  });

  // 反向：单位声称属于某编队，但没有任何编队收录它；维修中 / 已摧毁单位保持原状态
  saveState.units.forEach((u) => {
    if (!u) return;
    if (isDestroyed(u) || u.status === 'repairing') return;
    if (u.formationId && !owner.has(u.id)) {
      u.formationId = null;
      if (u.status === 'assigned' || u.status === 'deployed') u.status = 'ready';
      notes.push('单位归属的编队不存在，已返回库存');
    } else if (!u.formationId && u.status === 'assigned') {
      u.status = 'ready';
      notes.push('未编入编队的单位状态异常，已返回库存');
    }
  });

  /* --- 5b. 指挥容量超限：从最后一支编队的末尾成员开始确定性移除 --- */
  const capacity = computeCapacity(saveState);
  const costOf = (unitId) => {
    const u = unitById.get(unitId);
    const def = u && UNITS[u.type];
    return def ? safeNumber(def.command, 0) : 0;
  };
  let used = 0;
  saveState.formations.forEach((f) => { f.unitIds.forEach((id) => { used += costOf(id); }); });

  let overflowRemoved = 0;
  for (let i = saveState.formations.length - 1; i >= 0 && used > capacity; i -= 1) {
    const f = saveState.formations[i];
    while (f.unitIds.length > 0 && used > capacity) {
      const unitId = f.unitIds.pop();
      used -= costOf(unitId);
      detachUnit(unitById.get(unitId));
      overflowRemoved += 1;
    }
  }
  if (overflowRemoved > 0) {
    notes.push(`指挥容量超出上限，${overflowRemoved}个单位已返回库存`);
  }

  // 同步派生数值（容量占用不信任存档，一律重新计算）
  saveState.command = { capacity, used };

  return { repaired: notes.length > 0, notes };
}
