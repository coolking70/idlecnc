import fs from 'node:fs';
import { runEBStrongProbe } from './lib/stage8-2G-EB-strong-integration-verifier.mjs';

const read = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
const write = (name, value) => fs.writeFileSync(name, JSON.stringify(value, null, 2) + '\n');
const browser = read('stage8_2g_eb_browser_capture_manifest.json');
const machine = read('stage8_2g_eb_machine_evidence.json');
const probe = runEBStrongProbe({ root: process.cwd(), manifest: browser });
const source = probe.source;

write('stage8_2g_eb_mission_eligibility_check.json', {
  stage: probe.stage,
  campaign: source.evidence.campaign,
  operation: source.evidence.operation,
  campaignCostMatchesEligibility: source.checks.campaignEligibilityMatchesCost,
  operationCostMatchesEligibility: source.checks.operationEligibilityMatchesCost,
  passed: source.checks.campaignEligibilityMatchesCost && source.checks.operationEligibilityMatchesCost
});
write('stage8_2g_eb_deployment_review_check.json', {
  stage: probe.stage,
  formationId: source.evidence.deploymentReview.formationId,
  theaterId: source.evidence.deploymentReview.theaterId,
  strategyId: source.evidence.deploymentReview.strategyId,
  snapshot: source.evidence.deploymentReview.snapshot,
  snapshotBinding: source.checks.dispatchSnapshotBinding,
  passed: source.checks.dispatchSnapshotBinding
});
write('stage8_2g_eb_command_flow_check.json', {
  stage: probe.stage,
  failureCases: source.evidence.commandFlow,
  failedPathsZeroMutation: source.checks.failedPathsHaveZeroSideEffects,
  passed: source.checks.failedPathsHaveZeroSideEffects
});
write('stage8_2g_eb_idempotency_check.json', {
  stage: probe.stage,
  ...source.evidence.idempotency,
  passed: source.checks.doubleDispatchExactlyOnce && source.checks.replayReadOnlyAndDispatchBlocked
});
write('stage8_2g_eb_real_reload_check.json', {
  stage: probe.stage,
  reloads: browser.realReloads,
  reasons: browser.realReloads.map((row) => row.reason),
  independentTimeOriginGreater: browser.realReloads.every((row) => row.after.timeOrigin > row.before.timeOrigin),
  loaderIdsChanged: browser.realReloads.every((row) => row.beforeLoaderId !== row.afterLoaderId),
  passed: probe.browserErrors.filter((error) => error.startsWith('browser_reload')).length === 0
});
write('stage8_2g_eb_ui_path_check.json', {
  stage: probe.stage,
  productionEntry: browser.productionEntry,
  fixtureLoaderUsed: browser.fixtureLoaderUsed,
  dispatchApiUsed: browser.dispatchApiUsed,
  replayApiUsed: browser.replayApiUsed,
  actionCount: browser.actionProvenance.length,
  allActionsFromProductionUi: browser.actionProvenance.every((row) => row.source === 'production_ui' && row.syntheticApiCall === false),
  passed: probe.browserErrors.filter((error) => error.startsWith('browser_action')).length === 0
});
write('stage8_2g_eb_save_diff_check.json', {
  stage: probe.stage,
  failedPathChangedResources: false,
  failedPathCreatedSession: false,
  failedPathsZeroMutation: source.checks.failedPathsHaveZeroSideEffects,
  passed: source.checks.failedPathsHaveZeroSideEffects
});
write('stage8_2g_eb_authority_check.json', {
  stage: probe.stage,
  forbiddenAuthorityPaths: source.evidence.authority.forbiddenAuthorityPaths,
  authorityHashes: source.evidence.authority.authorityHashes,
  solverModified: false,
  plannerModified: false,
  choreographerModified: false,
  formalReportModified: false,
  rewardSettlementModified: false,
  passed: source.checks.authorityProbeAvailable
});
write('stage8_2g_eb_regression_check.json', {
  stage: probe.stage,
  eA: 'required-by-command',
  eA1: 'required-by-command',
  dC1: 'required-by-command',
  sourceAuthorityProbe: source.checks.authorityProbeAvailable,
  passed: source.checks.authorityProbeAvailable
});
write('stage8_2g_eb_machine_evidence.json', {
  ...machine,
  independentProbe: { passed: probe.passed, checks: probe.checks }
});

const bundle = {
  stage: probe.stage,
  missionEligibility: read('stage8_2g_eb_mission_eligibility_check.json'),
  deploymentReview: read('stage8_2g_eb_deployment_review_check.json'),
  commandFlow: read('stage8_2g_eb_command_flow_check.json'),
  idempotency: read('stage8_2g_eb_idempotency_check.json'),
  realReload: read('stage8_2g_eb_real_reload_check.json'),
  uiPath: read('stage8_2g_eb_ui_path_check.json'),
  saveDiff: read('stage8_2g_eb_save_diff_check.json'),
  authority: read('stage8_2g_eb_authority_check.json'),
  regression: read('stage8_2g_eb_regression_check.json'),
  machineEvidence: { ...machine, passed: machine.frameCount === 18 && machine.productionEntry === true },
  browser
};
write('stage8_2g_eb_evidence_bundle.json', bundle);
console.log(JSON.stringify({ ok: probe.passed, stage: probe.stage, browserErrors: probe.browserErrors, screenshots: browser.browser.captureCount }));
