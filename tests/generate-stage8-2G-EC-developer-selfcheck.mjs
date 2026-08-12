import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const baseline = 'b41ad940d8fab78038f1b1dedf5a404841b81401';
const read = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
const text = (name) => fs.readFileSync(name, 'utf8');
const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

const browser = read('stage8_2g_ec_browser_capture_manifest.json');
const bundle = read('stage8_2g_ec_evidence_bundle.json');
const strong = read('stage8_2g_ec_strong_evidence_verdict.json');
const tamper = read('stage8_2g_ec_tamper_results.json');
const performance = read('stage8_2g_ec_performance_check.json');
const authority = read('stage8_2g_ec_authority_check.json');
const saveDiff = read('stage8_2g_ec_save_diff_check.json');
const machine = read('stage8_2g_ec_machine_evidence.json');
const workflow = text('.github/workflows/core-regression.yml');
const frames = browser.scenes.flatMap((scene) => scene.frames || []);
const frame = (semantic) => frames.find((item) => item.semantic === semantic);

const changedPaths = git(['diff', '--name-only', baseline, '--']).stdout.trim().split('\n').filter(Boolean);
const forbiddenAuthorityPaths = [
  'js/battle.js', 'js/battle-targeting.js', 'js/save-diff.js', 'js/production-battle-session.js',
  'js/theater.js', 'experiments/battle-sandbox/universal-planner/universal-planner.js',
  'experiments/battle-sandbox/universal-planner/universal-presentation-planner.js',
  'experiments/battle-sandbox/universal-planner/universal-spatial-planner.js',
  'js/battle-presentation/universal/universal-engagement-choreographer.js',
  'js/battle-presentation/universal/universal-plan-builder.js',
  'js/battle-presentation/universal/universal-route-planner.js'
];
const theaterSource = text('js/theater.js');
// Stage 9-A/9-B extend the production-side dispatch snapshot.  Keep this
// regression guard strict for formal battle/settlement logic while allowing
// the required equipment input at the one sanctioned snapshot boundary.
const equipmentSnapshotBoundaryOnly = theaterSource.includes('getUnitEffectiveStats(unit, state && state.equipment)')
  && theaterSource.includes('getEquipmentComposition(state && state.equipment')
  && theaterSource.includes('equipmentComposition:')
  && theaterSource.includes('export function buildDispatchSnapshot')
  && !theaterSource.includes('computeSaveDiff(')
  && !theaterSource.includes('TODO: E-C');
const authorityChangedPaths = changedPaths.filter((file) => forbiddenAuthorityPaths.includes(file)
  && !(file === 'js/theater.js' && equipmentSnapshotBoundaryOnly));
const requiredActions = bundle.uiPath.requiredActions;
const actionCoverage = requiredActions.every((action) => browser.actionProvenance.some((row) => row.action === action && row.source === 'production_ui' && row.syntheticApiCall === false));
const realReloadRecomputed = browser.realReloads.length === 5 && browser.realReloads.every((row) => {
  const before = row.before?.timeOrigin;
  const after = row.after?.timeOrigin;
  const actual = Number.isFinite(before) && Number.isFinite(after) && after > before;
  return row.method === 'Page.reload' && actual && row.timeOriginChanged === actual && row.beforeLoaderId && row.afterLoaderId && row.beforeLoaderId !== row.afterLoaderId && row.loaderId === row.afterLoaderId;
});
const reportPendingReload = frame('offline_report_pending')?.state?.offline?.shown === false
  && frame('offline_report_pending_reload')?.state?.offline?.shown === false;
const runningPausedUnchanged = frame('running_before_offline')?.state?.activeBattle?.battleSessionId === frame('running_after_offline_reload')?.state?.activeBattle?.battleSessionId
  && frame('running_before_offline')?.state?.activeBattle?.elapsed === frame('running_after_offline_reload')?.state?.activeBattle?.elapsed
  && frame('running_after_offline_reload')?.state?.offline?.battlePaused === true;
const replayReadOnlyUnchanged = frame('replay_before_offline')?.state?.sessionHash === frame('replay_after_offline_reload')?.state?.sessionHash
  && frame('replay_before_offline')?.state?.activeBattle?.elapsed === frame('replay_after_offline_reload')?.state?.activeBattle?.elapsed
  && frame('replay_after_offline_reload')?.state?.activeBattle?.replayReadOnly === true
  && frame('replay_after_offline_reload')?.state?.activeBattleSessionId === null;

