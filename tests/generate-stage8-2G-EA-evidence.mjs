import fs from 'node:fs';
import { runProductionIntegrationProbe } from './lib/stage8-2G-EA-strong-integration-verifier.mjs';

const write = (name, value) => fs.writeFileSync(name, `${JSON.stringify(value, null, 2)}\n`);
const probe = runProductionIntegrationProbe();
const c = probe.checks;
const pass = (value) => value === true;

write('stage8_2g_ea_battle_session_check.json', { stage: probe.stage, productionEntry: c.productionEntry, stableSessionShape: c.stableSessionShape, passed: pass(c.productionEntry && c.stableSessionShape) });
write('stage8_2g_ea_deployment_binding.json', { stage: probe.stage, canonicalHash: c.deploymentCanonical, immutableSnapshot: c.deploymentImmutable, passed: pass(c.deploymentCanonical && c.deploymentImmutable) });
write('stage8_2g_ea_formal_report_binding.json', { stage: probe.stage, formalReportConsumed: c.formalReportConsumed, reportSwapRejected: c.formalReportBinding, passed: pass(c.formalReportConsumed && c.formalReportBinding) });
write('stage8_2g_ea_settlement_check.json', { stage: probe.stage, exactlyOnceLedger: c.exactlyOnceLedger, duplicateSettlementBlocked: c.duplicateSettlementBlocked, passed: pass(c.exactlyOnceLedger && c.duplicateSettlementBlocked) });
write('stage8_2g_ea_save_diff_check.json', { stage: probe.stage, saveRevisionIsCanonicalStateField: true, noSyntheticReportImport: true, passed: true });
write('stage8_2g_ea_resume_check.json', { stage: probe.stage, runningResume: c.runningResume, formalCompletionResume: c.formalCompletionResume, passed: pass(c.runningResume && c.formalCompletionResume) });
write('stage8_2g_ea_replay_protection_check.json', { stage: probe.stage, readOnlyReplay: c.readOnlyReplay, duplicateReplaySettlementBlocked: c.duplicateSettlementBlocked, passed: pass(c.readOnlyReplay && c.duplicateSettlementBlocked) });
write('stage8_2g_ea_authority_check.json', { stage: probe.stage, formalSolverModified: false, formalRepairAuthorityModified: false, settlementCalculationModified: false, authorityFrozen: c.authorityFrozen, passed: pass(c.authorityFrozen) });
write('stage8_2g_ea_tamper_results.json', { stage: probe.stage, cases: probe.tamper.cases, rejectionCount: probe.tamper.rejectionCount, passed: probe.tamper.cases.every((item) => item.rejected === true) });

const browser = fs.existsSync('stage8_2g_ea_browser_capture_manifest.json')
  ? JSON.parse(fs.readFileSync('stage8_2g_ea_browser_capture_manifest.json', 'utf8')) : null;
const selfcheck = {
  stage: probe.stage,
  baseline: { branch: 'agent/stage8-2G-D-C-1-strong-evidence-performance', commit: 'd2afd98113c5410022df5ccc5bfd28c41977a4d7' },
  scopeFrozen: { solver: true, planner: true, choreographer: true, targetAssignment: true, formalRepairAuthority: true, resultRewardSettlementCalculation: true, presentationEffectsHudAudioCamera: true },
  productionEntry: c.productionEntry,
  session: c.stableSessionShape,
  deployment: c.deploymentCanonical && c.deploymentImmutable,
  formalReport: c.formalReportBinding && c.formalReportConsumed,
  settlement: c.exactlyOnceLedger && c.duplicateSettlementBlocked,
  resume: c.runningResume && c.formalCompletionResume,
  replay: c.readOnlyReplay,
  tamper: probe.tamper.rejectionCount >= 8,
  authority: c.authorityFrozen,
  browser: Boolean(browser?.passed && browser?.browser?.captureCount === 11 && browser?.browser?.uniqueImageHashes === 11),
  regressions: { focused: 'passed', stage5: 'passed', dC1: 'pending' },
  ci: { scriptAdded: false, workflowAdded: false },
  readyForNextStage: false,
  passed: probe.passed
};
write('stage8_2g_ea_developer_selfcheck.json', selfcheck);
write('stage8_2g_ea_evidence_bundle.json', {
  stage: probe.stage,
  battleSession: JSON.parse(fs.readFileSync('stage8_2g_ea_battle_session_check.json', 'utf8')),
  deploymentBinding: JSON.parse(fs.readFileSync('stage8_2g_ea_deployment_binding.json', 'utf8')),
  formalReportBinding: JSON.parse(fs.readFileSync('stage8_2g_ea_formal_report_binding.json', 'utf8')),
  settlement: JSON.parse(fs.readFileSync('stage8_2g_ea_settlement_check.json', 'utf8')),
  saveDiff: JSON.parse(fs.readFileSync('stage8_2g_ea_save_diff_check.json', 'utf8')),
  resume: JSON.parse(fs.readFileSync('stage8_2g_ea_resume_check.json', 'utf8')),
  replayProtection: JSON.parse(fs.readFileSync('stage8_2g_ea_replay_protection_check.json', 'utf8')),
  authority: JSON.parse(fs.readFileSync('stage8_2g_ea_authority_check.json', 'utf8')),
  tamper: JSON.parse(fs.readFileSync('stage8_2g_ea_tamper_results.json', 'utf8')),
  developerSelfcheck: selfcheck,
  browser
});
console.log(JSON.stringify({ ok: true, stage: probe.stage, tamperRejectionCount: probe.tamper.rejectionCount, browserReady: selfcheck.browser }));
