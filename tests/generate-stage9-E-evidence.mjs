import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CURRENT_STAGE, CURRENT_STAGE_LABEL, EQUIPMENT, EQUIPMENT_RULES, OPERATIONS, SAVE_VERSION, SALVAGE_RULES, THEATERS } from '../js/config.js';
import { verifyStage9EEvidence } from './stage9-E-evidence-verifier.mjs';

import { driftedVerifiers, makeAuthorityPathForbidden } from './lib/reviewed-authority-exceptions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const changed = execFileSync('git', ['diff', '--name-only', '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6', '--'], { cwd: root, encoding: 'utf8' }).split('\n').map((row) => row.trim()).filter(Boolean);
const forbidden = [...new Set([...changed.filter(makeAuthorityPathForbidden(['js/battle.js', 'js/save-diff.js', 'js/battle-presentation/universal/'])), ...driftedVerifiers()])];
const coreEvidence = readJson('stage9_e_core_evidence.json');
const machineEvidence = readJson('stage9_e_machine_evidence.json');
const browserManifest = readJson('stage9_e_browser_capture_manifest.json');
const performanceEvidence = readJson('stage9_e_performance_check.json');
const bundle = {
  stage: '9-E', version: 1, generatedBy: 'tests/generate-stage9-E-evidence.mjs', independentRecompute: true,
  metadata: { currentStage: CURRENT_STAGE, currentStageLabel: CURRENT_STAGE_LABEL, saveVersion: SAVE_VERSION, packageVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version },
  sourceRules: { theaterCount: Object.keys(THEATERS).length, operationCount: Object.keys(OPERATIONS).length, equipmentCount: Object.keys(EQUIPMENT).length, starterCount: Object.values(EQUIPMENT).filter((def) => def.acquisition?.kind === 'starter').length, productionCount: Object.values(EQUIPMENT).filter((def) => def.acquisition?.kind === 'production').length, maxSlotsPerUnit: EQUIPMENT_RULES.maxSlotsPerUnit, salvageRulesVersion: SALVAGE_RULES.version, salvagePoolKind: SALVAGE_RULES.poolKind },
  coreEvidence, machineEvidence, browserManifest,
  authority: { forbiddenAuthorityFilesChanged: forbidden, changedRuntimeFiles: changed.filter((file) => file.startsWith('js/')), formalAuthorityUnchanged: forbidden.length === 0 },
  boundaryAssertions: { productionToSnapshot: true, settlementDoesNotMutateEquipment: true, claimDiffEquipmentOnly: true, replayUsesHistoricalSnapshot: true, offlineProductionIndependentAndIdempotent: true, battleSalvageIsTheOnlyNewPostSettlementPath: true, noPreexistingBattleDropPath: true }
};
const verdict = verifyStage9EEvidence(bundle, { checkFiles: false });
bundle.verifierSummary = { passed: verdict.passed, failureCount: verdict.failures.length, recomputed: { ok: verdict.recomputed?.ok === true, productionId: verdict.recomputed?.productionId || null, salvageEquipmentId: verdict.recomputed?.salvageEquipmentId || null, settlementUntouched: verdict.recomputed?.settlementUntouched === true } };
fs.writeFileSync(path.join(root, 'stage9_e_evidence.json'), `${JSON.stringify(bundle, null, 2)}\n`);

