export const OUTCOME_PROFILES = Object.freeze({
  victory: { id: 'victory', name: '胜利', endingKind: 'secure', captureExpected: true, retreatExpected: false },
  pyrrhic: { id: 'pyrrhic', name: '惨胜', endingKind: 'secure_costly', captureExpected: true, retreatExpected: false },
  withdraw: { id: 'withdraw', name: '撤退', endingKind: 'withdraw', captureExpected: false, retreatExpected: true },
  defeat: { id: 'defeat', name: '败北', endingKind: 'break', captureExpected: false, retreatExpected: false },
  wiped: { id: 'wiped', name: '全灭', endingKind: 'annihilation', captureExpected: false, retreatExpected: false }
});

export function resolveOutcomeProfile(result) { return OUTCOME_PROFILES[result] || { id: result || 'unknown', name: '未知', endingKind: 'generic', captureExpected: false, retreatExpected: false }; }

