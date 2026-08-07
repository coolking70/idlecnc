const validationCache = new WeakMap();
export function getCachedUniversalSpatialValidation(compiled, key = 'default') { return validationCache.get(compiled)?.get(key) || null; }
export function setCachedUniversalSpatialValidation(compiled, key, value) { if (!validationCache.has(compiled)) validationCache.set(compiled, new Map()); validationCache.get(compiled).set(key, value); return value; }

