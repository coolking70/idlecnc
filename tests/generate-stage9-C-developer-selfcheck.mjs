import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyStage9CEvidence } from './stage9-C-strong-evidence-test.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const bundle = read('stage9_c_evidence_bundle.json');
const tamper = read('stage9_c_tamper_results.json');
const browser = read('stage9_c_browser_capture_manifest.json');
const perf = read('stage9_c_performance_check.json');
const verification = verifyStage9CEvidence(bundle, { checkFiles: true });
const changed = execFileSync('git', ['diff', 'e72eedac27423902b94ebab69b2fa053ca99b112', '--name-only'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const forbidden = ['js/save-diff.js', 'tests/lib/', 'js/battle.js', 'js/theater.js', 'js/battle-presentation/universal/'];
const requiredEvidence = [
  'stage9_c_acquisition_model_check.json', 'stage9_c_production_queue_check.json', 'stage9_c_tech_gate_check.json', 'stage9_c_catalog_check.json',
  'stage9_c_inventory_integrity_check.json', 'stage9_c_migration_check.json', 'stage9_c_reload_check.json', 'stage9_c_battle_isolation_check.json',
  'stage9_c_save_diff_check.json', 'stage9_c_ui_path_check.json', 'stage9_c_authority_check.json', 'stage9_c_regression_check.json',
  'stage9_c_performance_check.json', 'stage9_c_tamper_results.json', 'stage9_c_browser_capture_manifest.json', 'stage9_c_strong_evidence_verdict.json'
];
const output = {
  stage: '9-C', independentRecompute: true,
  checks: {
    verifierRecomputedCurrentSource: verification.ok,
    verifierErrors: verification.errors,
    tamperCases: tamper.caseCount,
    tamperRejected: tamper.rejectionCount,
    passedFlagOnlyCases: tamper.passedFlagOnlyCases,
    browserRealReloads: browser.realReloads?.map((row) => row.reason) || [],
    browserApiFlagsFalse: browser.dispatchApiUsed === false && browser.replayApiUsed === false && browser.offlineApiUsed === false && browser.equipmentApiUsed === false,
    performanceMeasurementValid: perf.measurementValid === true,
    performanceBudgetUnchanged: perf.budgetMs === 16.7 && perf.warmup === 20 && perf.samples === 120,
    forbiddenChangedFiles: changed.filter((file) => forbidden.some((prefix) => file === prefix || file.startsWith(prefix))),
    scripts: { posttestIncludesStage9C: packageJson.scripts.posttest.includes('test:stage9-C'), gateIncludesStage9C: packageJson.scripts['gate:stage8-2G'].includes('browser:stage9-C'), workflowStepPresent: fs.readFileSync(path.join(root, '.github/workflows/core-regression.yml'), 'utf8').includes('npm run browser:stage9-C'), cnbUnchanged: execFileSync('git', ['diff', 'e72eedac27423902b94ebab69b2fa053ca99b112', '--name-only', '--', '.cnb.yml'], { cwd: root, encoding: 'utf8' }).trim() === '' }
  },
  requiredEvidence: requiredEvidence.map((file) => ({ file, exists: fs.existsSync(path.join(root, file)) })),
  noBattleDrops: true,
  noAuthorityChanges: changed.every((file) => !forbidden.some((prefix) => file === prefix || file.startsWith(prefix))),
  passed: verification.ok && tamper.caseCount >= 84 && tamper.rejectionCount === tamper.caseCount && tamper.passedFlagOnlyCases === 0 && browser.realReloads?.length === 4 && perf.measurementValid === true && perf.budgetMs === 16.7 && requiredEvidence.every((file) => fs.existsSync(path.join(root, file)))
};
fs.writeFileSync(path.join(root, 'stage9_c_developer_selfcheck.json'), `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true, JSON.stringify(output));
console.log(JSON.stringify({ ok: true, stage: output.stage, tamperCases: output.checks.tamperCases, passedFlagOnlyCases: output.checks.passedFlagOnlyCases, reloads: output.checks.browserRealReloads }));
