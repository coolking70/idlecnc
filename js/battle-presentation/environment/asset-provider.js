import { normalizeVisualUnitClass } from './visual-unit-class.js';

/** Offline asset manifest resolver. Runtime never calls a generation service. */
export const ASSET_RENDER_MODES = Object.freeze(['procedural', 'sprite', 'hybrid']);

export const OFFLINE_ASSET_MANIFEST = Object.freeze({
  version: 1,
  provider: 'offline-manifest',
  runtimeGeneration: false,
  assets: Object.freeze([
    { id: 'unit_friendly_infantry', category: 'unit', type: 'infantry', source: 'assets/battle/sample-assets/unit-friendly-infantry.svg', version: 1, format: 'svg', fallback: 'procedural_infantry', anchor: { x: .5, y: .5 }, worldSize: { width: 22, height: 28 }, license: 'self-authored', author: 'Iron Command', generated: false },
    { id: 'unit_friendly_mbt', category: 'unit', type: 'mbt', source: 'assets/battle/sample-assets/unit-friendly-mbt.svg', version: 1, format: 'svg', fallback: 'procedural_mbt', anchor: { x: .5, y: .5 }, worldSize: { width: 60, height: 36 }, license: 'self-authored', author: 'Iron Command', generated: false },
    { id: 'wreck_tank', category: 'wreck', type: 'tank_wreck', source: 'assets/battle/sample-assets/wreck-tank.svg', version: 1, format: 'svg', fallback: 'procedural_wreck', anchor: { x: .5, y: .5 }, worldSize: { width: 60, height: 36 }, license: 'self-authored', author: 'Iron Command', generated: false },
    { id: 'cover_industrial_module', category: 'industrial_prop', type: 'cover', source: 'assets/battle/sample-assets/industrial-cover.svg', version: 1, format: 'svg', fallback: 'procedural_industrial_cover', anchor: { x: .5, y: .5 }, worldSize: { width: 42, height: 24 }, license: 'self-authored', author: 'Iron Command', generated: false },
    { id: 'terrain_scrap_pile', category: 'terrain', type: 'prop', source: 'assets/battle/sample-assets/terrain-scrap-pile.svg', version: 1, format: 'svg', fallback: 'procedural_terrain_prop', anchor: { x: .5, y: .5 }, worldSize: { width: 36, height: 22 }, license: 'self-authored', author: 'Iron Command', generated: false }
  ])
});

export function assetEntry(manifest, id) { return (manifest?.assets || []).find((asset) => asset.id === id) || null; }

export function resolveAsset(manifest, id, availableSources = new Set()) {
  const entry = assetEntry(manifest, id); if (!entry) return { ok: false, mode: 'procedural', fallback: true, assetId: id, reason: 'manifest_entry_missing' };
  const available = availableSources instanceof Set ? availableSources.has(entry.source) : Boolean(availableSources?.[entry.source]);
  return { ok: available, status: available ? 'ready' : 'fallback', mode: available ? 'sprite' : 'procedural', fallback: !available, assetId: id, source: entry.source, fallbackId: entry.fallback, worldSize: entry.worldSize || null, license: entry.license || null };
}

export function resolveUnitAsset(actor, manifest, availableSources = new Set(), mode = 'hybrid') {
  const side = actor?.side === 'enemy' ? 'enemy' : actor?.side === 'friendly' ? 'friendly' : 'neutral';
  const visualClass = normalizeVisualUnitClass(actor);
  const unitType = visualClass === 'mbt' ? 'mbt' : ['infantry', 'anti_armor_infantry'].includes(visualClass) ? 'infantry' : null;
  const factionId = unitType ? `unit_${side}_${unitType}` : null;
  // The offline manifest intentionally only ships the friendly sample art.
  // Never let an enemy actor silently borrow that art: the procedural renderer
  // is the authoritative faction-safe fallback until enemy art is supplied.
  if (!unitType || !ASSET_RENDER_MODES.includes(mode)) return { assetId: null, mode: 'procedural', fallback: true, side, visualClass, factionVisualMode: 'procedural' };
  const id = factionId;
  if (side !== 'friendly' && !assetEntry(manifest, id)) return { assetId: null, requestedAssetId: id, mode: 'procedural', fallback: true, status: 'fallback', reason: 'faction_asset_unavailable', side, visualClass, factionVisualMode: `procedural_${side}` };
  const resolved = resolveAsset(manifest, id, availableSources);
  return { ...resolved, mode: resolved.ok && mode !== 'procedural' ? mode : 'procedural', side, visualClass, factionVisualMode: resolved.ok ? side : `procedural_${side}` };
}

export function resolveEnvironmentAsset(object, manifest = OFFLINE_ASSET_MANIFEST, availableSources = new Set(), mode = 'sprite') {
  const category = object?.category || '';
  const id = category === 'cover' || category === 'industrial_prop' ? 'cover_industrial_module'
    : ['rock', 'debris_static', 'vegetation'].includes(category) ? 'terrain_scrap_pile' : null;
  if (!id || !ASSET_RENDER_MODES.includes(mode)) return { assetId: id, mode: 'procedural', fallback: true, status: 'fallback' };
  const resolved = resolveAsset(manifest, id, availableSources);
  return { ...resolved, mode: resolved.ok && mode !== 'procedural' ? mode : 'procedural' };
}
