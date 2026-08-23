/**
 * Stage 10-P-A command presentation models.
 *
 * This module is intentionally read-only: it translates canonical gameplay
 * state plus existing authority selectors into small UI models.  It never
 * mutates state and never performs a gameplay command.
 */

import {
  BASE_LAYOUT, BUILDINGS, BUILDING_STATUS, EQUIPMENT, RESOURCE_DEFS,
  TECHNOLOGIES, UNITS, DAMAGE_STATES, REPAIR, RESEARCH, FORMATION,
  FORMATION_PRESETS, FORMATION_STATUS, FORMATION_STATUS_LABEL, THEATERS, OPERATIONS, EQUIPMENT_RULES
} from './config.js';
import { buildableList, canBuild, getConstructionProgress } from './construction.js';
import { canQueueEquipment, canQueueUnit, getProductionProgress, inventoryCount } from './production.js';
import { equipmentInventoryCounts, getEquipmentDefinition, canEquipEquipment, getUnitEquipment } from './equipment.js';
import {
  canQueueRepair, getActiveRepairs, getQueuedRepairs, getRepairProgress,
  getRepairRemaining, getRepairCost, getRepairTime
} from './repairs.js';
import { hasResearchCenter, getResearchProgress, getTechnologyState } from './research.js';
import { getUnitRank, getRankProgress, formatUnitDisplayName, getUnitEffectiveStats } from './units.js';
import { damageStateOfUnit } from './unit-status.js';
import {
  canCreateFormation, canApplyPreset, canAddUnit, getAvailableUnits,
  getFormationStats, getFormationWarnings, getPresetCommandCost
} from './formations.js';
import {
  listTheaters, listStrategies, getTheaterIntel, hasRadar, getReports, getOperation
} from './theater.js';
import {
  getOperationalTask, describeOperationalTask, canAssignOperationalTask,
  OPERATIONAL_TASK, OPERATIONAL_TASK_TYPE
} from './tasking.js';
import { theaterPressureView, theaterTaskCounts } from './theater-pressure.js';
import { formatDuration, formatInt, safeNumber } from './utils.js';

const UNIT_IMAGES = {
  infantry: 'assets/battle/sample-assets/unit-friendly-infantry.svg',
  at_infantry: 'assets/command/unit-at.svg',
  scout_car: 'assets/command/unit-scout.svg',
  mbt: 'assets/battle/sample-assets/unit-friendly-mbt.svg',
  repair_vehicle: 'assets/command/unit-repair.svg'
};

const BUILDING_IMAGES = {
  supply_depot: 'assets/command/building-depot.svg',
  alloy_plant: 'assets/command/building-factory.svg',
  barracks: 'assets/battle/sample-assets/unit-friendly-infantry.svg',
  armor_factory: 'assets/battle/sample-assets/unit-friendly-mbt.svg',
  radar_station: 'assets/command/building-radar.svg',
  research_center: 'assets/command/building-research.svg'
};

const EQUIPMENT_IMAGES = {
  anti_armor_sights: 'assets/command/equipment-module.svg',
  command_uplink: 'assets/command/equipment-module.svg',
  mobile_repair_rig: 'assets/command/equipment-module.svg',
  reactive_armor_module: 'assets/command/equipment-module.svg',
  precision_fire_control: 'assets/command/equipment-module.svg'
};

const RESOURCE_CODES = new Set(['resource', 'power']);
const LOCK_CODES = new Set(['locked', 'prereq', 'producer_missing', 'equipment_tech_prerequisite']);

function costRows(cost = {}, state = null) {
  return Object.entries(cost)
    .filter(([, amount]) => safeNumber(amount, 0) > 0)
    .map(([key, amount]) => ({
      key,
      label: RESOURCE_DEFS[key]?.name || key,
      need: safeNumber(amount, 0),
      have: state ? safeNumber(state.resources?.[key], 0) : null,
      insufficient: state ? safeNumber(state.resources?.[key], 0) < safeNumber(amount, 0) : false
    }));
}

function costText(rows) {
  return rows.map((row) => `${row.label} ${formatInt(row.need)}`).join(' · ') || '无成本';
}

function reasonState(check, completed = false) {
  if (completed) return 'completed';
  if (check?.ok) return 'available';
  if (LOCK_CODES.has(check?.code)) return 'locked';
  if (RESOURCE_CODES.has(check?.code)) return 'insufficient';
  return 'disabled';
}

function badgesFor(state, { count = 0, progress = null, queued = false } = {}) {
  const badges = [];
  if (state === 'locked') badges.push({ label: 'LOCK', tone: 'lock' });
  if (state === 'insufficient') badges.push({ label: '!', tone: 'resource' });
  if (state === 'completed') badges.push({ label: '已建成', tone: 'complete' });
  if (queued) badges.push({ label: '队列', tone: 'queued' });
  if (count > 0) badges.push({ label: `×${count}`, tone: 'count' });
  if (progress != null) badges.push({ label: `${Math.round(progress)}%`, tone: 'progress' });
  return badges;
}

function baseModel({ id, name, image, state, check, role, cost, duration, description, inspectorRows, badges = [], progress = null, actionId = null, actionPayload = null }) {
  const reason = check?.reason || check?.reasons?.[0] || '';
  return {
    id,
    name,
    image,
    imageAlt: '',
    state,
    disabled: state !== 'available',
    locked: state === 'locked',
    progress,
    badges,
    actionId,
    ariaLabel: state === 'available' ? `${name}，点击${actionId === 'build' ? '建造' : '生产'}` : `${name}，${reason || '当前不可执行'}`,
    tooltip: {
      title: name,
      role,
      cost: costText(cost || []),
      duration: duration ? formatDuration(Math.ceil(duration)) : '',
      status: reason || (state === 'available' ? '可执行' : state === 'completed' ? '已完成' : '当前不可执行')
    },
    inspector: {
      title: name,
      eyebrow: role,
      description: description || '',
      rows: inspectorRows || [],
      actionId,
      actionPayload
    }
  };
}

function buildingEffectSummary(def) {
  const parts = [];
  const effect = def.effects || {};
  if (effect.supplyPerSec) parts.push(`补给产量 +${effect.supplyPerSec}/s`);
  if (effect.alloyPerSec) parts.push(`合金产量 +${effect.alloyPerSec}/s`);
  if (effect.supplyCap) parts.push(`补给上限 +${formatInt(effect.supplyCap)}`);
  if (effect.scouting) parts.push(`侦察 +${effect.scouting}`);
  if (effect.researchSlots) parts.push(`科研槽位 ${effect.researchSlots}`);
  const unlocks = (def.unlocks || []).map((id) => UNITS[id]?.name || id);
  if (unlocks.length) parts.push(`解锁 ${unlocks.join('、')}`);
  return parts.join('；') || '无直接数值加成';
}

