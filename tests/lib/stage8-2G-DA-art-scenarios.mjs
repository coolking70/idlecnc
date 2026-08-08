import { miningVictoryReport } from './stage8-2G-C1-scenarios.mjs';

/**
 * A presentation-only art showcase derived from a real formal report.  The
 * extra MBT rows are inert visual actors whose final state is destroyed; they
 * are never passed to the combat solver and are used only to exercise the
 * production sprite/wreck path for both factions in browser evidence.
 */
export function buildArtShowcaseReport() {
  const report = structuredClone(miningVictoryReport());
  const friendlyTank = { ...report.initial.friendly.find((actor) => actor.type === 'mbt'), id: 'art-friendly-mbt-wreck', realId: null, alive: true, hp: 160, maxHp: 160 };
  const enemyTank = { ...report.initial.enemy[0], id: 'art-enemy-mbt', realId: null, type: 'mbt', name: '敌方主战坦克', category: 'armor', shape: 'tank', alive: true, hp: 160, maxHp: 160, attack: 35, antiArmor: 20, defense: 30, mobility: 10 };
  const enemyAt = { ...report.initial.enemy[0], id: 'art-enemy-at', realId: null, type: 'enemy_at', name: '敌方反装甲小组', category: 'at_infantry', shape: 'at_infantry', alive: true, hp: 80, maxHp: 80, attack: 15, antiArmor: 22, defense: 6, mobility: 4 };
  report.initial.friendly = [...report.initial.friendly, friendlyTank]; report.final.friendly = [...report.final.friendly, { ...friendlyTank, alive: false, hp: 0 }];
  report.initial.enemy = [...report.initial.enemy, enemyTank]; report.final.enemy = [...report.final.enemy, { ...enemyTank, alive: false, hp: 0 }];
  report.initial.enemy = [...report.initial.enemy, enemyAt]; report.final.enemy = [...report.final.enemy, { ...enemyAt, alive: false, hp: 0 }];
  return report;
}

export function artRequiredActors() {
  return [
    { id: 'art-friendly-infantry', side: 'friendly', type: 'infantry', category: 'infantry', shape: 'infantry', facing: 0, visualState: 'idle' },
    { id: 'art-friendly-at', side: 'friendly', type: 'at_infantry', category: 'at_infantry', shape: 'at_infantry', facing: 0, visualState: 'fire' },
    { id: 'art-friendly-mbt', side: 'friendly', type: 'mbt', category: 'armor', shape: 'tank', facing: 0, turretFacing: Math.PI / 4, visualState: 'fire' },
    { id: 'art-enemy-infantry', side: 'enemy', type: 'enemy_infantry', category: 'infantry', shape: 'infantry', facing: Math.PI, visualState: 'idle' },
    { id: 'art-enemy-at', side: 'enemy', type: 'enemy_at', category: 'at_infantry', shape: 'at_infantry', facing: Math.PI, visualState: 'fire' },
    { id: 'art-enemy-mbt', side: 'enemy', type: 'mbt', category: 'armor', shape: 'tank', facing: Math.PI, turretFacing: -Math.PI / 2, visualState: 'fire' }
  ];
}
