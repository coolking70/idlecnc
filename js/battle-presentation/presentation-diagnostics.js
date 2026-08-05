const onceKeys = new Set();

export function createPresentationDiagnostics() {
  const state = { mode: 'legacy', preference: 'auto', contractAttempts: 0, contractSuccesses: 0, fallbacks: 0, lastFailure: null, lastBattleId: null };
  return {
    state,
    setPreference(value) { state.preference = ['auto', 'legacy', 'contract'].includes(value) ? value : 'auto'; },
    markAttempt(battleId) { state.contractAttempts += 1; state.lastBattleId = battleId || null; },
    markSuccess() { state.mode = 'contract_road_victory'; state.contractSuccesses += 1; state.lastFailure = null; },
    markFallback(code, reason, battleId) {
      state.mode = 'legacy'; state.fallbacks += 1; state.lastFailure = { code, reason }; state.lastBattleId = battleId || state.lastBattleId;
      const key = `${code}:${battleId || 'none'}`;
      if (!onceKeys.has(key)) { onceKeys.add(key); console.info(`[presentation] fallback to legacy: ${code}`); }
    },
    snapshot() { return { ...state, lastFailure: state.lastFailure ? { ...state.lastFailure } : null }; }
  };
}
