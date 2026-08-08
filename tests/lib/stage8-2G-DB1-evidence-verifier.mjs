export function verifyDB1EvidenceBundle({ unarmed, semantic, machine, browser, responsive, leak }) {
  const errors = [];
  if (!unarmed || unarmed.stage !== '8.2G-D-B.1' || unarmed.passed !== true || (unarmed.violations || []).length !== 0 || unarmed.authority?.plannerModified || unarmed.authority?.solverModified || unarmed.authority?.choreographerModified) errors.push('unarmed_state');
  if (!semantic || semantic.stage !== '8.2G-D-B.1' || semantic.passed !== true || semantic.failClosed !== true || (semantic.unresolved || []).length !== 0 || (semantic.resolutions || []).some((item) => item.resolved !== true || item.recomputedPredicate?.passed !== true)) errors.push('semantic_resolution');
  const browserFrames = browser?.scenes?.flatMap((scene) => scene.frames || []) || [];
  if (!machine || machine.stage !== '8.2G-D-B.1' || machine.frameCount !== 10 || machine.sceneCount !== 3) errors.push('machine_evidence');
  if (!browser || browser.stage !== '8.2G-D-B.1' || browser.browser?.captureCount !== 10 || browser.browser?.uniqueImageHashes !== 10 || browser.browser?.pageErrors?.length || browser.browser?.consoleErrors?.length || browserFrames.length !== 10 || browserFrames.some((frame) => frame.semanticCheck && (frame.productionSemanticPredicate?.passed !== true || frame.productionSemanticPredicate?.id !== frame.semanticResolution?.predicate?.id || JSON.stringify(frame.productionSemanticPredicate?.matchedActorIds || []) !== JSON.stringify(frame.semanticResolution?.predicate?.matchedActorIds || []) || frame.stateSignature !== frame.semanticResolution?.stateSignature))) errors.push('browser_evidence');
  if (!responsive || responsive.stage !== '8.2G-D-B.1' || responsive.passed !== true || responsive.productionBattleFirstLayout !== true || (responsive.viewport || []).some((item) => item.battlefieldWidthRatio < .8 || item.panelHidden !== true)) errors.push('responsive_geometry');
  if (!leak || leak.stage !== '8.2G-D-B.1' || leak.passed !== true || (leak.productionDomForbidden || []).length !== 0 || leak.internalIdentifiersVisible === true || leak.debugOverlayPreserved !== true) errors.push('production_leak');
  return { ok: errors.length === 0, errors };
}
