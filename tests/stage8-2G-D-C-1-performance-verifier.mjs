import { DEFAULT_LOAD_THRESHOLD, DEFAULT_QUALIFICATION_RULES, evaluateEnvironmentQualification } from './lib/perf-environment.mjs';

const list = (value) => Array.isArray(value) ? value : [];
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const percentile = (sorted, ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];

export function recomputeTimingStats(values = []) {
  const sorted = values.map(finite).filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return {
    averageMs: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p50Ms: round(percentile(sorted, 0.5)),
    medianMs: round(percentile(sorted, 0.5)),
    p90Ms: round(percentile(sorted, 0.9)),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted.at(-1))
  };
}

const rulesNotWeakerThanDefault = (rules = {}) => (
  Number(rules.probesPerAttempt) >= DEFAULT_QUALIFICATION_RULES.probesPerAttempt
  && Number(rules.eventLoopSamplesPerProbe) >= DEFAULT_QUALIFICATION_RULES.eventLoopSamplesPerProbe
  && Number(rules.calibrationSamplesPerProbe) >= DEFAULT_QUALIFICATION_RULES.calibrationSamplesPerProbe
  && Number(rules.calibrationIterations) >= DEFAULT_QUALIFICATION_RULES.calibrationIterations
  && Number(rules.minimumEffectiveCpuCount) >= DEFAULT_QUALIFICATION_RULES.minimumEffectiveCpuCount
  && Number(rules.maxEventLoopP95JitterMs) <= DEFAULT_QUALIFICATION_RULES.maxEventLoopP95JitterMs
  && Number(rules.maxEventLoopMaxJitterMs) <= DEFAULT_QUALIFICATION_RULES.maxEventLoopMaxJitterMs
  && Number(rules.maxCalibrationCoefficientOfVariation) <= DEFAULT_QUALIFICATION_RULES.maxCalibrationCoefficientOfVariation
  && Number(rules.maxCalibrationP95MedianRatio) <= DEFAULT_QUALIFICATION_RULES.maxCalibrationP95MedianRatio
  && Number(rules.maxCalibrationMaxMedianRatio) <= DEFAULT_QUALIFICATION_RULES.maxCalibrationMaxMedianRatio
  && Number(rules.maxCalibrationWarmupDriftRatio) <= DEFAULT_QUALIFICATION_RULES.maxCalibrationWarmupDriftRatio
  && Number(rules.maxCgroupThrottledWallRatio) <= DEFAULT_QUALIFICATION_RULES.maxCgroupThrottledWallRatio
  && rules.requireProductCanary === true
  && Number(rules.productCanaryWarmupSamples) >= 20
  && Number(rules.productCanarySamplesPerScene) >= 60
  && Number(rules.productCanarySceneCount) === 3
  && Number(rules.maxProductCanaryP95Ms) <= 16.7
);

const metadataMatches = (runtime, snapshot) => {
  const keys = ['platform', 'arch', 'nodeVersion', 'cpuCount', 'availableCpuCount', 'effectiveCpuCount', 'cpuModel'];
  return keys.every((key) => runtime?.[key] === snapshot?.[key]) && same(runtime?.cgroup, snapshot?.cgroup);
};

