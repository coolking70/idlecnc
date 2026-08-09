import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyEBEvidenceBundle } from './lib/stage8-2G-EB-strong-integration-verifier.mjs';

const bundle = JSON.parse(fs.readFileSync('stage8_2g_eb_evidence_bundle.json', 'utf8'));
const cases = [];
const clone = (value) => JSON.parse(JSON.stringify(value));

function tamper(name, mutate) {
  const candidate = clone(bundle);
  mutate(candidate);
  const verdict = verifyEBEvidenceBundle(candidate);
  const rejected = verdict.ok === false;
  cases.push({ case: name, rejected, errors: verdict.errors });
  assert.equal(rejected, true, name + ' was accepted');
}

// All cases preserve every declared passed flag. They alter a source field
// that the independent probe must recompute.
tamper('fake_campaign_eligibility', (candidate) => { candidate.missionEligibility.campaign.eligibility.ok = false; });
tamper('fake_campaign_cost', (candidate) => { candidate.missionEligibility.campaign.cost.cost.supply += 1; });
tamper('fake_operation_eligibility', (candidate) => { candidate.missionEligibility.operation.eligibility.code = 'cooldown'; });
tamper('fake_operation_cost', (candidate) => { candidate.missionEligibility.operation.cost.breakdown.supplyMultiplier = 1; });
tamper('fake_operation_cooldown_remaining', (candidate) => { candidate.missionEligibility.operation.operationState.cooldownRemaining = 999; });
tamper('fake_deployment_unit_list', (candidate) => { candidate.deploymentReview.snapshot.units.pop(); });
tamper('fake_deployment_unit_hp', (candidate) => { candidate.deploymentReview.snapshot.units[0].hp += 1; });
tamper('fake_deployment_formation', (candidate) => { candidate.deploymentReview.formationId = 'fake-formation'; });
tamper('fake_failure_code', (candidate) => { candidate.commandFlow.failureCases.capturedResult.code = 'ready'; });
tamper('fake_failure_mutation_claim', (candidate) => { candidate.commandFlow.failedPathsZeroMutation = false; });
tamper('fake_double_dispatch_delta', (candidate) => { candidate.idempotency.doubleDispatchSessionDelta = 2; });
tamper('fake_replay_mutation_claim', (candidate) => { candidate.idempotency.replayCanonicalUnchanged = false; });
tamper('fake_reload_same_time_origin', (candidate) => {
  candidate.browser.realReloads[0].after.timeOrigin = candidate.browser.realReloads[0].before.timeOrigin;
  candidate.browser.realReloads[0].timeOriginChanged = true;
});
tamper('fake_reload_time_origin_regression', (candidate) => {
  candidate.browser.realReloads[0].after.timeOrigin = candidate.browser.realReloads[0].before.timeOrigin - 1;
  candidate.browser.realReloads[0].timeOriginChanged = true;
});
tamper('fake_reload_flag_mismatch', (candidate) => { candidate.browser.realReloads[0].timeOriginChanged = false; });
tamper('fake_reload_missing_before_time_origin', (candidate) => { delete candidate.browser.realReloads[0].before.timeOrigin; });
tamper('fake_reload_reason_coverage', (candidate) => { candidate.browser.realReloads[3].reason = 'running_battle'; });
tamper('fake_reload_method', (candidate) => { candidate.browser.realReloads[1].method = 'window.reload'; });
tamper('fake_reload_same_loader', (candidate) => {
  candidate.browser.realReloads[1].afterLoaderId = candidate.browser.realReloads[0].afterLoaderId;
  candidate.browser.realReloads[1].loaderId = candidate.browser.realReloads[0].afterLoaderId;
});
tamper('fake_reload_loader_declaration', (candidate) => { candidate.browser.realReloads[0].loaderId = 'other-loader'; });
tamper('fake_reload_missing_loader', (candidate) => { delete candidate.browser.realReloads[2].afterLoaderId; });
tamper('fake_reload_missing_reason', (candidate) => { delete candidate.browser.realReloads[2].reason; });
tamper('fake_browser_frame_count', (candidate) => { candidate.browser.browser.captureCount = 17; });
tamper('fake_browser_hash_count', (candidate) => { candidate.browser.browser.uniqueImageHashes = 17; });
tamper('fake_png_hash', (candidate) => { candidate.browser.scenes[0].frames[0].imageSha256 = '0'.repeat(64); });
tamper('fake_png_path', (candidate) => { candidate.browser.scenes[0].frames[0].screenshot.path = '../secret.png'; });
tamper('fake_production_entry', (candidate) => { candidate.browser.productionEntry = false; });
tamper('fake_fixture_loader', (candidate) => { candidate.browser.fixtureLoaderUsed = true; });
tamper('fake_dispatch_api_path', (candidate) => { candidate.browser.dispatchApiUsed = true; });
tamper('fake_replay_api_path', (candidate) => { candidate.browser.replayApiUsed = true; });
tamper('fake_action_source', (candidate) => { candidate.browser.actionProvenance[0].source = 'debug_api'; });
tamper('fake_action_synthetic_call', (candidate) => { candidate.browser.actionProvenance[0].syntheticApiCall = true; });
tamper('fake_review_unit_binding', (candidate) => { candidate.browser.scenes[0].frames[2].deploymentReview.unitIds[0] = 'fake-unit'; });
tamper('fake_review_dom_visibility', (candidate) => {
  candidate.browser.scenes[0].frames[2].domText = candidate.browser.scenes[0].frames[3].domText;
});
tamper('fake_reload_review_leftover', (candidate) => {
  candidate.browser.scenes[0].frames[3].domText += '\n部署确认 / DEPLOYMENT REVIEW';
});
tamper('fake_double_confirm', (candidate) => { candidate.browser.scenes[0].frames[4].state.sessionCount = 2; });
tamper('fake_operation_side_effect', (candidate) => { candidate.browser.scenes[0].frames[12].state.sessionCount = 2; });
tamper('fake_result_reload', (candidate) => { candidate.browser.scenes[0].frames[7].state.activeBattle.settled = false; });
tamper('fake_report_view', (candidate) => { candidate.browser.scenes[0].frames[8].domText = ''; });
tamper('fake_session_report_swap', (candidate) => { candidate.browser.scenes[0].frames[8].state.sessionId = 'swapped-session'; });
tamper('fake_return_base', (candidate) => { candidate.browser.scenes[0].frames[9].state.activeBattle = { settled: true }; });
tamper('fake_replay_start_write', (candidate) => { candidate.browser.scenes[0].frames[13].state.activeBattle.replayReadOnly = false; });
tamper('fake_replay_reload_write', (candidate) => { candidate.browser.scenes[0].frames[15].state.activeBattleSessionId = 'fake-session'; });
tamper('fake_replay_canonical_write', (candidate) => { candidate.browser.scenes[0].frames[15].state.sessionId = 'swapped-session'; });
tamper('fake_save_diff_zero_mutation', (candidate) => { candidate.saveDiff.failedPathsZeroMutation = false; });
tamper('fake_failed_path_resource_mutation', (candidate) => { candidate.saveDiff.failedPathChangedResources = true; });
tamper('fake_unrelated_state_mutation', (candidate) => { candidate.saveDiff.failedPathCreatedSession = true; });
tamper('fake_authority_scope', (candidate) => {
  const key = Object.keys(candidate.authority.authorityHashes)[0];
  candidate.authority.authorityHashes[key] = '0'.repeat(64);
});

const output = {
  stage: '8.2G-E-B',
  cases,
  rejectionCount: cases.filter((item) => item.rejected).length,
  passedFlagOnlyCases: 0,
  declaredPassedPreserved: true,
  passed: cases.length >= 35 && cases.every((item) => item.rejected === true)
};
fs.writeFileSync('stage8_2g_eb_tamper_results.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, rejectionCount: output.rejectionCount }));
