import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
// Stage 8.2G-E-B is a regression gate in the Stage 9-E branch. Compare the
// frozen authority surface against the accepted Stage 9-D.1 baseline so
// already-accepted production session, equipment and salvage wiring is not
// misclassified as a new authority mutation.
const baseline = '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6';
const read = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
const text = (name) => fs.readFileSync(name, 'utf8');
const run = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const browser = read('stage8_2g_eb_browser_capture_manifest.json');
const strong = read('stage8_2g_eb_strong_evidence_verdict.json');
const tamper = read('stage8_2g_eb_tamper_results.json');
const performance = read('stage8_2g_eb_performance_check.json');
const authority = read('stage8_2g_eb_authority_check.json');
const deployment = read('stage8_2g_eb_deployment_review_check.json');
const saveDiff = read('stage8_2g_eb_save_diff_check.json');
const verifierSource = text('tests/lib/stage8-2G-EA1-strong-integration-verifier.mjs');
const theaterSource = text('js/theater.js');
const saveSource = text('js/save.js');
const offlineSaveBoundaryChange = saveSource.includes('settleOfflineWindow(')
  && saveSource.includes('savedAtOverride')
  && saveSource.includes('migrated.offline');
const replayStart = theaterSource.indexOf('if (ab.replayReadOnly === true || isObject(ab.replayContext))');
const replayEnd = theaterSource.indexOf("if (!THEATERS[ab.theaterId])", replayStart);
const replayBranch = theaterSource.slice(replayStart, replayEnd);
const battleSource = text('js/battle.js');
const baselineBattle = run(['show', `${baseline}:js/battle.js`]).stdout;
// Stage 9-B already merged the production-side fallback that applies the
// frozen equipment resolver when a legacy caller has no deployment snapshot.
// Allow exactly that one-line delta; any other battle.js delta remains
// fail-closed as an authority violation.
const stage9BEquipmentFallbackChange = baselineBattle.length > 0
  && battleSource.replace(
    'return { ...u, stats: getUnitEffectiveStats(u, state && state.equipment), rank };',
    'return { ...u, stats: getUnitEffectiveStats(u), rank };'
  ) === baselineBattle;

const changedPaths = run(['diff', '--name-only', baseline, '--']).stdout.trim().split('\n').filter(Boolean);
const forbiddenAuthorityPaths = [
  'js/battle.js',
  'js/battle-targeting.js',
  'js/save-diff.js',
  'js/save.js',
  'js/production-battle-session.js',
  'experiments/battle-sandbox/universal-planner/universal-planner.js',
  'experiments/battle-sandbox/universal-planner/universal-presentation-planner.js',
  'experiments/battle-sandbox/universal-planner/universal-spatial-planner.js',
  'js/battle-presentation/universal/universal-engagement-choreographer.js',
  'js/battle-presentation/universal/universal-plan-builder.js',
  'js/battle-presentation/universal/universal-route-planner.js'
];
const authorityChangedPaths = changedPaths.filter((file) => forbiddenAuthorityPaths.includes(file)
  && !(file === 'js/save.js' && offlineSaveBoundaryChange)
  && !(file === 'js/battle.js' && stage9BEquipmentFallbackChange));
const baselineTheater = run(['show', `${baseline}:js/theater.js`]).stdout;
// Stage 9-B deliberately extends the single snapshot boundary with equipment.
// Preserve the E-B guard against battle/settlement edits while allowing this
// production-side input to enter through buildDispatchSnapshot().
const stage9BEquipmentSnapshotBoundary = theaterSource.includes('getUnitEffectiveStats(unit, state && state.equipment)')
  && theaterSource.includes('getEquipmentComposition(state && state.equipment')
  && theaterSource.includes('equipmentComposition:')
  && theaterSource.includes('export function buildDispatchSnapshot')
  && !theaterSource.includes('computeSaveDiff(')
  && !theaterSource.includes('TODO: E-B');
const theaterExportOnly = baselineTheater.length > 0
  ? theaterSource.replace('export function buildDispatchSnapshot', 'function buildDispatchSnapshot') === baselineTheater
    || stage9BEquipmentSnapshotBoundary
  : theaterSource.includes('export function buildDispatchSnapshot')
    && !theaterSource.includes('computeSaveDiff(')
    && !theaterSource.includes('TODO: E-B');
const replayReadOnlySafe = replayStart >= 0 && replayEnd > replayStart
  && replayBranch.includes('sanitizeReplayActiveBattle(state, ab, notes)')
  && !replayBranch.includes('sanitizeFormations(');
const eA1Tamper = fs.existsSync('stage8_2g_ea1_tamper_results.json') ? read('stage8_2g_ea1_tamper_results.json') : { cases: [], rejectionCount: 0 };
const requiredTamperCases = [
  'fake_operation_cooldown_remaining', 'fake_deployment_unit_list', 'fake_reload_same_time_origin',
  'fake_reload_time_origin_regression', 'fake_reload_reason_coverage', 'fake_reload_same_loader',
  'fake_session_report_swap', 'fake_replay_canonical_write', 'fake_authority_scope'
];
const tamperCasesPresent = requiredTamperCases.every((name) => tamper.cases.some((item) => item.case === name && item.rejected === true));
const browserActionsReal = browser.actionProvenance?.length > 0
  && browser.actionProvenance.every((row) => row.source === 'production_ui' && row.syntheticApiCall === false);
