export function verifyDCEvidenceBundle(bundle = {}) {
  const errors = [];
  const required = ['inventory', 'muzzle', 'impact', 'damage', 'destruction', 'wreck', 'camera', 'transition', 'audio', 'semantic', 'determinism', 'authority', 'performance'];
  for (const key of required) if (bundle[key]?.passed !== true) errors.push(key);
  if ((bundle.muzzle?.rows || []).some((row) => row.passed !== true || row.sourceBound !== true)) errors.push('muzzle_rows');
  if ((bundle.impact?.rows || []).some((row) => row.passed !== true || row.targetBound !== true)) errors.push('impact_rows');
  if ((bundle.damage?.rows || []).some((row) => row.passed !== true || row.targetBound !== true || row.damageAnchorBound !== true)) errors.push('damage_rows');
  if ((bundle.destruction?.rows || []).some((row) => row.passed !== true)) errors.push('destruction_rows');
  if ((bundle.wreck?.rows || []).some((row) => row.passed !== true || row.wreckReady !== true)) errors.push('wreck_rows');
  if ((bundle.transition?.rows || []).some((row) => row.passed !== true || row.deterministic !== true)) errors.push('transition_rows');
  const machine = bundle.machine;
  const browser = bundle.browser;
  const semanticRows = bundle.semantic?.rows || [];
  const browserFrames = browser?.scenes?.flatMap((scene) => scene.frames || []) || [];
  if (!machine || machine.stage !== '8.2G-D-C' || machine.frameCount !== 14 || machine.sceneCount !== 3) errors.push('machine');
  if (!browser || browser.stage !== '8.2G-D-C' || browser.browser?.captureCount !== 14 || browser.browser?.uniqueImageHashes !== 14 || browser.browser?.pageErrors?.length || browser.browser?.consoleErrors?.length || browserFrames.length !== 14 || browser.semantic?.browserRecomputed !== true || browser.semantic?.stateSignaturesMatched !== true || browser.effects?.traceable !== true || browser.effects?.inventoryPresent !== true) errors.push('browser');
  if (semanticRows.length !== 14 || semanticRows.some((row) => row.resolved !== true || !row.stateSignature)) errors.push('semantic_resolution');
  if (bundle.camera?.rows?.some((row) => Number(row.amplitude || 0) > 5 || Number(row.unclampedAmplitude || 0) < Number(row.amplitude || 0) || (Number(row.amplitude || 0) > 0 && !(row.sourceEventIds || []).length))) errors.push('camera_bounds');
  const audioCues = bundle.audio?.rows?.flatMap((row) => row.cues || []) || [];
  if (audioCues.some((cue) => !cue.shotId && !cue.eventId && cue.eventType !== 'result') || !audioCues.some((cue) => cue.eventType === 'fire') || !audioCues.some((cue) => cue.eventType === 'impact')) errors.push('audio_traceability');
  if (bundle.authority?.rows?.some((row) => row.reportUnchanged !== true || row.anchorHashBefore !== row.anchorHashAfter || row.formalRepairAuthorityModified === true || row.resultChanged === true)) errors.push('authority_immutability');
  const tamper = bundle.tamper;
  if (!tamper || tamper.passed !== true || Number(tamper.rejectionCount || 0) < 18 || (tamper.cases || []).some((item) => item.rejected !== true)) errors.push('tamper');
  return { ok: errors.length === 0, errors };
}
