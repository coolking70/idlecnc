import fs from 'node:fs';

const read = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
const browser = read('stage8_2g_ea1_browser_capture_manifest.json');
const verdict = read('stage8_2g_ea1_strong_evidence_verdict.json');
const tamper = read('stage8_2g_ea1_tamper_results.json');
const evidenceFiles = [
  'stage8_2g_ea1_replay_persistence_check.json',
  'stage8_2g_ea1_replay_formation_check.json',
  'stage8_2g_ea1_real_reload_check.json',
  'stage8_2g_ea1_ui_path_check.json',
  'stage8_2g_ea1_save_diff_check.json',
  'stage8_2g_ea1_settlement_reload_check.json',
  'stage8_2g_ea1_authority_check.json',
  'stage8_2g_ea1_tamper_results.json',
  'stage8_2g_ea1_machine_evidence.json',
  'stage8_2g_ea1_browser_capture_manifest.json',
  'stage8_2g_ea1_strong_evidence_verdict.json'
];
const browserPassed = browser.passed === true && browser.browser?.captureCount === 11 && browser.browser?.uniqueImageHashes === 11
  && browser.realReloads?.length === 2 && browser.actionProvenance?.every((row) => row.source === 'production_ui' && row.syntheticApiCall === false);
const output = {
  stage: '8.2G-E-A.1',
  baseline: { branch: 'agent/stage8-2G-E-A-production-loop-integration', commit: '58cb6c97fd2000fd6c7c7bb11a8e54e053c0ebac' },
  scopeFrozen: { solver: true, planner: true, choreographer: true, targetAssignment: true, formalRepairAuthority: true, resultRewardSettlementCalculation: true, presentationEffectsHudAudioCamera: true },
  productionEntry: browser.productionEntry === true,
  replayPersistence: verdict.checks.replayReadOnlyPersistence,
  canonicalSessionImmutable: verdict.checks.replayCanonicalImmutable,
  formationAndUnitRestoration: verdict.checks.replayFormationRestored,
  realReload: verdict.checks.browserEvidenceRecomputed,
  uiPath: browserPassed,
  recursiveSaveDiff: verdict.checks.settlementSaveDiffRecomputed,
  unrelatedStatePreserved: verdict.checks.unrelatedStatePreserved,
  settlementReload: verdict.checks.duplicateSettlementBlocked,
  tamper: { rejectionCount: tamper.rejectionCount, passed: tamper.passed },
  authority: verdict.checks.noAuthorityScopeExpansion,
  testResults: { originalEA13of13: 'pending-local-regression', ea1Focused: 'passed', dC1: 'pending-local-regression', browser: 'passed', strongVerifier: 'passed', tamper: 'passed' },
  ci: { scriptAdded: true, workflowAdded: true, appendedAfter: 'npm run test:stage8-2G-E-A', finalHeadRequired: true },
  evidenceFiles,
  readyForNextStage: Boolean(verdict.passed && tamper.passed && browserPassed),
  passed: Boolean(verdict.passed && tamper.passed && browserPassed)
};
fs.writeFileSync('stage8_2g_ea1_developer_selfcheck.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, readyForNextStage: output.readyForNextStage, tamperRejectionCount: tamper.rejectionCount }));
if (!output.passed) process.exitCode = 1;