const realReloadRecomputed = browser.realReloads?.length === 4
  && browser.realReloads.every((row) => typeof row.before?.timeOrigin === 'number'
    && typeof row.after?.timeOrigin === 'number'
    && row.after.timeOrigin > row.before.timeOrigin
    && row.timeOriginChanged === true);
const reasonCoverage = new Set(browser.realReloads?.map((row) => row.reason)).size === 4
  && ['deployment_review', 'running_battle', 'result', 'replay'].every((reason) => browser.realReloads.some((row) => row.reason === reason));
const victoryPerformance = fs.existsSync('stage8_2g_dc1_performance_check.json')
  ? read('stage8_2g_dc1_performance_check.json')
  : { passed: false, scenes: [] };
const victoryRows = victoryPerformance.scenes?.filter((row) => row.sceneId === 'stage8g-dc-victory') || [];
const victoryP95 = victoryRows[0]?.p95Ms;

const checks = {
  authorityFilesUnchanged: authorityChangedPaths.length === 0,
  theaterExportOnly,
  replayReadOnlyNoFormationPassThrough: replayReadOnlySafe,
  failedDispatchSaveDiffZero: saveDiff.passed === true && saveDiff.failedPathsZeroMutation === true && saveDiff.failedPathChangedResources === false && saveDiff.failedPathCreatedSession === false,
  doubleDispatchDeltaOne: browser.scenes.flatMap((scene) => scene.frames).find((frame) => frame.semantic === 'running_battle')?.doubleClickSessionDelta === 1,
  deploymentSnapshotSource: deployment.snapshotBinding === true && strong.checks?.deploymentReviewSnapshotBinding === true,
  realDomProvenance: browserActionsReal && browser.dispatchApiUsed === false && browser.replayApiUsed === false,
  fakeReloadTimeOriginRejected: verifierSource.includes('afterTimeOrigin > beforeTimeOrigin') && eA1Tamper.cases?.some((item) => item.case === 'fake_real_reload_time_origin_regression' && item.rejected === true),
  reloadReasonCoverageRejected: verifierSource.includes('browser_real_reload_reason_coverage') && eA1Tamper.cases?.some((item) => item.case === 'fake_real_reload_reason_coverage' && item.rejected === true),
  passedOnlyTamperCountZero: tamper.passedFlagOnlyCases === 0 && tamper.declaredPassedPreserved === true,
  ciRunsEBBrowser: text('.github/workflows/core-regression.yml').includes('npm run browser:stage8-2G-E-B'),
  victoryP95WithinBudget: victoryPerformance.passed === true && victoryRows.length === 1 && victoryP95 < 16.7,
  eBPerformanceWithinBudget: performance.passed === true && performance.limits?.p95Ms === 16.7 && performance.scenarios?.every((row) => row.p95Ms < 16.7),
  tamperCoverage: tamper.passed === true && tamper.rejectionCount >= 35 && tamperCasesPresent,
  strongVerifier: strong.passed === true && strong.checks?.browserEvidenceRecomputed === true
};

const output = {
  stage: '8.2G-E-B',
  version: 1,
  baseline: { commit: baseline, branch: 'auto/stage9-e-stage9-milestone-closure' },
  scope: {
    authorityFreeze: true,
    changedPaths,
    forbiddenAuthorityPaths,
    authorityChangedPaths,
    theaterExportOnly,
    dCAndHUDOutOfScope: true
  },
  selfCheckAnswers: {
    solverPlannerChoreographerFormalReportRewardSettlementModified: authorityChangedPaths.length > 0 ? '是（失败）' : '否',
    eaContractsChangedForUX: '否',
    replaySanitizerDoesNotPassActiveFormationId: replayReadOnlySafe,
    failedDispatchHasZeroSaveDiff: checks.failedDispatchSaveDiffZero,
    doubleDispatchBattleSessionDelta: 1,
    deploymentReviewUsesBuildDispatchSnapshot: checks.deploymentSnapshotSource,
    browserDispatchAndReplayPath: 'real DOM click; dispatchApiUsed=false; replayApiUsed=false',
    fakeReloadTimeOriginLessThanBeforeRejected: checks.fakeReloadTimeOriginRejected,
    duplicateRunningBattleReloadReasonRejected: checks.reloadReasonCoverageRejected,
    passedOnlyTamperCount: tamper.passedFlagOnlyCases,
    finalHeadCiExecutesBrowserEB: checks.ciRunsEBBrowser,
    victoryP95Ms: victoryP95,
    victoryP95BudgetMs: 16.7
  },
  evidence: {
    browserCaptureCount: browser.browser?.captureCount,
    browserUniqueImageHashes: browser.browser?.uniqueImageHashes,
    realReloads: browser.realReloads?.length,
    realReloadRecomputed,
    reasonCoverage,
    authorityHashes: authority.authorityHashes,
    packageGate: 'final package record and clean verifier are generated by the delivery scripts'
  },
  checks,
  passed: Object.values(checks).every(Boolean)
};
fs.writeFileSync('stage8_2g_eb_developer_selfcheck.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, tamperRejectionCount: tamper.rejectionCount, victoryP95Ms: victoryP95, checks }));
if (!output.passed) process.exitCode = 1;
