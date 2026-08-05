/**
 * unit-status.js —— 单位损伤等级的唯一判定实现。
 * 纯逻辑模块：不读写全局状态，不操作 DOM / Canvas。
 */

import { DAMAGE_STATES, DAMAGE_THRESHOLDS } from './config.js';

export function getDamageState(hp, maxHp) {
  const max = Number(maxHp);
  const cur = Number(hp);
  if (!Number.isFinite(max) || max <= 0 || !Number.isFinite(cur) || cur <= 0) {
    return DAMAGE_STATES.DESTROYED;
  }
  const ratio = cur / max;
  if (ratio >= DAMAGE_THRESHOLDS.intact) return DAMAGE_STATES.INTACT;
  if (ratio >= DAMAGE_THRESHOLDS.light) return DAMAGE_STATES.LIGHT;
  return DAMAGE_STATES.HEAVY;
}

export function damageStateOfUnit(unit) {
  if (!unit || typeof unit !== 'object') return DAMAGE_STATES.DESTROYED;
  return getDamageState(unit.hp, unit.maxHp);
}

