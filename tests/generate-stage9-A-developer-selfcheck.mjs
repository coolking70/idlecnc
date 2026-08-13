import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/core-regression.yml', 'utf8');
const manifest = JSON.parse(fs.readFileSync('stage9_a_browser_capture_manifest.json', 'utf8'));
const tamper = JSON.parse(fs.readFileSync('stage9_a_tamper_results.json', 'utf8'));
const baseline = '27c115848bea9aaa965fa46b784940a9949537e4';
const committed = execFileSync('git', ['diff', '--name-only', `${baseline}..HEAD`], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const working = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const changedFiles = [...new Set([...committed, ...working])].sort();
const allowedPerformanceHelper = 'tests/lib/perf-environment.mjs';
const forbiddenPrefixes = ['js/battle.js', 'js/theater.js', 'js/save-diff.js', 'js/battle-presentation/universal/', 'experiments/battle-sandbox/universal-planner/universal-planner.js'];
const forbiddenChangedFiles = changedFiles.filter((file) => forbiddenPrefixes.some((prefix) => file === prefix || file.startsWith(prefix)) || (file.startsWith('tests/lib/') && file !== allowedPerformanceHelper));
const output = {
  stage: '9-A',
  changedFiles,
  forbiddenChangedFiles,
  forbiddenAuthorityPaths: forbiddenPrefixes,
  allowedPerformanceHelper,
  package: { testStage9: typeof pkg.scripts['test:stage9-A'] === 'string', browserStage9: typeof pkg.scripts['browser:stage9-A'] === 'string', posttestIncludesStage9: String(pkg.scripts.posttest).includes('test:stage9-A'), gateIncludesStage9: String(pkg.scripts['gate:stage8-2G']).includes('browser:stage9-A') },
  workflow: { testStage9: workflow.includes('npm run test:stage9-A'), browserStage9: workflow.includes('npm run browser:stage9-A') },
  browser: { productionEntry: manifest.productionEntry, fixtureLoaderUsed: manifest.fixtureLoaderUsed, dispatchApiUsed: manifest.dispatchApiUsed, replayApiUsed: manifest.replayApiUsed, offlineApiUsed: manifest.offlineApiUsed, frameCount: manifest.browser.captureCount },
  tamper: { caseCount: tamper.caseCount, rejectionCount: tamper.rejectionCount, passedFlagOnlyCases: tamper.passedFlagOnlyCases },
  passed: forbiddenChangedFiles.length === 0 && typeof pkg.scripts['test:stage9-A'] === 'string' && typeof pkg.scripts['browser:stage9-A'] === 'string' && String(pkg.scripts.posttest).includes('test:stage9-A') && String(pkg.scripts['gate:stage8-2G']).includes('browser:stage9-A') && workflow.includes('npm run test:stage9-A') && workflow.includes('npm run browser:stage9-A') && manifest.productionEntry === true && manifest.fixtureLoaderUsed === false && tamper.caseCount >= 80 && tamper.rejectionCount === tamper.caseCount && tamper.passedFlagOnlyCases === 0
};
fs.writeFileSync('stage9_a_developer_selfcheck.json', `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true, JSON.stringify(output));
console.log(JSON.stringify({ ok: true, stage: output.stage, changedFiles: changedFiles.length, tamperCases: tamper.caseCount }));