export function buildConstructionTileModels(state) {
  return buildableList().map((def) => {
    const check = canBuild(state, def.id);
    const instance = (state.buildings || []).find((row) => row?.type === def.id);
    const completed = instance?.status === BUILDING_STATUS.OPERATIONAL;
    const building = instance?.status === BUILDING_STATUS.UNDER_CONSTRUCTION;
    const viewState = building ? 'active' : reasonState(check, completed);
    const costs = costRows(def.cost, state);
    const zone = BASE_LAYOUT.zones.find((row) => row.id === def.zone)?.name || '基地';
    const prerequisites = (def.requires || []).map((id) => BUILDINGS[id]?.name || id).join('、') || '无';
    const power = safeNumber(def.power?.consume, 0);
    return baseModel({
      id: `construction:${def.id}`,
      name: def.name,
      image: BUILDING_IMAGES[def.id] || 'assets/battle/sample-assets/industrial-cover.svg',
      state: viewState,
      check,
      role: `${zone} · 建设项目`,
      cost: costs,
      duration: def.buildTime,
      description: def.desc,
      actionId: check.ok ? 'build' : null,
      actionPayload: { typeId: def.id },
      progress: building ? safeNumber(instance.progress, 0) * 100 : null,
      badges: badgesFor(viewState, { progress: building ? safeNumber(instance.progress, 0) * 100 : null }),
      inspectorRows: [
        { label: '建设成本', value: costText(costs) },
        { label: '建设时间', value: formatDuration(def.buildTime) },
        { label: '电力需求', value: power > 0 ? `${power}` : '无' },
        { label: '前置', value: prerequisites },
        { label: '建成效果', value: buildingEffectSummary(def) },
        { label: '当前状态', value: check.reason || (completed ? '已建成' : building ? '施工中' : '可建造') }
      ]
    });
  });
}

export function buildCurrentConstructionModel(state) {
  const progress = getConstructionProgress(state);
  if (!progress) return null;
  const def = BUILDINGS[progress.typeId];
  return {
    id: `construction-current:${progress.buildingId}`,
    name: progress.name,
    image: BUILDING_IMAGES[progress.typeId] || 'assets/battle/sample-assets/industrial-cover.svg',
    imageAlt: '',
    state: 'active',
    disabled: true,
    locked: false,
    progress: progress.percent,
    badges: badgesFor('active', { progress: progress.percent }),
    actionId: null,
    inspectOnClick: true,
    ariaLabel: `${progress.name}，施工进度 ${progress.percent}%`,
    tooltip: { title: progress.name, role: '当前施工', cost: '', duration: `ETA ${progress.remainingText}`, status: state.time?.speed === 0 ? '已暂停' : '施工中' },
    inspector: {
      title: progress.name,
      eyebrow: '当前施工',
      description: def?.desc || '',
      rows: [
        { label: '进度', value: `${progress.percent}%` },
        { label: '已用时间', value: progress.elapsedText },
        { label: '总时间', value: formatDuration(progress.duration) },
        { label: '剩余时间', value: progress.remainingText }
      ],
      actionId: 'cancel-construction'
    }
  };
}

function unitStatsRows(def) {
  const stats = def.stats || {};
  return [
    ['攻击', stats.attack], ['反装甲', stats.antiArmor], ['防御', stats.defense],
    ['侦察', stats.scouting], ['机动', stats.mobility], ['维修', stats.repair], ['生命', stats.hp]
  ].map(([label, value]) => ({ label, value: String(value ?? '—') }));
}

export function buildUnitProductionTileModels(state) {
  const counts = inventoryCount(state);
  return Object.values(UNITS).map((def) => {
    const check = canQueueUnit(state, def.id);
    const viewState = reasonState(check);
    const costs = costRows(def.cost, state);
    const producer = BUILDINGS[def.from]?.name || def.from;
    const queued = state.production?.current?.type === def.id || (state.production?.queue || []).some((job) => job?.type === def.id);
    return baseModel({
      id: `unit:${def.id}`,
      name: def.name,
      image: UNIT_IMAGES[def.id],
      state: viewState,
      check,
      role: `${def.category === 'infantry' ? '步兵' : def.category === 'armor' ? '装甲' : def.category === 'support' ? '支援' : '车辆'} · ${producer}`,
      cost: costs,
      duration: def.buildTime,
      description: def.desc,
      actionId: check.ok ? 'produce-unit' : null,
      actionPayload: { unitType: def.id },
      badges: badgesFor(viewState, { count: safeNumber(counts[def.id], 0), queued }),
      inspectorRows: [
        { label: '生产成本', value: costText(costs) },
        { label: '生产时间', value: formatDuration(def.buildTime) },
        { label: '生产设施', value: producer },
        { label: '库存', value: String(safeNumber(counts[def.id], 0)) },
        { label: '指挥占用', value: String(def.command) },
        ...unitStatsRows(def),
        { label: '当前状态', value: check.reason || '可生产' }
      ]
    });
  });
}

function modifierText(modifiers = {}) {
  return Object.entries(modifiers).map(([key, value]) => `${key} ×${value}`).join('、') || '无';
}

export function buildEquipmentProductionTileModels(state) {
  const counts = equipmentInventoryCounts(state.equipment);
  return Object.values(EQUIPMENT).filter((def) => def.acquisition?.kind === 'production').map((def) => {
    const check = canQueueEquipment(state, def.id);
    const viewState = reasonState(check);
    const costs = costRows(def.acquisition.cost, state);
    const producer = BUILDINGS[def.acquisition.building]?.name || def.acquisition.building;
    const queued = state.production?.current?.equipmentId === def.id || (state.production?.queue || []).some((job) => job?.equipmentId === def.id);
    const applicable = (def.applicableTypes || []).map((id) => UNITS[id]?.name || id).join('、');
    return baseModel({
      id: `equipment:${def.id}`,
      name: def.name,
      image: EQUIPMENT_IMAGES[def.id] || UNIT_IMAGES.scout_car,
      state: viewState,
      check,
      role: `${def.slot} · ${producer}`,
      cost: costs,
      duration: def.acquisition.buildTime,
      description: def.desc,
      actionId: check.ok ? 'produce-equipment' : null,
      actionPayload: { equipmentId: def.id },
      badges: badgesFor(viewState, { count: safeNumber(counts[def.id], 0), queued }),
      inspectorRows: [
        { label: '槽位', value: def.slot },
        { label: '效果', value: modifierText(def.modifiers) },
        { label: '适用单位', value: applicable },
        { label: '制造成本', value: costText(costs) },
        { label: '制造时间', value: formatDuration(def.acquisition.buildTime) },
        { label: '库存', value: String(safeNumber(counts[def.id], 0)) },
        { label: '生产来源', value: producer },
        { label: '科研前置', value: def.requiresTech ? (TECHNOLOGIES[def.requiresTech]?.name || def.requiresTech) : '无' },
        { label: '当前状态', value: check.reason || '可制造' }
      ]
    });
  });
}

