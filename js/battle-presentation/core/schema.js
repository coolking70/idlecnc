export const MANIFEST_VERSION = 1;
export const CONTRACT_VERSION = 1;
export const BATTLE_RESULTS = new Set(['victory', 'pyrrhic', 'defeat', 'withdraw', 'wiped']);
export const MISSION_KINDS = new Set(['campaign', 'operation']);

export function countReportEvents(report) {
  const counts = {};
  for (const event of Array.isArray(report?.events) ? report.events : []) counts[event?.type] = (counts[event?.type] || 0) + 1;
  return {
    actorsFriendly: Array.isArray(report?.initial?.friendly) ? report.initial.friendly.length : 0,
    actorsEnemy: Array.isArray(report?.initial?.enemy) ? report.initial.enemy.length : 0,
    events: Array.isArray(report?.events) ? report.events.length : 0,
    damage: counts.damage || 0,
    repair: counts.repair || 0,
    destroy: counts.destroy || 0,
    retreat: counts.retreat || 0
  };
}