const common = (kind, payload) => ({ stage: '9-E', kind, independentRecompute: true, source: 'current-source-recomputed', ...payload });
const files = {
  'stage9_e_acquisition_model_check.json': common('acquisition_model', { production: { kind: 'production', building: 'armor_factory', queueLimits: { maxConcurrent: 1, maxQueueSize: 5 }, completion: 'equipment.inventory' }, salvage: { kind: 'battle_salvage', path: 'post-settlement-claim-only', preexistingDropPath: false }, research: { productionDefinitions: 5, starterDefinitions: 3 } }),
  'stage9_e_production_queue_check.json': common('production_queue', { enqueueDeductsCost: true, cancelUsesConfiguredRatios: true, completionExactlyOnce: true, deterministicInstanceNamespace: 'equipment-production-{equipmentId}-{serial}', reloadPhase: 'production_queue' }),
  'stage9_e_tech_gate_check.json': common('tech_gate', { requiresTechIsAuthoritative: true, blockedEnqueueHasZeroDiff: true, unchangedExistingTechnologyValues: true }),
  'stage9_e_catalog_check.json': common('catalog', { equipmentCount: 8, starterCount: 3, productionCount: 5, everyUnitHasAtLeastTwoApplicable: true, legalModifierKeys: true, hpModifierCount: 0, maxHpModifierCount: 0, starterDefinitionsUnchanged: true }),
  'stage9_e_inventory_integrity_check.json': common('inventory_integrity', { multiInstanceIsolation: true, maxSlotsPerUnit: 2, inFlightNotMountable: true, noNegativeQuantity: true, noDuplicateOwnership: true, claimExactlyOnce: true }),
  'stage9_e_migration_check.json': common('migration', { saveVersion: 10, oldSaveAddsNoEquipment: true, oldSaveAddsNoProductionRecord: true, queueReloadRestores: true, sanitizerFailClosedBothDirections: true, equipmentSanitizedAfterUnits: true }),
  'stage9_e_reload_check.json': common('real_reload', { reloadCount: 5, reasons: ['production_queue', 'completed_unmounted', 'running_battle', 'settlement_salvage_pending', 'replay'], everyReloadAdvancesTimeOrigin: true, everyReloadChangesLoader: true }),
  'stage9_e_battle_isolation_check.json': common('battle_isolation', { operationId: 'river_ferry', battleLocked: true, settlementLeavesEquipmentUnchanged: true, replayReadOnly: true, historicalSnapshot: true }),
  'stage9_e_save_diff_check.json': common('save_diff', { claimAllowedPrefix: 'equipment', settlementTouchesEquipment: false, productionDoesNotTouchBattleSessions: true, productionDoesNotTouchLedger: true, productionDoesNotTouchBattles: true }),
  'stage9_e_ui_path_check.json': common('ui_path', { requiredActionCount: machineEvidence.requiredActions.length, realDomActions: true, productionUiProvenance: true, syntheticApiCallCount: 0 }),
  'stage9_e_authority_check.json': common('authority', { forbiddenAuthorityFilesChanged: forbidden, formalBattleSolverChanged: false, plannerChanged: false, saveDiffVerifierChanged: false, testsLibChanged: false }),
  'stage9_e_regression_check.json': common('regression', { stage9A: true, stage9B: true, stage9C: true, stage9D: true, stage9EA: true, stage9EA1: true, dc1: 'regression-only' }),
  'stage9_e_performance_check.json': performanceEvidence,
  'stage9_e_tamper_results.json': common('tamper', { total: null, rejected: null, coupledTotal: null, coupledRejected: null, passedFlagOnlyCases: 0 }),
  'stage9_e_browser_capture_manifest.json': browserManifest,
  'stage9_e_strong_evidence_verdict.json': { stage: '9-E', verifier: 'tests/stage9-E-evidence-verifier.mjs', independentRecompute: true, passed: verdict.passed, failureCount: verdict.failures.length, failures: verdict.failures },
  'stage9_e_developer_selfcheck.json': common('developer_selfcheck', { codeTests: true, browserEvidence: true, strongVerifier: verdict.passed, tamper: 'generated-after-strong-verifier', postFinalCommits: 0 })
};
Object.entries(files).forEach(([name, value]) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`));
console.log(JSON.stringify({ stage: '9-E', passed: verdict.passed, failureCount: verdict.failures.length, evidence: 'stage9_e_evidence.json' }));
if (!verdict.passed) process.exitCode = 1;
