const FOOTPRINTS = Object.freeze({
  infantry: Object.freeze({ width: 28, height: 24, halfWidth: 14, halfHeight: 12, radius: 14 }),
  at_infantry: Object.freeze({ width: 30, height: 26, halfWidth: 15, halfHeight: 13, radius: 15 }),
  mbt: Object.freeze({ width: 72, height: 48, halfWidth: 36, halfHeight: 24, radius: 36 }),
  scout_car: Object.freeze({ width: 54, height: 32, halfWidth: 27, halfHeight: 16, radius: 27 }),
  enemy_scout_car: Object.freeze({ width: 54, height: 32, halfWidth: 27, halfHeight: 16, radius: 27 }),
  repair_vehicle: Object.freeze({ width: 56, height: 34, halfWidth: 28, halfHeight: 17, radius: 28 }),
  wreck: Object.freeze({ width: 64, height: 40, halfWidth: 32, halfHeight: 20, radius: 32 })
});
const DEFAULT_FOOTPRINT = Object.freeze({ width: 40, height: 30, halfWidth: 20, halfHeight: 15, radius: 20 });

export function visualFootprint(actor = {}) {
  return { ...(FOOTPRINTS[actor.type] || FOOTPRINTS[actor.category] || (actor.kind === 'wreck' ? FOOTPRINTS.wreck : DEFAULT_FOOTPRINT)) };
}

export function footprintOverlapMetric(left = {}, right = {}) {
  const a = left.footprint || left;
  const b = right.footprint || right;
  const halfWidth = Math.max(1, Number(a.halfWidth ?? a.width / 2) || 1) + Math.max(1, Number(b.halfWidth ?? b.width / 2) || 1);
  const halfHeight = Math.max(1, Number(a.halfHeight ?? a.height / 2) || 1) + Math.max(1, Number(b.halfHeight ?? b.height / 2) || 1);
  const dx = (Number(right.visualCenter?.x ?? right.x) || 0) - (Number(left.visualCenter?.x ?? left.x) || 0);
  const dy = (Number(right.visualCenter?.y ?? right.y) || 0) - (Number(left.visualCenter?.y ?? left.y) || 0);
  return Math.hypot(dx / halfWidth, dy / halfHeight);
}

export function footprintSeparationThreshold(left = {}, right = {}) {
  const leftLarge = Math.max(Number(left.footprint?.halfWidth) || 0, Number(left.footprint?.halfHeight) || 0) >= 24;
  const rightLarge = Math.max(Number(right.footprint?.halfWidth) || 0, Number(right.footprint?.halfHeight) || 0) >= 24;
  return leftLarge && rightLarge ? .96 : .90;
}

function stableAxis(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % 2 === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
}

export function separateVisualFootprints(actors, bounds = {}, options = {}) {
  const rows = actors.map((actor) => ({ ...actor, footprint: actor.footprint || visualFootprint(actor), visualCenter: { ...actor.visualCenter }, nextPosition: { ...actor.nextPosition }, previousPosition: { ...actor.previousPosition } }));
  for (let pass = 0; pass < 6; pass += 1) {
    for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
      const left = rows[leftIndex]; const right = rows[rightIndex];
      const dx = right.visualCenter.x - left.visualCenter.x; const dy = right.visualCenter.y - left.visualCenter.y; const distance = Math.hypot(dx, dy);
      const metric = footprintOverlapMetric(left, right); const threshold = footprintSeparationThreshold(left, right);
      if (metric >= threshold) continue;
      const axis = distance > .001 ? { x: dx / distance, y: dy / distance } : stableAxis(`${left.actorId}:${right.actorId}`);
      const minimum = (left.footprint.radius + right.footprint.radius) * threshold;
      const shift = Math.min(14, Math.max(0.5, (minimum - distance) * .5));
      const move = (row, sign) => {
        row.visualCenter.x += axis.x * shift * sign; row.visualCenter.y += axis.y * shift * sign;
        row.nextPosition.x += axis.x * shift * sign; row.nextPosition.y += axis.y * shift * sign;
        row.previousPosition.x += axis.x * shift * sign; row.previousPosition.y += axis.y * shift * sign;
      };
      move(left, -1); move(right, 1);
    }
  }
  const blockers = (options.blockers || []).map((blocker) => ({ ...blocker, footprint: blocker.footprint || visualFootprint(blocker), visualCenter: { ...blocker.visualCenter } }));
  for (let pass = 0; pass < 6; pass += 1) {
    for (const row of rows) {
      if (row.visualState === 'wreck' || row.alive === false) continue;
      for (const blocker of blockers) {
        if (blocker.actorId && blocker.actorId === row.actorId) continue;
        const metric = footprintOverlapMetric(row, blocker); const threshold = footprintSeparationThreshold(row, blocker);
        if (metric >= threshold) continue;
        const dx = row.visualCenter.x - blocker.visualCenter.x; const dy = row.visualCenter.y - blocker.visualCenter.y; const distance = Math.hypot(dx, dy);
        const axis = distance > .001 ? { x: dx / distance, y: dy / distance } : stableAxis(`${row.actorId}:${blocker.actorId || blocker.id}`);
        const shift = Math.min(16, Math.max(.5, ((row.footprint.radius + blocker.footprint.radius) * threshold - distance)));
        row.visualCenter.x += axis.x * shift; row.visualCenter.y += axis.y * shift;
        row.nextPosition.x += axis.x * shift; row.nextPosition.y += axis.y * shift;
        row.previousPosition.x += axis.x * shift; row.previousPosition.y += axis.y * shift;
      }
    }
  }
  const width = Number(bounds.width) || Infinity; const height = Number(bounds.height) || Infinity;
  for (const row of rows) { row.visualCenter.x = Math.max(0, Math.min(width, row.visualCenter.x)); row.visualCenter.y = Math.max(0, Math.min(height, row.visualCenter.y)); }
  return rows;
}
