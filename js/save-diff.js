/**
 * Stage 8.2G-E-A.1 save-diff and production-signature helpers.
 *
 * This module is intentionally independent from settlement mutation. It only
 * observes two save-shaped values and compares the second value with the
 * read-only Formal Settlement Plan supplied by the caller.
 */
import { canonicalHash, cloneJson } from './production-battle-session.js';

export const IGNORED_SAVE_DIFF_PATHS = Object.freeze(['savedAt']);

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isIdentifiedArray = (value) => Array.isArray(value)
  && value.every((row) => isObject(row) && typeof row.id === 'string' && row.id);

function pathChild(path, key) {
  if (!path) return String(key);
  return Array.isArray(key) ? `${path}[${key[0]}=${key[1]}]` : `${path}.${key}`;
}

function ignored(path, ignoredPaths) {
  return ignoredPaths.includes(path);
}

/**
 * Recursive deterministic diff for primitive/object/array values.
 * Identified arrays are compared by stable row id so report insertion does
 * not disguise itself as a mutation of every existing report.
 */
export function computeSaveDiff(before, after, { ignoredPaths = IGNORED_SAVE_DIFF_PATHS } = {}) {
  const rows = [];
  const ignoredList = [...new Set(ignoredPaths || [])].sort();
  const visit = (left, right, path) => {
    if (ignored(path, ignoredList)) return;
    if (Object.is(left, right)) return;
    if (left === undefined) { rows.push({ path, type: 'added', before: undefined, after: cloneJson(right) }); return; }
    if (right === undefined) { rows.push({ path, type: 'removed', before: cloneJson(left), after: undefined }); return; }
    if (Array.isArray(left) && Array.isArray(right)) {
      if (isIdentifiedArray(left) && isIdentifiedArray(right)) {
        const leftMap = new Map(left.map((row) => [row.id, row]));
        const rightMap = new Map(right.map((row) => [row.id, row]));
        const ids = [...new Set([...leftMap.keys(), ...rightMap.keys()])].sort();
        ids.forEach((id) => visit(leftMap.get(id), rightMap.get(id), pathChild(path, ['id', id])));
        const leftOrder = left.map((row) => row.id).join('|');
        const rightOrder = right.map((row) => row.id).join('|');
        if (leftOrder !== rightOrder) rows.push({ path: `${path}[*order]`, type: 'changed', before: leftOrder, after: rightOrder });
        return;
      }
      const length = Math.max(left.length, right.length);
      for (let index = 0; index < length; index += 1) visit(left[index], right[index], `${path}[${index}]`);
      return;
    }
    if (isObject(left) && isObject(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      keys.forEach((key) => visit(left[key], right[key], pathChild(path, key)));
      return;
    }
    rows.push({ path, type: 'changed', before: cloneJson(left), after: cloneJson(right) });
  };
  visit(before, after, '');
  return rows;
}

function pathMatches(path, allowed) {
  if (allowed === path) return true;
  if (allowed.endsWith('.*')) return path.startsWith(allowed.slice(0, -1));
  if (allowed.endsWith('**')) return path.startsWith(allowed.slice(0, -2));
  if (allowed.endsWith('[**]')) return path.startsWith(`${allowed.slice(0, -4)}[`);
  return false;
}

function unitIndexPath(prefix, id, field = null) {
  return `${prefix}[id=${id}]${field ? `.${field}` : ''}`;
}

function reportIdPath(prefix, id) {
  return `${prefix}[id=${id}]`;
}

function objectWithout(state, keys) {
  const copy = cloneJson(state || {});
  keys.forEach((key) => { delete copy[key]; });
  return copy;
}

/** Production signature intentionally excludes active battle/replay UX. */
export function productionStateSnapshot(state) {
  return {
    resources: cloneJson(state?.resources || {}),
    units: cloneJson(state?.units || []),
    formations: cloneJson(state?.formations || []),
    buildings: cloneJson(state?.buildings || []),
    research: cloneJson(state?.research || {}),
    theaters: cloneJson(state?.theaters || {}),
    stats: cloneJson(state?.stats || {}),
    battleSettlementLedger: cloneJson(state?.battleSettlementLedger || {}),
    battleSessions: cloneJson(state?.battleSessions || {}),
    battles: cloneJson(state?.battles || [])
  };
}

export function productionStateSignature(state) {
  return canonicalHash(productionStateSnapshot(state));
}

function unrelatedSnapshot(state, plan) {
  const participating = new Set(plan?.unitUpdates?.map((row) => row.unitId) || []);
  (plan?.unitRemovals || []).forEach((id) => participating.add(id));
  const theaterId = plan?.theaterUpdate?.theaterId || null;
  const operationId = plan?.operationUpdate?.operationId || null;
  return {
    buildings: cloneJson(state?.buildings || []),
    research: cloneJson(state?.research || {}),
    settings: cloneJson(state?.settings || {}),
    unrelatedUnits: cloneJson((state?.units || []).filter((unit) => !participating.has(unit?.id))),
    unrelatedTheaters: objectWithout(state?.theaters || {}, theaterId ? [theaterId] : []),
    unrelatedOperations: objectWithout(state?.operations || {}, operationId ? [operationId] : [])
  };
}

function buildAllowedPaths(before, after, plan) {
  const paths = [
    'savedAt', 'saveRevision', 'activeBattle.**', 'activeBattleSessionId',
    'log[**]', 'command.used', 'command.capacity', 'power.used', 'rates.supply'
  ];
  Object.keys(plan?.rewards || {}).forEach((key) => paths.push(`resources.${key}`));
  const unitIds = new Set([...(plan?.unitUpdates || []).map((row) => row.unitId), ...(plan?.unitRemovals || [])]);
  (before?.units || []).forEach((row) => { if (unitIds.has(row?.id)) paths.push(unitIndexPath('units', row.id), unitIndexPath('units', row.id, '**')); });
  (after?.units || []).forEach((row) => { if (unitIds.has(row?.id)) paths.push(unitIndexPath('units', row.id), unitIndexPath('units', row.id, '**')); });
  if (plan?.formationUpdate?.formationId) paths.push(unitIndexPath('formations', plan.formationUpdate.formationId, '**'));
  if (plan?.theaterUpdate?.theaterId) paths.push(`theaters.${plan.theaterUpdate.theaterId}.**`);
  // Stage 10-E：正式结算反向改写该战区的动态压力（strategic-loop authority）。
  // 允许根键（旧档首次结算时创建容器）与本次作战目标战区的行；
  // 其余战区的 pressure 变更仍然视为意外变更。
  if (plan?.theaterUpdate?.theaterId) {
    paths.push('theaterPressure', `theaterPressure.${plan.theaterUpdate.theaterId}`, `theaterPressure.${plan.theaterUpdate.theaterId}.**`);
  }
  if (plan?.operationUpdate?.operationId) paths.push(`operations.${plan.operationUpdate.operationId}.**`);
  paths.push('stats.battlesFought', 'stats.victories');
  if (plan?.reportId) paths.push(reportIdPath('battles', plan.reportId), 'battles[*order]');
  const settlementId = after?.activeBattle?.settlementId;
  const sessionId = after?.activeBattle?.battleSessionId;
  if (settlementId) paths.push(`battleSettlementLedger.${settlementId}`, `battleSettlementLedger.${settlementId}.**`);
  if (sessionId) paths.push(`battleSessions.${sessionId}.**`);
  if (plan?.formationUpdate?.removeUnitIds?.length) paths.push('formations[*order]');
  if (plan?.unitRemovals?.length) paths.push('units[*order]');
  return [...new Set(paths)];
}

function formalPlanMatches(before, after, plan) {
  const problems = [];
  const num = (value) => Number(value || 0);
  Object.entries(plan?.rewards || {}).forEach(([key, expected]) => {
    const delta = num(after?.resources?.[key]) - num(before?.resources?.[key]);
    if (delta !== num(expected)) problems.push(`reward:${key}`);
  });
  (plan?.unitUpdates || []).forEach((expected) => {
    const actual = (after?.units || []).find((unit) => unit?.id === expected.unitId);
    for (const key of ['hp', 'maxHp', 'damage', 'status', 'battles', 'experience']) {
      if (!actual || actual[key] !== expected[key]) problems.push(`unit:${expected.unitId}:${key}`);
    }
  });
  (plan?.unitRemovals || []).forEach((id) => {
    if ((after?.units || []).some((unit) => unit?.id === id)) problems.push(`unit_not_removed:${id}`);
  });
  if (plan?.formationUpdate) {
    const actual = (after?.formations || []).find((row) => row?.id === plan.formationUpdate.formationId);
    for (const key of ['status', 'battles', 'experience']) {
      if (!actual || actual[key] !== plan.formationUpdate[key]) problems.push(`formation:${key}`);
    }
  }
  const theater = plan?.theaterUpdate;
  const actualTheater = theater && after?.theaters?.[theater.theaterId];
  if (theater && actualTheater) {
    for (const key of ['lastResult', 'lastBattleId']) if (actualTheater[key] !== theater[key]) problems.push(`theater:${key}`);
    if (theater.captured && actualTheater.captured !== true) problems.push('theater:captured');
  }
  if (after?.stats?.battlesFought !== num(before?.stats?.battlesFought) + num(plan?.statsUpdate?.battlesFoughtDelta)) problems.push('stats:battlesFought');
  if (after?.stats?.victories !== num(before?.stats?.victories) + num(plan?.statsUpdate?.victoriesDelta)) problems.push('stats:victories');
  const reports = (after?.battles || []).filter((row) => row?.id === plan?.reportId);
  if (reports.length !== 1) problems.push('report:exactly_once');
  return problems;
}

/**
 * Recompute the real settlement diff against a read-only formal plan.
 * Evidence may report this result, but verifiers should call this function
 * themselves instead of trusting an evidence `passed` boolean.
 */
export function recomputeSettlementSaveDiff(before, after, plan, options = {}) {
  const ignoredPaths = options.ignoredPaths || IGNORED_SAVE_DIFF_PATHS;
  const changed = computeSaveDiff(before, after, { ignoredPaths });
  const allowedChangedPaths = buildAllowedPaths(before, after, plan);
  const unexpectedChangedPaths = changed
    .filter((row) => !allowedChangedPaths.some((allowed) => pathMatches(row.path, allowed)))
    .map((row) => row.path);
  const formalProblems = formalPlanMatches(before, after, plan);
  const unrelatedStatePreserved = canonicalHash(unrelatedSnapshot(before, plan))
    === canonicalHash(unrelatedSnapshot(after, plan));
  const beforeHash = canonicalHash(objectWithout(before, ['savedAt']));
  const afterHash = canonicalHash(objectWithout(after, ['savedAt']));
  return {
    beforeHash,
    afterHash,
    changedPaths: changed.map((row) => row.path),
    allowedChangedPaths,
    unexpectedChangedPaths,
    formalPlanProblems: formalProblems,
    unrelatedStatePreserved,
    ignoredSaveDiffPaths: [...ignoredPaths],
    passed: unexpectedChangedPaths.length === 0 && formalProblems.length === 0 && unrelatedStatePreserved
  };
}