function queueModel(job, position, state, active = false) {
  const def = job.kind === 'equipment' ? getEquipmentDefinition(job.equipmentId) : UNITS[job.type];
  const duration = safeNumber(job.duration, job.kind === 'equipment' ? def?.acquisition?.buildTime : def?.buildTime);
  const elapsed = active ? safeNumber(job.elapsed, 0) : 0;
  const selectedProgress = active ? getProductionProgress(state) : null;
  const progress = active ? safeNumber(selectedProgress?.percent, 0) : null;
  const producerInstance = (state.buildings || []).find((row) => row?.id === job.sourceBuildingId);
  const producer = BUILDINGS[producerInstance?.type]?.name || '生产设施';
  const costs = costRows(job.costPaid || {});
  const kind = job.kind === 'equipment' ? '装备制造' : '单位生产';
  return {
    id: `queue:${job.id}`,
    name: def?.name || '未知项目',
    image: job.kind === 'equipment' ? (EQUIPMENT_IMAGES[job.equipmentId] || UNIT_IMAGES.scout_car) : UNIT_IMAGES[job.type],
    imageAlt: '',
    state: active ? 'active' : 'queued',
    disabled: true,
    locked: false,
    progress,
    badges: badgesFor(active ? 'active' : 'queued', { progress, queued: !active }),
    actionId: null,
    inspectOnClick: true,
    ariaLabel: `${def?.name || '未知项目'}，${active ? `生产进度 ${progress}%` : `队列第 ${position} 位`}`,
    tooltip: { title: def?.name || '未知项目', role: kind, cost: costText(costs), duration: formatDuration(duration), status: active ? `${progress}% · 生产中` : `队列第 ${position} 位` },
    inspector: {
      title: def?.name || '未知项目',
      eyebrow: active ? '当前生产' : `队列第 ${position} 位`,
      description: def?.desc || '',
      rows: [
        { label: '类型', value: kind },
        { label: '生产设施', value: producer },
        { label: '已支付', value: costText(costs) },
        { label: '总时间', value: formatDuration(duration) },
        ...(active ? [{ label: '已用时间', value: formatDuration(elapsed) }, { label: '进度', value: `${progress}%` }] : [])
      ],
      actionId: active ? 'cancel-current-production' : 'cancel-queued-production',
      actionPayload: { jobId: job.id }
    }
  };
}

export function buildProductionQueueModels(state) {
  const models = [];
  if (state.production?.current) models.push(queueModel(state.production.current, 1, state, true));
  (state.production?.queue || []).forEach((job, index) => models.push(queueModel(job, index + 2, state, false)));
  return models;
}

export function buildProductionStatusModel(state) {
  const progress = getProductionProgress(state);
  return progress ? { name: progress.name, percent: progress.percent, remainingText: progress.remainingText } : null;
}

/* ==========================================================
 * Stage 10-P-B：全量 Command UI 迁移模型
 * 全部为只读纯函数：只读 canonical state 与现有 authority
 * selector，不做任何 gameplay 判定或状态修改。
 * ======================================================== */

const DAMAGE_LABELS = {
  [DAMAGE_STATES.INTACT]: '完好',
  [DAMAGE_STATES.LIGHT]: '轻伤',
  [DAMAGE_STATES.HEAVY]: '重伤',
  [DAMAGE_STATES.DESTROYED]: '已损毁'
};

const UNIT_STATUS_LABELS = { ready: '待命', assigned: '已编队', repairing: '维修中', deployed: '部署中' };

/* Formation status labels reuse the canonical FORMATION_STATUS_LABEL from
 * config.js (idle / rallying / marching / fighting / returning / repairing).
 * The presentation never maintains a reduced copy of that mapping. */
const formationStatusLabels = FORMATION_STATUS_LABEL;

/* Non-idle canonical formation statuses are busy: the tile must read as
 * active, never as available. */
const FORMATION_BUSY_STATUSES = new Set([
  FORMATION_STATUS.RALLYING,
  FORMATION_STATUS.MARCHING,
  FORMATION_STATUS.FIGHTING,
  FORMATION_STATUS.RETURNING,
  FORMATION_STATUS.REPAIRING
]);

const TECH_STATUS_LABELS = { completed: '已完成', researching: '研究中', queued: '队列中', available: '可研究', locked: '未解锁' };

function inspectModel({ id, name, image, state, badges = [], progress = null, ariaLabel, tooltip, inspector, actionId = null, actionPayload = null, disabled = false, inspectOnClick = true }) {
  return {
    id, name,
    image, imageAlt: '',
    state,
    disabled,
    locked: false,
    progress,
    badges,
    actionId,
    actionPayload,
    inspectOnClick,
    ariaLabel,
    tooltip,
    inspector
  };
}

/* ---------------- Units：单位花名册 ---------------- */

export function buildUnitRosterModels(state) {
  const units = Array.isArray(state.units) ? state.units : [];
  return units.map((unit) => {
    const def = UNITS[unit.type] || {};
    const rank = getUnitRank(unit);
    const damage = damageStateOfUnit(unit);
    const damageLabel = DAMAGE_LABELS[damage] || '完好';
    const progress = getRankProgress(unit);
    const stats = getUnitEffectiveStats(unit, state.equipment);
    const equipped = getUnitEquipment(state.equipment, unit.id);
    const formation = (state.formations || []).find((f) => (f.unitIds || []).includes(unit.id));
    const badges = [
      { label: UNIT_STATUS_LABELS[unit.status] || unit.status, tone: unit.status === 'ready' ? 'complete' : 'default' },
      { label: rank.name, tone: rank.id === 'recruit' ? 'default' : 'count' }
    ];
    if (damage !== DAMAGE_STATES.INTACT) badges.push({ label: damageLabel, tone: damage === DAMAGE_STATES.HEAVY ? 'resource' : 'progress' });
    const actions = [];
    equipped.forEach((item) => {
      actions.push({
        id: 'unequip-equipment',
        label: `卸载 ${item.name}`,
        payload: { unitId: unit.id, equipmentInstanceId: item.instanceId }
      });
    });
    const mounted = new Set(equipped.map((item) => item.instanceId));
    (state.equipment?.inventory || []).forEach((instance) => {
      if (mounted.has(instance.id)) return;
      const equipmentDef = getEquipmentDefinition(instance.equipmentId);
      if (!equipmentDef) return;
      const check = canEquipEquipment(state, unit.id, instance.id);
      actions.push({
        id: 'equip-equipment',
        label: `挂载 ${equipmentDef.name}`,
        payload: { unitId: unit.id, equipmentInstanceId: instance.id },
        disabled: !check.ok
      });
    });
    return inspectModel({
      id: `unit-instance:${unit.id}`,
      name: formatUnitDisplayName(unit),
      image: UNIT_IMAGES[unit.type] || UNIT_IMAGES.scout_car,
      state: unit.status === 'repairing' ? 'active' : damage !== DAMAGE_STATES.INTACT ? 'disabled' : 'available',
      badges,
      ariaLabel: `${formatUnitDisplayName(unit)}，${rank.name}，${damageLabel}`,
      tooltip: {
        title: formatUnitDisplayName(unit),
        role: def.name || unit.type,
        status: `${UNIT_STATUS_LABELS[unit.status] || unit.status} · ${damageLabel} · HP ${Math.round(safeNumber(unit.hp, 0))}/${Math.round(safeNumber(unit.maxHp, 0))}`
      },
      inspector: {
        title: formatUnitDisplayName(unit),
        eyebrow: `${def.name || unit.type} · ${rank.name}`,
        description: def.desc || '',
        rows: [
          { label: '状态', value: `${UNIT_STATUS_LABELS[unit.status] || unit.status} · ${damageLabel}` },
          { label: '生命', value: `${Math.round(safeNumber(unit.hp, 0))} / ${Math.round(safeNumber(unit.maxHp, 0))}` },
          { label: '经验 / 战斗', value: `${formatInt(safeNumber(unit.experience, 0))} / ${safeNumber(unit.battles, 0)} 次` },
          { label: '等级进度', value: progress.nextRankName ? `距${progress.nextRankName}还需 ${progress.remaining}` : '已达最高等级' },
          { label: '所属编队', value: formation ? formation.name : '库存（未编队）' },
          { label: '装备槽位', value: `${equipped.length} / ${EQUIPMENT_RULES.maxSlotsPerUnit}` }
        ],
        sections: [
          {
            title: '实际战斗属性（含装备与等级修正）',
            rows: ['attack', 'antiArmor', 'defense', 'scouting', 'mobility', 'repair']
              .map((key) => ({ label: key, value: `${stats[key]}（基础 ${safeNumber(def.stats?.[key], 0)}）` }))
          }
        ],
        inputs: [{
          label: '呼号',
          value: unit.callsign || '',
          maxLength: 12,
          placeholder: '输入呼号',
          actionId: 'rename-unit',
          payload: { unitId: unit.id }
        }],
        actions
      }
    });
  });
}

