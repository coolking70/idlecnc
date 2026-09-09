import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createInitialState } from '../../js/state.js';
import { recalcDerived } from '../../js/economy.js';
import { createUnit } from '../../js/production.js';
import { createFormation, addUnit } from '../../js/formations.js';
import {
  buildDispatchSnapshot,
  canDispatch,
  canDispatchOperationMission,
  dispatchFormation,
  dispatchOperation,
  finishBattleReturn,
  getOperation,
  getMissionCost,
  replayBattleSession,
  settleActiveBattle,
  tickActiveBattle
} from '../../js/theater.js';
import { getOperationCost } from '../../js/operations.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const REQUIRED_EB_ACTIONS = Object.freeze([
  'select-theater', 'select-strategy', 'open-deployment-review',
  'confirm-dispatch', 'view-report', 'return-from-battle', 'replay-report'
]);

export function requiredActionCoverage(manifest, required = REQUIRED_EB_ACTIONS) {
  const actions = Array.isArray(manifest?.actionProvenance) ? manifest.actionProvenance : [];
  const present = new Set(actions.map((row) => row?.action).filter(Boolean));
  return required.filter((action) => !present.has(action));
}

// Formation IDs are generated at runtime, so they are not stable evidence
// identity. Compare the semantic snapshot while retaining every authoritative
// field (unit order, stats, HP, theater, strategy and mission binding).
function comparableDeploymentSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  const output = clone(snapshot);
  const unitIds = new Map((output.units || []).map((unit, index) => [unit?.id, `unit-${index}`]));
  if (Array.isArray(output.units)) {
    output.units = output.units.map((unit) => ({ ...unit, id: unitIds.get(unit?.id) || unit?.id }));
  }
  if (output.formation && typeof output.formation === 'object') {
    output.formation = {
      ...output.formation,
      id: '<formation>',
      name: '<formation>',
      unitIds: (output.formation.unitIds || []).map((id) => unitIds.get(id) || id)
    };
  }
  return output;
}

function fresh({ captured = false, resources = null } = {}) {
  const state = createInitialState();
  state.resources = resources || { supply: 99999, alloy: 99999, intel: 99999 };
  state.command.capacity = 999;
  ['infantry', 'infantry', 'infantry', 'infantry', 'scout_car'].forEach((type, index) => {
    const unit = createUnit(type, 'eb-probe-' + index);
    unit.id = 'eb-probe-unit-' + index;
    state.units.push(unit);
  });
  const created = createFormation(state, 'E-B independent verifier formation');
  if (!created.ok) throw new Error('unable to create verifier formation');
  state.units.forEach((unit) => addUnit(state, created.formation.id, unit.id));
  if (captured) state.theaters.scrap_mine.captured = true;
  recalcDerived(state);
  return state;
}

