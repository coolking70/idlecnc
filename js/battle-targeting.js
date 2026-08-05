import { hashString } from './utils.js';

const CATEGORY_PRIORITY = Object.freeze({
  at_infantry: Object.freeze(['armor', 'vehicle', 'infantry', 'support']),
  armor: Object.freeze(['infantry', 'support', 'vehicle', 'armor']),
  infantry: Object.freeze(['at_infantry', 'support', 'infantry', 'vehicle', 'armor']),
  vehicle: Object.freeze(['support', 'infantry', 'vehicle', 'armor']),
  support: Object.freeze(['infantry', 'vehicle', 'armor'])
});

const DEFAULT_PRIORITY = Object.freeze(['infantry', 'vehicle', 'armor', 'support']);

export function targetCategoryPriority(actorCategory) {
  return CATEGORY_PRIORITY[actorCategory] || DEFAULT_PRIORITY;
}

function compareIds(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Pure comparator. It only reads precomputed ranking fields. */
export function compareTargetRanking(a, b) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.hp !== b.hp) return a.hp - b.hp;
  if (a.tieKey !== b.tieKey) return a.tieKey - b.tieKey;
  return compareIds(a.id, b.id);
}

export function buildTargetRanking(actor, targets, tieSalt) {
  const priorities = targetCategoryPriority(actor?.category);
  const salt = Number(tieSalt) >>> 0;
  return (Array.isArray(targets) ? targets : []).map((target) => {
    let priority = priorities.indexOf(target?.category);
    if (priority < 0) priority = priorities.length;
    const id = String(target?.id ?? '');
    return {
      target,
      id,
      priority,
      hp: Number(target?.hp) || 0,
      tieKey: hashString(`${salt}:${String(actor?.id ?? '')}:${id}`)
    };
  });
}

export function nativeSortRanking(ranking) {
  return ranking.slice().sort(compareTargetRanking);
}

export function insertionSortRanking(ranking) {
  const sorted = ranking.slice();
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    let j = i - 1;
    while (j >= 0 && compareTargetRanking(sorted[j], current) > 0) {
      sorted[j + 1] = sorted[j];
      j -= 1;
    }
    sorted[j + 1] = current;
  }
  return sorted;
}

export function mergeSortRanking(ranking) {
  if (ranking.length < 2) return ranking.slice();
  const middle = Math.floor(ranking.length / 2);
  const left = mergeSortRanking(ranking.slice(0, middle));
  const right = mergeSortRanking(ranking.slice(middle));
  const merged = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (compareTargetRanking(left[i], right[j]) <= 0) merged.push(left[i++]);
    else merged.push(right[j++]);
  }
  return merged.concat(left.slice(i), right.slice(j));
}

function sortRanking(ranking, sortImplementation) {
  if (typeof sortImplementation === 'function') return sortImplementation(ranking.slice());
  if (sortImplementation === 'insertion' || sortImplementation === insertionSortRanking) return insertionSortRanking(ranking);
  if (sortImplementation === 'merge' || sortImplementation === 'mergeSort' || sortImplementation === mergeSortRanking) return mergeSortRanking(ranking);
  return nativeSortRanking(ranking);
}

/**
 * Selects a target with exactly one RNG draw for every non-empty candidate set.
 * The draw is a salt only; sorting itself is pure and engine-independent.
 */
export function chooseTargetDeterministically(actor, targets, rng, options = {}) {
  if (!Array.isArray(targets) || targets.length === 0) return null;
  if (!rng || typeof rng.int !== 'function') throw new TypeError('deterministic target selection requires rng.int');
  const tieSalt = rng.int(0, 0xFFFFFFFF);
  const ranking = buildTargetRanking(actor, targets, tieSalt);
  const sorted = sortRanking(ranking, options.sortImplementation || 'native');
  return sorted[0]?.target || null;
}

export const TARGET_CATEGORY_PRIORITY = CATEGORY_PRIORITY;
