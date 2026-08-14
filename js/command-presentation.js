/**
 * Stage 10-P-A command presentation models.
 *
 * This module is intentionally read-only: it translates canonical gameplay
 * state plus existing authority selectors into small UI models.  It never
 * mutates state and never performs a gameplay command.
 */

import {
  BASE_LAYOUT, BUILDINGS, BUILDING_STATUS, EQUIPMENT, RESOURCE_DEFS,
  TECHNOLOGIES, UNITS
} from './config.js';
import { buildableList, canBuild, getConstructionProgress } from './construction.js';
import { canQueueEquipment, canQueueUnit, getProductionProgress, inventoryCount } from './production.js';
import { equipmentInventoryCounts, getEquipmentDefinition } from './equipment.js';
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
