import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_LOAD_THRESHOLD,
  DEFAULT_QUALIFICATION_RULES,
  awaitFitEnvironment,
  evaluateEnvironmentQualification
} from './lib/perf-environment.mjs';
import { recomputeTimingStats, verifyDC1PerformanceEvidence } from './stage8-2G-D-C-1-performance-verifier.mjs';

const clone = (value) => structuredClone(value);
const snapshot = (overrides = {}) => ({
  platform: 'linux', arch: 'x64', nodeVersion: process.version,
  cpuCount: 4, availableCpuCount: 4, effectiveCpuCount: 4,
  cpuModel: 'qualification-fixture-cpu', loadAverage: [0.4, 0.3, 0.2],
  normalizedLoad1: 0.1, spareEffectiveCores: 3.6,
  cgroup: { available: true, version: 2, quotaCores: 4, nrPeriods: 100, nrThrottled: 0, throttledUsec: 0 },
  ...overrides
});

function validAttempt() {
  const probes = Array.from({ length: DEFAULT_QUALIFICATION_RULES.probesPerAttempt }, (_, index) => ({
    probe: index + 1,
    snapshotBefore: snapshot(),
    snapshotAfter: snapshot(),
    eventLoopJitterMs: Array(DEFAULT_QUALIFICATION_RULES.eventLoopSamplesPerProbe).fill(0.2),
    calibration: {
      iterations: DEFAULT_QUALIFICATION_RULES.calibrationIterations,
      checksum: 123,
      warmupMs: Array(DEFAULT_QUALIFICATION_RULES.calibrationWarmupSamples).fill(2.1),
      samplesMs: Array(DEFAULT_QUALIFICATION_RULES.calibrationSamplesPerProbe).fill(2)
    },
    cgroupThrottle: { available: true, throttledUsecDelta: 0, throttledWallRatio: 0, nrThrottledDelta: 0 }
  }));
  const raw = { probes };
  return { attempt: 1, ...raw, evaluation: evaluateEnvironmentQualification(raw, { threshold: DEFAULT_LOAD_THRESHOLD, rules: DEFAULT_QUALIFICATION_RULES }) };
}

function validScene(sceneId, baseMs) {
  const timingSamplesMs = Array.from({ length: 120 }, (_, index) => Number((baseMs + ((index % 7) * 0.01)).toFixed(6)));
  const stats = recomputeTimingStats(timingSamplesMs);
  return {
    sceneId, actorCount: 12, durationSeconds: 34, warmupSamples: 20,
    samples: 120, sampleCount: 120, timingSamplesMs, ...stats,
    averageEffectCount: 10, peakEffectCount: 46, peakSmokeCount: 28,
    peakProjectileCount: 18, peakEnvironmentObjectCount: 20
  };
}

function validEvidence() {
  const selected = validAttempt();
  const runtime = selected.probes.at(-1).snapshotAfter;
  return {
    stage: '8.2G-D-C.1', version: 2, measurement: 'fixture', runtime: clone(runtime),
    environmentQualified: true, environmentQualificationReason: 'QUALIFIED',
    environmentGuard: {
      fit: true, environmentQualified: true, environmentQualificationReason: 'QUALIFIED',
      qualificationVersion: 2, threshold: DEFAULT_LOAD_THRESHOLD,
      rules: clone(DEFAULT_QUALIFICATION_RULES), attempts: 1, attemptsLimit: 2,
      samples: [selected], selectedAttempt: 1, snapshot: clone(runtime), loadAfter: clone(runtime)
    },
    measurementValid: true, formalMeasurementRuns: 1,
    measurementPolicy: { retryAfterMeasurement: false, bestOfN: false, outlierTrimming: false },
    warmupSamples: 20, sampleCount: 120,
    scenes: [validScene('stage8g-dc-victory', 4), validScene('stage8g-dc-withdraw', 5), validScene('stage8g-dc-art', 6)],
    limits: { p95TotalPresentationBuildMs: 16.7, sampleCountMinimum: 120, maxEffects: 96, maxSmokeParticles: 32 },
    passed: true
  };
}

assert.equal(verifyDC1PerformanceEvidence(validEvidence()).ok, true, 'valid evidence must be independently accepted');
const injectedUnfit = validAttempt();
injectedUnfit.probes[0].eventLoopJitterMs.fill(20);
const unfitGuard = await awaitFitEnvironment({ attempts: 1, waitMs: 0, attemptProvider: async () => injectedUnfit, sleepFn: async () => {} });
assert.equal(unfitGuard.fit, false, 'preflight must fail closed before product measurement');
assert.match(unfitGuard.environmentQualificationReason, /^ENVIRONMENT_UNFIT:/);

const cases = [];
function tamper(id, mutate) {
  const evidence = validEvidence();
  mutate(evidence);
  assert.equal(evidence.passed, true, `${id}: passed flag must be preserved`);
  const verdict = verifyDC1PerformanceEvidence(evidence);
  const row = { id, rejected: verdict.ok === false, passedPreserved: evidence.passed === true, errors: verdict.errors };
  cases.push(row);
  assert.equal(row.rejected, true, `${id} must be rejected`);
}

tamper('fake_fit_high_calibration_variance', (evidence) => {
  evidence.environmentGuard.samples[0].probes[0].calibration.samplesMs = Array.from({ length: 12 }, (_, index) => index % 2 ? 8 : 1);
});
tamper('fake_low_load_excessive_event_loop_jitter', (evidence) => {
  evidence.environmentGuard.samples[0].probes[1].eventLoopJitterMs.fill(12);
});
tamper('measurement_valid_while_qualification_failed', (evidence) => {
  evidence.environmentGuard.samples[0].probes.forEach((probe) => { probe.snapshotBefore.normalizedLoad1 = 1.2; probe.snapshotAfter.normalizedLoad1 = 1.2; });
});
tamper('performance_passed_with_p95_over_budget', (evidence) => {
  evidence.scenes[2].timingSamplesMs.splice(110, 10, ...Array(10).fill(20));
});
tamper('sample_count_below_120', (evidence) => {
  evidence.scenes[0].timingSamplesMs.pop(); evidence.scenes[0].samples = 119; evidence.scenes[0].sampleCount = 119;
});
tamper('p95_field_tampered', (evidence) => { evidence.scenes[1].p95Ms += 1; });
tamper('best_of_n_retry_result_injected', (evidence) => {
  evidence.measurementAttempts = [{ p95Ms: 20, passed: false }, { p95Ms: 5, passed: true }]; evidence.bestOf = 2;
});
tamper('environment_metadata_tampered', (evidence) => { evidence.runtime.cpuModel = 'forged-cpu'; });

const output = {
  stage: '8.2G-D-C.1-performance-environment', version: 1,
  cases, caseCount: cases.length, rejectionCount: cases.filter((row) => row.rejected).length,
  passedFlagOnlyCases: cases.filter((row) => row.passedPreserved && row.errors.length === 0).length,
  passed: cases.length === 8 && cases.every((row) => row.rejected && row.passedPreserved)
};
assert.equal(output.passed, true);
assert.equal(output.passedFlagOnlyCases, 0);
fs.writeFileSync('stage8_2g_dc1_performance_environment_tamper_results.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, cases: output.caseCount, rejectionCount: output.rejectionCount, passedFlagOnlyCases: output.passedFlagOnlyCases }));
