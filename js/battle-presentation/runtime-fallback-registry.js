const disabledBattles = new Map();

export function markBattleContractDisabled(battleKey, code, reason) {
  if (!battleKey) return null;
  if (!disabledBattles.has(battleKey)) disabledBattles.set(battleKey, { battleKey, code, reason: String(reason || code), markedAt: Date.now() });
  return disabledBattles.get(battleKey);
}

export function isBattleContractDisabled(battleKey) {
  return Boolean(battleKey && disabledBattles.has(battleKey));
}

export function clearBattleContractDisabled(battleKey) {
  if (battleKey) disabledBattles.delete(battleKey);
}

export function clearAllRuntimeFallbacks() {
  disabledBattles.clear();
}

export function getRuntimeFallbackDiagnostics() {
  return [...disabledBattles.values()].map((entry) => ({ ...entry }));
}