/* ---------------- Formations：编队指挥 ---------------- */

export function buildFormationCommandModels(state) {
  const models = [];
  const create = canCreateFormation(state);
  models.push(inspectModel({
    id: 'formation:new',
    name: '新建编队',
    image: UNIT_IMAGES.infantry,
    state: create.ok ? 'available' : 'locked',
    badges: create.ok ? [] : [{ label: 'LOCK', tone: 'lock' }],
    ariaLabel: '新建空编队',
    tooltip: { title: '新建编队', role: '指挥', status: create.ok ? '可创建' : create.reason },
    inspector: {
      title: '新建编队',
      eyebrow: '指挥',
      description: '创建一支空编队后再挑选库存单位编入；也可在下方预设模板中一键组建。',
      rows: [
        { label: '编队上限', value: `${(state.formations || []).length} / ${FORMATION.maxFormations}` },
        { label: '指挥容量', value: `${formatInt(safeNumber(state.command?.used, 0))} / ${formatInt(safeNumber(state.command?.capacity, 0))}` },
        { label: '当前状态', value: create.ok ? '可创建' : create.reason }
      ],
      actions: [{ id: 'create-formation', label: '新建空编队', disabled: !create.ok }]
    }
  }));
  FORMATION_PRESETS.forEach((preset) => {
    const check = canApplyPreset(state, preset.id);
    const comp = Object.keys(preset.units).map((t) => `${UNITS[t]?.name || t}×${preset.units[t]}`).join('、');
    models.push(inspectModel({
      id: `formation-preset:${preset.id}`,
      name: preset.name,
      image: UNIT_IMAGES.mbt,
      state: check.ok ? 'available' : 'locked',
      badges: [{ label: `C${getPresetCommandCost(preset.id)}`, tone: 'count' }, ...(check.ok ? [] : [{ label: '!', tone: 'resource' }])],
      ariaLabel: `预设 ${preset.name}，${check.ok ? '点击组建' : check.reason}`,
      tooltip: { title: preset.name, role: '预设模板', status: check.ok ? comp : check.reason },
      inspector: {
        title: preset.name,
        eyebrow: '预设模板 · 一键组建',
        description: comp,
        rows: [
          { label: '编成', value: comp },
          { label: '指挥占用', value: String(getPresetCommandCost(preset.id)) },
          { label: '当前状态', value: check.ok ? '可组建' : check.reason }
        ],
        actions: [{ id: 'apply-preset', label: '一键组建', payload: { presetId: preset.id }, disabled: !check.ok }]
      }
    }));
  });
  (state.formations || []).forEach((formation) => {
    const stats = getFormationStats(state, formation);
    const warnings = getFormationWarnings(state, formation);
    const comp = Object.keys(stats.byType).map((t) => `${UNITS[t]?.name || t}×${stats.byType[t]}`).join('、');
    const pool = getAvailableUnits(state);
    const task = getOperationalTask(state, formation.id);
    const taskDesc = task ? describeOperationalTask(task) : null;
    const tasked = Boolean(task);
    const busy = FORMATION_BUSY_STATUSES.has(formation.status);
    const formationStatusLabel = formationStatusLabels[formation.status] || formation.status;
    const actions = [];
    formation.unitIds.forEach((unitId) => {
      const unit = (state.units || []).find((u) => u.id === unitId);
      if (!unit) return;
      actions.push({
        id: 'remove-unit',
        label: `移出 ${formatUnitDisplayName(unit)}`,
        payload: { formationId: formation.id, unitId },
        disabled: formation.status !== FORMATION_STATUS.IDLE || tasked
      });
    });
    Object.keys(UNITS).forEach((typeId) => {
      const group = pool.filter((u) => u.type === typeId);
      if (!group.length) return;
      const check = canAddUnit(state, formation.id, group[0].id);
      actions.push({
        id: 'add-unit',
        label: `编入 ${UNITS[typeId].name} ×1`,
        payload: { formationId: formation.id, unitId: group[0].id },
        disabled: !check.ok || formation.status !== FORMATION_STATUS.IDLE || tasked
      });
    });

    /* Stage 10-A：OPERATIONAL TASK —— 空闲编队可下达，任务编队可召回 */
    const unlockedTheaters = listTheaters(state).filter((row) => row.unlocked);
    const taskProbeTheater = unlockedTheaters[0]?.id || null;
    const taskSections = [];
    let taskRows = [];
    if (taskDesc) {
      taskRows = [
        { label: '任务类型', value: taskDesc.typeLabel },
        { label: '目标战区', value: taskDesc.theaterName },
        { label: '已执行时间', value: taskDesc.elapsedText },
        { label: '周期消耗', value: `${taskDesc.upkeepPerInterval} / ${OPERATIONAL_TASK.costIntervalSec}s` },
        { label: '补给不足周期', value: String(taskDesc.missedIntervals) }
      ];
      taskRows.push(taskDesc.type === OPERATIONAL_TASK_TYPE.RECON
        ? { label: '累积侦察点', value: String(taskDesc.reconPoints) }
        : taskDesc.type === OPERATIONAL_TASK_TYPE.PATROL
          ? { label: '累积巡逻时长', value: formatDuration(Math.floor(taskDesc.patrolTime)) }
          : { label: '累积警戒时长', value: formatDuration(Math.floor(taskDesc.securityTime)) });
      actions.push({ id: 'recall-task', label: '召回作战任务', payload: { formationId: formation.id } });
    } else if (stats.count > 0 && formation.status === FORMATION_STATUS.IDLE) {
      const probeCheck = taskProbeTheater
        ? canAssignOperationalTask(state, formation.id, OPERATIONAL_TASK_TYPE.PATROL, taskProbeTheater)
        : { ok: false, reason: '暂无已解锁战区' };
      OPERATIONAL_TASK.types.forEach((taskType) => {
        actions.push({
          id: 'choose-task',
          label: `下达 ${OPERATIONAL_TASK.shortLabels[taskType]}`,
          payload: { formationId: formation.id, taskType },
          disabled: !probeCheck.ok
        });
      });
      taskRows = [probeCheck.ok
        ? { label: '状态', value: '可下达持续性任务：巡逻 / 侦察 / 警戒' }
        : { label: '状态', value: probeCheck.reason || '当前不可下达任务' }];
    }
    if (taskRows.length) taskSections.push({ title: 'OPERATIONAL TASK', rows: taskRows });

    actions.push({
      id: 'disband-formation',
      label: '解散编队',
      payload: { formationId: formation.id },
      disabled: formation.status !== FORMATION_STATUS.IDLE || tasked,
      danger: true
    });
    models.push(inspectModel({
      id: `formation:${formation.id}`,
      name: formation.name,
      image: UNIT_IMAGES.mbt,
      state: tasked || busy ? 'active' : stats.count === 0 ? 'locked' : 'available',
      badges: tasked
        ? [
            { label: OPERATIONAL_TASK.shortLabels[task.type] || task.type, tone: 'progress' },
            { label: taskDesc.elapsedText, tone: 'count' },
            { label: `×${stats.count}`, tone: 'count' }
          ]
        : [
            { label: formationStatusLabel, tone: formation.status === FORMATION_STATUS.IDLE ? 'complete' : 'progress' },
            { label: `×${stats.count}`, tone: 'count' }
          ],
      ariaLabel: tasked
        ? `${formation.name}，正在执行${OPERATIONAL_TASK.shortLabels[task.type]}任务，${taskDesc.elapsedText}`
        : `${formation.name}，${stats.count} 个单位，${formationStatusLabel}`,
      tooltip: {
        title: formation.name,
        role: '编队',
        status: tasked
          ? `${OPERATIONAL_TASK.shortLabels[task.type]} · ${taskDesc.theaterName} · 已执行 ${taskDesc.elapsedText}`
          : `${formationStatusLabel} · ${stats.count} 单位 · 指挥 ${stats.command} · 攻击 ${formatInt(stats.attack)} · 防御 ${formatInt(stats.defense)}`
      },
      inspector: {
        title: formation.name,
        eyebrow: tasked
          ? `编队 · ${OPERATIONAL_TASK.shortLabels[task.type]} 任务执行中`
          : `编队 · ${formationStatusLabel}`,
        description: comp || '空编队',
        rows: [
          { label: '单位数量', value: String(stats.count) },
          { label: '指挥占用', value: String(stats.command) },
          { label: '总生命值', value: `${formatInt(stats.hp)} / ${formatInt(stats.maxHp)}` },
          { label: '完好度', value: `${Math.round(stats.avgHp * 100)}%` },
          { label: '总攻击 / 反装甲', value: `${formatInt(stats.attack)} / ${formatInt(stats.antiArmor)}` },
          { label: '总防御 / 侦察', value: `${formatInt(stats.defense)} / ${formatInt(stats.scouting)}` },
          { label: '总维修', value: formatInt(stats.repair) },
          { label: '平均机动', value: String(stats.avgMobility.toFixed(1)) },
          { label: '任务补给消耗', value: `${formatInt(stats.upkeep)}/次` }
        ],
        sections: [
          { title: '编成评估', rows: warnings.map((text) => ({ label: '提示', value: text })) },
          ...taskSections
        ],
        actions
      }
    }));
  });
  return models;
}

