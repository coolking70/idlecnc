/**
 * economy.js —— 经济系统（纯逻辑，不触碰 DOM / Canvas）
 *
 * 职责：
 *  1. 根据建筑重新计算派生数值（产量、上限、电力、指挥容量）；
 *  2. 每个逻辑步长增长资源并按上限钳制；
 *  3. 提供资源花费 / 返还的统一入口。
 */

import { ECONOMY, BUILDINGS, BUILDING_STATUS, UNITS, RESOURCE_DEFS, THEATERS } from './config.js';
import { clamp, safeNumber, formatInt } from './utils.js';
import { getResearchModifiers } from './research.js';

/**
 * 重新计算所有派生数值。
 * 建筑变化（建成、拆除、读档）后必须调用一次。
 */
export function recalcDerived(state) {
  if (!state) return;

  const rates = { ...ECONOMY.baseRates };
  const caps = { ...ECONOMY.baseCaps };
  const research = getResearchModifiers(state);
  let powerProduced = 0;
  let powerUsed = 0;
  let commandCapacity = 0;

  state.buildings.forEach((bld) => {
    const def = BUILDINGS[bld.type];
    if (!def) return;
    // 只有已建成的建筑才提供效果与消耗电力
    if (bld.status !== BUILDING_STATUS.OPERATIONAL) return;

    const eff = def.effects || {};
    rates.supply += safeNumber(eff.supplyPerSec, 0);
    rates.alloy += safeNumber(eff.alloyPerSec, 0);
    rates.intel += safeNumber(eff.intelPerSec, 0);
    caps.supply += safeNumber(eff.supplyCap, 0);
    caps.alloy += safeNumber(eff.alloyCap, 0);
    caps.intel += safeNumber(eff.intelCap, 0);
    commandCapacity += safeNumber(eff.commandCapacity, 0);

    powerProduced += safeNumber(def.power && def.power.produce, 0);
    powerUsed += safeNumber(def.power && def.power.consume, 0);
  });

  // 已占领战区的持续收益：一律以 THEATERS 配置为准，绝不信任存档里的 income 字段
  Object.keys(THEATERS).forEach((id) => {
    const t = (state.theaters || {})[id];
    const cfg = THEATERS[id];
    if (!t || !t.captured || !cfg) return;
    const inc = cfg.captureIncome || {};
    rates.supply += safeNumber(inc.supplyPerSec, 0);
    rates.alloy += safeNumber(inc.alloyPerSec, 0);
    rates.intel += safeNumber(inc.intelPerSec, 0);
  });

  rates.supply += safeNumber(research.supplyPerSec, 0);
  rates.alloy += safeNumber(research.alloyPerSec, 0);
  caps.supply += safeNumber(research.supplyCap, 0);
  caps.alloy += safeNumber(research.alloyCap, 0);

  state.rates = rates;
  state.caps = caps;
  state.power = { produced: powerProduced, used: powerUsed };

  // 指挥容量占用：编队中在役单位（阶段4起有值）
  let commandUsed = 0;
  (state.formations || []).forEach((f) => {
    (f.unitIds || []).forEach((unitId) => {
      const unit = (state.units || []).find((u) => u.id === unitId);
      const def = unit && UNITS[unit.type];
      if (def) commandUsed += safeNumber(def.command, 0);
    });
  });
  state.command = { capacity: commandCapacity + safeNumber(research.commandCapacity, 0), used: commandUsed };

  // 上限变化后重新钳制当前资源
  clampResources(state);
}

/** 把资源钳制在 0 ~ 上限之间 */
export function clampResources(state) {
  Object.keys(RESOURCE_DEFS).forEach((key) => {
    const cap = safeNumber(state.caps[key], 0);
    state.resources[key] = clamp(safeNumber(state.resources[key], 0), 0, cap);
  });
}

/**
 * 经济步进
 * @param {object} state
 * @param {number} dt 游戏秒（已乘以游戏速度）
 */
export function tickEconomy(state, dt) {
  if (!state || dt <= 0) return;
  const factor = powerFactor(state);
  state.resources.supply = clamp(
    state.resources.supply + state.rates.supply * factor * dt, 0, state.caps.supply
  );
  state.resources.alloy = clamp(
    state.resources.alloy + state.rates.alloy * factor * dt, 0, state.caps.alloy
  );
  state.resources.intel = clamp(
    state.resources.intel + state.rates.intel * factor * dt, 0, state.caps.intel
  );
}

/**
 * 电力不足时的产量系数。
 * 阶段1不会出现超载（发电站30，无耗电建筑），阶段2起生效。
 */
export function powerFactor(state) {
  const produced = safeNumber(state.power.produced, 0);
  const used = safeNumber(state.power.used, 0);
  if (used <= produced) return 1;
  return ECONOMY.brownoutFactor;
}

/** 是否负担得起某个成本对象 */
export function canAfford(state, cost) {
  if (!cost) return true;
  return Object.keys(cost).every(
    (key) => safeNumber(state.resources[key], 0) >= safeNumber(cost[key], 0)
  );
}

/** 列出缺少的资源，用于按钮禁用原因提示 */
export function missingResources(state, cost) {
  if (!cost) return [];
  const missing = [];
  Object.keys(cost).forEach((key) => {
    const need = safeNumber(cost[key], 0);
    const have = safeNumber(state.resources[key], 0);
    if (have < need) {
      const name = RESOURCE_DEFS[key] ? RESOURCE_DEFS[key].name : key;
      missing.push(`${name}不足（缺 ${formatInt(need - have)}）`);
    }
  });
  return missing;
}

/** 扣除资源，成功返回 true */
export function spend(state, cost) {
  if (!canAfford(state, cost)) return false;
  Object.keys(cost || {}).forEach((key) => {
    state.resources[key] = safeNumber(state.resources[key], 0) - safeNumber(cost[key], 0);
  });
  clampResources(state);
  return true;
}

/** 返还 / 奖励资源 */
export function grant(state, gains) {
  Object.keys(gains || {}).forEach((key) => {
    if (state.resources[key] === undefined) return;
    state.resources[key] = clamp(
      safeNumber(state.resources[key], 0) + safeNumber(gains[key], 0),
      0,
      safeNumber(state.caps[key], 0)
    );
  });
}

/**
 * 预留：离线资源结算（阶段6接入）
 * 返回纯数据，不直接修改 state，方便先展示报告再确认。
 */
export function estimateOfflineGains(state, seconds) {
  const factor = powerFactor(state);
  return {
    supply: Math.floor(state.rates.supply * factor * seconds),
    alloy: Math.floor(state.rates.alloy * factor * seconds),
    intel: Math.floor(state.rates.intel * factor * seconds)
  };
}