function sourceProbe() {
  const checks = {};
  const evidence = {};
  const mark = (name, fn) => {
    try { checks[name] = Boolean(fn()); } catch (error) { checks[name] = false; evidence[name + 'Error'] = String(error); }
  };
  const campaign = fresh();
  const formationId = campaign.formations[0].id;
  const campaignCost = getMissionCost(campaign, formationId, 'scrap_mine', 'cautious');
  const campaignEligibility = canDispatch(campaign, formationId, 'scrap_mine', 'cautious');
  const campaignSnapshot = buildDispatchSnapshot(campaign, campaign.formations[0], 'scrap_mine', 'cautious', 'campaign', 'scrap_mine');
  evidence.campaign = { eligibility: campaignEligibility, cost: campaignCost, snapshot: campaignSnapshot };
  mark('campaignEligibilityMatchesCost', () => campaignEligibility.ok === true
    && equal(campaignEligibility.cost, campaignCost.cost)
    && campaignEligibility.missing.length === 0);

  const operation = fresh({ captured: true });
  const operationId = operation.formations[0].id;
  const operationCost = getOperationCost(operation, operationId, 'salvage_run', 'cautious');
  const operationEligibility = canDispatchOperationMission(operation, operationId, 'salvage_run', 'cautious');
  const operationState = getOperation(operation, 'salvage_run');
  const operationSnapshot = buildDispatchSnapshot(operation, operation.formations[0], 'scrap_mine', 'cautious', 'operation', 'salvage_run');
  evidence.operation = { eligibility: operationEligibility, cost: operationCost, operationState, snapshot: operationSnapshot };
  mark('operationEligibilityMatchesCost', () => operationEligibility.ok === true
    && equal(operationEligibility.cost, operationCost.cost)
    && operationCost.breakdown.supplyMultiplier === 4);

  const deployed = dispatchFormation(campaign, formationId, 'scrap_mine', 'cautious', 82091);
  mark('dispatchSnapshotBinding', () => deployed.ok === true
    && equal(deployed.activeBattle.dispatchSnapshot, campaignSnapshot)
    && equal(campaign.battleSessions[deployed.activeBattle.battleSessionId].deploymentSnapshot, campaignSnapshot));
  evidence.deploymentReview = {
    formationId,
    theaterId: 'scrap_mine',
    strategyId: 'cautious',
    unitIds: campaignSnapshot.units.map((unit) => unit.id),
    snapshot: campaignSnapshot
  };

  const second = dispatchFormation(campaign, formationId, 'scrap_mine', 'cautious', 82092);
  mark('doubleDispatchExactlyOnce', () => second.ok === false && second.code === 'battle_active'
    && campaign.battleSessionSequence === 1 && Object.keys(campaign.battleSessions).length === 1);

  const capturedCampaign = fresh({ captured: true });
  const beforeCaptured = clone(capturedCampaign);
  const capturedResult = dispatchFormation(capturedCampaign, capturedCampaign.formations[0].id, 'scrap_mine', 'cautious', 82093);
  const uncapturedOperation = fresh();
  const beforeUncapturedOperation = clone(uncapturedOperation);
  const uncapturedResult = dispatchOperation(uncapturedOperation, uncapturedOperation.formations[0].id, 'salvage_run', 'cautious', { seed: 82094 });
  const cooldown = fresh({ captured: true });
  cooldown.operations.salvage_run.cooldownUntil = cooldown.time.game + 100;
  const beforeCooldown = clone(cooldown);
  const cooldownResult = dispatchOperation(cooldown, cooldown.formations[0].id, 'salvage_run', 'cautious', { seed: 82095 });
  const poor = fresh({ resources: { supply: 0, alloy: 0, intel: 0 } });
  const beforePoor = clone(poor);
  const poorResult = dispatchFormation(poor, poor.formations[0].id, 'scrap_mine', 'cautious', 82096);
  mark('failedPathsHaveZeroSideEffects', () => capturedResult.code === 'captured'
    && uncapturedResult.code === 'theater_not_captured'
    && cooldownResult.code === 'cooldown'
    && poorResult.ok === false
    && equal(capturedCampaign, beforeCaptured)
    && equal(uncapturedOperation, beforeUncapturedOperation)
    && equal(cooldown, beforeCooldown)
    && equal(poor, beforePoor));
  evidence.commandFlow = {
    capturedResult, uncapturedResult, cooldownResult, poorResult,
    failedPathsZeroMutation: checks.failedPathsHaveZeroSideEffects
  };

  const replayState = fresh();
  const replayLaunch = dispatchFormation(replayState, replayState.formations[0].id, 'scrap_mine', 'cautious', 82097);
  tickActiveBattle(replayState, replayLaunch.activeBattle.duration + 1);
  const sessionId = replayLaunch.activeBattle.battleSessionId;
  finishBattleReturn(replayState);
  const replayStart = replayBattleSession(replayState, sessionId);
  const replayBefore = clone({ session: replayState.battleSessions[sessionId], ledger: replayState.battleSettlementLedger });
  const dispatchDuringReplay = dispatchFormation(replayState, replayState.formations[0].id, 'scrap_mine', 'cautious', 82098);
  const duplicateSettlement = settleActiveBattle(replayState);
  const replayAfter = clone({ session: replayState.battleSessions[sessionId], ledger: replayState.battleSettlementLedger });
  mark('replayReadOnlyAndDispatchBlocked', () => replayStart.ok === true
    && replayState.activeBattle?.replayReadOnly === true
    && replayState.activeBattleSessionId === null
    && dispatchDuringReplay.ok === false
    && dispatchDuringReplay.code === 'battle_active'
    && duplicateSettlement.ok === false
    && equal(replayBefore, replayAfter));
  evidence.idempotency = {
    doubleDispatchSessionDelta: 1,
    dispatchDuringReplay,
    duplicateSettlement,
    replayCanonicalUnchanged: checks.replayReadOnlyAndDispatchBlocked
  };

  // The deployment UX changed only presentation / command plumbing. These
  // source files remain outside the authority set for this phase.
  const forbiddenAuthorityPaths = [
    'js/battle.js',
    'js/save-diff.js',
    'js/production-battle-session.js',
    'experiments/battle-sandbox/universal-planner/universal-presentation-planner.js',
    'experiments/battle-sandbox/universal-planner/universal-spatial-planner.js'
  ];
  const authorityHashes = {};
  forbiddenAuthorityPaths.forEach((relative) => {
    const absolute = path.resolve(process.cwd(), relative);
    if (fs.existsSync(absolute)) authorityHashes[relative] = sha256(fs.readFileSync(absolute));
  });
  evidence.authority = { forbiddenAuthorityPaths, authorityHashes };
  mark('authorityProbeAvailable', () => Object.keys(authorityHashes).length >= 3);

  const passed = Object.values(checks).every(Boolean);
  return { checks, evidence, passed };
}

