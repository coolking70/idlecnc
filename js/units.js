/** 阶段8单位档案、呼号与老兵等级。 */

import { UNITS, UNIT_RANKS } from './config.js';
import { getDamageState } from './unit-status.js';
import { clamp, safeNumber } from './utils.js';

const RANK_ORDER = Object.values(UNIT_RANKS).sort((a, b) => a.minExperience - b.minExperience);

export function getUnitRank(unitOrExperience) {
  const experience = Math.max(0, safeNumber(
    typeof unitOrExperience === 'object' ? unitOrExperience && unitOrExperience.experience : unitOrExperience, 0
  ));
  let rank = RANK_ORDER[0];
  RANK_ORDER.forEach((candidate) => { if (experience >= candidate.minExperience) rank = candidate; });
  return { ...rank, modifiers: { ...rank.modifiers } };
}

export function getRankProgress(unitOrExperience) {
  const experience = Math.max(0, safeNumber(typeof unitOrExperience === 'object' ? unitOrExperience.experience : unitOrExperience, 0));
  const rank = getUnitRank(experience);
  const next = RANK_ORDER.find((candidate) => candidate.minExperience > rank.minExperience) || null;
  return {
    rankId: rank.id, rankName: rank.name, experience,
    nextRankId: next ? next.id : null,
    nextRankName: next ? next.name : null,
    nextExperience: next ? next.minExperience : null,
    remaining: next ? Math.max(0, next.minExperience - experience) : 0,
    percent: next ? clamp((experience - rank.minExperience) / (next.minExperience - rank.minExperience), 0, 1) * 100 : 100
  };
}

export function formatUnitDisplayName(unit, units = UNITS) {
  const def = unit && units[unit.type];
  const base = def ? def.name : (unit && unit.type) || '未知单位';
  const callsign = typeof (unit && unit.callsign) === 'string' ? unit.callsign.trim() : '';
  return callsign ? `${callsign}（${base}）` : base;
}

export function renameUnit(state, unitId, callsign) {
  const unit = state && Array.isArray(state.units) ? state.units.find((item) => item && item.id === unitId) : null;
  if (!unit) return { ok: false, code: 'unknown_unit', reason: '单位不存在', unit: null };
  const normalized = String(callsign == null ? '' : callsign).trim().slice(0, 12);
  unit.callsign = normalized || null;
  return { ok: true, code: 'ready', reason: '', unit };
}

export function getUnitEffectiveStats(unit) {
  const def = unit && UNITS[unit.type];
  if (!def) return null;
  const rank = getUnitRank(unit);
  const stats = {};
  Object.keys(def.stats || {}).forEach((key) => {
    const modifier = rank.modifiers[key] || 1;
    stats[key] = key === 'hp' ? def.stats[key] : Number((safeNumber(def.stats[key], 0) * modifier).toFixed(4));
  });
  return { ...stats, rankId: rank.id, rankName: rank.name, rankModifiers: { ...rank.modifiers }, base: { ...def.stats } };
}

export function sanitizeUnit(unit) {
  if (!unit || typeof unit !== 'object' || !UNITS[unit.type]) return null;
  const def = UNITS[unit.type];
  unit.callsign = typeof unit.callsign === 'string' ? unit.callsign.trim().slice(0, 12) || null : null;
  unit.experience = Number.isFinite(Number(unit.experience)) && Number(unit.experience) >= 0 ? Number(unit.experience) : 0;
  unit.battles = Number.isFinite(Number(unit.battles)) && Number(unit.battles) >= 0 ? Math.floor(Number(unit.battles)) : 0;
  unit.maxHp = safeNumber(def.stats.hp, 100);
  unit.hp = clamp(safeNumber(unit.hp, unit.maxHp), 0, unit.maxHp);
  unit.damage = getDamageState(unit.hp, unit.maxHp);
  return unit;
}

export function sanitizeUnits(state) {
  const notes = [];
  if (!state || typeof state !== 'object') return { repaired: false, notes };
  if (!Array.isArray(state.units)) { state.units = []; return { repaired: true, notes: ['单位列表缺失，已重建。'] }; }
  const ids = new Set();
  state.units = state.units.filter((unit) => {
    if (!unit || typeof unit !== 'object' || !UNITS[unit.type]) { notes.push('非法单位已移除。'); return false; }
    if (typeof unit.id !== 'string' || !unit.id || ids.has(unit.id)) { notes.push('重复或缺失单位ID已移除。'); return false; }
    ids.add(unit.id);
    const before = JSON.stringify({ callsign: unit.callsign, experience: unit.experience, battles: unit.battles });
    sanitizeUnit(unit);
    if (before !== JSON.stringify({ callsign: unit.callsign, experience: unit.experience, battles: unit.battles })) notes.push(`${formatUnitDisplayName(unit)}档案字段已规范化。`);
    return true;
  });
  return { repaired: notes.length > 0, notes };
}

export function filterUnits(state, filter = {}) {
  const units = Array.isArray(state && state.units) ? state.units.slice() : [];
  const category = filter.category && filter.category !== 'all' ? filter.category : null;
  const status = filter.status && filter.status !== 'all' ? filter.status : null;
  const rankId = filter.rankId && filter.rankId !== 'all' ? filter.rankId : null;
  return units.filter((unit) => {
    const def = UNITS[unit.type];
    if (category && (!def || def.category !== category)) return false;
    if (status === 'damaged' && getDamageState(unit.hp, unit.maxHp) === 'intact') return false;
    if (status && status !== 'damaged' && unit.status !== status) return false;
    if (rankId && getUnitRank(unit).id !== rankId) return false;
    return true;
  });
}

export function sortUnits(units, sort = 'createdAt') {
  const list = Array.isArray(units) ? units.slice() : [];
  const value = (unit) => {
    if (sort === 'experience') return safeNumber(unit.experience, 0);
    if (sort === 'battles') return safeNumber(unit.battles, 0);
    if (sort === 'hpRatio') return safeNumber(unit.maxHp, 1) > 0 ? safeNumber(unit.hp, 0) / unit.maxHp : 0;
    if (sort === 'type') return String(unit.type || '');
    return safeNumber(unit.createdAt, 0);
  };
  return list.sort((a, b) => {
    const av = value(a); const bv = value(b);
    if (av === bv) return String(a.id).localeCompare(String(b.id));
    return sort === 'type' ? String(av).localeCompare(String(bv)) : sort === 'createdAt' ? av - bv : bv - av;
  });
}

export const UNITS_API = { getUnitRank, getRankProgress, formatUnitDisplayName, renameUnit, getUnitEffectiveStats, sanitizeUnit, sanitizeUnits, filterUnits, sortUnits };
