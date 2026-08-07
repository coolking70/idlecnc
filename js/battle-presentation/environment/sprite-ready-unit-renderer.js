import { resolveUnitAsset } from './asset-provider.js';

export function unitVisualSpec(actor, options = {}) {
  const resolved = resolveUnitAsset(actor, options.manifest || { assets: [] }, options.availableSources || new Set(), options.mode || 'hybrid');
  const type = actor?.type === 'mbt' ? 'mbt' : actor?.type === 'scout_car' || actor?.type === 'enemy_scout_car' ? 'light_vehicle' : actor?.type === 'at_infantry' ? 'anti_armor_infantry' : actor?.category === 'infantry' ? 'infantry' : 'support_vehicle';
  return { type, mode: resolved.mode, fallback: resolved.fallback !== false, assetId: resolved.assetId || null, minimumScreenFootprint: type === 'mbt' ? 46 : type === 'infantry' || type === 'anti_armor_infantry' ? 24 : 34 };
}