function verifyBrowserManifest(manifest, root, errors, source) {
  const frames = (manifest?.scenes || []).flatMap((scene) => scene.frames || []);
  const bySemantic = (semantic) => frames.find((frame) => frame.semantic === semantic);
  const expectedReasons = new Set(['deployment_review', 'running_battle', 'result', 'replay']);
  if (manifest?.stage !== '8.2G-E-B') errors.push('browser_stage');
  if (manifest?.productionEntry !== true || manifest?.fixtureLoaderUsed === true || manifest?.debugOverlayUsed === true) errors.push('browser_production_entry');
  if (manifest?.dispatchApiUsed !== false || manifest?.replayApiUsed !== false) errors.push('browser_api_shortcut');
  if (frames.length !== 18 || manifest?.browser?.captureCount !== 18 || manifest?.browser?.uniqueImageHashes !== 18) errors.push('browser_frame_count_or_hashes');
  if (manifest?.browser?.pageErrors?.length || manifest?.browser?.consoleErrors?.length) errors.push('browser_runtime_errors');
  const reloads = manifest?.realReloads || [];
  if (reloads.length !== 4) errors.push('browser_real_reload_count');
  const afterLoaders = [];
  const reasons = new Set();
  reloads.forEach((row, index) => {
    const before = row?.before?.timeOrigin;
    const after = row?.after?.timeOrigin;
    const beforeLoader = typeof row?.beforeLoaderId === 'string' ? row.beforeLoaderId.trim() : '';
    const afterLoader = typeof row?.afterLoaderId === 'string' ? row.afterLoaderId.trim() : '';
    const changed = typeof before === 'number' && Number.isFinite(before)
      && typeof after === 'number' && Number.isFinite(after) && after > before;
    if (row?.method !== 'Page.reload') errors.push('browser_reload_method:' + index);
    if (!changed) errors.push('browser_reload_time_origin:' + index);
    if (row?.timeOriginChanged !== changed) errors.push('browser_reload_declaration:' + index);
    if (!beforeLoader || !afterLoader || beforeLoader === afterLoader || row?.loaderId !== row?.afterLoaderId) errors.push('browser_reload_loader:' + index);
    reasons.add(row?.reason);
    afterLoaders.push(afterLoader);
  });
  if (new Set(afterLoaders).size !== afterLoaders.length) errors.push('browser_reload_loader_uniqueness');
  for (const reason of expectedReasons) if (!reasons.has(reason)) errors.push('browser_reload_reason:' + reason);
  if (reasons.size !== expectedReasons.size) errors.push('browser_reload_unexpected_reason');

  const seen = new Set();
  frames.forEach((frame) => {
    if (seen.has(frame.file)) errors.push('browser_duplicate_frame:' + frame.file);
    seen.add(frame.file);
    const relative = frame.screenshot?.path;
    if (!relative || path.isAbsolute(relative) || relative.includes('..')) {
      errors.push('browser_path:' + frame.file);
      return;
    }
    const absolute = path.resolve(root, relative);
    if (!fs.existsSync(absolute)) {
      errors.push('browser_missing_png:' + frame.file);
      return;
    }
    const hash = sha256(fs.readFileSync(absolute));
    if (hash !== frame.imageSha256 || hash !== frame.screenshot?.sha256) errors.push('browser_png_hash:' + frame.file);
  });

  if (!frames.every((frame) => frame.state?.sessionCount === undefined || Number.isInteger(frame.state.sessionCount))) errors.push('browser_state_shape');
  const review = bySemantic('deployment_review');
  const safeReview = bySemantic('review_after_real_reload_safe_fallback');
  const operationReview = bySemantic('operation_review');
  const resultReload = bySemantic('result_after_real_reload');
  const reportView = bySemantic('report_view');
  const baseAfter = bySemantic('base_after_return');
  const replayStart = bySemantic('replay_start');
  const replayAfter = bySemantic('replay_after_real_reload');
  const campaignReviewUnits = review?.deploymentReview?.unitIds || [];
  const sourceCampaignUnits = source.evidence.campaign.snapshot.units || [];
  const reviewMatchesState = (frame) => {
    const deployment = frame?.deploymentReview;
    const formation = (frame?.state?.formations || []).find((item) => item.id === deployment?.formationId);
    return Boolean(deployment && formation
      && formation.status === 'idle'
      && formation.unitIds?.length === deployment.unitIds?.length
      && equal(formation.unitIds, deployment.unitIds));
  };
  if (!review?.domText?.includes('部署确认 / DEPLOYMENT REVIEW')
    || campaignReviewUnits.length !== sourceCampaignUnits.length
    || new Set(campaignReviewUnits).size !== campaignReviewUnits.length
    || !reviewMatchesState(review)) errors.push('browser_campaign_review_binding');
  if (safeReview?.state?.activeBattle !== null || safeReview?.domText?.includes('部署确认 / DEPLOYMENT REVIEW')) errors.push('browser_review_reload_not_safe');
  if (!operationReview?.domText?.includes('部署确认 / DEPLOYMENT REVIEW')
    || operationReview?.deploymentReview?.missionKind !== 'operation'
    || !operationReview?.domText?.includes('重复任务')
    || !reviewMatchesState(operationReview)) errors.push('browser_operation_review');
  if (bySemantic('running_battle')?.state?.sessionCount !== 1 || bySemantic('running_battle')?.doubleClickSessionDelta !== 1) errors.push('browser_double_confirm');
  if (bySemantic('operation_cancelled')?.state?.sessionCount !== 1 || bySemantic('operation_cancelled')?.noSessionCreated !== true) errors.push('browser_operation_cancel_side_effect');
  if (resultReload?.state?.activeBattle?.settled !== true) errors.push('browser_result_reload');
  // Stage 10-P-B replaced the standalone '战报详情' card with the Command
  // Inspector. Assert on the seed row, which the Inspector always renders for a
  // report. Do not assert on the outcome-analysis section: it is only rendered
  // when the battle produced advantages or problems, so binding to it makes the
  // gate depend on the simulated outcome.
  if (!reportView?.domText?.includes('随机种子')) errors.push('browser_report_view');
  if (baseAfter?.state?.activeBattle !== null || baseAfter?.state?.reportCount !== 1) errors.push('browser_return_base');
  if (replayStart?.state?.activeBattle?.replayReadOnly !== true || replayStart?.state?.activeBattleSessionId !== null) errors.push('browser_replay_start');
  if (replayAfter?.state?.activeBattle?.replayReadOnly !== true || replayAfter?.state?.activeBattleSessionId !== null) errors.push('browser_replay_reload');
  const runningState = bySemantic('running_battle')?.state;
  const resultState = resultReload?.state;
  const reportState = reportView?.state;
  const replayState = replayAfter?.state;
  const sessionId = runningState?.activeBattleSessionId;
  const sessionIdentity = Boolean(sessionId
    && runningState?.activeBattle?.battleSessionId === sessionId
    && runningState?.sessionId === sessionId
    && resultState?.activeBattle?.battleSessionId === sessionId
    && resultState?.sessionId === sessionId
    && reportState?.activeBattle?.battleSessionId === sessionId
    && reportState?.sessionId === sessionId
    && replayState?.activeBattle?.battleSessionId === sessionId
    && replayState?.sessionId === sessionId
    && replayState?.activeBattleSessionId === null);
  if (!sessionIdentity) errors.push('browser_session_report_settlement_identity');
  if ((manifest?.actionProvenance || []).some((row) => row.source !== 'production_ui' || row.syntheticApiCall !== false)) errors.push('browser_action_provenance');
  requiredActionCoverage(manifest).forEach((action) => errors.push('browser_required_action:' + action));
}