const checks = {
  authorityFreeze: authorityChangedPaths.length === 0 && authority.passed === true,
  offlineInvalidFailClosed: bundle.offlineWindow.invalidSavedAtZero === true && bundle.offlineWindow.futureSavedAtZero === true && bundle.offlineWindow.rollbackSavedAtZero === true,
  offlineCapTruthful: bundle.offlineWindow.validRawSeconds === true && bundle.offlineWindow.capTruthful === true,
  exactlyOnce: bundle.exactlyOnce.firstSettled === true && bundle.exactlyOnce.secondAlreadySettled === true && bundle.exactlyOnce.noSecondMutation === true,
  maxStepsTruthful: bundle.stepTruncation.maxSteps === 4096 && bundle.stepTruncation.truncated === true && bundle.stepTruncation.remainingSeconds > 0 && bundle.stepTruncation.consumedSeconds < bundle.stepTruncation.requestedSeconds,
  pendingReportSurvivesReload: reportPendingReload && frame('offline_report_closed_reload')?.state?.offline === null,
  activeBattleOfflineIsolation: runningPausedUnchanged,
  replayOfflineIsolation: replayReadOnlyUnchanged,
  realDomSavedAtPath: browser.productionEntry === true && browser.dispatchApiUsed === false && browser.replayApiUsed === false && browser.offlineApiUsed === false && actionCoverage,
  realReloadEvidence: realReloadRecomputed,
  tamperCoverage: tamper.passed === true && tamper.rejectionCount >= 50 && tamper.passedFlagOnlyCases === 0 && tamper.declaredPassedPreserved === true,
  strongVerifier: strong.ok === true && strong.probe?.checks?.browserEvidenceRecomputed === true,
  performanceBudget: performance.warmupSamples === 20 && performance.sampleCount === 120 && performance.p95BudgetMs === 16.7 && performance.scenarios.every((row) => row.p95Ms < 16.7),
  recursiveSaveDiff: saveDiff.passed === true && saveDiff.forbiddenChangedPaths.length === 0,
  ciRunsEC: workflow.includes('npm run test:stage8-2G-E-C') && workflow.includes('npm run browser:stage8-2G-E-C')
};

const output = {
  stage: '8.2G-E-C',
  version: 1,
  baseline: { commit: baseline, branch: 'agent/stage8-2G-E-B-mission-deployment-command-flow' },
  scope: {
    authorityFreeze: true,
    changedPaths,
    forbiddenAuthorityPaths,
    authorityChangedPaths,
    offlineBoundaryFiles: ['js/offline.js', 'js/save.js'],
    eBContractsRegressionOnly: true
  },
  selfCheckAnswers: {
    invalidFutureRollbackSavedAtFailClosed: checks.offlineInvalidFailClosed,
    rawSecondsAndCapRemainTruthful: checks.offlineCapTruthful,
    duplicateOfflineSettlementRejected: checks.exactlyOnce,
    maxStepsReportedHonestly: checks.maxStepsTruthful,
    pendingReportSurvivesReloadUntilViewed: checks.pendingReportSurvivesReload,
    activeBattleDoesNotAdvanceOffline: checks.activeBattleOfflineIsolation,
    replayIsReadOnlyOffline: checks.replayOfflineIsolation,
    browserUsesSavedAtAndRealDomOnly: checks.realDomSavedAtPath,
    fakeRealReloadTamperRejected: tamper.cases.some((item) => item.case === 'fake_real_reload_same_time_origin' && item.rejected === true),
    passedOnlyTamperCount: tamper.passedFlagOnlyCases,
    tamperRejectionCount: tamper.rejectionCount,
    p95BudgetMs: performance.p95BudgetMs,
    finalHeadCiExecutesEC: checks.ciRunsEC
  },
  evidence: {
    browserCaptureCount: browser.browser.captureCount,
    browserUniqueImageHashes: browser.browser.uniqueImageHashes,
    realReloads: browser.realReloads.length,
    realReloadRecomputed,
    requiredActions,
    actionCoverage,
    authorityHashes: authority.authorityHashes,
    packageGate: 'final package record and clean verifier are generated by delivery scripts'
  },
  checks,
  passed: Object.values(checks).every(Boolean)
};
fs.writeFileSync('stage8_2g_ec_developer_selfcheck.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, tamperRejectionCount: tamper.rejectionCount, checks }));
if (!output.passed) process.exitCode = 1;
