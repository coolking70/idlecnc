function movePoint(point, dx, dy = 0) {
  return { ...point, x: point.x + dx, y: point.y + dy };
}

export function applyReturnChoreography(state, progress, plan) {
  const amount = Math.max(0, Math.min(1, Number(progress) || 0));
  const shift = 360 * amount;
  for (const actor of state.actors || []) {
    if (actor.side !== 'friendly' || actor.alive !== true) continue;
    actor.visualCenter = movePoint(actor.visualCenter, -shift);
    actor.anchorPosition = movePoint(actor.anchorPosition || actor.visualCenter, -shift);
    if (Array.isArray(actor.memberPositions)) actor.memberPositions = actor.memberPositions.map((member) => movePoint(member, -shift));
  }
  state.returning = true;
  state.returnProgress = amount;
  state.returnShift = shift;
  return state;
}

export function validateReturnChoreography(before, after, progress) {
  const errors = [];
  const beforeById = Object.fromEntries((before?.actors || []).map((actor) => [actor.id, actor]));
  for (const actor of after?.actors || []) {
    const previous = beforeById[actor.id];
    if (!previous) continue;
    if (actor.hp !== previous.hp || actor.alive !== previous.alive) errors.push(`${actor.id}: authority state changed`);
    const dx = Number(actor.visualCenter?.x || 0) - Number(previous.visualCenter?.x || 0);
    if (actor.side === 'friendly' && actor.alive === true && Number(progress) > 0 && dx >= 0) errors.push(`${actor.id}: friendly actor did not move left`);
    if (actor.side !== 'friendly' && (dx !== 0 || Number(actor.visualCenter?.y || 0) !== Number(previous.visualCenter?.y || 0))) errors.push(`${actor.id}: enemy actor moved`);
    const membersBefore = previous.memberPositions || [];
    const membersAfter = actor.memberPositions || [];
    if (membersBefore.length !== membersAfter.length) errors.push(`${actor.id}: member count changed`);
    for (let index = 0; index < Math.min(membersBefore.length, membersAfter.length); index += 1) {
      const memberDx = membersAfter[index].x - membersBefore[index].x;
      if (actor.side === 'friendly' && actor.alive === true && Number(progress) > 0 && memberDx >= 0) errors.push(`${actor.id}: member ${index} did not move left`);
    }
  }
  if (JSON.stringify(before?.wrecks || []) !== JSON.stringify(after?.wrecks || [])) errors.push('wrecks moved');
  return { ok: errors.length === 0, errors };
}
