export const PRESENTATION_DURATION = 35;
export const TIME_EPSILON = 1e-6;
const PRESENTATION_NODES = Object.freeze([0, 7, 13, 21, 26, 32, 35]);

function actorRows(contract) { return [...(contract?.normalizedBattle?.actors?.friendly || []), ...(contract?.normalizedBattle?.actors?.enemy || [])]; }
function sideOf(contract, id) { return actorRows(contract).find((actor) => actor.id === id)?.side || null; }
function finiteTime(value, fallback = 0) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function firstTime(anchors, predicate, fallback) { return anchors.filter(predicate).map((anchor) => finiteTime(anchor.reportTime)).sort((a, b) => a - b)[0] ?? fallback; }
function lastTime(anchors, predicate, fallback) { const values = anchors.filter(predicate).map((anchor) => finiteTime(anchor.reportTime)).sort((a, b) => a - b); return values.at(-1) ?? fallback; }

export function deriveVictoryMilestones(contract) {
  const anchors = contract?.authorityAnchors || [];
  const resultAnchor = anchors.find((anchor) => anchor.type === 'result');
  const firstContact = firstTime(anchors, (anchor) => ['fire', 'damage', 'ambush'].includes(anchor.type), firstTime(anchors, (anchor) => anchor.type !== 'phase', 0));
  const enemyDestroys = anchors.filter((anchor) => anchor.type === 'destroy' && sideOf(contract, anchor.targetId) === 'enemy').sort((a, b) => finiteTime(a.reportTime) - finiteTime(b.reportTime));
  const friendlyDestroys = anchors.filter((anchor) => anchor.type === 'destroy' && sideOf(contract, anchor.targetId) === 'friendly');
  const firstEnemyDestroyed = enemyDestroys[0]?.reportTime ?? firstContact;
  const lastEnemyDestroyed = enemyDestroys.at(-1)?.reportTime ?? firstEnemyDestroyed;
  const midEnemyDestroyed = enemyDestroys.length >= 2
    ? enemyDestroys[Math.floor((enemyDestroys.length - 1) / 2)].reportTime
    : (finiteTime(firstEnemyDestroyed) + finiteTime(lastEnemyDestroyed)) / 2;
  const friendlyMajorDamage = anchors.filter((anchor) => anchor.type === 'damage' && sideOf(contract, anchor.targetId) === 'friendly').sort((a, b) => Number(b.value || 0) - Number(a.value || 0) || finiteTime(a.reportTime) - finiteTime(b.reportTime))[0];
  const lastFriendlyDestroyedOrMajorLoss = friendlyDestroys.length
    ? lastTime(anchors, (anchor) => anchor.type === 'destroy' && sideOf(contract, anchor.targetId) === 'friendly', finiteTime(lastEnemyDestroyed))
    : friendlyMajorDamage?.reportTime ?? midEnemyDestroyed;
  const resultTime = finiteTime(resultAnchor?.reportTime, finiteTime(contract?.normalizedBattle?.battle?.duration, lastEnemyDestroyed));
  return {
    sourceStart: 0,
    firstContact: finiteTime(firstContact),
    firstEnemyDestroyed: finiteTime(firstEnemyDestroyed),
    midEnemyDestroyed: finiteTime(midEnemyDestroyed),
    lastFriendlyDestroyedOrMajorLoss: finiteTime(lastFriendlyDestroyedOrMajorLoss),
    lastEnemyDestroyed: finiteTime(lastEnemyDestroyed),
    resultTime
  };
}

function strictlyIncreasing(values) {
  const result = [];
  for (const value of values) result.push(Math.max(Number(value), (result.at(-1) ?? -Infinity) + TIME_EPSILON));
  return result;
}

export function buildSemanticTimeMap(contract, options = {}) {
  const milestones = deriveVictoryMilestones(contract);
  const requestedPresentation = options.presentationNodes || PRESENTATION_NODES;
  const sourceValues = strictlyIncreasing([
    milestones.sourceStart,
    milestones.firstContact,
    milestones.firstEnemyDestroyed,
    milestones.midEnemyDestroyed,
    milestones.lastFriendlyDestroyedOrMajorLoss,
    milestones.lastEnemyDestroyed,
    milestones.resultTime
  ]);
  const presentationValues = strictlyIncreasing(requestedPresentation).map((value) => Math.min(PRESENTATION_DURATION, value));
  presentationValues[presentationValues.length - 1] = PRESENTATION_DURATION;
  return {
    duration: PRESENTATION_DURATION,
    milestones,
    knots: sourceValues.map((source, index) => ({ source, presentation: presentationValues[index] })),
    sourceDuration: Math.max(sourceValues.at(-1), finiteTime(contract?.normalizedBattle?.battle?.duration, 0)),
    sourceId: options.sourceId || null
  };
}

function interpolate(left, right, value) { return left + (right - left) * value; }
function mapWithKnots(knots, value, leftKey, rightKey) {
  const safe = finiteTime(value, knots[0][leftKey]);
  if (safe <= knots[0][leftKey]) return knots[0][rightKey];
  for (let index = 1; index < knots.length; index += 1) {
    const left = knots[index - 1]; const right = knots[index];
    if (safe <= right[leftKey]) {
      const span = Math.max(TIME_EPSILON, right[leftKey] - left[leftKey]);
      return interpolate(left[rightKey], right[rightKey], (safe - left[leftKey]) / span);
    }
  }
  return knots.at(-1)[rightKey];
}

export function mapSourceToPresentation(timeMap, sourceTime) { return Math.max(0, Math.min(PRESENTATION_DURATION, mapWithKnots(timeMap.knots, sourceTime, 'source', 'presentation'))); }
export function mapPresentationToSource(timeMap, presentationTime) { return Math.max(0, Math.min(timeMap.sourceDuration, mapWithKnots(timeMap.knots.slice().sort((a, b) => a.presentation - b.presentation), presentationTime, 'presentation', 'source'))); }

export function validateSemanticTimeMap(timeMap, contract) {
  const errors = [];
  if (!timeMap?.knots?.length) errors.push('time map has no knots');
  let previousSource = -Infinity; let previousPresentation = -Infinity;
  for (const knot of timeMap.knots || []) {
    if (knot.source < previousSource) errors.push('source knots are not monotonic');
    if (knot.presentation < previousPresentation) errors.push('presentation knots are not monotonic');
    if (knot.presentation < 0 || knot.presentation > PRESENTATION_DURATION) errors.push('presentation knot outside 0..35');
    previousSource = knot.source; previousPresentation = knot.presentation;
  }
  if (timeMap.knots?.at(-1)?.presentation !== PRESENTATION_DURATION) errors.push('result knot must map to 35');
  const anchors = contract?.authorityAnchors || [];
  const mapped = anchors.map((anchor) => mapSourceToPresentation(timeMap, anchor.reportTime));
  if (mapped.some((time, index) => index && time < mapped[index - 1] - TIME_EPSILON)) errors.push('anchor mapping is not monotonic');
  if (timeMap.milestones.lastEnemyDestroyed > timeMap.milestones.resultTime + TIME_EPSILON) errors.push('lastEnemyDestroyed is after result');
  if (mapSourceToPresentation(timeMap, timeMap.milestones.lastEnemyDestroyed) > 32.5 + TIME_EPSILON) errors.push('lastEnemyDestroyed is later than 32.5 presentation seconds');
  return { ok: errors.length === 0, errors };
}

export { PRESENTATION_NODES };
