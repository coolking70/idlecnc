/** 阶段8完整性工具：只做纯数据验证，不操作 DOM / Canvas。 */

import { TECHNOLOGIES, UNIT_RANKS } from './config.js';
import { stableStringify, safeNumber } from './utils.js';
import { validateOutcomeSnapshot } from './battle-outcome.js';

const TECH_ORDER = Object.keys(TECHNOLOGIES);

/** 按等级和配置顺序筛选出依赖闭合的科技集合。 */
export function validateCompletedTechnologyClosure(completedIds) {
  const source = new Set(Array.isArray(completedIds) ? completedIds : []);
  const valid = new Set();
  TECH_ORDER
    .map((id, index) => ({ id, index, tier: safeNumber(TECHNOLOGIES[id].tier, 0) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .forEach(({ id }) => {
      if (!source.has(id)) return;
      const requires = Array.isArray(TECHNOLOGIES[id].requires) ? TECHNOLOGIES[id].requires : [];
      if (requires.every((required) => valid.has(required))) valid.add(id);
    });
  return TECH_ORDER.filter((id) => valid.has(id));
}

export function missingTechnologyPrerequisites(completedIds, techId) {
  const set = new Set(validateCompletedTechnologyClosure(completedIds));
  const tech = TECHNOLOGIES[techId];
  return tech ? (tech.requires || []).filter((id) => !set.has(id)) : [];
}

export function validateResearchHistory(history, currentRevision = 0) {
  const problems = [];
  const rows = Array.isArray(history) ? history : [];
  const revisions = rows.map((row) => row && row.revision).filter((x) => Number.isInteger(x) && x >= 0);
  if (!rows.length) problems.push('科研历史为空');
  if (new Set(revisions).size !== revisions.length) problems.push('科研历史revision重复');
  let prev = -1;
  rows.slice().sort((a, b) => safeNumber(a && a.revision, -1) - safeNumber(b && b.revision, -1)).forEach((row) => {
    const revision = safeNumber(row && row.revision, -1);
    if (revision <= prev) problems.push('科研历史revision未递增');
    prev = revision;
    const closure = validateCompletedTechnologyClosure(row && row.completed);
    if (stableStringify(closure) !== stableStringify(Array.isArray(row && row.completed) ? row.completed : [])) {
      problems.push(`科研历史revision ${revision} 前置关系不闭合`);
    }
    if (!Number.isFinite(Number(row && row.gameTime)) || Number(row.gameTime) < 0) {
      problems.push(`科研历史revision ${revision} 时间非法`);
    }
  });
  if (safeNumber(currentRevision, 0) !== Math.max(0, ...revisions, 0)) problems.push('当前科研revision与历史最高版本不一致');
  return { ok: problems.length === 0, problems };
}

/** 验证结果枚举与最终阵容是否一致。 */
export function validateBattleOutcomeConsistency(report) {
  const outcome = validateOutcomeSnapshot({
    friendly: report?.final?.friendly,
    enemy: report?.final?.enemy,
    result: report?.result,
    missionKind: report?.missionKind,
    capture: report?.capture,
    rewards: report?.rewards,
    events: report?.events
  });
  return { ok: outcome.ok, reason: outcome.reason, problems: outcome.problems };
}

export function compareBattleReports(expected, actual) {
  const keys = ['id', 'seed', 'formationId', 'theaterId', 'strategyId', 'missionKind', 'missionId',
    'duration', 'result', 'capture', 'rewards', 'initial', 'final', 'events', 'losses', 'rounds', 'scout'];
  const left = Object.fromEntries(keys.map((key) => [key, expected ? expected[key] : undefined]));
  const right = Object.fromEntries(keys.map((key) => [key, actual ? actual[key] : undefined]));
  return { ok: stableStringify(left) === stableStringify(right), expected: left, actual: right };
}

export { stableStringify, UNIT_RANKS };