/* ---------------- Theater：战区与任务 ---------------- */

export function buildTheaterCommandModels(state) {
  const models = [];
  listTheaters(state).forEach((view) => {
    const intel = getTheaterIntel(state, view.id);
    const statusLabel = view.engaged ? '交战中' : view.captured ? '已占领' : view.unlocked ? '可进攻' : '未解锁';
    const tileState = view.captured ? 'completed' : view.engaged ? 'active' : view.unlocked ? 'available' : 'locked';
    const pressure = theaterPressureView(state, view.id);
    const taskCounts = theaterTaskCounts(state, view.id);
    const activeTaskCount = taskCounts.patrol + taskCounts.recon + taskCounts.security;
    const badges = [
      { label: statusLabel, tone: view.captured ? 'complete' : view.engaged ? 'progress' : view.unlocked ? 'count' : 'lock' },
      { label: `THREAT ${Math.round(pressure.threat)}`, tone: pressure.threat >= 60 ? 'resource' : 'progress' },
      { label: `CTRL ${Math.round(pressure.control)}`, tone: pressure.control >= 60 ? 'complete' : 'count' },
      { label: '★'.repeat(Math.max(1, Math.min(5, view.difficulty))), tone: 'default' }
    ];
    if (!view.captured && Object.keys(view.firstReward || {}).length) badges.push({ label: '首占奖励', tone: 'progress' });
    if (activeTaskCount > 0) badges.push({ label: `任务 ×${activeTaskCount}`, tone: 'progress' });
    const rows = [
      { label: '地形', value: `${view.terrainName} · 隐蔽 ${view.concealment}` },
      { label: '补给系数', value: `×${view.supplyMultiplier}` },
      { label: '战绩', value: `尝试 ${view.attempts} 次 / 胜利 ${view.victories} 次${view.lastResult ? ` · 上次 ${view.lastResult}` : ''}` }
    ];
    if (view.captured) {
      const income = Object.keys(view.captureIncome || {})
        .map((k) => `${RESOURCE_DEFS[k.replace('PerSec', '')]?.name || k}+${view.captureIncome[k]}/s`);
      rows.push({ label: '占领收益', value: income.join(' ') || '无' });
    } else {
      rows.push({ label: '首占奖励', value: Object.keys(view.firstReward || {}).length ? formatMissionCostText(view.firstReward) : '无' });
    }
    if (!view.unlocked) rows.push({ label: '解锁条件', value: view.lockReason || '—' });
    const sections = [];
    sections.push({
      title: 'THEATER PRESSURE · 战区压力',
      rows: [
        { label: 'Threat 威胁', value: `${Math.round(pressure.threat)} / 100` },
        { label: 'Control 控制力', value: `${Math.round(pressure.control)} / 100` },
        { label: 'Recon 侦察掌握', value: `${Math.round(pressure.recon)} / 100` },
        { label: 'Security 安全度', value: `${Math.round(pressure.security)} / 100` },
        { label: '任务影响', value: activeTaskCount > 0
          ? `巡逻 ×${taskCounts.patrol} · 侦察 ×${taskCounts.recon} · 警戒 ×${taskCounts.security}（效果叠加中）`
          : '无执行中任务（威胁缓慢回升，其余指标缓慢衰减）' }
      ]
    });
    if (intel) {
      sections.push({
        title: `敌情（${intel.accurate ? '雷达确认' : '侦察估算'} · 兵力 ${intel.totalText}）`,
        rows: intel.units.map((u) => ({ label: u.threat ? '⚠ 威胁' : '敌军', value: u.label }))
          .concat([{ label: '地形影响', value: intel.terrainEffects.join(' · ') || '无' }, { label: '伏击风险', value: intel.ambushText }])
      });
    }
    models.push(inspectModel({
      id: `theater:${view.id}`,
      name: view.name,
      image: 'assets/battle/sample-assets/industrial-cover.svg',
      state: tileState,
      badges,
      ariaLabel: `${view.name}，${statusLabel}`,
      tooltip: { title: view.name, role: '战区', status: `${statusLabel} · ${view.terrainName} · 难度 ${view.difficulty}` },
      inspector: { title: view.name, eyebrow: '战区', description: view.desc, rows, sections, actions: [{ id: 'select-theater', label: '选为行动目标', payload: { theaterId: view.id, operationId: null } }] }
    }));
    if (view.captured) {
      Object.values(OPERATIONS).filter((operation) => operation.theaterId === view.id).forEach((operation) => {
        const op = getOperation(state, operation.id);
        const cooling = safeNumber(op?.cooldownRemaining, 0) > 0;
        models.push(inspectModel({
          id: `operation:${operation.id}`,
          name: operation.name,
          image: UNIT_IMAGES.scout_car,
          state: cooling ? 'locked' : 'available',
          badges: [
            { label: '任务', tone: 'count' },
            ...(cooling ? [{ label: '冷却', tone: 'lock' }] : [])
          ],
          ariaLabel: `${operation.name} 重复任务`,
          tooltip: { title: operation.name, role: '重复任务', status: op?.cooldownText || '可执行' },
          inspector: {
            title: operation.name,
            eyebrow: '重复任务',
            description: operation.desc,
            rows: [
              { label: '经验倍率', value: `×${operation.experienceMultiplier}` },
              { label: '补给系数', value: `×${operation.supplyMultiplier}` },
              { label: '冷却', value: op?.cooldownText || '—' },
              { label: '奖励范围', value: Object.keys(operation.rewards || {}).map((key) => `${key} ${operation.rewards[key].min}-${operation.rewards[key].max}`).join(' / ') }
            ],
            actions: [{ id: 'select-theater', label: '选为行动任务', payload: { theaterId: view.id, operationId: operation.id }, disabled: cooling }]
          }
        }));
      });
    }
  });
  return models;
}

