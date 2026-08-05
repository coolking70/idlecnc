export function createWreck(sourceUnitId, x, y, angle, createdAt) {
  return { id: `wreck_${sourceUnitId}`, sourceUnitId, x, y, angle, createdAt, smokeLevel: 0.75, burnUntil: createdAt + 4.28 };
}

export function getWreckSmoke(wreck, time) {
  if (time <= wreck.burnUntil) return wreck.smokeLevel;
  return Math.max(0.25, wreck.smokeLevel - (time - wreck.burnUntil) * 0.08);
}
