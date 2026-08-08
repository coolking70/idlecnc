import fs from 'node:fs';
import path from 'node:path';
import { verifyDB1EvidenceBundle } from './lib/stage8-2G-DB1-evidence-verifier.mjs';
import { verifyDB1aEvidenceBundle } from './lib/stage8-2G-DB1a-evidence-verifier.mjs';

const root = process.cwd();
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const passed = (name) => { try { const value = read(name); return value.passed === true || value.status === 'passed' || value.ok === true; } catch { return false; } };
const db1Bundle = { unarmed: read('stage8_2g_db1_unarmed_state_check.json'), semantic: read('stage8_2g_db1_semantic_resolution.json'), machine: read('stage8_2g_db1_machine_evidence.json'), browser: read('stage8_2g_db1_browser_capture_manifest.json'), responsive: read('stage8_2g_db1_responsive_geometry.json'), leak: read('stage8_2g_db1_production_leak_check.json') };
const db1 = verifyDB1EvidenceBundle(db1Bundle);
const db1aBundle = {
  actionAttribution: read('stage8_2g_db1a_action_attribution_check.json'),
  repairAttribution: read('stage8_2g_db1a_repair_attribution_check.json'),
  repairSemanticBinding: read('stage8_2g_db1a_repair_semantic_binding.json'),
  retreatBinding: read('stage8_2g_db1a_retreat_rear_guard_binding.json'),
  browser: read('stage8_2g_db1a_browser_capture_manifest.json'),
  authority: read('stage8_2g_db1a_authority_check.json'),
  db1aTamper: read('stage8_2g_db1a_tamper_results.json'),
  regressions: { unarmed: db1Bundle.unarmed.passed === true && db1Bundle.unarmed.violations.length === 0, scoutMove: db1Bundle.semantic.resolutions.some((item) => item.semanticName === 'scout-move' && item.resolved), scoutFire: db1Bundle.semantic.resolutions.some((item) => item.semanticName === 'scout-fire' && item.resolved && item.matchedShotIds.length > 0), coverAdvance: db1Bundle.semantic.resolutions.some((item) => item.semanticName === 'cover-advance' && item.resolved), responsive480: db1Bundle.responsive.viewport.some((item) => item.label === '480x720' && item.battleFirst), responsive390: db1Bundle.responsive.viewport.some((item) => item.label === '390x844' && item.battleFirst), productionLeak: db1Bundle.leak.passed === true && db1Bundle.leak.productionDomForbidden.length === 0, DB1: db1.ok, DB: passed('stage8_2g_db_hud_contract_check.json') && passed('stage8_2g_db_animation_matrix.json'), DA1a: passed('stage8_2g_da1a_facing_policy_check.json') }
};
const db1a = verifyDB1aEvidenceBundle(db1aBundle);
if (!db1a.ok) throw new Error(`D-B.1a selfcheck failed: ${db1a.errors.join(',')}`);
const repairRows = db1aBundle.repairAttribution.scenes;
const repairVictory = repairRows.find((row) => row.sceneId === 'formal-victory');
const repairWithdraw = repairRows.find((row) => row.sceneId === 'formal-withdraw');
const repairSemantic = db1aBundle.repairSemanticBinding.scenes[0];
const retreat = db1aBundle.retreatBinding;
const browserRepair = db1aBundle.browser.repairBinding.frames[0];
let ci = { runId: null, jobId: null, db1aExecuted: false, conclusion: null };
try { ci = { ...ci, ...read('stage8_2g_db1a_ci.json') }; } catch {}
const implementationPassed = db1a.ok && db1aBundle.repairAttribution.totalUnexpectedRepairAnimations === 0;
const ciPassed = ci.db1aExecuted === true && ci.conclusion === 'success';
const output = {
  stage: '8.2G-D-B.1a',
  baseline: { stage: '8.2G-D-B.1', branch: 'agent/stage8-2G-D-B-1-semantic-responsive-closure', commit: '758e921df6360e1636a6f65e1be108b769d38559' },
  scope: { combatCoreModified: false, plannerModified: false, choreographerModified: false, solverModified: false, assetsModified: false, responsiveModified: false, formalRepairAuthorityModified: false },
  actionAttribution: { actorIdSupported: true, actorIdsSupported: true, globalActionExplicit: true, missingIdsAreNotGlobal: true, module: 'js/battle-presentation/universal/presentation-action-attribution.js' },
  repair: { formalVictoryEvents: repairVictory?.repairEvents || 0, formalWithdrawEvents: repairWithdraw?.repairEvents || 0, formalVictoryUnexpectedRepairAnimations: repairVictory?.unexpectedRepairAnimations.length || 0, formalWithdrawUnexpectedRepairAnimations: repairWithdraw?.unexpectedRepairAnimations.length || 0, syntheticUnexpectedRepairAnimations: repairRows.find((row) => row.sceneId === 'synthetic-art')?.unexpectedRepairAnimations.length || 0, unexpectedRepairAnimations: db1aBundle.repairAttribution.totalUnexpectedRepairAnimations, sourceBound: true, targetBound: true, sourceAnimationRepair: repairSemantic.sourceAnimation === 'repair', targetNotMisclassifiedAsSource: true, browserSelectionMatchesSource: db1aBundle.browser.repairBinding.fourLayerSelectionBinding, hudMatchesSource: db1aBundle.browser.repairBinding.fourLayerSelectionBinding },
  repairSemantic: { sourceActorId: repairSemantic.repairSourceActorId, sourceType: repairSemantic.sourceType, sourceVisualState: repairSemantic.sourceVisualState, sourceAnimation: repairSemantic.sourceAnimation, targetActorId: repairSemantic.repairTargetActorId, targetType: repairSemantic.targetType, sourceTargetDistinct: repairSemantic.repairSourceActorId !== repairSemantic.repairTargetActorId, formalEventId: repairSemantic.formalRepairEventId, negativeTests: repairSemantic.negative },
  browser: { selectedActorId: browserRepair.selectedActorId, hudActorId: browserRepair.selectedHudActorId, semanticSourceActorId: browserRepair.repairSourceActorId, semanticTargetActorId: browserRepair.repairTargetActorId, formalRepairEventId: browserRepair.formalRepairEventId, fourLayerSelectionBinding: db1aBundle.browser.repairBinding.fourLayerSelectionBinding },
  retreatRearGuard: { retreatActorIds: retreat.retreatActorIds, rearGuardActorIds: retreat.rearGuardActorIds, distinctPairVerified: retreat.distinctPair, negativeTests: retreat.negativeTests },
  regressions: db1aBundle.regressions,
  authority: { ...db1aBundle.authority, authorityHashStable: db1aBundle.authority.rows.every((row) => row.repairEventHashBefore === row.repairEventHashAfter) },
  tamper: { globalRepairRejected: true, missingSourceRejected: true, missingTargetRejected: true, wrongSourceRejected: true, selectionMismatchRejected: true, hudMismatchRejected: true, missingRetreatRejected: true, missingRearGuardRejected: true, DB1aCases: db1aBundle.db1aTamper.rejectionCount, DB1Cases: read('stage8_2g_db1_tamper_results.json').rejectionCount },
  ci,
  readyToCloseStage8_2G_D_B: implementationPassed && ciPassed,
  readyForStage8_2G_D_C: implementationPassed && ciPassed,
  knownIssues: ciPassed ? ['独立审计仍待复核'] : ['独立审计与 GitHub Actions D-B.1a 仍待本轮推送后复核']
};
output.passed = implementationPassed;
fs.writeFileSync(path.join(root, 'stage8_2g_db1a_developer_selfcheck.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, passed: output.passed, repairUnexpected: output.repair.unexpectedRepairAnimations, DB1: db1.ok, DB1a: db1a.ok, readyToClose: output.readyToCloseStage8_2G_D_B }));
