export function verifyDB1aEvidenceBundle(bundle = {}) {
  const errors = [];
  const action = bundle.actionAttribution;
  const repair = bundle.repairAttribution;
  const semantic = bundle.repairSemanticBinding;
  const retreat = bundle.retreatBinding;
  const browser = bundle.browser;
  const authority = bundle.authority;
  const tamper = bundle.db1aTamper;
  const regressions = bundle.regressions || {};
  if (!action?.passed || action.cases?.actorId !== true || action.cases?.actorIds !== true || action.cases?.explicitGlobal !== true || action.cases?.unscopedMissingIdsRejected !== true) errors.push('action_attribution');
  if (!repair?.passed || repair.totalUnexpectedRepairAnimations !== 0 || (repair.scenes || []).some((scene) => (scene.unexpectedRepairAnimations || []).length !== 0)) errors.push('repair_attribution');
  if (!semantic?.passed || semantic.negativeTests?.missingSourceRejected !== true || semantic.negativeTests?.missingTargetRejected !== true || semantic.negativeTests?.wrongSourceRejected !== true || (semantic.scenes || []).some((scene) => !scene.repairSourceActorId || !scene.repairTargetActorId || scene.repairSourceActorId === scene.repairTargetActorId || scene.targetBound !== true)) errors.push('repair_semantic_binding');
  if (!retreat?.passed || !retreat.distinctPair || !retreat.retreatActorIds?.length || !retreat.rearGuardActorIds?.length || retreat.negativeTests?.missingRetreatRejected !== true || retreat.negativeTests?.missingRearGuardRejected !== true || retreat.negativeTests?.onlyRearGuardRejected !== true || retreat.negativeTests?.onlyRetreatRejected !== true) errors.push('retreat_binding');
  const browserFrames = browser?.scenes?.flatMap((scene) => scene.frames || []) || [];
  const browserRepairFrames = browser?.repairBinding?.frames || browserFrames.filter((frame) => frame.repairExpected);
  const browserRepairBinding = browserRepairFrames.length > 0 && browserRepairFrames.every((frame) => frame.selectedActorId === frame.selectedHudActorId && frame.selectedActorId === frame.repairSourceActorId && Boolean(frame.repairTargetActorId) && Boolean(frame.formalRepairEventId));
  if (!browser || browser.stage !== '8.2G-D-B.1a' || browser.browser?.captureCount !== 7 || browser.browser?.uniqueImageHashes !== 7 || browser.browser?.pageErrors?.length || browser.browser?.consoleErrors?.length || browserFrames.length !== 7 || browser.semantic?.browserRecomputed !== true || browser.semantic?.stateSignaturesMatched !== true || browser.repairBinding?.fourLayerSelectionBinding !== true || !browserRepairBinding) errors.push('browser_evidence');
  if (!browserRepairBinding) errors.push('browser_repair_binding');
  if (!authority?.passed || authority.combatCoreModified || authority.plannerModified || authority.choreographerModified || authority.repairAuthorityModified || (authority.rows || []).some((row) => row.shotChanged || row.resultChanged || row.rewardChanged || row.settlementChanged || row.saveChanged || row.repairEventCountChanged !== 0 || row.repairSourceChanged !== 0 || row.repairTargetChanged !== 0 || row.repairTimeChanged !== 0 || row.repairAmountChanged !== 0 || row.repairEventHashBefore !== row.repairEventHashAfter)) errors.push('authority');
  if (!tamper || tamper.passed !== true || Number(tamper.rejectionCount || 0) < 12 || (tamper.cases || []).some((item) => item.rejected !== true)) errors.push('db1a_tamper');
  for (const [key, value] of Object.entries({ unarmed: regressions.unarmed, scoutMove: regressions.scoutMove, scoutFire: regressions.scoutFire, coverAdvance: regressions.coverAdvance, responsive480: regressions.responsive480, responsive390: regressions.responsive390, productionLeak: regressions.productionLeak, DB1: regressions.DB1, DB: regressions.DB, DA1a: regressions.DA1a })) if (value !== true) errors.push(`regression_${key}`);
  return { ok: errors.length === 0, errors };
}
