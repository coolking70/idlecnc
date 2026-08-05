export function reserveSlotId(side, index) {
  return `${side}_reserve_${Math.max(1, Math.floor(Number(index) || 1))}`;
}

export function reserveIndexFromSlot(slotId) {
  const match = /^(friendly|enemy)_reserve_(\d+)$/.exec(String(slotId || ''));
  return match ? Number(match[2]) : null;
}

export function isReserveSlot(slotId) {
  return reserveIndexFromSlot(slotId) !== null;
}

function buildFriendlyReserveRoute(index, category = 'infantry') {
  const laneOffset = (Math.max(1, index) - 1) * 34;
  const vehicleOffset = category === 'infantry' ? 0 : -18;
  return [
    [120, 620 - laneOffset + vehicleOffset],
    [230, 590 - laneOffset + vehicleOffset],
    [360, 545 - laneOffset + vehicleOffset],
    [500, 500 - laneOffset + vehicleOffset],
    [625, 455 - laneOffset + vehicleOffset],
    [700, 430 - laneOffset + vehicleOffset]
  ];
}

function buildEnemyReserveRoute(index, category = 'infantry') {
  const laneOffset = (Math.max(1, index) - 1) * 36;
  const vehicleOffset = category === 'infantry' ? 0 : -18;
  return [
    [1120, 390 + laneOffset + vehicleOffset],
    [1030, 395 + laneOffset + vehicleOffset],
    [950, 400 + laneOffset + vehicleOffset],
    [900, 405 + laneOffset + vehicleOffset],
    [865, 410 + laneOffset + vehicleOffset],
    [850, 415 + laneOffset + vehicleOffset]
  ];
}

export function buildReserveRoute({ side, index, category = 'infantry' } = {}) {
  if (side !== 'friendly' && side !== 'enemy') throw new Error(`unknown_reserve_side:${side}`);
  const points = side === 'friendly'
    ? buildFriendlyReserveRoute(index, category)
    : buildEnemyReserveRoute(index, category);
  return points.map(([x, y]) => ({ x, y }));
}

export { buildFriendlyReserveRoute, buildEnemyReserveRoute };
