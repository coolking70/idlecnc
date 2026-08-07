import { OFFLINE_ASSET_MANIFEST, resolveAsset, resolveEnvironmentAsset, resolveUnitAsset } from './asset-provider.js';

export const MINIMUM_SCREEN_FOOTPRINT = Object.freeze({ infantry: 24, anti_armor_infantry: 24, light_vehicle: 34, mbt: 46, support_vehicle: 34 });
// The footprint is a readability floor, not a default-size hint.  A narrow
// viewport may reduce world pixels per unit below the infantry floor, so the
// renderer must be allowed to scale the visual representation enough to reach
// the declared minimum instead of silently accepting an unreadable marker.
const MAX_VISUAL_SCALE_BOOST = 6;
const baseWorldSize = (type) => type === 'mbt' ? 60 : type === 'infantry' || type === 'at_infantry' ? 28 : 44;
const typeFor = (actor) => actor?.type === 'mbt' ? 'mbt' : actor?.type === 'scout_car' || actor?.type === 'enemy_scout_car' ? 'light_vehicle' : actor?.type === 'at_infantry' ? 'anti_armor_infantry' : actor?.category === 'infantry' ? 'infantry' : 'support_vehicle';
const sourceSet = (manifest, availableSources) => availableSources instanceof Set ? availableSources : new Set((manifest.assets || []).map((asset) => asset.source));

export function assetSpecForResolved(resolved, kind = 'actor') {
  const entry = resolved?.assetId ? (resolved.source ? resolved : null) : null;
  return { assetId: resolved?.assetId || null, assetMode: resolved?.mode || 'procedural', fallbackUsed: resolved?.fallback !== false, assetStatus: resolved?.status || (resolved?.fallback === false ? 'ready' : 'fallback'), assetSource: entry?.source || null, worldSize: resolved?.worldSize || null, drawPath: resolved?.fallback === false ? 'drawImage' : 'procedural-fallback', kind };
}

export function buildActorDrawSpec(actor, camera = {}, options = {}) {
  const manifest = options.manifest || OFFLINE_ASSET_MANIFEST; const sources = sourceSet(manifest, options.availableSources); const type = typeFor(actor); const requestedMode = options.modeByType?.[type] || (type === 'mbt' ? 'hybrid' : type === 'infantry' || type === 'anti_armor_infantry' ? 'sprite' : 'procedural'); const resolved = resolveUnitAsset(actor, manifest, sources, requestedMode); const minimumScreenFootprint = MINIMUM_SCREEN_FOOTPRINT[type] || 34; const zoom = Math.max(.1, Number(camera.zoom) || .86); const logicalWorldSize = baseWorldSize(actor?.type); const rawScreenFootprint = logicalWorldSize * zoom; const visualScaleBoost = Math.min(MAX_VISUAL_SCALE_BOOST, Math.max(1, minimumScreenFootprint / Math.max(1, rawScreenFootprint))); return { actorId: actor?.id || actor?.actorId || null, type, logicalWorldSize, minimumScreenFootprint, rawScreenFootprint, visualScaleBoost: Number(visualScaleBoost.toFixed(4)), screenFootprint: Number((rawScreenFootprint * visualScaleBoost).toFixed(3)), ...assetSpecForResolved(resolved, 'actor'), weaponProfileId: actor?.weapon?.id || null, weaponPresentation: actor?.weaponPresentation || null, hybridComponents: resolved.mode === 'hybrid' ? ['sprite_hull', 'procedural_turret', 'procedural_barrel', 'procedural_selection'] : [] };
}

export function buildWreckDrawSpec(wreck, options = {}) {
  const manifest = options.manifest || OFFLINE_ASSET_MANIFEST; const sources = sourceSet(manifest, options.availableSources); const resolved = wreck?.wreckType === 'tank_wreck' ? resolveAsset(manifest, 'wreck_tank', sources) : { assetId: null, mode: 'procedural', fallback: true, status: 'fallback' }; return { wreckId: wreck?.id || wreck?.sourceActorId || null, wreckType: wreck?.wreckType || 'unknown_wreck', ...assetSpecForResolved(resolved, 'wreck') };
}

export function buildEnvironmentDrawSpecs(environment, options = {}) {
  const manifest = options.manifest || OFFLINE_ASSET_MANIFEST; const sources = sourceSet(manifest, options.availableSources); return (environment?.objects || []).map((object) => ({ objectId: object.id, variant: object.variant, category: object.category, position: { ...object.position }, ...assetSpecForResolved(resolveEnvironmentAsset(object, manifest, sources, 'sprite'), 'environment') }));
}

export function buildProductionDrawSpecs({ actors = [], wrecks = [], environment, camera, options = {} } = {}) {
  const actorSpecs = actors.map((actor) => buildActorDrawSpec(actor, camera, options)); const wreckSpecs = wrecks.map((wreck) => buildWreckDrawSpec(wreck, options)); const environmentSpecs = buildEnvironmentDrawSpecs(environment, options); return { version: '8.2G-C.1-draw-spec-1', actorSpecs, wreckSpecs, environmentSpecs, assetCount: new Set([...actorSpecs, ...wreckSpecs, ...environmentSpecs].map((item) => item.assetId).filter(Boolean)).size, minimumScreenFootprint: { ...MINIMUM_SCREEN_FOOTPRINT }, maxVisualScaleBoost: MAX_VISUAL_SCALE_BOOST };
}

export function productionAssetIds(manifest = OFFLINE_ASSET_MANIFEST) { return (manifest.assets || []).map((asset) => asset.id); }
