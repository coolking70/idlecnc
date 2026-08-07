export function coverageText(coverage) {
  const total = coverage.total || {};
  const entries = (value) => Object.entries(value || {}).map(([key, count]) => `${key}:${count}`).join('  ');
  const range = (value) => Object.keys(value || {}).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const friendly = range(total.byFriendlyActorCount); const enemy = range(total.byEnemyActorCount);
  const actorRange = friendly.length && enemy.length ? [friendly[0] + enemy[0], friendly.at(-1) + enemy.at(-1)] : [];
  const matrix = coverage.missionResultMatrix || {};
  const unobserved = (matrix.unobservedCells || []).map((cell) => `${cell.missionId}/${cell.result}`).join(', ') || 'none';
  return [
    `total ${total.total}`,
    `terrain ${entries(total.byTerrain)}`,
    `mission ${entries(total.byMissionId)}`,
    `strategy ${entries(total.byStrategy)}`,
    `results ${entries(total.byResult)}`,
    `roster friendly ${friendly.join(',') || 'none'}`,
    `roster enemy ${enemy.join(',') || 'none'}`,
    `actors ${actorRange.length ? actorRange.join('–') : 'none'}`,
    `mission×result ${matrix.coveredCells ?? 0}/${matrix.totalCells ?? 0}`,
    `unobserved ${unobserved}`,
    `planFailures ${(coverage.planFailures || []).length}`
  ].join('\n');
}
