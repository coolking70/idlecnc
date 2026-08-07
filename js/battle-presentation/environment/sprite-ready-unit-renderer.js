import { resolveUnitAsset } from './asset-provider.js';
import { normalizeVisualUnitClass } from './visual-unit-class.js';

export function unitVisualSpec(actor, options = {}) {
  const resolved = resolveUnitAsset(actor, options.manifest || { assets: [] }, options.availableSources || new Set(), options.mode || 'hybrid');
  const type = normalizeVisualUnitClass(actor);
  return { type, mode: resolved.mode, fallback: resolved.fallback !== false, assetId: resolved.assetId || null, minimumScreenFootprint: ({ mbt: 46, infantry: 24, anti_armor_infantry: 24, light_vehicle: 34, support_vehicle: 34, unknown: 30 })[type] || 30 };
}
