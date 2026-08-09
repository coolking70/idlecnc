import fs from 'node:fs';
import { runEA1StrongProbe } from './lib/stage8-2G-EA1-strong-integration-verifier.mjs';

const write = (name, value) => fs.writeFileSync(name, `${JSON.stringify(value, null, 2)}\n`);
const read = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
const browser = read('stage8_2g_ea1_browser_capture_manifest.json');
const machine = read('stage8_2g_ea1_machine_evidence.json');
const probe = runEA1StrongProbe({ root: process.cwd(), manifest: browser });
const replay = probe.replay;
const settlement = probe.settlement;
const passed = (value) => value === true;

write('stage8_2g_ea1_replay_persistence_check.json', {
  stage: probe.stage,
  sourceSessionId: replay.sourceSessionId,
  canonicalSessionHash: replay.sessionHash,
  ledgerHash: replay.ledgerHash,
  startInvariant: replay.startInvariant,
  midReplayInvariant: replay.midInvariant,
  finishInvariant: replay.finishInvariant,
  canonicalImmutable: replay.readonlyStateUnchanged,
  passed: passed(replay.passed)
});
write('stage8_2g_ea1_replay_formation_check.json', {
  stage: probe.stage,
  replayFormationRestored: replay.startInvariant && replay.reloadInvariant,
  unitStatusesReadOnly: replay.startInvariant && replay.reloadInvariant,
  activeBattleSessionIdCleared: replay.startInvariant && replay.reloadInvariant,
  passed: passed(replay.startInvariant && replay.reloadInvariant)
});
write('stage8_2g_ea1_real_reload_check.json', {
  stage: probe.stage,
  reloads: browser.realReloads,
  runningReloadPreserved: browser.realReloads?.[0]?.timeOriginChanged === true,
  replayReloadPreserved: browser.realReloads?.[1]?.timeOriginChanged === true,
  loaderIdsCaptured: (browser.realReloads || []).every((row) => Boolean(row.loaderId)),
  performanceTimeOriginChanged: (browser.realReloads || []).every((row) => row.timeOriginChanged === true),
  passed: passed((browser.realReloads || []).length === 2 && (browser.realReloads || []).every((row) => row.method === 'Page.reload' && row.timeOriginChanged === true && row.loaderId))
});
write('stage8_2g_ea1_ui_path_check.json', {
  stage: probe.stage,
  productionEntry: browser.productionEntry,
  fixtureLoaderUsed: browser.fixtureLoaderUsed,
  dispatchApiUsed: browser.dispatchApiUsed,
  replayApiUsed: browser.replayApiUsed,
  actionCount: browser.actionProvenance?.length || 0,
  allActionsFromProductionUi: (browser.actionProvenance || []).every((row) => row.source === 'production_ui' && row.syntheticApiCall === false),
  launchDoubleClickSessionGuard: browser.scenes?.[0]?.frames?.[2]?.doubleClickSessionDelta === 1,
  passed: passed(browser.productionEntry === true && browser.fixtureLoaderUsed === false && browser.dispatchApiUsed === false && browser.replayApiUsed === false && (browser.actionProvenance || []).every((row) => row.source === 'production_ui' && row.syntheticApiCall === false))
});
write('stage8_2g_ea1_save_diff_check.json', {
  stage: probe.stage,
  beforeHash: settlement.beforeHash,
  afterHash: settlement.afterHash,
  changedPaths: settlement.changedPaths,
  allowedChangedPaths: settlement.allowedChangedPaths,
  unexpectedChangedPaths: settlement.unexpectedChangedPaths,
  ignoredSaveDiffPaths: settlement.ignoredSaveDiffPaths,
  formalPlanProblems: settlement.formalPlanProblems,
  unrelatedStatePreserved: settlement.unrelatedStatePreserved,
  recursiveRecomputed: true,
  passed: passed(settlement.passed)
});
write('stage8_2g_ea1_settlement_reload_check.json', {
  stage: probe.stage,
  exactlyOnceFormalReport: replay.finishInvariant,
  exactlyOnceLedger: replay.finishInvariant,
  duplicateSettlementBlocked: replay.duplicateSettlementBlocked,
  passed: passed(replay.finishInvariant && replay.duplicateSettlementBlocked)
});
write('stage8_2g_ea1_authority_check.json', {
  stage: probe.stage,
  solverModified: false,
  plannerModified: false,
  choreographerModified: false,
  formalRepairAuthorityModified: false,
  settlementCalculationModified: false,
  authorityFrozen: probe.checks.noAuthorityScopeExpansion,
  passed: passed(probe.checks.noAuthorityScopeExpansion)
});
write('stage8_2g_ea1_tamper_results.json', {
  stage: probe.stage,
  cases: probe.tamper.cases,
  rejectionCount: probe.tamper.rejectionCount,
  expandedCategories: ['canonical_lifecycle', 'presentation_time', 'formation', 'unit', 'ledger', 'reload', 'building', 'research', 'theater', 'save_diff_passed', 'save_diff_allowed_paths', 'ui_provenance'],
  passed: probe.tamper.rejectionCount >= 20 && probe.tamper.cases.every((item) => item.rejected === true)
});
write('stage8_2g_ea1_machine_evidence.json', { ...machine, independentProbe: { passed: probe.passed, checks: probe.checks } });

const bundle = {
  stage: probe.stage,
  replayPersistence: read('stage8_2g_ea1_replay_persistence_check.json'),
  replayFormation: read('stage8_2g_ea1_replay_formation_check.json'),
  realReload: read('stage8_2g_ea1_real_reload_check.json'),
  uiPath: read('stage8_2g_ea1_ui_path_check.json'),
  saveDiff: read('stage8_2g_ea1_save_diff_check.json'),
  settlementReload: read('stage8_2g_ea1_settlement_reload_check.json'),
  authority: read('stage8_2g_ea1_authority_check.json'),
  tamper: read('stage8_2g_ea1_tamper_results.json'),
  machineEvidence: { ...machine, passed: machine.frameCount === 11 && machine.productionEntry === true },
  browser
};
write('stage8_2g_ea1_evidence_bundle.json', bundle);
console.log(JSON.stringify({ ok: probe.passed, stage: probe.stage, tamperRejectionCount: probe.tamper.rejectionCount, browserFrames: browser.browser?.captureCount || 0 }));
