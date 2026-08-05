export function validateVictoryTemplateContract(contract) {
  const errors = [];
  if (contract?.validation?.ok !== true) errors.push('contract.validation.ok must be true');
  if (contract?.diagnostics?.supported !== true) errors.push('contract.diagnostics.supported must be true');
  if (contract?.presentation?.templateId !== null) errors.push('source contract.presentation.templateId must remain null');
  if (contract?.normalizedBattle?.battle?.result !== 'victory') return { ok: false, code: 'unsupported_result', reason: '当前模板只支持胜利战报', errors: ['normalized result must be victory'] };
  const actors = [...(contract?.normalizedBattle?.actors?.friendly || []), ...(contract?.normalizedBattle?.actors?.enemy || [])];
  const enemyAlive = actors.filter((actor) => actor.side === 'enemy' && actor.final?.alive);
  if (enemyAlive.length) errors.push(`victory contract has ${enemyAlive.length} enemy actors alive at final`);
  return { ok: errors.length === 0, code: errors.length ? 'invalid_contract' : null, reason: errors.join('; '), errors };
}
