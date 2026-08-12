import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBattlePresentationRouter } from '../js/battle-presentation/presentation-router.js';
import { clearAllRuntimeFallbacks } from '../js/battle-presentation/runtime-fallback-registry.js';
import { getUniversalCoverageDecision, getUniversalCoverageSummary, isContractTemplatePrecedence, UNIVERSAL_COVERAGE_MATRIX_VERSION } from '../js/battle-presentation/universal/universal-coverage-matrix.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const active = (report, id) => ({ id, theaterId: report.theaterId, report, elapsed: 0, duration: report.duration, presentationPhase: 'battle', returnElapsed: 0, returnDuration: 5 });
const victory = load('campaign-victory.json'); const withdraw = load('campaign-withdraw.json'); const wiped = load('campaign-defeat-or-wiped.json'); const operation = load('operation-result.json');
let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${name}`); }

check('formal coverage matrix is explicit and versioned', () => {
  const summary = getUniversalCoverageSummary(); assert.equal(UNIVERSAL_COVERAGE_MATRIX_VERSION, '8.2F-B.3'); assert.equal(summary.totalCells, 60); assert.equal(summary.coveredCells, 44); assert.equal(summary.unobservedCells.length, 16);
  const disk = JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/universal-planner/scenarios/coverage.json'), 'utf8')).missionResultMatrix; assert.deepEqual(summary.unobservedCells, disk.unobservedCells); assert.equal(summary.coveredCells, disk.coveredCells);
});

check('matrix decisions distinguish covered, unobserved and unknown cells', () => {
  assert.equal(getUniversalCoverageDecision(operation).eligible, true); assert.equal(getUniversalCoverageDecision(operation).code, 'covered_formal_cell');
  assert.equal(getUniversalCoverageDecision({ report: { missionId: 'salvage_run', result: 'defeat' } }).code, 'unobserved_formal_cell');
  assert.equal(getUniversalCoverageDecision({ report: { missionId: 'future_mission', result: 'victory' } }).code, 'unknown_formal_cell');
});

check('contract precedence remains only the specialized road victory', () => {
  assert.equal(isContractTemplatePrecedence(victory), true); assert.equal(isContractTemplatePrecedence(withdraw), false); assert.equal(isContractTemplatePrecedence(operation), false);
});

check('auto defaults covered non-contract battle to universal renderer', () => {
  clearAllRuntimeFallbacks(); const router = createBattlePresentationRouter({ canvas: null, legacyRenderer: { render: () => true } }); router.setPreference('auto'); router.render(active(operation, 'b3-operation')); const state = router.getState(); assert.equal(state.preference, 'auto'); assert.equal(state.renderedMode, 'universal_battle'); assert.equal(state.coverage.eligible, true); assert.equal(state.coverage.code, 'covered_formal_cell'); assert.equal(state.universalDefaultSuccesses, 1); router.destroy();
});

check('auto defaults covered withdraw and wiped outcomes to universal', () => {
  for (const [report, id] of [[withdraw, 'b3-withdraw'], [wiped, 'b3-wiped']]) { const router = createBattlePresentationRouter({ canvas: null, legacyRenderer: { render: () => true } }); router.setPreference('auto'); router.render(active(report, id)); assert.equal(router.getState().renderedMode, 'universal_battle'); assert.equal(router.getState().coverage.eligible, true); router.destroy(); }
});

check('auto preserves specialized contract precedence for border road victory', () => {
  const router = createBattlePresentationRouter({ canvas: null, legacyRenderer: { render: () => true } }); router.setPreference('auto'); router.render(active(victory, 'b3-contract')); assert.equal(router.getState().renderedMode, 'contract_road_victory'); assert.equal(router.getState().coverage.cell.mode, 'contract_precedence'); assert.equal(router.getState().universalDefaultSuccesses, 0); router.destroy();
});

check('auto does not claim an unobserved matrix cell', () => {
  const unobserved = { ...operation, missionId: 'salvage_run', theaterId: 'scrap_mine', result: 'defeat' }; const router = createBattlePresentationRouter({ canvas: null, legacyRenderer: { render: () => true } }); router.setPreference('auto'); router.render(active(unobserved, 'b3-unobserved')); const state = router.getState(); assert.equal(state.renderedMode, 'legacy'); assert.equal(state.coverage.eligible, false); assert.equal(state.coverage.code, 'unobserved_formal_cell'); assert.equal(state.universalAttempts, 0); router.destroy();
});

check('explicit universal remains available outside default matrix policy', () => {
  const router = createBattlePresentationRouter({ canvas: null, legacyRenderer: { render: () => true } }); router.setPreference('universal'); router.render(active(operation, 'b3-explicit')); assert.equal(router.getState().renderedMode, 'universal_battle'); assert.equal(router.getState().universalDefaultAttempts, 0); assert.equal(router.getState().universalAttempts, 1); router.destroy();
});

check('production coverage module has no sandbox resource import', () => {
  const source = fs.readFileSync(path.join(root, 'js/battle-presentation/universal/universal-coverage-matrix.js'), 'utf8'); assert.doesNotMatch(source, /experiments\//); assert.doesNotMatch(source, /coverage\.json/);
});

console.log(`stage8-2F-B-3-test: ${passed} passed / ${passed} total`);