/** Production performance evidence verifier: recomputes qualification and percentiles from raw samples. */
export function verifyDC1PerformanceEvidence(evidence = {}) {
  const errors = [];
  const guard = evidence.environmentGuard || {};
  const rules = guard.rules || {};
  if (evidence.stage !== '8.2G-D-C.1' || Number(evidence.version) < 2) errors.push('evidence_shape');
  if (!(Number(guard.threshold) > 0 && Number(guard.threshold) <= DEFAULT_LOAD_THRESHOLD)) errors.push('qualification_load_threshold');
  if (!rulesNotWeakerThanDefault(rules)) errors.push('qualification_rules_weakened');
  const selected = list(guard.samples).find((attempt) => Number(attempt.attempt) === Number(guard.selectedAttempt));
  if (!selected) errors.push('qualification_selected_attempt');
  const qualification = selected ? evaluateEnvironmentQualification(selected, { threshold: Number(guard.threshold), rules }) : null;
  if (!qualification?.qualified) errors.push('qualification_failed');
  if (selected && (!same(selected.evaluation?.reasons, qualification.reasons) || !same(selected.evaluation?.metrics, qualification.metrics) || selected.evaluation?.qualified !== qualification.qualified)) errors.push('qualification_declared_mismatch');
  if (guard.fit !== true || guard.environmentQualified !== true || evidence.environmentQualified !== true || evidence.environmentQualificationReason !== 'QUALIFIED') errors.push('qualification_claim');
  if (!metadataMatches(evidence.runtime, guard.snapshot)) errors.push('environment_metadata');
  const canaryRows = qualification?.metrics?.productCanary?.rows || [];
  if (canaryRows.length !== 3) errors.push('product_canary_scene_count');
  if (canaryRows.some((row) => row.sampleCount < Number(rules.productCanarySamplesPerScene) || !(row.stats?.p95Ms < Number(rules.maxProductCanaryP95Ms)))) errors.push('product_canary_budget');

  if (evidence.measurementValid !== true) errors.push('measurement_valid');
  if (Number(evidence.formalMeasurementRuns) !== 1) errors.push('formal_measurement_count');
  if (evidence.measurementPolicy?.retryAfterMeasurement !== false || evidence.measurementPolicy?.bestOfN !== false || evidence.measurementPolicy?.outlierTrimming !== false) errors.push('measurement_policy');
  for (const key of ['measurementAttempts', 'selectedMeasurement', 'bestOf', 'retries', 'discardedSamples']) if (Object.prototype.hasOwnProperty.call(evidence, key)) errors.push(`retry_injection:${key}`);

  const limits = evidence.limits || {};
  if (Number(limits.p95TotalPresentationBuildMs) !== 16.7 || Number(limits.sampleCountMinimum) < 120 || Number(limits.maxEffects) !== 96 || Number(limits.maxSmokeParticles) !== 32) errors.push('performance_limits');
  if (Number(evidence.warmupSamples) < 20 || Number(evidence.sampleCount) < 120) errors.push('performance_sample_contract');
  const scenes = list(evidence.scenes);
  if (scenes.length !== 3 || new Set(scenes.map((scene) => scene.sceneId)).size !== 3) errors.push('performance_scene_count');
  for (const scene of scenes) {
    const samples = list(scene.timingSamplesMs);
    if (samples.length !== Number(scene.sampleCount) || samples.length !== Number(scene.samples) || samples.length < 120 || Number(scene.warmupSamples) < 20) {
      errors.push(`sample_count:${scene.sceneId}`);
      continue;
    }
    const stats = recomputeTimingStats(samples);
    const declared = stats && Object.fromEntries(Object.keys(stats).map((key) => [key, Number(scene[key])]));
    if (!stats || !same(declared, stats)) errors.push(`timing_recompute:${scene.sceneId}`);
    if (!(stats?.p95Ms < 16.7)) errors.push(`p95_budget:${scene.sceneId}`);
    if (Number(scene.peakEffectCount) > 96) errors.push(`effect_budget:${scene.sceneId}`);
    if (Number(scene.peakSmokeCount) > 32) errors.push(`smoke_budget:${scene.sceneId}`);
  }
  const recomputedPassed = errors.filter((error) => error.startsWith('sample_count:') || error.startsWith('timing_recompute:') || error.startsWith('p95_budget:') || error.startsWith('effect_budget:') || error.startsWith('smoke_budget:')).length === 0;
  if (evidence.passed !== true || !recomputedPassed) errors.push('performance_passed_claim');
  return { ok: errors.length === 0, errors: [...new Set(errors)], environmentQualified: qualification?.qualified === true, recomputedSceneCount: scenes.length };
}
