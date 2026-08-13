import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadSnapshot } from './lib/perf-environment.mjs';
import { verifyDC1PerformanceEvidence } from './stage8-2G-D-C-1-performance-verifier.mjs';

const outputDir = path.resolve(process.argv[2] || 'artifacts/stage9-c1b-performance');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const githubSha = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const performance = read('stage8_2g_dc1_performance_check.json');
const qualificationTamper = read('stage8_2g_dc1_performance_environment_tamper_results.json');
const verdict = verifyDC1PerformanceEvidence(performance);
assert.equal(verdict.ok, true, JSON.stringify(verdict));
assert.equal(qualificationTamper.passed, true);
assert.equal(qualificationTamper.rejectionCount, 9);
assert.equal(qualificationTamper.passedFlagOnlyCases, 0);

const result = {
  stage: 'Stage 9-C.1b',
  githubSha,
  workflowRunId: process.env.GITHUB_RUN_ID || null,
  workflowRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || 0) || null,
  runner: {
    name: process.env.RUNNER_NAME || null,
    os: process.env.RUNNER_OS || process.platform,
    arch: process.env.RUNNER_ARCH || process.arch,
    imageOS: process.env.ImageOS || null,
    imageVersion: process.env.ImageVersion || null,
    environment: loadSnapshot()
  },
  measurementValid: performance.measurementValid,
  environmentQualified: performance.environmentQualified,
  environmentQualificationReason: performance.environmentQualificationReason,
  warmupSamples: performance.warmupSamples,
  sampleCount: performance.sampleCount,
  formalMeasurementRuns: performance.formalMeasurementRuns,
  limits: performance.limits,
  scenes: performance.scenes.map(({ timingSamplesMs, ...scene }) => ({ ...scene, timingSampleCount: timingSamplesMs.length })),
  environmentGuard: performance.environmentGuard,
  qualificationTamper: {
    caseCount: qualificationTamper.caseCount,
    rejectionCount: qualificationTamper.rejectionCount,
    passedFlagOnlyCases: qualificationTamper.passedFlagOnlyCases
  },
  verifier: verdict,
  passed: performance.passed === true && verdict.ok === true
};
assert.equal(result.passed, true);
fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync('stage8_2g_dc1_performance_check.json', path.join(outputDir, 'stage8_2g_dc1_performance_check.json'));
fs.copyFileSync('stage8_2g_dc1_performance_environment_tamper_results.json', path.join(outputDir, 'stage8_2g_dc1_performance_environment_tamper_results.json'));
fs.writeFileSync(path.join(outputDir, 'stage9_c1b_performance_result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, githubSha, output: path.join(outputDir, 'stage9_c1b_performance_result.json'), scenes: result.scenes.map(({ sceneId, p95Ms }) => ({ sceneId, p95Ms })) }));
