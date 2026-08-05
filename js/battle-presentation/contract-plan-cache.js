import { createContractBattlePresentation } from './contract-battle-adapter.js';
import { buildPresentationCacheKey, buildReportFingerprint } from './report-fingerprint.js';

const cache = new Map();
let activeKey = null;
let buildCount = 0;
let hitCount = 0;

function keyFor(activeBattle) {
  return buildPresentationCacheKey(activeBattle);
}

export function getOrBuildContractPresentation(activeBattle, options = {}) {
  const key = keyFor(activeBattle);
  if (cache.has(key)) { hitCount += 1; activeKey = key; return cache.get(key); }
  const presentation = createContractBattlePresentation(activeBattle, options);
  if (presentation?.ok) presentation.reportFingerprint = buildReportFingerprint(activeBattle?.report);
  cache.set(key, presentation); activeKey = key; buildCount += 1;
  return presentation;
}

export function clearContractPlanCache() {
  cache.clear(); activeKey = null;
}

export function getContractPlanCacheDiagnostics() {
  const value = cache.get(activeKey);
  return {
    entries: cache.size,
    activeKey,
    activeFingerprint: value?.reportFingerprint || null,
    builds: buildCount,
    hits: hitCount,
    lastMode: value?.mode || 'legacy',
    lastCode: value?.code || null
  };
}

export { keyFor as presentationCacheKey };
