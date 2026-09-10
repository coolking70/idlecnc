/**
 * equipment.js —— 装备库存、挂载与存档边界。
 *
 * 装备只改写 state.equipment。它不写单位战斗属性、不写编队、不写战报，
 * 正式战斗所需的装备数据由 theater.buildDispatchSnapshot() 固化后才会进入
 * battle session。这样生产侧变更天然不会污染运行中战斗或历史回放。
 */

import {
  EQUIPMENT, EQUIPMENT_RULES, EQUIPMENT_STAT_KEYS,
  FORMATION_STATUS, TECHNOLOGIES, SALVAGE_RULES
} from './config.js';
import { safeNumber } from './utils.js';

function cloneJson(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (err) { return null; }
}

function equipmentStateOf(source) {
  if (!source || typeof source !== 'object') return null;
  return source.equipment && typeof source.equipment === 'object' ? source.equipment : source;
}

export function roundEquipmentNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(EQUIPMENT_RULES.roundingDigits));
}

export function createInitialEquipmentState() {
  const starter = Object.values(EQUIPMENT).slice(0, EQUIPMENT_RULES.starterInventory);
  return {
    inventory: starter.map((def, index) => ({
      id: `equipment-starter-${index + 1}`,
      equipmentId: def.id,
      quantity: 1,
      acquiredAt: 0,
      acquisition: cloneJson(def.acquisition),
      provenance: { kind: 'starter' }
    })),
    bindings: {},
    salvageClaims: {}
  };
}

export function emptyEquipmentState() {
  return { inventory: [], bindings: {}, salvageClaims: {} };
}

export function isSalvageInstanceId(id) {
  return typeof id === 'string' && id.startsWith(`${SALVAGE_RULES.instanceNamespace}-`);
}

/** 只返回可由装甲工厂制造的装备定义，顺序由 config 的声明顺序决定。 */
export function getEquipmentProductionDefinitions() {
  return Object.values(EQUIPMENT).filter((def) => def && def.acquisition?.kind === 'production');
}

/** 各装备的库存实例数；挂载不会从库存删除，生产完成才增加实例。 */
export function equipmentInventoryCounts(stateOrEquipment) {
  const equipment = equipmentStateOf(stateOrEquipment);
  const counts = {};
  (Array.isArray(equipment?.inventory) ? equipment.inventory : []).forEach((instance) => {
    if (!instance || !getEquipmentDefinition(instance.equipmentId) || instance.quantity !== 1) return;
    counts[instance.equipmentId] = (counts[instance.equipmentId] || 0) + 1;
  });
  return counts;
}

/**
 * 生产完成时生成装备实例。ID 不依赖墙上时钟或随机数：取该装备最小可用序号，
 * 并使用独立的 production 前缀，保证绝不与三个 starter ID 冲突。
 */
export function createEquipmentInstance(stateOrEquipment, equipmentId, acquiredAt = 0) {
  const equipment = equipmentStateOf(stateOrEquipment);
  const def = getEquipmentDefinition(equipmentId);
  if (!equipment || !def || def.acquisition?.kind !== 'production') return null;
  if (!Array.isArray(equipment.inventory)) equipment.inventory = [];
  let serial = 1;
  let id = `equipment-production-${equipmentId}-${serial}`;
  const used = new Set(equipment.inventory.map((item) => item && item.id).filter(Boolean));
  while (used.has(id)) {
    serial += 1;
    id = `equipment-production-${equipmentId}-${serial}`;
  }
  return {
    id,
    equipmentId: def.id,
    quantity: 1,
    acquiredAt: Math.max(0, safeNumber(acquiredAt, 0)),
    acquisition: cloneJson(def.acquisition),
    provenance: { kind: 'production' }
  };
}

export function addEquipmentInstance(state, equipmentId, acquiredAt = 0) {
  if (!state || typeof state !== 'object') return null;
  if (!state.equipment || typeof state.equipment !== 'object') state.equipment = emptyEquipmentState();
  const instance = createEquipmentInstance(state.equipment, equipmentId, acquiredAt);
  if (!instance) return null;
  state.equipment.inventory.push(instance);
  return instance;
}

/**
 * Salvage 实例的 ID 与来源由 salvage 模块预先确定；这里仅负责构造实例，
 * 不读取当前库存最大编号，也不产生时间/随机性。
 */