export function buildStrategyModels(state, selectedStrategyId) {
  return listStrategies(state).map((strategy) => ({
    id: `strategy:${strategy.id}`,
    name: strategy.name,
    image: UNIT_IMAGES.at_infantry,
    imageAlt: '',
    state: 'available',
    disabled: false,
    locked: false,
    progress: null,
    badges: [
      { label: strategy.id === selectedStrategyId ? '已选' : '', tone: 'count' },
      ...(strategy.cost && Object.keys(strategy.cost).length ? [{ label: formatMissionCostText(strategy.cost), tone: 'progress' }] : [])
    ].filter((badge) => badge.label),
    actionId: 'select-strategy',
    actionPayload: { strategyId: strategy.id },
    selected: strategy.id === selectedStrategyId,
    ariaLabel: `策略 ${strategy.name}`,
    tooltip: { title: strategy.name, role: '作战策略', status: strategy.desc },
    inspector: {
      title: strategy.name,
      eyebrow: '作战策略',
      description: strategy.desc,
      rows: [
        { label: '额外成本', value: strategy.cost && Object.keys(strategy.cost).length ? formatMissionCostText(strategy.cost) : '无' },
        ...strategy.advantages.map((text) => ({ label: '优势', value: text })),
        ...strategy.risks.map((text) => ({ label: '风险', value: text }))
      ]
    }
  }));
}

/* ---------------- Repairs：维修指挥 ---------------- */

export function buildRepairCommandModels(state) {
  const labels = DAMAGE_LABELS;
  const active = getActiveRepairs(state).map((job) => inspectModel({
    id: `repair-active:${job.id}`,
    name: job.unitName,
    image: UNIT_IMAGES.infantry,
    state: 'active',
    badges: [{ label: labels[job.severity] || job.severity, tone: 'progress' }, { label: '维修中', tone: 'complete' }],
    progress: Math.round(safeNumber(getRepairProgress(job), 0) * 100),
    ariaLabel: `${job.unitName} 维修中`,
    tooltip: { title: job.unitName, role: '维修工位', duration: `剩余 ${formatDuration(getRepairRemaining(job))}`, status: '维修中' },
    inspector: {
      title: job.unitName,
      eyebrow: '维修工位',
      rows: [
        { label: '损伤', value: labels[job.severity] || job.severity },
        { label: '进度', value: `${Math.round(safeNumber(getRepairProgress(job), 0) * 100)}%` },
        { label: '剩余时间', value: formatDuration(getRepairRemaining(job)) }
      ],
      actions: [{ id: 'cancel-repair', label: '取消维修', payload: { jobId: job.id }, danger: true }]
    }
  }));
  const queued = getQueuedRepairs(state).map((job) => inspectModel({
    id: `repair-queued:${job.id}`,
    name: job.unitName,
    image: UNIT_IMAGES.infantry,
    state: 'queued',
    badges: [{ label: labels[job.severity] || job.severity, tone: 'progress' }, { label: '队列', tone: 'queued' }],
    ariaLabel: `${job.unitName} 等待维修`,
    tooltip: { title: job.unitName, role: '维修队列', duration: `预计 ${formatDuration(job.duration)}`, status: '排队中' },
    inspector: {
      title: job.unitName,
      eyebrow: '维修队列',
      rows: [
        { label: '损伤', value: labels[job.severity] || job.severity },
        { label: '预计时长', value: formatDuration(job.duration) }
      ],
      actions: [{ id: 'cancel-repair', label: '取消排队', payload: { jobId: job.id }, danger: true }]
    }
  }));
  const candidates = (state.units || []).filter((unit) => {
    if (!unit || unit.status === 'repairing' || unit.status === 'deployed') return false;
    const ds = damageStateOfUnit(unit);
    return ds === DAMAGE_STATES.LIGHT || ds === DAMAGE_STATES.HEAVY;
  }).map((unit) => {
    const def = UNITS[unit.type] || {};
    const ds = damageStateOfUnit(unit);
    const check = canQueueRepair(state, unit.id);
    const cost = getRepairCost(ds);
    const costText = Object.keys(cost).map((k) => `${RESOURCE_DEFS[k]?.name || k} ${formatInt(cost[k])}`).join(' · ');
    return inspectModel({
      id: `repair-candidate:${unit.id}`,
      name: formatUnitDisplayName(unit),
      image: UNIT_IMAGES[unit.type] || UNIT_IMAGES.scout_car,
      state: check.ok ? 'available' : 'insufficient',
      badges: [{ label: labels[ds] || ds, tone: ds === DAMAGE_STATES.HEAVY ? 'resource' : 'progress' }, ...(check.ok ? [] : [{ label: '!', tone: 'resource' }])],
      actionId: check.ok ? 'repair-unit' : null,
      actionPayload: { unitId: unit.id },
      disabled: !check.ok,
      /* Safe primary action: a plain click / tap sends the unit to repair.
       * Details stay reachable through hover, long press, ⓘ and context menu;
       * when repair is not allowed the tile only opens details. */
      inspectOnClick: !check.ok,
      ariaLabel: `${formatUnitDisplayName(unit)}，${check.ok ? '点击送去维修' : check.reason}`,
      tooltip: { title: formatUnitDisplayName(unit), role: def.name, cost: costText, duration: `预计 ${formatDuration(getRepairTime(state, unit.id))}`, status: check.ok ? '可维修' : check.reason },
      inspector: {
        title: formatUnitDisplayName(unit),
        eyebrow: `${def.name || unit.type} · ${labels[ds] || ds}`,
        rows: [
          { label: '耐久', value: `${formatInt(safeNumber(unit.hp, 0))} / ${formatInt(safeNumber(unit.maxHp, 0))}` },
          { label: '维修费用', value: costText || '——' },
          { label: '预计时长', value: formatDuration(getRepairTime(state, unit.id)) },
          { label: '当前状态', value: check.ok ? '可排队维修' : check.reason }
        ],
        actions: [{ id: 'repair-unit', label: '送去维修', payload: { unitId: unit.id }, disabled: !check.ok }]
      }
    });
  });
  return { active, queued, candidates };
}

