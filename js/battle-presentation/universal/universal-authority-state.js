export function buildUniversalFinalState(normalized) {
  const actors = {};
  for (const actor of [...(normalized?.actors?.friendly || []), ...(normalized?.actors?.enemy || [])].sort((a, b) => a.id.localeCompare(b.id))) actors[actor.id] = { side: actor.side, type: actor.type, hp: actor.final.hp, maxHp: actor.final.maxHp, alive: actor.final.alive };
  return { actors, friendlyAliveIds: Object.entries(actors).filter(([, actor]) => actor.side === 'friendly' && actor.alive).map(([id]) => id), friendlyDestroyedIds: Object.entries(actors).filter(([, actor]) => actor.side === 'friendly' && !actor.alive).map(([id]) => id), enemyAliveIds: Object.entries(actors).filter(([, actor]) => actor.side === 'enemy' && actor.alive).map(([id]) => id), enemyDestroyedIds: Object.entries(actors).filter(([, actor]) => actor.side === 'enemy' && !actor.alive).map(([id]) => id) };
}
