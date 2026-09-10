import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadSnapshot } from './lib/perf-environment.mjs';

const outputDir = path.resolve(process.argv[2] || 'artifacts/stage9-c1b-node-core');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const githubSha = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const stage9A = { regression: read('stage9_a_regression_check.json'), browser: read('stage9_a_browser_capture_manifest.json'), tamper: read('stage9_a_tamper_results.json'), strong: read('stage9_a_strong_evidence_verdict.json') };
const stage9B = { regression: read('stage9_b_regression_check.json'), browser: read('stage9_b_browser_capture_manifest.json'), tamper: read('stage9_b_tamper_results.json'), strong: read('stage9_b_strong_evidence_verdict.json') };
const stage9C = { browser: read('stage9_c_browser_capture_manifest.json'), tamper: read('stage9_c_tamper_results.json'), strong: read('stage9_c_strong_evidence_verdict.json'), authority: read('stage9_c_authority_check.json') };

const browserPassed = (bundle, frames, reloads) => bundle.browser.passed === true && bundle.browser.browser?.captureCount === frames && bundle.browser.browser?.uniqueImageHashes === frames && bundle.browser.realReloads?.length === reloads && bundle.browser.browser?.pageErrors?.length === 0 && bundle.browser.browser?.consoleErrors?.length === 0;
const result = {
  stage: 'Stage 9-C.1b', githubSha,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || 0) || null,
  runner: { name: process.env.RUNNER_NAME || null, imageOS: process.env.ImageOS || null, imageVersion: process.env.ImageVersion || null, environment: loadSnapshot() },
  stage9A: { node: stage9A.regression.passed === true && stage9A.strong.passed === true, browser: browserPassed(stage9A, 18, 4), frames: stage9A.browser.browser.captureCount, reloads: stage9A.browser.realReloads.length, tamperCases: stage9A.tamper.caseCount, tamperRejected: stage9A.tamper.rejectionCount, passedFlagOnlyCases: stage9A.tamper.passedFlagOnlyCases },
  stage9B: { node: stage9B.regression.passed === true && stage9B.strong.passed === true, browser: browserPassed(stage9B, 8, 4), frames: stage9B.browser.browser.captureCount, reloads: stage9B.browser.realReloads.length, tamperCases: stage9B.tamper.caseCount, tamperRejected: stage9B.tamper.rejectionCount, passedFlagOnlyCases: stage9B.tamper.passedFlagOnlyCases },
  stage9C: { node: stage9C.strong.passed === true, browser: browserPassed(stage9C, 9, 4), frames: stage9C.browser.browser.captureCount, reloads: stage9C.browser.realReloads.length, tamperCases: stage9C.tamper.caseCount, tamperRejected: stage9C.tamper.rejectionCount, coupledTamperCases: stage9C.tamper.coupledTamperCaseCount, coupledTamperRejected: stage9C.tamper.coupledTamperRejected, passedFlagOnlyCases: stage9C.tamper.passedFlagOnlyCases, authority: stage9C.authority.authorityFieldChanges === 0 }
};
result.passed = result.stage9A.node && result.stage9A.browser && result.stage9B.node && result.stage9B.browser && result.stage9C.node && result.stage9C.browser && result.stage9C.frames === 9 && result.stage9C.reloads === 4 && result.stage9C.tamperCases === 141 && result.stage9C.tamperRejected === 141 && result.stage9C.coupledTamperCases === 11 && result.stage9C.coupledTamperRejected === 11 && result.stage9C.passedFlagOnlyCases === 0 && result.stage9C.authority;
assert.equal(result.passed, true, JSON.stringify(result));
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'stage9_c1b_stage9c_result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, githubSha, output: path.join(outputDir, 'stage9_c1b_stage9c_result.json'), stage9A: result.stage9A, stage9B: result.stage9B, stage9C: result.stage9C }));
