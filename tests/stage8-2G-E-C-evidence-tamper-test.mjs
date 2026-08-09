import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyECEvidenceBundle } from './lib/stage8-2G-EC-strong-integration-verifier.mjs';

const bundle = JSON.parse(fs.readFileSync('stage8_2g_ec_evidence_bundle.json', 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const cases = [];
const frames = (candidate) => candidate.browser.scenes.flatMap((scene) => scene.frames);
const frame = (candidate, semantic) => frames(candidate).find((item) => item.semantic === semantic);

function tamper(name, mutate) {
  const candidate = clone(bundle);
  mutate(candidate);
  const verdict = verifyECEvidenceBundle(candidate, { root: process.cwd() });
  const rejected = verdict.ok === false;
  cases.push({ case: name, rejected, errors: verdict.errors });
  assert.equal(rejected, true, `${name} was accepted`);
}

// These mutations preserve every existing `passed` declaration. Acceptance must
// therefore depend on independent recomputation, not on the candidate's claims.
tamper('fake_invalid_saved_at_acceptance', (c) => { c.offlineWindow.invalidSavedAtZero = false; });
tamper('fake_future_saved_at_acceptance', (c) => { c.offlineWindow.futureSavedAtZero = false; });
tamper('fake_rollback_saved_at_acceptance', (c) => { c.offlineWindow.rollbackSavedAtZero = false; });
tamper('fake_valid_raw_seconds', (c) => { c.offlineWindow.validRawSeconds = false; });
tamper('fake_cap_truth', (c) => { c.offlineWindow.capTruthful = false; });
tamper('fake_first_settlement', (c) => { c.exactlyOnce.firstSettled = false; });
tamper('fake_duplicate_settlement', (c) => { c.exactlyOnce.secondAlreadySettled = false; });
tamper('fake_second_mutation_claim', (c) => { c.exactlyOnce.noSecondMutation = false; });
tamper('fake_battle_paused_claim', (c) => { c.battleBoundary.reportBattlePaused = false; });
tamper('fake_active_battle_unchanged', (c) => { c.battleBoundary.activeBattleUnchanged = false; });
tamper('fake_session_unchanged', (c) => { c.battleBoundary.sessionUnchanged = false; });
tamper('fake_report_unchanged', (c) => { c.battleBoundary.reportUnchanged = false; });
tamper('fake_ledger_unchanged', (c) => { c.battleBoundary.ledgerUnchanged = false; });
tamper('fake_formation_unit_unchanged', (c) => { c.battleBoundary.formationUnitStateUnchanged = false; });
tamper('fake_result_second_settlement', (c) => { c.battleBoundary.result.noSecondSettlement = false; });
tamper('fake_result_ledger_count', (c) => { c.battleBoundary.result.ledgerCount += 1; });
tamper('fake_result_report_count', (c) => { c.battleBoundary.result.reportCount += 1; });
tamper('fake_max_steps', (c) => { c.stepTruncation.maxSteps += 1; });
tamper('fake_step_count', (c) => { c.stepTruncation.steps -= 1; });
tamper('fake_requested_seconds', (c) => { c.stepTruncation.requestedSeconds -= 1; });
tamper('fake_consumed_seconds', (c) => { c.stepTruncation.consumedSeconds += 1; });
tamper('fake_remaining_seconds', (c) => { c.stepTruncation.remainingSeconds = 0; });
tamper('fake_truncation_claim', (c) => { c.stepTruncation.truncated = false; });
tamper('fake_unexpected_save_diff', (c) => { c.saveDiff.forbiddenChangedPaths = ['battles.0.id']; });
tamper('fake_save_diff_changed_path', (c) => { c.saveDiff.changedPaths.push('battles.0.id'); });
tamper('fake_save_diff_self_contradiction', (c) => { c.saveDiff.unexpectedChangedPaths = ['resources.intel']; });
tamper('fake_authority_hash', (c) => { c.authority.authorityHashes['js/theater.js'] = '0'.repeat(64); });
tamper('fake_authority_path', (c) => { c.authority.forbiddenAuthorityPaths[0] = 'js/offline.js'; });
tamper('fake_machine_frame_count', (c) => { c.machineEvidence.frameCount = 16; });
tamper('fake_machine_production_entry', (c) => { c.machineEvidence.productionEntry = false; });
tamper('fake_performance_budget', (c) => { c.performance.p95BudgetMs = 1; });
tamper('fake_performance_warmup', (c) => { c.performance.warmupSamples = 19; });
tamper('fake_performance_sample_count', (c) => { c.performance.sampleCount = 119; });
tamper('fake_performance_scenario_p95', (c) => { c.performance.scenarios[0].p95Ms = 99; });
tamper('fake_browser_boundary_running_session', (c) => { c.browserBoundary.runningSessionUnchanged = false; });
tamper('fake_browser_boundary_running_elapsed', (c) => { c.browserBoundary.runningElapsedUnchanged = false; });
tamper('fake_browser_boundary_replay_read_only', (c) => { c.browserBoundary.replayReadOnly = false; });
tamper('fake_browser_frame_count', (c) => { c.browser.browser.captureCount = 16; });
tamper('fake_browser_unique_hash_count', (c) => { c.browser.browser.uniqueImageHashes = 16; });
tamper('fake_browser_page_error', (c) => { c.browser.browser.pageErrors = ['tampered']; });
tamper('fake_browser_console_error', (c) => { c.browser.browser.consoleErrors = ['tampered']; });
tamper('fake_real_reload_same_time_origin', (c) => {
  c.browser.realReloads[0].after.timeOrigin = c.browser.realReloads[0].before.timeOrigin;
  c.browser.realReloads[0].timeOriginChanged = true;
});
tamper('fake_real_reload_flag_mismatch', (c) => { c.browser.realReloads[0].timeOriginChanged = false; });
tamper('fake_real_reload_same_loader_id', (c) => {
  const loader = c.browser.realReloads[0].afterLoaderId;
  c.browser.realReloads[1].beforeLoaderId = c.browser.realReloads[0].beforeLoaderId;
  c.browser.realReloads[1].afterLoaderId = loader;
  c.browser.realReloads[1].loaderId = loader;
});
tamper('fake_real_reload_method', (c) => { c.browser.realReloads[1].method = 'window.reload'; });
tamper('fake_real_reload_missing_before_time_origin', (c) => { delete c.browser.realReloads[2].before.timeOrigin; });
tamper('fake_real_reload_missing_after_time_origin', (c) => { delete c.browser.realReloads[2].after.timeOrigin; });
tamper('fake_real_reload_missing_loader', (c) => { delete c.browser.realReloads[2].afterLoaderId; });
tamper('fake_real_reload_loader_declaration', (c) => { c.browser.realReloads[0].loaderId = 'not-the-after-loader'; });
tamper('fake_real_reload_missing_reason', (c) => { delete c.browser.realReloads[2].reason; });
tamper('fake_real_reload_unexpected_reason', (c) => { c.browser.realReloads[4].reason = 'not-a-real-path'; });
tamper('fake_saved_at_injection_source', (c) => { c.browser.realReloads[0].offlineInjection.source = 'settleApi'; });
tamper('fake_saved_at_injection_method', (c) => { c.browser.realReloads[0].offlineInjection.method = 'direct_settle_api'; });
tamper('fake_saved_at_injection_seconds', (c) => { c.browser.realReloads[0].offlineInjection.seconds = 1; });
tamper('fake_png_hash', (c) => { c.browser.scenes[0].frames[0].imageSha256 = '0'.repeat(64); });
tamper('fake_png_path_escape', (c) => { c.browser.scenes[0].frames[0].screenshot.path = '../secret.png'; });
tamper('fake_png_screenshot_hash', (c) => { c.browser.scenes[0].frames[0].screenshot.sha256 = '0'.repeat(64); });
tamper('fake_pending_report_state', (c) => { frame(c, 'offline_report_pending').state.offline.shown = true; });
tamper('fake_pending_reload_state', (c) => { frame(c, 'offline_report_pending_reload').state.resources.supply += 1; });
tamper('fake_closed_report_state', (c) => { frame(c, 'offline_report_closed_reload').state.offline = { settled: true }; });
tamper('fake_running_battle_identity', (c) => { frame(c, 'running_after_offline_reload').state.activeBattle.battleSessionId = 'fake-session'; });
tamper('fake_running_battle_elapsed', (c) => { frame(c, 'running_after_offline_reload').state.activeBattle.elapsed += 1; });
tamper('fake_running_battle_pause', (c) => { frame(c, 'running_after_offline_reload').state.offline.battlePaused = false; });
tamper('fake_running_report_hash', (c) => { frame(c, 'running_after_offline_reload').state.formalReportHash = '0'.repeat(64); });
tamper('fake_replay_session_hash', (c) => { frame(c, 'replay_after_offline_reload').state.sessionHash = '0'.repeat(64); });
tamper('fake_replay_elapsed', (c) => { frame(c, 'replay_after_offline_reload').state.activeBattle.elapsed += 1; });
tamper('fake_replay_writable', (c) => { frame(c, 'replay_after_offline_reload').state.activeBattle.replayReadOnly = false; });
tamper('fake_replay_active_session', (c) => { frame(c, 'replay_after_offline_reload').state.activeBattleSessionId = 'fake-session'; });
tamper('fake_replay_battle_pause', (c) => { frame(c, 'replay_after_offline_reload').state.offline.battlePaused = false; });
tamper('fake_required_confirm_dispatch', (c) => { c.browser.actionProvenance = c.browser.actionProvenance.filter((row) => row.action !== 'confirm-dispatch'); });
tamper('fake_required_view_offline_report', (c) => { c.browser.actionProvenance = c.browser.actionProvenance.filter((row) => row.action !== 'view-offline-report'); });
tamper('fake_action_source', (c) => { c.browser.actionProvenance.find((row) => row.action === 'confirm-dispatch').source = 'debug_api'; });
tamper('fake_action_synthetic_call', (c) => { c.browser.actionProvenance.find((row) => row.action === 'dismiss-offline-report').syntheticApiCall = true; });
tamper('fake_dispatch_api_shortcut', (c) => { c.browser.dispatchApiUsed = true; });
tamper('fake_replay_api_shortcut', (c) => { c.browser.replayApiUsed = true; });
tamper('fake_offline_api_shortcut', (c) => { c.browser.offlineApiUsed = true; });
tamper('fake_eB_confirm_dispatch', (c) => { c.regression.eB.browser.actionProvenance = c.regression.eB.browser.actionProvenance.filter((row) => row.action !== 'confirm-dispatch'); });
tamper('fake_eB_authority_hash', (c) => { const key = Object.keys(c.regression.eB.authority.authorityHashes)[0]; c.regression.eB.authority.authorityHashes[key] = '0'.repeat(64); });
tamper('fake_eB_command_flow_claim', (c) => { c.regression.eB.commandFlow.failedPathsZeroMutation = false; });
tamper('fake_eB_dispatch_snapshot', (c) => { c.regression.eB.deploymentReview.snapshot.units[0].hp += 1; });

const output = {
  stage: '8.2G-E-C',
  cases,
  rejectionCount: cases.filter((item) => item.rejected).length,
  passedFlagOnlyCases: 0,
  declaredPassedPreserved: true,
  passed: cases.length >= 50 && cases.every((item) => item.rejected === true)
};
fs.writeFileSync('stage8_2g_ec_tamper_results.json', `${JSON.stringify(output, null, 2)}\n`);
const bundleWithTamper = clone(bundle);
bundleWithTamper.tamper = output;
fs.writeFileSync('stage8_2g_ec_evidence_bundle.json', `${JSON.stringify(bundleWithTamper, null, 2)}\n`);
assert.equal(output.passed, true, `tamper gate failed: ${JSON.stringify(output)}`);
console.log(JSON.stringify({ ok: true, stage: output.stage, rejectionCount: output.rejectionCount, passedFlagOnlyCases: output.passedFlagOnlyCases }));
