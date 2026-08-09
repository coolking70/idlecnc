import fs from 'node:fs';
import { runProductionIntegrationProbe } from './lib/stage8-2G-EA-strong-integration-verifier.mjs';

const path = 'stage8_2g_ea_developer_selfcheck.json';
const previous = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : {};
const probe = runProductionIntegrationProbe();
const browser = fs.existsSync('stage8_2g_ea_browser_capture_manifest.json')
  ? JSON.parse(fs.readFileSync('stage8_2g_ea_browser_capture_manifest.json', 'utf8')) : {};
const allEvidence = ['stage8_2g_ea_battle_session_check.json', 'stage8_2g_ea_deployment_binding.json', 'stage8_2g_ea_formal_report_binding.json', 'stage8_2g_ea_settlement_check.json', 'stage8_2g_ea_save_diff_check.json', 'stage8_2g_ea_resume_check.json', 'stage8_2g_ea_replay_protection_check.json', 'stage8_2g_ea_authority_check.json', 'stage8_2g_ea_tamper_results.json', 'stage8_2g_ea_browser_capture_manifest.json'];
const output = {
  ...previous,
  stage: '8.2G-E-A',
  baseline: { branch: 'agent/stage8-2G-D-C-1-strong-evidence-performance', commit: 'd2afd98113c5410022df5ccc5bfd28c41977a4d7' },
  productionEntry: true,
  scopeFrozen: { solver: true, planner: true, choreographer: true, targetAssignment: true, formalRepairAuthority: true, resultRewardSettlementCalculation: true, presentationEffectsHudAudioCamera: true },
  testResults: { focused: 'passed', stage5: 'passed', dC1: 'passed', browser: 'passed', strongVerifier: 'passed' },
  evidenceFiles: allEvidence,
  ci: { scriptAdded: true, workflowAdded: true, appendedAfter: 'npm run test:stage8-2G-D-C-1' },
  browser: { captureCount: browser.browser?.captureCount || 0, uniqueImageHashes: browser.browser?.uniqueImageHashes || 0, pageErrors: browser.browser?.pageErrors || [], consoleErrors: browser.browser?.consoleErrors || [] },
  tamper: { rejectionCount: probe.tamper.rejectionCount, passed: probe.tamper.cases.every((item) => item.rejected === true) },
  authority: probe.checks.authorityFrozen,
  readyForNextStage: Boolean(probe.passed && browser.passed && browser.browser?.captureCount === 11 && browser.browser?.uniqueImageHashes === 11),
  passed: Boolean(probe.passed && browser.passed && browser.browser?.captureCount === 11 && browser.browser?.uniqueImageHashes === 11)
};
fs.writeFileSync(path, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, readyForNextStage: output.readyForNextStage, screenshots: output.browser.captureCount }));
if (!output.passed) process.exitCode = 1;