export function createSalvageEquipmentInstance(equipmentId, instanceId, acquiredAt = 0, provenance = {}) {
  const def = getEquipmentDefinition(equipmentId);
  if (!def || def.acquisition?.kind !== 'production' || !isSalvageInstanceId(instanceId)) return null;
  return {
    id: instanceId,
    equipmentId: def.id,
    quantity: 1,
    acquiredAt: Math.max(0, safeNumber(acquiredAt, 0)),
    acquisition: cloneJson(def.acquisition),
    provenance: cloneJson({ ...provenance, kind: 'battle_salvage' })
  };
}

export function getEquipmentDefinition(equipmentId) {
  return equipmentId && EQUIPMENT[equipmentId] ? EQUIPMENT[equipmentId] : null;
}

export function getEquipmentInstance(stateOrEquipment, instanceId) {
  const equipment = equipmentStateOf(stateOrEquipment);
  if (!equipment || !Array.isArray(equipment.inventory)) return null;
  return equipment.inventory.find((item) => item && item.id === instanceId) || null;
}

export function getUnitEquipment(stateOrEquipment, unitId) {
  const equipment = equipmentStateOf(stateOrEquipment);
  if (!equipment || !equipment.bindings || typeof equipment.bindings !== 'object') return [];
  const ids = Array.isArray(equipment.bindings[unitId]) ? equipment.bindings[unitId] : [];
  return ids.map((instanceId, slotIndex) => {
    const instance = getEquipmentInstance(equipment, instanceId);
    const def = instance && getEquipmentDefinition(instance.equipmentId);
    if (!instance || !def) return null;
    return {
      instanceId: instance.id,
      equipmentId: def.id,
      name: def.name,
      slot: def.slot,
      slotIndex,
      modifiers: { ...def.modifiers },
      desc: def.desc
    };
  }).filter(Boolean);
}

export function getEquipmentComposition(stateOrEquipment, unitIds = []) {
  const result = {};
  (Array.isArray(unitIds) ? unitIds : []).forEach((unitId) => {
    result[unitId] = getUnitEquipment(stateOrEquipment, unitId).map((item) => cloneJson(item));
  });
  return result;
}

export function equipmentModifiersFor(unit, stateOrEquipment) {
  const equipment = getUnitEquipment(stateOrEquipment, unit && unit.id);
  const modifiers = {};
  equipment.forEach((item) => {
    EQUIPMENT_STAT_KEYS.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(item.modifiers, key)) return;
      const modifier = Number(item.modifiers[key]);
      if (!Number.isFinite(modifier) || modifier <= 0) return;
      modifiers[key] = roundEquipmentNumber((modifiers[key] || 1) * modifier);
    });
  });
  return { equipment, modifiers };
}

function unitById(state, unitId) {
  return state && Array.isArray(state.units)
    ? state.units.find((unit) => unit && unit.id === unitId) || null
    : null;
}

function formationForUnit(state, unitId) {
  return state && Array.isArray(state.formations)
    ? state.formations.find((formation) => Array.isArray(formation.unitIds) && formation.unitIds.includes(unitId)) || null
    : null;
}

function battleLock(state) {
  const active = state && state.activeBattle;
  if (!active) return null;
  if (active.replayReadOnly === true || active.settlementAllowed === false) {
    return { code: 'replay_read_only', reason: '只读回放期间不能变更装备' };
  }
  return { code: 'battle_locked', reason: '正式战斗或结果面板期间不能变更装备' };
}

function compatible(unit, def) {
  return Boolean(unit && def && Array.isArray(def.applicableTypes) && def.applicableTypes.includes(unit.type));
}

export function canEquipEquipment(state, unitId, instanceId) {
  const equipment = equipmentStateOf(state);
  const unit = unitById(state, unitId);
  const instance = getEquipmentInstance(equipment, instanceId);
  const def = instance && getEquipmentDefinition(instance.equipmentId);
  if (!unit) return { ok: false, code: 'unknown_unit', reason: '单位不存在' };
  if (!instance || !def || instance.quantity !== 1) return { ok: false, code: 'unknown_equipment', reason: '装备实例不存在' };
  const lock = battleLock(state);
  if (lock) return { ok: false, ...lock };
  const formation = formationForUnit(state, unitId);
  if (formation && formation.status !== FORMATION_STATUS.IDLE) {
    return { ok: false, code: 'formation_locked', reason: '只有待命编队中的单位可以变更装备' };
  }
  if (!compatible(unit, def)) return { ok: false, code: 'incompatible_unit', reason: '该装备不适用于此单位类型' };
  const current = getUnitEquipment(equipment, unitId);
  if (current.some((item) => item.instanceId === instanceId)) {
    return { ok: false, code: 'already_equipped', reason: '该装备已经挂载' };
  }
  const boundElsewhere = Object.entries(equipment?.bindings || {}).some(([boundUnitId, ids]) => boundUnitId !== unitId && Array.isArray(ids) && ids.includes(instanceId));
  if (boundElsewhere) return { ok: false, code: 'equipment_bound', reason: '同一装备实例不能重复挂载' };
  if (current.length >= EQUIPMENT_RULES.maxSlotsPerUnit) {
    return { ok: false, code: 'slots_full', reason: `装备槽位已满（最多${EQUIPMENT_RULES.maxSlotsPerUnit}个）` };
  }
  return { ok: true, code: 'ready', reason: '', unit, instance, definition: def, slotIndex: current.length };
}

