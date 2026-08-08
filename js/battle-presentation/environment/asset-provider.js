import { normalizeVisualUnitClass } from './visual-unit-class.js';

/** Offline asset manifest resolver. Runtime never calls a generation service. */
export const ASSET_RENDER_MODES = Object.freeze(['procedural', 'sprite', 'hybrid']);

export const SPRITE_DIRECTION_ORDER = Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
export const REQUIRED_SPRITE_ANIMATIONS = Object.freeze(['idle', 'move', 'fire']);
const SPRITE_ANIMATIONS = Object.freeze({
  idle: Object.freeze({ startFrame: 0, frameCount: 2, frameDuration: .6, loop: true, region: 'direction-row' }),
  move: Object.freeze({ startFrame: 2, frameCount: 4, frameDuration: .14, loop: true, region: 'direction-row' }),
  aim: Object.freeze({ startFrame: 6, frameCount: 1, frameDuration: .5, loop: false, region: 'direction-row' }),
  fire: Object.freeze({ startFrame: 7, frameCount: 1, frameDuration: .18, loop: false, region: 'direction-row' }),
  hit: Object.freeze({ startFrame: 1, frameCount: 1, frameDuration: .22, loop: false, region: 'direction-row' }),
  destroy: Object.freeze({ startFrame: 7, frameCount: 1, frameDuration: .5, loop: false, region: 'direction-row' })
});
const SPRITESHEET = Object.freeze({ frameWidth: 96, frameHeight: 96, columns: 8, rows: 8 });
const WRECK_SPRITESHEET = Object.freeze({ frameWidth: 96, frameHeight: 96, columns: 1, rows: 8 });
const provenance = Object.freeze({ license: 'self-authored', author: 'Iron Command', generated: true, generationSource: 'scripts/generate-stage8-2G-D-A-assets.mjs', version: 1 });
function factionMetadata(side) { return { factionPalette: side === 'friendly' ? 'military-green-sand' : 'rust-red-iron', factionMark: side === 'friendly' ? 'mint-chevron' : 'orange-slash' }; }
function spriteUnit(id, visualClass, side, source, worldSize, options = {}) { return { id, category: 'unit', visualClass, type: visualClass, side, ...factionMetadata(side), format: 'spritesheet', source, directions: 8, directionOrder: SPRITE_DIRECTION_ORDER, spritesheet: SPRITESHEET, animations: SPRITE_ANIMATIONS, anchor: { x: .5, y: .55 }, worldSize, weaponMuzzleAnchor: options.weaponMuzzleAnchor || { space: 'normalized-destination', forward: .56, lateral: -.08, directionAware: true }, fallback: options.fallback || `procedural_${visualClass}`, components: options.components || null, ...provenance }; }
function spriteComponent(id, side, source, component) { return { id, category: 'unit_component', visualClass: 'mbt', type: 'mbt', side, ...factionMetadata(side), component, format: 'spritesheet', source, directions: 8, directionOrder: SPRITE_DIRECTION_ORDER, spritesheet: SPRITESHEET, animations: SPRITE_ANIMATIONS, anchor: { x: .5, y: .5 }, worldSize: { width: 60, height: 36 }, fallback: 'procedural_mbt', ...provenance }; }
function wreckAsset(id, side, source) { return { id, category: 'wreck', visualClass: 'mbt', type: 'tank_wreck', side, ...factionMetadata(side), format: 'spritesheet', source, directions: 8, directionOrder: SPRITE_DIRECTION_ORDER, spritesheet: WRECK_SPRITESHEET, animations: { idle: { startFrame: 0, frameCount: 1, frameDuration: 1, loop: false, region: 'direction-row' } }, anchor: { x: .5, y: .55 }, worldSize: { width: 60, height: 36 }, weaponMuzzleAnchor: null, fallback: 'procedural_wreck', ...provenance }; }