/* ---------------- Research：科研 ---------------- */

export function buildResearchCommandModels(state) {
  const built = hasResearchCenter(state);
  const progress = getResearchProgress(state);
  const currentModels = progress ? [inspectModel({
    id: `research-current:${progress.techId || progress.id || 'current'}`,
    name: progress.name,
    image: 'assets/command/building-research.svg',
    state: 'active',
    badges: [{ label: '研究中', tone: 'complete' }, { label: `${Math.round(progress.percent)}%`, tone: 'progress' }],
    progress: progress.percent,
    ariaLabel: `${progress.name} 研究中 ${Math.round(progress.percent)}%`,
    tooltip: { title: progress.name, role: '当前研究', duration: `剩余 ${formatDuration(Math.ceil(progress.remaining))}`, status: `已用 ${formatDuration(Math.floor(progress.elapsed))}` },
    inspector: {
      title: progress.name,
      eyebrow: '当前研究',
      rows: [
        { label: '进度', value: `${Math.round(progress.percent)}%` },
        { label: '已用时间', value: formatDuration(Math.floor(progress.elapsed)) },
        { label: '剩余时间', value: formatDuration(Math.ceil(progress.remaining)) }
      ],
      actions: [{ id: 'cancel-current-research', label: '取消当前研究', payload: { confirm: true }, danger: true }]
    }
  })] : [];
  const queueModels = ((state.research && state.research.queue) || []).map((task, index) => inspectModel({
    id: `research-queued:${task.id}`,
    name: (TECHNOLOGIES[task.techId] || {}).name || task.techId,
    image: 'assets/command/building-research.svg',
    state: 'queued',
    badges: [{ label: `队列 ${index + 2}`, tone: 'queued' }],
    ariaLabel: `${(TECHNOLOGIES[task.techId] || {}).name || task.techId} 排队中`,
    tooltip: { title: (TECHNOLOGIES[task.techId] || {}).name || task.techId, role: '科研队列', duration: formatDuration(task.duration), status: `队列第 ${index + 2} 位` },
    inspector: {
      title: (TECHNOLOGIES[task.techId] || {}).name || task.techId,
      eyebrow: `科研队列 · 第 ${index + 2} 位`,
      rows: [
        { label: '时长', value: formatDuration(task.duration) },
        { label: '已支付', value: Object.keys(task.costPaid || {}).map((k) => `${RESOURCE_DEFS[k]?.name || k} ${formatInt(task.costPaid[k])}`).join(' · ') || '免费' }
      ],
      actions: [{ id: 'cancel-queued-research', label: '取消排队', payload: { taskId: task.id, confirm: true }, danger: true }]
    }
  }));
  const techModels = Object.values(TECHNOLOGIES).map((tech) => {
    const view = getTechnologyState(state, tech.id);
    const checkOk = built && view.status === 'available';
    const costs = costRows(tech.cost, state);
    return inspectModel({
      id: `research:${tech.id}`,
      name: tech.name,
      image: 'assets/command/building-research.svg',
      state: view.status === 'completed' ? 'completed' : view.status === 'researching' || view.status === 'queued' ? 'active' : view.status === 'available' ? (built ? 'available' : 'disabled') : 'locked',
      badges: [{ label: TECH_STATUS_LABELS[view.status] || view.status, tone: view.status === 'completed' ? 'complete' : view.status === 'available' ? 'count' : 'lock' }],
      actionId: checkOk ? 'research' : null,
      actionPayload: { techId: tech.id },
      disabled: !checkOk,
      /* Safe primary action: a plain click / tap starts an available research.
       * Locked / completed / researching / queued tiles keep details-only. */
      inspectOnClick: !checkOk,
      ariaLabel: `${tech.name}，${TECH_STATUS_LABELS[view.status] || view.status}`,
      tooltip: { title: tech.name, role: `${{ industry: '工业', military: '军备', command: '指挥' }[tech.branch] || tech.branch} · ${tech.tier}级`, cost: costText(costs), duration: formatDuration(tech.researchTime), status: view.status === 'available' ? (built ? '可研究' : '需先建成技术实验室') : (TECH_STATUS_LABELS[view.status] || view.reason || '') },
      inspector: {
        title: tech.name,
        eyebrow: `${{ industry: '工业', military: '军备', command: '指挥' }[tech.branch] || tech.branch} · ${tech.tier}级`,
        description: tech.desc,
        rows: [
          { label: '研究成本', value: costText(costs) },
          { label: '研究时间', value: formatDuration(tech.researchTime) },
          { label: '前置科技', value: (tech.requires || []).map((id) => TECHNOLOGIES[id]?.name || id).join('、') || '无' },
          { label: '当前状态', value: view.status === 'available' ? (built ? '可研究' : '需先建成技术实验室') : (TECH_STATUS_LABELS[view.status] || view.reason || '') }
        ],
        actions: [{ id: 'research', label: '开始研究', payload: { techId: tech.id }, disabled: !checkOk }]
      }
    });
  });
  return { current: currentModels, queue: queueModels, tech: techModels, labBuilt: built };
}

/* ---------------- Reports：战报 ---------------- */

const RESULT_LABELS_SHORT = { victory: '胜利', pyrrhic: '惨胜', withdraw: '撤军', defeat: '失败', wiped: '全灭' };

