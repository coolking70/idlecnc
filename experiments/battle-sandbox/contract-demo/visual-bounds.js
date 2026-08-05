export function getVisualBounds(actor, center = actor?.visualCenter || actor?.anchorPosition || { x: 0, y: 0 }) {
  const vehicle = !actor?.members?.length;
  const tank = actor?.type === 'mbt';
  const halfWidth = vehicle ? (tank ? 29 : 21) : 18;
  const halfHeight = vehicle ? (tank ? 17 : 12) : 13;
  return { left: center.x - halfWidth, right: center.x + halfWidth, top: center.y - halfHeight, bottom: center.y + halfHeight, width: halfWidth * 2, height: halfHeight * 2, center: { x: center.x, y: center.y } };
}

export function boundsIntersect(first, second, padding = 0) {
  return first.left < second.right + padding && first.right > second.left - padding && first.top < second.bottom + padding && first.bottom > second.top - padding;
}

export function distanceBetween(first, second) { return Math.hypot(first.x - second.x, first.y - second.y); }
