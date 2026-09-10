import assert from 'node:assert/strict';
import { buildPresentations, definitions, writeJson } from './lib/stage8-2G-DC1-fixtures.mjs';
import { awaitFitEnvironment, DEFAULT_QUALIFICATION_RULES, loadSnapshot, PerfEnvironmentUnfitError } from './lib/perf-environment.mjs';
import { verifyDC1PerformanceEvidence } from './stage8-2G-D-C-1-performance-verifier.mjs';

const warmupSamples = 20;
const sampleCount = 120;
const limits = { p95TotalPresentationBuildMs: 16.7, sampleCountMinimum: 120, maxEffects: 96, maxSmokeParticles: 32 };
const measurement = 'complete presentation renderState.atTime including effects, camera, audio, transitions and environment state';

const qualificationRules = {
  ...DEFAULT_QUALIFICATION_RULES,
  requireProductCanary: true,
  productCanaryWarmupSamples: warmupSamples,
  productCanarySamplesPerScene: 60,
  productCanarySceneCount: definitions.length,
  maxProductCanaryP95Ms: limits.p95TotalPresentationBuildMs
};
const productCanary = () => {
  const scenes = [];
  for (const { sceneId } of definitions) {
    const presentation = buildPresentations().get(sceneId);
    assert.equal(presentation?.ok, true, `canary presentation ${sceneId}`);
    const duration = presentation.plan.timeline.duration;
    for (let index = 0; index < qualificationRules.productCanaryWarmupSamples; index += 1) {
      presentation.renderState.atTime((duration * ((index * 17) % 101)) / 100);
    }
    const timingSamplesMs = [];
    for (let index = 0; index < qualificationRules.productCanarySamplesPerScene; index += 1) {
      const started = process.hrtime.bigint();
      presentation.renderState.atTime((duration * ((index * 37) % 101)) / 100);
      timingSamplesMs.push(Number((Number(process.hrtime.bigint() - started) / 1e6).toFixed(6)));
    }
    scenes.push({ sceneId, timingSamplesMs });
  }
  return { scenes };
};
const guard = await awaitFitEnvironment({ rules: qualificationRules, workloadProvider: productCanary });
if (!guard.fit) {
  const output = {
    stage: '8.2G-D-C.1', version: 2, measurement,
    runtime: guard.snapshot,
    environmentQualified: false,
    environmentQualificationReason: guard.environmentQualificationReason,
    environmentGuard: guard,
    measurementValid: false,
    formalMeasurementRuns: 0,
    measurementPolicy: { retryAfterMeasurement: false, bestOfN: false, outlierTrimming: false },
    warmupSamples,
    sampleCount,
    scenes: [],
    limits,
    passed: false
  };
  writeJson('stage8_2g_dc1_performance_check.json', output);
  console.error(JSON.stringify({ ok: false, stage: output.stage, code: 'ENVIRONMENT_UNFIT', environmentQualificationReason: output.environmentQualificationReason, environmentGuard: guard }));
  throw new PerfEnvironmentUnfitError('8.2G-D-C.1', guard);
}

const percentile = (sorted, ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
const rows = [];
for (const { sceneId } of definitions) {
  const presentation = buildPresentations().get(sceneId);
  assert.equal(presentation?.ok, true, `presentation ${sceneId}`);
  const duration = presentation.plan.timeline.duration;
  for (let index = 0; index < warmupSamples; index += 1) presentation.renderState.atTime((duration * ((index * 17) % 101)) / 100);
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const start = process.hrtime.bigint();
    const state = presentation.renderState.atTime((duration * ((index * 37) % 101)) / 100);
    const elapsedMs = Number((Number(process.hrtime.bigint() - start) / 1e6).toFixed(6));
    samples.push({ elapsedMs, effectCount: state.effects.length, smokeCount: state.smoke.length, projectileCount: state.projectiles.length, environmentObjectCount: state.environment?.objects?.length || 0 });
  }
  const sorted = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const averageMs = samples.reduce((sum, sample) => sum + sample.elapsedMs, 0) / samples.length;
  const p50Ms = Number(percentile(sorted, 0.5).toFixed(3));
  rows.push({
    sceneId,
    actorCount: presentation.plan.forces.profile.totalCount,
    durationSeconds: duration,
    warmupSamples,
    samples: sampleCount,
    sampleCount,
    timingSamplesMs: samples.map((sample) => sample.elapsedMs),
    averageMs: Number(averageMs.toFixed(3)),
    p50Ms,
    medianMs: p50Ms,
    p90Ms: Number(percentile(sorted, 0.9).toFixed(3)),
    p95Ms: Number(percentile(sorted, 0.95).toFixed(3)),
    maxMs: Number(sorted.at(-1).toFixed(3)),
    averageEffectCount: Number((samples.reduce((sum, sample) => sum + sample.effectCount, 0) / samples.length).toFixed(3)),
    peakEffectCount: Math.max(...samples.map((sample) => sample.effectCount)),
    peakSmokeCount: Math.max(...samples.map((sample) => sample.smokeCount)),
    peakProjectileCount: Math.max(...samples.map((sample) => sample.projectileCount)),
    peakEnvironmentObjectCount: Math.max(...samples.map((sample) => sample.environmentObjectCount))
  });
}

const loadAfter = loadSnapshot();
const passed = rows.every((row) => row.samples >= limits.sampleCountMinimum && row.p95Ms < limits.p95TotalPresentationBuildMs && row.peakEffectCount <= limits.maxEffects && row.peakSmokeCount <= limits.maxSmokeParticles);
const output = {
  stage: '8.2G-D-C.1',
  version: 2,
  measurement,
  runtime: guard.snapshot,
  environmentQualified: true,
  environmentQualificationReason: guard.environmentQualificationReason,
  environmentGuard: { ...guard, loadAfter },
  measurementValid: true,
  formalMeasurementRuns: 1,
  measurementPolicy: { retryAfterMeasurement: false, bestOfN: false, outlierTrimming: false },
  warmupSamples,
  sampleCount,
  scenes: rows,
  limits,
  passed
};
writeJson('stage8_2g_dc1_performance_check.json', output);
const verdict = verifyDC1PerformanceEvidence(output);
assert.equal(verdict.ok, true, JSON.stringify(verdict));
assert.equal(passed, true, JSON.stringify(rows.map(({ timingSamplesMs, ...row }) => row)));
console.log(JSON.stringify({
  ok: true,
  stage: output.stage,
  measurementValid: true,
  environmentQualified: true,
  environmentQualificationReason: output.environmentQualificationReason,
  formalMeasurementRuns: 1,
  warmupSamples,
  sampleCount,
  runtime: output.runtime,
  qualification: guard.samples.map((attempt) => ({ attempt: attempt.attempt, qualified: attempt.evaluation.qualified, reason: attempt.evaluation.reason, metrics: attempt.evaluation.metrics })),
  rows: rows.map(({ sceneId, p50Ms, p90Ms, p95Ms, maxMs, peakEffectCount, peakSmokeCount }) => ({ sceneId, p50Ms, p90Ms, p95Ms, maxMs, peakEffectCount, peakSmokeCount }))
}));
