import { buildPresentationCacheKey } from '../report-fingerprint.js';
import { createUniversalBattlePresentation } from './universal-battle-adapter.js';

const cache = new Map();
let activeKey = null;
let buildCount = 0;
let hitCount = 0;

export function getOrBuildUniversalPresentation(activeBattle, options = {}) {
  const key = buildPresentationCacheKey(activeBattle);
  if (cache.has(key)) { hitCount += 1; activeKey = key; return cache.get(key); }
  const presentation = createUniversalBattlePresentation(activeBattle, options);
  cache.set(key, presentation); activeKey = key; buildCount += 1;
  return presentation;
}

export function clearUniversalPlanCache() { cache.clear(); activeKey = null; }

export function getUniversalPlanCacheDiagnostics() {
  const value = cache.get(activeKey);
  return { entries: cache.size, activeKey, builds: buildCount, hits: hitCount, lastMode: value?.mode || 'legacy', lastCode: value?.code || null };
}

export { getOrBuildUniversalPresentation as getUniversalPresentation };