export const OFFLINE_ASSET_MANIFEST = Object.freeze({
  version: 2,
  provider: 'offline-manifest',
  runtimeGeneration: false,
  assets: Object.freeze([
    spriteUnit('unit_friendly_infantry', 'infantry', 'friendly', 'assets/battle/sprites/unit-friendly-infantry.png', { width: 30, height: 36 }),
    spriteUnit('unit_friendly_at_infantry', 'anti_armor_infantry', 'friendly', 'assets/battle/sprites/unit-friendly-at-infantry.png', { width: 34, height: 40 }, { weaponMuzzleAnchor: { space: 'normalized-destination', forward: .68, lateral: -.16, directionAware: true } }),
    spriteUnit('unit_enemy_infantry', 'infantry', 'enemy', 'assets/battle/sprites/unit-enemy-infantry.png', { width: 30, height: 36 }),
    spriteUnit('unit_enemy_at_infantry', 'anti_armor_infantry', 'enemy', 'assets/battle/sprites/unit-enemy-at-infantry.png', { width: 34, height: 40 }, { weaponMuzzleAnchor: { space: 'normalized-destination', forward: .68, lateral: -.16, directionAware: true } }),
    spriteUnit('unit_friendly_mbt', 'mbt', 'friendly', 'assets/battle/sprites/unit-friendly-mbt-hull.png', { width: 60, height: 36 }, { components: { hullAssetId: 'unit_friendly_mbt', turretAssetId: 'unit_friendly_mbt_turret' }, weaponMuzzleAnchor: { space: 'normalized-destination', forward: .78, lateral: -.02, directionAware: true, uses: 'turretFacing' } }),
    spriteUnit('unit_enemy_mbt', 'mbt', 'enemy', 'assets/battle/sprites/unit-enemy-mbt-hull.png', { width: 60, height: 36 }, { components: { hullAssetId: 'unit_enemy_mbt', turretAssetId: 'unit_enemy_mbt_turret' }, weaponMuzzleAnchor: { space: 'normalized-destination', forward: .78, lateral: -.02, directionAware: true, uses: 'turretFacing' } }),
    spriteComponent('unit_friendly_mbt_turret', 'friendly', 'assets/battle/sprites/unit-friendly-mbt-turret.png', 'turret'),
    spriteComponent('unit_enemy_mbt_turret', 'enemy', 'assets/battle/sprites/unit-enemy-mbt-turret.png', 'turret'),
    wreckAsset('wreck_friendly_mbt', 'friendly', 'assets/battle/sprites/wreck-friendly-mbt.png'),
    wreckAsset('wreck_enemy_mbt', 'enemy', 'assets/battle/sprites/wreck-enemy-mbt.png'),
    // Legacy environment samples remain valid fallback/test assets.
    { id: 'wreck_tank', category: 'wreck', type: 'tank_wreck', source: 'assets/battle/sample-assets/wreck-tank.svg', version: 1, format: 'svg', fallback: 'procedural_wreck', anchor: { x: .5, y: .5 }, worldSize: { width: 60, height: 36 }, license: 'self-authored', author: 'Iron Command', generated: false },
    { id: 'cover_industrial_module', category: 'industrial_prop', type: 'cover', source: 'assets/battle/sample-assets/industrial-cover.svg', version: 1, format: 'svg', fallback: 'procedural_industrial_cover', anchor: { x: .5, y: .5 }, worldSize: { width: 42, height: 24 }, license: 'self-authored', author: 'Iron Command', generated: false },
    { id: 'terrain_scrap_pile', category: 'terrain', type: 'prop', source: 'assets/battle/sample-assets/terrain-scrap-pile.svg', version: 1, format: 'svg', fallback: 'procedural_terrain_prop', anchor: { x: .5, y: .5 }, worldSize: { width: 36, height: 22 }, license: 'self-authored', author: 'Iron Command', generated: false }
  ]),
  directions: 8,
  directionOrder: SPRITE_DIRECTION_ORDER,
  requiredAnimations: REQUIRED_SPRITE_ANIMATIONS
});

export function assetEntry(manifest, id) { return (manifest?.assets || []).find((asset) => asset.id === id) || null; }

export function resolveAsset(manifest, id, availableSources = new Set()) {
  const entry = assetEntry(manifest, id); if (!entry) return { ok: false, mode: 'procedural', fallback: true, assetId: id, reason: 'manifest_entry_missing' };
  const available = availableSources instanceof Set ? availableSources.has(entry.source) : Boolean(availableSources?.[entry.source]);
  return { ok: available, status: available ? 'ready' : 'fallback', mode: available ? (entry.format === 'spritesheet' ? 'sprite' : 'sprite') : 'procedural', fallback: !available, assetId: id, source: entry.source, fallbackId: entry.fallback, worldSize: entry.worldSize || null, license: entry.license || null, entry, component: entry.component || null };
}

export function resolveUnitAsset(actor, manifest, availableSources = new Set(), mode = 'hybrid') {
  const side = actor?.side === 'enemy' ? 'enemy' : actor?.side === 'friendly' ? 'friendly' : 'neutral';
  const visualClass = normalizeVisualUnitClass(actor);
  const unitType = visualClass === 'mbt' ? 'mbt' : visualClass === 'anti_armor_infantry' ? 'at_infantry' : visualClass === 'infantry' ? 'infantry' : null;
  const factionId = unitType ? `unit_${side}_${unitType}` : null;
  if (!unitType || !ASSET_RENDER_MODES.includes(mode)) return { assetId: null, mode: 'procedural', fallback: true, side, visualClass, factionVisualMode: 'procedural' };
  const id = factionId;
  if (!assetEntry(manifest, id)) return { assetId: null, requestedAssetId: id, mode: 'procedural', fallback: true, status: 'fallback', reason: 'faction_asset_unavailable', side, visualClass, factionVisualMode: `procedural_${side}` };
  const resolved = resolveAsset(manifest, id, availableSources);
  const components = resolved.entry?.components || null;
  return { ...resolved, mode: resolved.ok && mode !== 'procedural' ? (visualClass === 'mbt' ? 'hybrid' : mode) : 'procedural', side, visualClass, factionVisualMode: resolved.ok ? side : `procedural_${side}`, componentAssetIds: components ? { ...components } : null };
}

export function resolveWreckAsset(wreck, manifest = OFFLINE_ASSET_MANIFEST, availableSources = new Set()) {
  if (wreck?.wreckType !== 'tank_wreck') return { assetId: null, mode: 'procedural', fallback: true, status: 'fallback', side: wreck?.side || null, visualClass: 'unknown' };
  const id = wreck.side === 'enemy' ? 'wreck_enemy_mbt' : 'wreck_friendly_mbt'; const resolved = resolveAsset(manifest, id, availableSources); return { ...resolved, side: wreck.side || 'friendly', visualClass: 'mbt', factionVisualMode: resolved.ok ? wreck.side || 'friendly' : `procedural_${wreck.side || 'friendly'}` };
}

export function resolveEnvironmentAsset(object, manifest = OFFLINE_ASSET_MANIFEST, availableSources = new Set(), mode = 'sprite') {
  const category = object?.category || '';
  const id = category === 'cover' || category === 'industrial_prop' ? 'cover_industrial_module'
    : ['rock', 'debris_static', 'vegetation'].includes(category) ? 'terrain_scrap_pile' : null;
  if (!id || !ASSET_RENDER_MODES.includes(mode)) return { assetId: id, mode: 'procedural', fallback: true, status: 'fallback' };
  const resolved = resolveAsset(manifest, id, availableSources);
  return { ...resolved, mode: resolved.ok && mode !== 'procedural' ? mode : 'procedural' };
}
