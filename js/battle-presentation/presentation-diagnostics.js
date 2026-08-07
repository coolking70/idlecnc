const onceKeys = new Set();

export function createPresentationDiagnostics() {
  const state = { mode: 'legacy', preference: 'auto', contractAttempts: 0, contractSuccesses: 0, universalAttempts: 0, universalSuccesses: 0, universalDefaultAttempts: 0, universalDefaultSuccesses: 0, coverage: null, fallbacks: 0, lastFailure: null, lastBattleId: null };
  return {
    state,
    setPreference(value) { state.preference = ['auto', 'legacy', 'contract', 'universal'].includes(value) ? value : 'auto'; },
    setCoverageDecision(decision) { state.coverage = decision ? { eligible: decision.eligible === true, code: decision.code || null, cell: decision.cell ? { ...decision.cell } : null, matrixVersion: decision.matrixVersion || null } : null; },
    markAttempt(battleId, mode = 'contract') { state[mode === 'universal' ? 'universalAttempts' : 'contractAttempts'] += 1; state.lastBattleId = battleId || null; },
    markSuccess(mode = 'contract', source = 'explicit') { state.mode = mode === 'universal' ? 'universal_battle' : 'contract_road_victory'; state[mode === 'universal' ? 'universalSuccesses' : 'contractSuccesses'] += 1; if (mode === 'universal' && source === 'default') state.universalDefaultSuccesses += 1; state.lastFailure = null; },
    markFallback(code, reason, battleId, mode = 'legacy') {
      state.mode = 'legacy'; state.fallbacks += 1; state.lastFailure = { code, reason }; state.lastBattleId = battleId || state.lastBattleId;
      const key = `${code}:${battleId || 'none'}`;
      if (!onceKeys.has(key)) { onceKeys.add(key); console.info(`[presentation] ${mode} fallback to legacy: ${code}`); }
    },
    snapshot() { return { ...state, lastFailure: state.lastFailure ? { ...state.lastFailure } : null }; }
  };
}
