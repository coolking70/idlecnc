/**
 * The only visual unit-class authority used by production presentation code.
 *
 * Combat/authority schemas intentionally remain free to grow aliases.  The
 * renderer, asset resolver, footprint audit and evidence must not each grow
 * their own slightly different interpretation of those aliases.
 */
export const VISUAL_UNIT_CLASSES = Object.freeze([
  'infantry',
  'anti_armor_infantry',
  'light_vehicle',
  'mbt',
  'support_vehicle',
  'unknown'
]);

const stringValue = (value) => String(value || '').trim().toLowerCase();

export function normalizeVisualUnitClass(actor = {}) {
  const type = stringValue(actor.type);
  const category = stringValue(actor.category);
  const shape = stringValue(actor.shape);

  if (type === 'mbt' || shape === 'tank') return 'mbt';
  if (['at_infantry', 'enemy_at'].includes(type)
    || ['at_infantry', 'anti_armor_infantry'].includes(category)
    || shape === 'at_infantry') return 'anti_armor_infantry';
  if (['scout_car', 'enemy_scout_car', 'vehicle', 'scout'].includes(type)
    || ['light_vehicle', 'vehicle'].includes(category)
    || ['vehicle', 'scout'].includes(shape)) return 'light_vehicle';
  if (['repair_vehicle', 'support_vehicle', 'support'].includes(type)
    || ['support_vehicle', 'support'].includes(category)
    || shape === 'support') return 'support_vehicle';
  if (type === 'infantry' || type === 'enemy_infantry'
    || category === 'infantry' || shape === 'infantry') return 'infantry';
  return 'unknown';
}

export function visualUnitClassFamily(visualClass) {
  return visualClass === 'infantry' || visualClass === 'anti_armor_infantry' ? 'infantry' : 'vehicle';
}

export function isInfantryVisualClass(actorOrClass) {
  const visualClass = typeof actorOrClass === 'string' ? actorOrClass : normalizeVisualUnitClass(actorOrClass);
  return visualClass === 'infantry' || visualClass === 'anti_armor_infantry';
}