export function equipEquipment(state, unitId, instanceId) {
  const check = canEquipEquipment(state, unitId, instanceId);
  if (!check.ok) return { ...check, equipment: null };
  if (!state.equipment || typeof state.equipment !== 'object') state.equipment = emptyEquipmentState();
  if (!state.equipment.bindings || typeof state.equipment.bindings !== 'object') state.equipment.bindings = {};
  const current = Array.isArray(state.equipment.bindings[unitId]) ? state.equipment.bindings[unitId] : [];
  state.equipment.bindings[unitId] = current.concat(instanceId);
  return { ok: true, code: 'equipped', reason: '', equipment: getUnitEquipment(state.equipment, unitId), unit: check.unit };
}

export function canUnequipEquipment(state, unitId, instanceId) {
  const unit = unitById(state, unitId);
  if (!unit) return { ok: false, code: 'unknown_unit', reason: '单位不存在' };
  const lock = battleLock(state);
  if (lock) return { ok: false, ...lock };
  const formation = formationForUnit(state, unitId);
  if (formation && formation.status !== FORMATION_STATUS.IDLE) {
    return { ok: false, code: 'formation_locked', reason: '只有待命编队中的单位可以变更装备' };
  }
  const current = getUnitEquipment(state, unitId);
  if (!current.some((item) => item.instanceId === instanceId)) {
    return { ok: false, code: 'not_equipped', reason: '该装备未挂载' };
  }
  return { ok: true, code: 'ready', reason: '', unit };
}

export function unequipEquipment(state, unitId, instanceId) {
  const check = canUnequipEquipment(state, unitId, instanceId);
  if (!check.ok) return { ...check, equipment: null };
  const before = Array.isArray(state.equipment?.bindings?.[unitId]) ? state.equipment.bindings[unitId] : [];
  const next = before.filter((id) => id !== instanceId);
  if (next.length) state.equipment.bindings[unitId] = next;
  else if (state.equipment?.bindings) delete state.equipment.bindings[unitId];
  return { ok: true, code: 'unequipped', reason: '', equipment: getUnitEquipment(state.equipment, unitId), unit: check.unit };
}

function validModifierMap(def) {
  if (!def || !def.modifiers || typeof def.modifiers !== 'object') return false;
  if (Object.keys(def.modifiers).some((key) => !EQUIPMENT_STAT_KEYS.includes(key))) return false;
  return EQUIPMENT_STAT_KEYS.every((key) => {
    if (!Object.prototype.hasOwnProperty.call(def.modifiers, key)) return true;
    const value = Number(def.modifiers[key]);
    return Number.isFinite(value) && value > 0;
  });
}

function validProductionAcquisition(def) {
  const acquisition = def && def.acquisition;
  if (!acquisition || acquisition.kind !== 'production') return true;
  if (typeof acquisition.building !== 'string' || !acquisition.building) return false;
  if (!acquisition.cost || typeof acquisition.cost !== 'object' || Array.isArray(acquisition.cost)) return false;
  if (Object.keys(acquisition.cost).some((key) => !['supply', 'alloy', 'intel'].includes(key)
    || !Number.isFinite(Number(acquisition.cost[key])) || Number(acquisition.cost[key]) < 0)) return false;
  if (!(Number(acquisition.buildTime) > 0) || !Number.isFinite(Number(acquisition.buildTime))) return false;
  const requires = Array.isArray(def.requiresTech) ? def.requiresTech : (def.requiresTech ? [def.requiresTech] : []);
  return requires.every((id) => typeof id === 'string' && Boolean(TECHNOLOGIES[id]));
}