export function buildReportModels(state) {
  return getReports(state).map((report) => {
    const resultShort = RESULT_LABELS_SHORT[report.result] || report.result;
    const lostN = ((report.losses && report.losses.friendly) || []).filter((l) => !l.recovered).length;
    return inspectModel({
      id: `report:${report.id}`,
      name: report.missionKind === 'operation' ? `任务 · ${report.theaterName}` : report.theaterName,
      image: report.missionKind === 'operation' ? UNIT_IMAGES.scout_car : 'assets/battle/sample-assets/industrial-cover.svg',
      state: ['victory', 'pyrrhic'].includes(report.result) ? 'completed' : 'disabled',
      badges: [
        { label: resultShort, tone: ['victory', 'pyrrhic'].includes(report.result) ? 'complete' : 'resource' },
        { label: `T+${formatInt(safeNumber(report.startedAt, 0))}s`, tone: 'default' },
        { label: report.formationName, tone: 'count' }
      ],
      ariaLabel: `${report.theaterName} 战报，${resultShort}`,
      tooltip: { title: report.theaterName, role: `${resultShort} · ${report.strategyName}`, status: `${(report.rounds || []).length} 轮 · 损失 ${lostN} · 种子 ${report.seed}` },
      inspector: {
        title: report.theaterName,
        eyebrow: `${resultShort} · ${report.strategyName} · ${report.formationName}`,
        description: report.summary || '',
        rows: [
          { label: '随机种子', value: String(report.seed) },
          { label: '战斗时长', value: `${formatInt(safeNumber(report.duration, 0))} 秒` },
          { label: '我方参战 / 敌方兵力', value: `${((report.initial && report.initial.friendly) || []).length} / ${((report.initial && report.initial.enemy) || []).length}` },
          { label: '我方永久损失', value: ((report.losses && report.losses.friendly) || []).filter((l) => !l.recovered).map((l) => l.name).join('、') || '无' },
          { label: '战地抢救回收', value: ((report.losses && report.losses.friendly) || []).filter((l) => l.recovered).map((l) => l.name).join('、') || '无' },
          { label: '敌方损失', value: `${((report.losses && report.losses.enemy) || []).length} 个单位` },
          { label: '是否占领', value: report.capture ? '是' : '否' },
          { label: '首占奖励', value: Object.keys(report.rewards || {}).length ? formatMissionCostText(report.rewards) : '无' }
        ],
        sections: [
          ...(report.phases || []).map((phase) => ({
            title: phase.title,
            rows: (phase.details && phase.details.length ? phase.details : [phase.summary || '']).map((text) => ({ label: '经过', value: text }))
          })),
          {
            title: '胜负原因',
            rows: [
              ...((report.reasons && report.reasons.advantages) || []).map((text) => ({ label: '优势', value: text })),
              ...((report.reasons && report.reasons.problems) || []).map((text) => ({ label: '问题', value: text }))
            ]
          }
        ],
        listSections: (report.events || []).length ? [{ title: '事件时间轴', items: (report.events || []).map((ev) => `${safeNumber(ev.t, 0).toFixed(1)}s  ${ev.text || ''}`) }] : []
      }
    });
  });
}

/* ---------------- Overview：指挥官总览 ---------------- */

export function buildOverviewCommandModels(state) {
  const models = [];
  const construction = buildCurrentConstructionModel(state);
  if (construction) {
    construction.eyebrow = null;
    models.push(construction);
  }
  const production = getProductionProgress(state);
  if (production) {
    models.push(inspectModel({
      id: 'overview:production',
      name: production.name,
      image: UNIT_IMAGES.infantry,
      state: 'active',
      badges: [{ label: '生产中', tone: 'complete' }, { label: `${Math.round(production.percent)}%`, tone: 'progress' }],
      progress: production.percent,
      ariaLabel: `${production.name} 生产中`,
      tooltip: { title: production.name, role: '当前生产', duration: `剩余 ${production.remainingText}`, status: '生产中' },
      inspector: { title: production.name, eyebrow: '当前生产', rows: [{ label: '进度', value: `${Math.round(production.percent)}%` }, { label: '剩余时间', value: production.remainingText }] }
    }));
  }
  const research = getResearchProgress(state);
  if (research) {
    models.push(inspectModel({
      id: 'overview:research',
      name: research.name,
      image: 'assets/command/building-research.svg',
      state: 'active',
      badges: [{ label: '研究中', tone: 'complete' }, { label: `${Math.round(research.percent)}%`, tone: 'progress' }],
      progress: research.percent,
      ariaLabel: `${research.name} 研究中`,
      tooltip: { title: research.name, role: '当前研究', duration: `剩余 ${formatDuration(Math.ceil(research.remaining))}`, status: '研究中' },
      inspector: { title: research.name, eyebrow: '当前研究', rows: [{ label: '进度', value: `${Math.round(research.percent)}%` }, { label: '剩余时间', value: formatDuration(Math.ceil(research.remaining)) }] }
    }));
  }
  const repairsActive = getActiveRepairs(state);
  if (repairsActive.length) {
    models.push(inspectModel({
      id: 'overview:repairs',
      name: `维修 ×${repairsActive.length}`,
      image: UNIT_IMAGES.repair_vehicle,
      state: 'active',
      badges: [{ label: `${Math.round(safeNumber(getRepairProgress(repairsActive[0]), 0) * 100)}%`, tone: 'progress' }],
      ariaLabel: `${repairsActive.length} 项维修进行中`,
      tooltip: { title: '维修车间', role: '维修', status: `${repairsActive.length} 项进行中` },
      inspector: {
        title: '维修车间',
        eyebrow: '维修',
        rows: repairsActive.map((job) => ({ label: job.unitName, value: `${Math.round(safeNumber(getRepairProgress(job), 0) * 100)}% · 剩余 ${formatDuration(getRepairRemaining(job))}` }))
      }
    }));
  }
  const activeBattle = state.activeBattle;
  if (activeBattle) {
    models.push(inspectModel({
      id: 'overview:battle',
      name: `${activeBattle.formationName} → ${activeBattle.theaterName}`,
      image: UNIT_IMAGES.at_infantry,
      state: 'active',
      badges: [{ label: activeBattle.settled ? '待返回' : '交战中', tone: 'progress' }],
      ariaLabel: '当前作战',
      tooltip: { title: '当前作战', role: '战区', status: `${activeBattle.formationName} → ${activeBattle.theaterName}` },
      inspector: { title: '当前作战', eyebrow: '战区', rows: [{ label: '编队', value: activeBattle.formationName }, { label: '目标', value: activeBattle.theaterName }, { label: '状态', value: activeBattle.settled ? '已结束，待返回基地' : '交战中' }] }
    }));
  }
  const readyFormations = (state.formations || []).filter((f) => f.status === 'idle' && (f.unitIds || []).length > 0);
  models.push(inspectModel({
    id: 'overview:formations',
    name: `可行动编队 ×${readyFormations.length}`,
    image: UNIT_IMAGES.mbt,
    state: readyFormations.length ? 'available' : 'locked',
    badges: [{ label: `×${readyFormations.length}`, tone: 'count' }],
    ariaLabel: `${readyFormations.length} 支可行动编队`,
    tooltip: { title: '可行动编队', role: '指挥', status: readyFormations.length ? `${readyFormations.length} 支待命` : '暂无待命编队' },
    inspector: {
      title: '可行动编队',
      eyebrow: '指挥',
      rows: readyFormations.length
        ? readyFormations.map((f) => ({ label: f.name, value: `${(f.unitIds || []).length} 单位 · 待命` }))
        : [{ label: '状态', value: '暂无待命编队，请先组建编队' }]
    }
  }));
  return models;
}

function formatMissionCostText(cost = {}) {
  return Object.keys(cost).map((key) => `${RESOURCE_DEFS[key]?.name || key} ${formatInt(cost[key])}`).join(' / ') || '无';
}
