import { buildSemanticTimeMap, mapPresentationToSource, mapSourceToPresentation, PRESENTATION_DURATION, validateSemanticTimeMap } from './semantic-time-mapper.js';

// Compatibility exports for the original B contract test. New plans always pass a semantic time map.
export const TIME_MAP_KNOTS = Object.freeze([
  Object.freeze({ source: 0, presentation: 0 }),
  Object.freeze({ source: 2.3, presentation: 7 }),
  Object.freeze({ source: 16.86, presentation: 16 }),
  Object.freeze({ source: 31.04, presentation: 25 }),
  Object.freeze({ source: 44.45, presentation: 32 }),
  Object.freeze({ source: 45.6, presentation: 35 })
]);

function legacyMap(knots, value, leftKey, rightKey) {
  const safe = Number.isFinite(Number(value)) ? Number(value) : knots[0][leftKey];
  if (safe <= knots[0][leftKey]) return knots[0][rightKey];
  for (let index = 1; index < knots.length; index += 1) {
    const left = knots[index - 1]; const right = knots[index];
    if (safe <= right[leftKey]) {
      const span = Math.max(Number.EPSILON, right[leftKey] - left[leftKey]);
      return left[rightKey] + (right[rightKey] - left[rightKey]) * ((safe - left[leftKey]) / span);
    }
  }
  return knots.at(-1)[rightKey];
}

export function mapSourceTimeToPresentation(sourceTime) { return Math.max(0, Math.min(PRESENTATION_DURATION, legacyMap(TIME_MAP_KNOTS, sourceTime, 'source', 'presentation'))); }
export function mapPresentationTimeToSource(presentationTime) { return Math.max(0, Math.min(TIME_MAP_KNOTS.at(-1).source, legacyMap(TIME_MAP_KNOTS, presentationTime, 'presentation', 'source'))); }

export function mapAuthorityAnchors(anchors, timeMap = null) {
  return anchors.map((anchor, sourceIndex) => ({
    ...anchor,
    sourceIndex,
    reportTime: anchor.reportTime,
    presentationTime: Number((timeMap ? mapSourceToPresentation(timeMap, anchor.reportTime) : mapSourceTimeToPresentation(anchor.reportTime)).toFixed(6))
  })).sort((a, b) => (a.presentationTime - b.presentationTime) || (a.sourceIndex - b.sourceIndex));
}

export function validateMappedTimes(mappedAnchors, timeMap = null, contract = null) {
  const errors = [];
  let previous = -Infinity;
  const sourceEventIds = new Set();
  for (const anchor of mappedAnchors) {
    if (anchor.presentationTime < 0 || anchor.presentationTime > PRESENTATION_DURATION) errors.push(`${anchor.id} outside presentation range`);
    if (anchor.presentationTime < previous) errors.push(`${anchor.id} is not monotonic`);
    if (sourceEventIds.has(anchor.sourceEventId)) errors.push(`duplicate sourceEventId ${anchor.sourceEventId}`);
    sourceEventIds.add(anchor.sourceEventId); previous = anchor.presentationTime;
  }
  if (timeMap && contract) errors.push(...validateSemanticTimeMap(timeMap, contract).errors);
  return { ok: errors.length === 0, errors };
}

export { buildSemanticTimeMap, mapSourceToPresentation, mapPresentationToSource, PRESENTATION_DURATION };