/**
 * 存档清洗的 fail-closed 规则：
 * 1. 先清洗库存实例（合法 definition、唯一 ID、quantity 必须为 1）；
 * 2. 再按已清洗单位表校验绑定的 unitId；
 * 3. 最后校验实例存在性、适用类型、槽位上限和实例唯一归属。
 * 因而“装备→已删除单位”和“单位→不存在装备”两种悬空方向都会被丢弃。
 */
export function sanitizeEquipment(state) {
  const notes = [];
  if (!state || typeof state !== 'object') return { repaired: false, notes };
  const source = state.equipment;
  if (!source || typeof source !== 'object') {
    state.equipment = emptyEquipmentState();
    return { repaired: true, notes: ['装备字段缺失，已补齐为空库存。'] };
  }

  const inventory = Array.isArray(source.inventory) ? source.inventory : [];
  const inventoryIdCounts = inventory.reduce((counts, instance) => {
    if (instance && typeof instance.id === 'string' && instance.id) counts[instance.id] = (counts[instance.id] || 0) + 1;
    return counts;
  }, {});
  const ids = new Set();
  state.equipment.inventory = inventory.filter((instance) => {
    const def = instance && getEquipmentDefinition(instance.equipmentId);
    const valid = instance && typeof instance === 'object'
      && typeof instance.id === 'string' && instance.id
      && inventoryIdCounts[instance.id] === 1
      && !ids.has(instance.id)
      && Boolean(def) && validModifierMap(def)
      && validProductionAcquisition(def)
      && Number(instance.quantity) === 1;
    if (!valid) { notes.push('非法、重复或数量异常的装备实例已移除。'); return false; }
    ids.add(instance.id);
    instance.quantity = 1;
    instance.acquiredAt = Math.max(0, safeNumber(instance.acquiredAt, 0));
    instance.acquisition = cloneJson(def.acquisition) || null;
    if (!instance.provenance || typeof instance.provenance !== 'object') {
      instance.provenance = String(instance.id).startsWith('equipment-starter-')
        ? { kind: 'starter' }
        : isSalvageInstanceId(instance.id)
          ? { kind: 'battle_salvage', salvageId: null }
          : { kind: 'production' };
    }
    if (instance.provenance && !['starter', 'production', 'battle_salvage'].includes(instance.provenance.kind)) {
      instance.provenance = null;
    }
    return true;
  });

  const units = new Map((Array.isArray(state.units) ? state.units : []).map((unit) => [unit && unit.id, unit]));
  const bindings = source.bindings && typeof source.bindings === 'object' && !Array.isArray(source.bindings)
    ? source.bindings : {};
  const seen = new Set();
  const normalized = {};
  Object.entries(bindings).forEach(([unitId, rawIds]) => {
    const unit = units.get(unitId);
    if (!unit || !Array.isArray(rawIds)) { notes.push('悬空装备绑定已移除。'); return; }
    const accepted = [];
    rawIds.slice(0, EQUIPMENT_RULES.maxSlotsPerUnit).forEach((instanceId) => {
      const instance = state.equipment.inventory.find((item) => item.id === instanceId);
      const def = instance && getEquipmentDefinition(instance.equipmentId);
      if (!instance || !def || !compatible(unit, def) || seen.has(instanceId)) {
        notes.push('不适用、悬空或重复装备绑定已移除。');
        return;
      }
      seen.add(instanceId);
      accepted.push(instanceId);
    });
    if (Array.isArray(rawIds) && rawIds.length > EQUIPMENT_RULES.maxSlotsPerUnit) notes.push('超出装备槽位上限的绑定已移除。');
    if (accepted.length) normalized[unitId] = accepted;
  });
  if (JSON.stringify(source.bindings || {}) !== JSON.stringify(normalized)) notes.push('装备绑定已规范化。');
  state.equipment.bindings = normalized;
  if (!source.salvageClaims || typeof source.salvageClaims !== 'object' || Array.isArray(source.salvageClaims)) {
    state.equipment.salvageClaims = {};
  } else {
    state.equipment.salvageClaims = source.salvageClaims;
  }
  return { repaired: notes.length > 0, notes };
}

export const EQUIPMENT_API = {
  createInitialEquipmentState, emptyEquipmentState, getEquipmentDefinition,
  getEquipmentProductionDefinitions, equipmentInventoryCounts, createEquipmentInstance, addEquipmentInstance,
  createSalvageEquipmentInstance,
  isSalvageInstanceId,
  getEquipmentInstance, getUnitEquipment, getEquipmentComposition,
  equipmentModifiersFor, canEquipEquipment, equipEquipment,
  canUnequipEquipment, unequipEquipment, sanitizeEquipment,
  roundEquipmentNumber
};
