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
  repair: Object.freeze({ startFrame: 6, frameCount: 1, frameDuration: .38, loop: true, region: 'direction-row' }),
  hit: Object.freeze({ startFrame: 1, frameCount: 1, frameDuration: .22, loop: false, region: 'direction-row' }),
  destroy: Object.freeze({ startFrame: 7, frameCount: 1, frameDuration: .5, loop: false, region: 'direction-row' })
});
const SPRITESHEET = Object.freeze({ frameWidth: 96, frameHeight: 96, columns: 8, rows: 8 });
const WRECK_SPRITESHEET = Object.freeze({ frameWidth: 96, frameHeight: 96, columns: 1, rows: 8 });
const provenance = Object.freeze({ license: 'self-authored', author: 'Iron Command', generated: true, generationSource: 'scripts/generate-stage8-2G-D-A-assets.mjs', version: 1 });
function factionMetadata(side) { return { factionPalette: side === 'friendly' ? 'military-green-sand' : 'rust-red-iron', factionMark: side === 'friendly' ? 'mint-chevron' : 'orange-slash' }; }
function spriteUnit(id, visualClass, side, source, worldSize, options = {}) { const defaultAnchor = options.weaponTopology === 'unarmed' ? null : { space: 'normalized-destination', forward: .56, lateral: -.08, directionAware: true }; return { id, category: 'unit', visualClass, type: options.type || visualClass, side, ...factionMetadata(side), format: 'spritesheet', source, directions: 8, directionOrder: SPRITE_DIRECTION_ORDER, spritesheet: SPRITESHEET, animations: SPRITE_ANIMATIONS, requiredAnimations: options.requiredAnimations || ['idle', 'move'], optionalAnimations: options.optionalAnimations || ['aim', 'fire', 'reload', 'hit', 'destroy'], weaponTopology: options.weaponTopology || null, anchor: { x: .5, y: .55 }, worldSize, weaponMuzzleAnchor: options.weaponMuzzleAnchor === undefined ? defaultAnchor : options.weaponMuzzleAnchor, fallback: options.fallback || `procedural_${visualClass}`, components: options.components || null, ...provenance }; }
function spriteComponent(id, side, source, component) { return { id, category: 'unit_component', visualClass: 'mbt', type: 'mbt', side, ...factionMetadata(side), component, format: 'spritesheet', source, directions: 8, directionOrder: SPRITE_DIRECTION_ORDER, spritesheet: SPRITESHEET, animations: SPRITE_ANIMATIONS, anchor: { x: .5, y: .5 }, worldSize: { width: 60, height: 36 }, fallback: 'procedural_mbt', ...provenance }; }
function wreckAsset(id, side, source, options = {}) { return { id, category: 'wreck', visualClass: options.visualClass || 'mbt', type: options.type || 'tank_wreck', side, ...factionMetadata(side), format: 'spritesheet', source, directions: 8, directionOrder: SPRITE_DIRECTION_ORDER, spritesheet: WRECK_SPRITESHEET, animations: { idle: { startFrame: 0, frameCount: 1, frameDuration: 1, loop: false, region: 'direction-row' } }, requiredAnimations: ['idle'], optionalAnimations: [], weaponTopology: null, anchor: { x: .5, y: .55 }, worldSize: options.worldSize || { width: 60, height: 36 }, weaponMuzzleAnchor: null, fallback: 'procedural_wreck', ...provenance }; }

