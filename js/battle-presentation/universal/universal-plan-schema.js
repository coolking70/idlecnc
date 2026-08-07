export const UNIVERSAL_PLAN_VERSION = '8.2F-A.2';
export const UNIVERSAL_PLAN_KIND = 'universal_battle';
export const PLAN_RESULTS = Object.freeze(['victory', 'pyrrhic', 'withdraw', 'defeat', 'wiped']);

export function clone(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

export function createUniversalPlan(seed = {}) {
  return {
    planVersion: UNIVERSAL_PLAN_VERSION,
    planKind: UNIVERSAL_PLAN_KIND,
    planFingerprint: null,
    source: {
      reportId: null, reportFingerprint: null, seed: null, theaterId: null,
      missionKind: null, missionId: null, strategyId: null, result: null,
      ...seed.source
    },
    intent: seed.intent || null,
    contact: seed.contact || null,
    scene: seed.scene || null,
    forces: seed.forces || { friendly: [], enemy: [], profile: null },
    assignments: seed.assignments || [],
    roleGroups: seed.roleGroups || { friendly: {}, enemy: {} },
    layout: seed.layout || { bounds: { width: 1200, height: 700 }, zones: [], nodes: [], metrics: {} },
    spatialEntities: seed.spatialEntities || [],
    spatialValidation: seed.spatialValidation || null,
    timeline: seed.timeline || { duration: 30, sourceDuration: null, phases: [], anchors: [], actions: [] },
    outcome: seed.outcome || null,
    authority: seed.authority || { expectedEventCount: 0, expectedAnchorCount: 0, finalState: null },
    quality: seed.quality || { level: 'generic', reasons: [] },
    validation: seed.validation || { ok: false, errors: [], warnings: [], metrics: {} },
    ok: false
  };
}

export function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function numberOr(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}