export function runEBStrongProbe({ root = process.cwd(), manifest = null } = {}) {
  const source = sourceProbe();
  const browserErrors = [];
  verifyBrowserManifest(manifest || {}, root, browserErrors, source);
  const checks = {
    missionEligibility: source.checks.campaignEligibilityMatchesCost && source.checks.operationEligibilityMatchesCost,
    deploymentReviewSnapshotBinding: source.checks.dispatchSnapshotBinding,
    failedPathsZeroMutation: source.checks.failedPathsHaveZeroSideEffects,
    idempotency: source.checks.doubleDispatchExactlyOnce && source.checks.replayReadOnlyAndDispatchBlocked,
    browserEvidenceRecomputed: browserErrors.length === 0,
    authorityFrozen: source.checks.authorityProbeAvailable
  };
  return {
    stage: '8.2G-E-B',
    source,
    browserErrors: [...new Set(browserErrors)],
    checks,
    passed: Object.values(checks).every(Boolean)
  };
}

export function verifyEBEvidenceBundle(bundle = {}, { root = process.cwd() } = {}) {
  const browser = bundle.browser || (fs.existsSync(path.join(root, 'stage8_2g_eb_browser_capture_manifest.json'))
    ? JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_eb_browser_capture_manifest.json'), 'utf8')) : {});
  const probe = runEBStrongProbe({ root, manifest: browser });
  const errors = [...probe.browserErrors];
  if (bundle.stage !== '8.2G-E-B') errors.push('bundle_stage');
  const sourceEvidence = probe.source.evidence;
  if (!equal(bundle.missionEligibility?.campaign?.cost, sourceEvidence.campaign.cost)
    || !equal(bundle.missionEligibility?.campaign?.eligibility, sourceEvidence.campaign.eligibility)
    || !equal(bundle.missionEligibility?.operation?.cost, sourceEvidence.operation.cost)
    || !equal(bundle.missionEligibility?.operation?.eligibility, sourceEvidence.operation.eligibility)
    || !equal(bundle.missionEligibility?.operation?.operationState, sourceEvidence.operation.operationState)) errors.push('evidence:missionEligibility');
  const evidenceDeployment = bundle.deploymentReview || {};
  const evidenceSnapshot = evidenceDeployment.snapshot;
  const deploymentBinding = evidenceSnapshot?.formation?.id === evidenceDeployment.formationId
    && evidenceSnapshot?.theaterId === evidenceDeployment.theaterId
    && evidenceSnapshot?.strategyId === evidenceDeployment.strategyId
    && evidenceSnapshot?.missionKind === 'campaign'
    && Array.isArray(evidenceSnapshot?.units)
    && equal(evidenceSnapshot.formation?.unitIds, evidenceSnapshot.units.map((unit) => unit.id));
  if (!deploymentBinding || !equal(comparableDeploymentSnapshot(evidenceSnapshot), comparableDeploymentSnapshot(sourceEvidence.deploymentReview.snapshot))) {
    errors.push('evidence:deploymentReview');
  }
  if (bundle.machineEvidence?.frameCount !== 18 || bundle.machineEvidence?.productionEntry !== true) errors.push('evidence:machineEvidence');
  if (bundle.commandFlow?.failedPathsZeroMutation !== true
    || !equal(bundle.commandFlow?.failureCases, sourceEvidence.commandFlow)) errors.push('evidence:commandFlow');
  if (bundle.idempotency?.doubleDispatchSessionDelta !== 1 || bundle.idempotency?.replayCanonicalUnchanged !== true) errors.push('evidence:idempotency');
  if (bundle.authority?.passed !== true
    || !equal(bundle.authority?.forbiddenAuthorityPaths, sourceEvidence.authority.forbiddenAuthorityPaths)
    || !equal(bundle.authority?.authorityHashes, sourceEvidence.authority.authorityHashes)
    || bundle.authority?.solverModified !== false
    || bundle.authority?.plannerModified !== false
    || bundle.authority?.choreographerModified !== false
    || bundle.authority?.formalReportModified !== false
    || bundle.authority?.rewardSettlementModified !== false) errors.push('evidence:authority');
  if (bundle.tamper && (bundle.tamper.rejectionCount || 0) < 35) errors.push('tamper_count');
  if (bundle.saveDiff?.passed !== true
    || bundle.saveDiff?.failedPathsZeroMutation !== true
    || bundle.saveDiff?.failedPathChangedResources !== false
    || bundle.saveDiff?.failedPathCreatedSession !== false) errors.push('evidence:saveDiff');
  if (!probe.passed) errors.push('independent_probe');
  return { ok: errors.length === 0, errors: [...new Set(errors)], probe };
}