export const OFFLINE_ASSET_MANIFEST = Object.freeze({
  version: 2,
  provider: 'offline-manifest',
  runtimeGeneration: false,
  assets: Object.freeze([
    spriteUnit('unit_friendly_infantry', 'infantry', 'friendly', 'assets/battle/sprites/unit-friendly-infantry.png', { width: 30, height: 36 }, { type: 'infantry', weaponTopology: 'body_mounted', requiredAnimations: ['idle', 'move', 'aim', 'fire'] }),
    spriteUnit('unit_friendly_at_infantry', 'anti_armor_infantry', 'friendly', 'assets/battle/sprites/unit-friendly-at-infantry.png', { width: 34, height: 40 }, { type: 'at_infantry', weaponTopology: 'body_mounted', requiredAnimations: ['idle', 'move', 'aim', 'fire'], weaponMuzzleAnchor: { space: 'normalized-destination', forward: .68, lateral: -.16, directionAware: true } }),
    spriteUnit('unit_enemy_infantry', 'infantry', 'enemy', 'assets/battle/sprites/unit-enemy-infantry.png', { width: 30, height: 36 }, { type: 'infantry', weaponTopology: 'body_mounted', requiredAnimations: ['idle', 'move', 'aim', 'fire'] }),
    spriteUnit('unit_enemy_at_infantry', 'anti_armor_infantry', 'enemy', 'assets/battle/sprites/unit-enemy-at-infantry.png', { width: 34, height: 40 }, { type: 'at_infantry', weaponTopology: 'body_mounted', requiredAnimations: ['idle', 'move', 'aim', 'fire'], weaponMuzzleAnchor: { space: 'normalized-destination', forward: .68, lateral: -.16, directionAware: true } }),
    spriteUnit('unit_friendly_mbt', 'mbt', 'friendly', 'assets/battle/sprites/unit-friendly-mbt-hull.png', { width: 60, height: 36 }, { type: 'mbt', weaponTopology: 'independent_turret', components: { hullAssetId: 'unit_friendly_mbt', turretAssetId: 'unit_friendly_mbt_turret' }, weaponMuzzleAnchor: { space: 'normalized-destination', forward: .78, lateral: -.02, directionAware: true, uses: 'turretFacing' } }),
    spriteUnit('unit_enemy_mbt', 'mbt', 'enemy', 'assets/battle/sprites/unit-enemy-mbt-hull.png', { width: 60, height: 36 }, { type: 'mbt', weaponTopology: 'independent_turret', components: { hullAssetId: 'unit_enemy_mbt', turretAssetId: 'unit_enemy_mbt_turret' }, weaponMuzzleAnchor: { space: 'normalized-destination', forward: .78, lateral: -.02, directionAware: true, uses: 'turretFacing' } }),
    spriteUnit('unit_friendly_scout_car', 'light_vehicle', 'friendly', 'assets/battle/sprites/unit-friendly-scout-car.png', { width: 48, height: 26 }, { type: 'scout_car', weaponTopology: 'body_mounted', requiredAnimations: ['idle', 'move', 'aim', 'fire'], weaponMuzzleAnchor: { space: 'normalized-destination', forward: .68, lateral: -.05, directionAware: true } }),
    spriteUnit('unit_enemy_scout_car', 'light_vehicle', 'enemy', 'assets/battle/sprites/unit-enemy-scout-car.png', { width: 48, height: 26 }, { type: 'scout_car', weaponTopology: 'body_mounted', requiredAnimations: ['idle', 'move', 'aim', 'fire'], weaponMuzzleAnchor: { space: 'normalized-destination', forward: .68, lateral: -.05, directionAware: true } }),
    spriteUnit('unit_friendly_repair_vehicle', 'support_vehicle', 'friendly', 'assets/battle/sprites/unit-friendly-repair-vehicle.png', { width: 52, height: 28 }, { type: 'repair_vehicle', weaponTopology: 'unarmed', requiredAnimations: ['idle', 'move', 'repair', 'hit', 'destroy'], optionalAnimations: [] }),
    spriteUnit('unit_friendly_support_vehicle', 'support_vehicle', 'friendly', 'assets/battle/sprites/unit-friendly-support-vehicle.png', { width: 54, height: 30 }, { type: 'support_vehicle', weaponTopology: 'unarmed', requiredAnimations: ['idle', 'move', 'hit', 'destroy'], optionalAnimations: [] }),
    spriteUnit('unit_enemy_support_vehicle', 'support_vehicle', 'enemy', 'assets/battle/sprites/unit-enemy-support-vehicle.png', { width: 54, height: 30 }, { type: 'support_vehicle', weaponTopology: 'unarmed', requiredAnimations: ['idle', 'move', 'hit', 'destroy'], optionalAnimations: [] }),
    spriteComponent('unit_friendly_mbt_turret', 'friendly', 'assets/battle/sprites/unit-friendly-mbt-turret.png', 'turret'),
    spriteComponent('unit_enemy_mbt_turret', 'enemy', 'assets/battle/sprites/unit-enemy-mbt-turret.png', 'turret'),
    wreckAsset('wreck_friendly_mbt', 'friendly', 'assets/battle/sprites/wreck-friendly-mbt.png'),
    wreckAsset('wreck_enemy_mbt', 'enemy', 'assets/battle/sprites/wreck-enemy-mbt.png'),
    wreckAsset('wreck_friendly_scout_car', 'friendly', 'assets/battle/sprites/wreck-friendly-scout-car.png', { visualClass: 'light_vehicle', type: 'scout_car_wreck', worldSize: { width: 48, height: 26 } }),
    wreckAsset('wreck_enemy_scout_car', 'enemy', 'assets/battle/sprites/wreck-enemy-scout-car.png', { visualClass: 'light_vehicle', type: 'scout_car_wreck', worldSize: { width: 48, height: 26 } }),
    wreckAsset('wreck_friendly_repair_vehicle', 'friendly', 'assets/battle/sprites/wreck-friendly-repair-vehicle.png', { visualClass: 'support_vehicle', type: 'repair_vehicle_wreck', worldSize: { width: 52, height: 28 } }),
    wreckAsset('wreck_friendly_support_vehicle', 'friendly', 'assets/battle/sprites/wreck-friendly-support-vehicle.png', { visualClass: 'support_vehicle', type: 'support_vehicle_wreck', worldSize: { width: 54, height: 30 } }),
    wreckAsset('wreck_enemy_support_vehicle', 'enemy', 'assets/battle/sprites/wreck-enemy-support-vehicle.png', { visualClass: 'support_vehicle', type: 'support_vehicle_wreck', worldSize: { width: 54, height: 30 } }),
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
  const unitType = visualClass === 'mbt' ? 'mbt'
    : visualClass === 'anti_armor_infantry' ? 'at_infantry'
      : visualClass === 'infantry' ? 'infantry'
        : visualClass === 'light_vehicle' ? (String(actor?.type || '').includes('scout') || String(actor?.type || '').includes('light_armor') ? 'scout_car' : 'light_vehicle')
          : visualClass === 'support_vehicle' ? (String(actor?.type || '').includes('repair') ? 'repair_vehicle' : 'support_vehicle') : null;
  const factionId = unitType ? `unit_${side}_${unitType}` : null;
  if (!unitType || !ASSET_RENDER_MODES.includes(mode)) return { assetId: null, mode: 'procedural', fallback: true, side, visualClass, factionVisualMode: 'procedural' };
  const id = factionId;
  if (!assetEntry(manifest, id)) return { assetId: null, requestedAssetId: id, mode: 'procedural', fallback: true, status: 'fallback', reason: 'faction_asset_unavailable', side, visualClass, factionVisualMode: `procedural_${side}` };
  const resolved = resolveAsset(manifest, id, availableSources);
  const components = resolved.entry?.components || null;
  return { ...resolved, mode: resolved.ok && mode !== 'procedural' ? (visualClass === 'mbt' ? 'hybrid' : mode) : 'procedural', side, visualClass, factionVisualMode: resolved.ok ? side : `procedural_${side}`, componentAssetIds: components ? { ...components } : null };
}

export function resolveWreckAsset(wreck, manifest = OFFLINE_ASSET_MANIFEST, availableSources = new Set()) {
  const side = wreck?.side === 'enemy' ? 'enemy' : 'friendly';
  const visualClass = wreck?.visualClass || (wreck?.wreckType === 'tank_wreck' ? 'mbt' : 'unknown'); const type = String(wreck?.sourceType || wreck?.type || '');
  const suffix = visualClass === 'mbt' ? 'mbt' : visualClass === 'light_vehicle' ? 'scout_car' : visualClass === 'support_vehicle' && type.includes('repair') ? 'repair_vehicle' : visualClass === 'support_vehicle' ? 'support_vehicle' : null;
  const id = suffix ? `wreck_${side}_${suffix}` : null;
  if (!id || !assetEntry(manifest, id)) return { assetId: null, mode: 'procedural', fallback: true, status: 'fallback', side, visualClass };
  const resolved = resolveAsset(manifest, id, availableSources); return { ...resolved, side, visualClass, factionVisualMode: resolved.ok ? side : `procedural_${side}` };
}

export function resolveEnvironmentAsset(object, manifest = OFFLINE_ASSET_MANIFEST, availableSources = new Set(), mode = 'sprite') {
  const category = object?.category || '';
  const id = category === 'cover' || category === 'industrial_prop' ? 'cover_industrial_module'
    : ['rock', 'debris_static', 'vegetation'].includes(category) ? 'terrain_scrap_pile' : null;
  if (!id || !ASSET_RENDER_MODES.includes(mode)) return { assetId: id, mode: 'procedural', fallback: true, status: 'fallback' };
  const resolved = resolveAsset(manifest, id, availableSources);
  return { ...resolved, mode: resolved.ok && mode !== 'procedural' ? mode : 'procedural' };
}
