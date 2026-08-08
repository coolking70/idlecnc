import fs from 'node:fs';

const VICTORY_FIXTURE = new URL('../../experiments/battle-sandbox/report-adapter/fixtures/campaign-victory.json', import.meta.url);

function baseActor(report, side) {
  return structuredClone(report.initial?.[side]?.[0] || { hp: 100, maxHp: 100, category: 'vehicle', shape: 'vehicle', stats: {} });
}

function showcaseActor(report, side, type, id, overrides = {}) {
  const source = baseActor(report, side);
  const maxHp = Number(overrides.maxHp || source.maxHp || source.hp || 100);
  return {
    ...source,
    id,
    realId: null,
    type,
    name: overrides.name || id,
    category: overrides.category || 'vehicle',
    shape: overrides.shape || 'vehicle',
    hp: maxHp,
    maxHp,
    alive: true,
    attack: Number(overrides.attack || source.attack || 0),
    antiArmor: Number(overrides.antiArmor || source.antiArmor || 0),
    defense: Number(overrides.defense || source.defense || 10),
    mobility: Number(overrides.mobility || source.mobility || 10),
    scouting: Number(overrides.scouting || 0),
    repair: Number(overrides.repair || 0),
    stats: { ...(source.stats || {}), ...(overrides.stats || {}) }
  };
}

/**
 * Presentation-only full-art fixture. It starts from the formal campaign
 * victory report (which already contains authoritative repair events), then
 * adds inert unit rows solely to exercise the production asset inventory.
 * These rows never enter the combat solver and have no authority events.
 */
export function buildDbArtShowcaseReport() {
  const report = JSON.parse(fs.readFileSync(VICTORY_FIXTURE, 'utf8')).report;
  const additions = [
    showcaseActor(report, 'friendly', 'support_vehicle', 'art-db-friendly-support', { name: '友方支援车', category: 'support', maxHp: 120 }),
    showcaseActor(report, 'enemy', 'enemy_scout_car', 'art-db-enemy-scout', { name: '敌方侦察车', scouting: 18, mobility: 18, maxHp: 90 }),
    showcaseActor(report, 'enemy', 'enemy_support_vehicle', 'art-db-enemy-support', { name: '敌方支援车', category: 'support', maxHp: 120 })
  ];
  report.initial.friendly.push(additions[0]);
  report.initial.enemy.push(additions[1], additions[2]);
  report.final.friendly.push({ ...additions[0], alive: false, hp: 0 });
  report.final.enemy.push({ ...additions[1], alive: false, hp: 0 }, { ...additions[2], alive: false, hp: 0 });
  // The base formal report keeps these support units alive. The art-only
  // branch intentionally ends them as wrecks so the D-B showcase exercises
  // last-hull-facing and faction-specific recovery for every new vehicle.
  report.final.friendly = report.final.friendly.map((actor) => ['scout_car', 'repair_vehicle'].includes(actor.type) ? { ...actor, alive: false, hp: 0 } : actor);
  return report;
}

export const DB_ART_ASSET_TYPES = Object.freeze([
  ['friendly', 'scout_car', 'unit_friendly_scout_car'],
  ['enemy', 'enemy_scout_car', 'unit_enemy_scout_car'],
  ['friendly', 'repair_vehicle', 'unit_friendly_repair_vehicle'],
  ['friendly', 'support_vehicle', 'unit_friendly_support_vehicle'],
  ['enemy', 'enemy_support_vehicle', 'unit_enemy_support_vehicle']
]);

export const DB_ART_WRECK_TYPES = Object.freeze([
  ['friendly', 'scout_car', 'wreck_friendly_scout_car'],
  ['enemy', 'enemy_scout_car', 'wreck_enemy_scout_car'],
  ['friendly', 'repair_vehicle', 'wreck_friendly_repair_vehicle'],
  ['friendly', 'support_vehicle', 'wreck_friendly_support_vehicle'],
  ['enemy', 'enemy_support_vehicle', 'wreck_enemy_support_vehicle']
]);
