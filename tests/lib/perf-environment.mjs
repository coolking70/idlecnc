/**
 * 性能门禁的 pre-measurement 环境资格守卫。
 *
 * 16.7ms 是产品预算，绝不由本模块调整。本模块只在正式产品测量开始前，使用
 * load、event-loop jitter、确定性 CPU calibration 与 Linux cgroup throttling
 * 判断当前进程是否具备可重复的微基准条件。正式测量一旦开始，不会重试或择优。
 */
import fs from 'node:fs';
import os from 'node:os';
import { performance } from 'node:perf_hooks';

export const DEFAULT_LOAD_THRESHOLD = 0.75;
export const DEFAULT_ATTEMPTS = 2;
export const DEFAULT_WAIT_MS = 1_000;
export const QUALIFICATION_VERSION = 2;

export const DEFAULT_QUALIFICATION_RULES = Object.freeze({
  probesPerAttempt: 3,
  eventLoopSamplesPerProbe: 12,
  eventLoopDelayMs: 4,
  calibrationWarmupSamples: 6,
  calibrationSamplesPerProbe: 12,
  calibrationIterations: 1_200_000,
  requireProductCanary: false,
  productCanaryWarmupSamples: 20,
  productCanarySamplesPerScene: 60,
  productCanarySceneCount: 3,
  maxProductCanaryP95Ms: 16.7,
  minimumEffectiveCpuCount: 2,
  maxEventLoopP95JitterMs: 2.5,
  maxEventLoopMaxJitterMs: 10,
  maxCalibrationCoefficientOfVariation: 0.20,
  maxCalibrationP95MedianRatio: 1.30,
  maxCalibrationMaxMedianRatio: 1.80,
  maxCalibrationWarmupDriftRatio: 0.35,
  maxCgroupThrottledWallRatio: 0.15
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positiveNumber = (value, fallback) => finite(value) > 0 ? finite(value) : fallback;
const nonNegativeNumber = (value, fallback) => finite(value, -1) >= 0 ? finite(value) : fallback;
const round = (value, digits = 6) => Number(finite(value).toFixed(digits));
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const readNumber = (file) => {
  try {
    const value = Number(fs.readFileSync(file, 'utf8').trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
};

const readText = (file) => {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
};

/** 读取 Linux cgroup v2/v1 CPU quota 与 throttling；其它平台明确标记 unavailable。 */
export function readCgroupCpu() {
  if (process.platform !== 'linux') return { available: false, version: null, quotaCores: null };
  const cpuMax = readText('/sys/fs/cgroup/cpu.max');
  const cpuStat = readText('/sys/fs/cgroup/cpu.stat');
  if (cpuMax !== null || cpuStat !== null) {
    const [quotaRaw, periodRaw] = String(cpuMax || '').split(/\s+/);
    const quota = quotaRaw === 'max' ? null : finite(quotaRaw, NaN);
    const period = finite(periodRaw, NaN);
    const stats = Object.fromEntries(String(cpuStat || '').split('\n').map((line) => line.trim().split(/\s+/)).filter((row) => row.length === 2).map(([key, value]) => [key, finite(value)]));
    return {
      available: cpuMax !== null && cpuStat !== null,
      version: 2,
      quotaCores: Number.isFinite(quota) && quota > 0 && Number.isFinite(period) && period > 0 ? round(quota / period, 3) : null,
      nrPeriods: finite(stats.nr_periods),
      nrThrottled: finite(stats.nr_throttled),
      throttledUsec: finite(stats.throttled_usec)
    };
  }
  const quota = readNumber('/sys/fs/cgroup/cpu/cpu.cfs_quota_us');
  const period = readNumber('/sys/fs/cgroup/cpu/cpu.cfs_period_us');
  const v1Stats = Object.fromEntries(String(readText('/sys/fs/cgroup/cpu/cpu.stat') || '').split('\n').map((line) => line.trim().split(/\s+/)).filter((row) => row.length === 2).map(([key, value]) => [key, finite(value)]));
  return {
    available: quota !== null && period !== null,
    version: 1,
    quotaCores: quota > 0 && period > 0 ? round(quota / period, 3) : null,
    nrPeriods: finite(v1Stats.nr_periods),
    nrThrottled: finite(v1Stats.nr_throttled),
    throttledUsec: v1Stats.throttled_time ? round(finite(v1Stats.throttled_time) / 1000, 3) : 0
  };
}

/** 读取一次 CPU/load 快照，归一化分母使用 quota/availableParallelism 的有效最小值。 */
export function loadSnapshot() {
  const cpus = os.cpus();
  const cpuCount = Math.max(1, cpus.length || 1);
  const availableCpuCount = Math.max(1, typeof os.availableParallelism === 'function' ? os.availableParallelism() : cpuCount);
  const cgroup = readCgroupCpu();
  const effectiveCpuCount = Math.max(0.001, Math.min(cpuCount, availableCpuCount, cgroup.quotaCores || Number.POSITIVE_INFINITY));
  const loadAverage = os.loadavg().map((value) => round(Number.isFinite(value) ? value : 0, 3));
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cpuCount,
    availableCpuCount,
    effectiveCpuCount: round(effectiveCpuCount, 3),
    cpuModel: cpus[0]?.model || 'unknown',
    loadAverage,
    normalizedLoad1: round(loadAverage[0] / effectiveCpuCount, 3),
    spareEffectiveCores: round(effectiveCpuCount - loadAverage[0], 3),
    cgroup
  };
}

export function loadThreshold() {
  return positiveNumber(process.env.IRON_PERF_LOAD_THRESHOLD, DEFAULT_LOAD_THRESHOLD);
}

export function summarizeSamples(values = []) {
  const sorted = values.map((value) => finite(value)).sort((a, b) => a - b);
  if (!sorted.length) return { count: 0, medianMs: null, p90Ms: null, p95Ms: null, maxMs: null, meanMs: null, coefficientOfVariation: null };
  const percentile = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / sorted.length;
  return {
    count: sorted.length,
    medianMs: round(percentile(0.5)),
    p90Ms: round(percentile(0.9)),
    p95Ms: round(percentile(0.95)),
    maxMs: round(sorted.at(-1)),
    meanMs: round(mean),
    coefficientOfVariation: mean > 0 ? round(Math.sqrt(variance) / mean) : 0
  };
}

export async function measureEventLoopJitter({ samples = DEFAULT_QUALIFICATION_RULES.eventLoopSamplesPerProbe, delayMs = DEFAULT_QUALIFICATION_RULES.eventLoopDelayMs } = {}) {
  const values = [];
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now();
    await sleep(delayMs);
    values.push(round(Math.max(0, performance.now() - started - delayMs)));
  }
  return values;
}

export function runCpuCalibration(iterations = DEFAULT_QUALIFICATION_RULES.calibrationIterations) {
  let checksum = 0x12345678;
  for (let index = 0; index < iterations; index += 1) checksum = (Math.imul(checksum ^ (index + 1), 1664525) + 1013904223) >>> 0;
  return checksum;
}

export function measureCpuCalibration({ warmupSamples = DEFAULT_QUALIFICATION_RULES.calibrationWarmupSamples, samples = DEFAULT_QUALIFICATION_RULES.calibrationSamplesPerProbe, iterations = DEFAULT_QUALIFICATION_RULES.calibrationIterations } = {}) {
  const measureOne = () => {
    const started = performance.now();
    const checksum = runCpuCalibration(iterations);
    return { elapsedMs: round(performance.now() - started), checksum };
  };
  const warmup = Array.from({ length: warmupSamples }, measureOne);
  const measured = Array.from({ length: samples }, measureOne);
  return { iterations, checksum: measured.at(-1)?.checksum ?? warmup.at(-1)?.checksum ?? null, warmupMs: warmup.map((row) => row.elapsedMs), samplesMs: measured.map((row) => row.elapsedMs) };
}

const cgroupThrottleDelta = (before, after, wallMs) => {
  if (!before?.available || !after?.available || before.version !== after.version || before.throttledUsec === null || after.throttledUsec === null) return { available: false, throttledUsecDelta: null, throttledWallRatio: null, nrThrottledDelta: null };
  const throttledUsecDelta = Math.max(0, finite(after.throttledUsec) - finite(before.throttledUsec));
  return {
    available: true,
    throttledUsecDelta,
    throttledWallRatio: wallMs > 0 ? round(throttledUsecDelta / (wallMs * 1000)) : 0,
    nrThrottledDelta: Math.max(0, finite(after.nrThrottled) - finite(before.nrThrottled))
  };
};

export async function collectQualificationAttempt({ rules = DEFAULT_QUALIFICATION_RULES, loadProvider = loadSnapshot, eventLoopProvider = measureEventLoopJitter, calibrationProvider = measureCpuCalibration, workloadProvider } = {}) {
  const probes = [];
  for (let probe = 1; probe <= rules.probesPerAttempt; probe += 1) {
    const snapshotBefore = loadProvider();
    const cgroupBefore = snapshotBefore.cgroup;
    const started = performance.now();
    const eventLoopJitterMs = await eventLoopProvider({ samples: rules.eventLoopSamplesPerProbe, delayMs: rules.eventLoopDelayMs, probe });
    const calibration = await calibrationProvider({ warmupSamples: rules.calibrationWarmupSamples, samples: rules.calibrationSamplesPerProbe, iterations: rules.calibrationIterations, probe });
    const productCanary = workloadProvider ? await workloadProvider({ rules, probe }) : null;
    const wallMs = performance.now() - started;
    const snapshotAfter = loadProvider();
    probes.push({
      probe,
      snapshotBefore,
      snapshotAfter,
      eventLoopJitterMs,
      calibration,
      ...(productCanary ? { productCanary } : {}),
      cgroupThrottle: cgroupThrottleDelta(cgroupBefore, snapshotAfter.cgroup, wallMs)
    });
  }
  return { probes };
}

/** 从真实 probe 数据重算资格；不采信 fit/environmentQualified 声明字段。 */
export function evaluateEnvironmentQualification(attempt = {}, { threshold = loadThreshold(), rules = DEFAULT_QUALIFICATION_RULES } = {}) {
  const probes = Array.isArray(attempt.probes) ? attempt.probes : [];
  const reasons = [];
  if (probes.length !== rules.probesPerAttempt) reasons.push('probe_count');
  const snapshots = probes.flatMap((probe) => [probe.snapshotBefore, probe.snapshotAfter]).filter(Boolean);
  const effectiveCpuCounts = snapshots.map((snapshot) => finite(snapshot.effectiveCpuCount, finite(snapshot.cpuCount, 1)));
  const normalizedLoads = snapshots.map((snapshot) => finite(snapshot.normalizedLoad1, Number.POSITIVE_INFINITY));
  if (!effectiveCpuCounts.length || Math.min(...effectiveCpuCounts) < rules.minimumEffectiveCpuCount) reasons.push('effective_cpu_count');
  if (!normalizedLoads.length || Math.max(...normalizedLoads) >= threshold) reasons.push('normalized_load');

  const eventLoopSamples = probes.flatMap((probe) => Array.isArray(probe.eventLoopJitterMs) ? probe.eventLoopJitterMs : []);
  const expectedEventLoopSamples = rules.probesPerAttempt * rules.eventLoopSamplesPerProbe;
  const eventLoop = summarizeSamples(eventLoopSamples);
  if (eventLoopSamples.length !== expectedEventLoopSamples) reasons.push('event_loop_sample_count');
  if (eventLoop.p95Ms === null || eventLoop.p95Ms > rules.maxEventLoopP95JitterMs) reasons.push('event_loop_p95_jitter');
  if (eventLoop.maxMs === null || eventLoop.maxMs > rules.maxEventLoopMaxJitterMs) reasons.push('event_loop_max_jitter');

  const calibrationSamples = probes.flatMap((probe) => Array.isArray(probe.calibration?.samplesMs) ? probe.calibration.samplesMs : []);
  const calibrationWarmup = probes.flatMap((probe) => Array.isArray(probe.calibration?.warmupMs) ? probe.calibration.warmupMs : []);
  const expectedCalibrationSamples = rules.probesPerAttempt * rules.calibrationSamplesPerProbe;
  const expectedWarmupSamples = rules.probesPerAttempt * rules.calibrationWarmupSamples;
  const calibration = summarizeSamples(calibrationSamples);
  const warmup = summarizeSamples(calibrationWarmup);
  const p95MedianRatio = calibration.medianMs > 0 ? round(calibration.p95Ms / calibration.medianMs) : Number.POSITIVE_INFINITY;
  const maxMedianRatio = calibration.medianMs > 0 ? round(calibration.maxMs / calibration.medianMs) : Number.POSITIVE_INFINITY;
  const warmupDriftRatio = calibration.medianMs > 0 && warmup.medianMs !== null ? round(Math.abs(warmup.medianMs - calibration.medianMs) / calibration.medianMs) : Number.POSITIVE_INFINITY;
  if (calibrationSamples.length !== expectedCalibrationSamples || calibrationWarmup.length !== expectedWarmupSamples) reasons.push('calibration_sample_count');
  if (calibration.coefficientOfVariation === null || calibration.coefficientOfVariation > rules.maxCalibrationCoefficientOfVariation) reasons.push('calibration_variance');
  if (p95MedianRatio > rules.maxCalibrationP95MedianRatio) reasons.push('calibration_p95_ratio');
  if (maxMedianRatio > rules.maxCalibrationMaxMedianRatio) reasons.push('calibration_max_ratio');
  if (warmupDriftRatio > rules.maxCalibrationWarmupDriftRatio) reasons.push('calibration_warmup_drift');

  const throttledRatios = probes.map((probe) => probe.cgroupThrottle).filter((row) => row?.available).map((row) => finite(row.throttledWallRatio));
  const maxCgroupThrottledWallRatio = throttledRatios.length ? Math.max(...throttledRatios) : null;
  if (maxCgroupThrottledWallRatio !== null && maxCgroupThrottledWallRatio > rules.maxCgroupThrottledWallRatio) reasons.push('cgroup_throttling');

  const rawCanaryRows = probes.flatMap((probe) => Array.isArray(probe.productCanary?.scenes) ? probe.productCanary.scenes : []);
  const canaryByScene = new Map();
  for (const row of rawCanaryRows) {
    const current = canaryByScene.get(row.sceneId) || [];
    canaryByScene.set(row.sceneId, current.concat(Array.isArray(row.timingSamplesMs) ? row.timingSamplesMs : []));
  }
  const expectedCanaryRows = rules.productCanarySceneCount;
  const canary = [...canaryByScene.entries()].map(([sceneId, timingSamplesMs]) => ({ sceneId, sampleCount: timingSamplesMs.length, stats: summarizeSamples(timingSamplesMs) }));
  if (rules.requireProductCanary) {
    if (canary.length !== expectedCanaryRows) reasons.push('product_canary_scene_count');
    for (const row of canary) {
      if (row.sampleCount !== rules.probesPerAttempt * rules.productCanarySamplesPerScene) reasons.push(`product_canary_sample_count:${row.sceneId}`);
      if (row.stats.p95Ms === null || row.stats.p95Ms >= rules.maxProductCanaryP95Ms) reasons.push(`product_canary_p95:${row.sceneId}`);
    }
  }

  return {
    qualified: reasons.length === 0,
    reason: reasons.length ? `ENVIRONMENT_UNFIT:${[...new Set(reasons)].join(',')}` : 'QUALIFIED',
    reasons: [...new Set(reasons)],
    metrics: {
      maximumNormalizedLoad1: normalizedLoads.length ? round(Math.max(...normalizedLoads), 3) : null,
      minimumEffectiveCpuCount: effectiveCpuCounts.length ? round(Math.min(...effectiveCpuCounts), 3) : null,
      eventLoop,
      calibration: { ...calibration, p95MedianRatio, maxMedianRatio, warmupDriftRatio },
      maxCgroupThrottledWallRatio,
      productCanary: { sceneCount: canary.length, expectedSceneCount: expectedCanaryRows, rows: canary }
    }
  };
}

/**
 * 执行有限次、只发生于产品测量前的资格探测。返回 fit 后，调用方只能进行一次正式测量。
 */
export async function awaitFitEnvironment(options = {}) {
  const threshold = positiveNumber(options.threshold, loadThreshold());
  const attemptsLimit = Math.max(1, Math.floor(positiveNumber(options.attempts, DEFAULT_ATTEMPTS)));
  const waitMs = nonNegativeNumber(options.waitMs, DEFAULT_WAIT_MS);
  const rules = { ...DEFAULT_QUALIFICATION_RULES, ...(options.rules || {}) };
  const attempts = [];
  let snapshot = loadSnapshot();
  for (let attemptNumber = 1; attemptNumber <= attemptsLimit; attemptNumber += 1) {
    const raw = options.attemptProvider
      ? await options.attemptProvider({ attempt: attemptNumber, rules, threshold })
      : await collectQualificationAttempt({ rules, loadProvider: options.loadProvider, eventLoopProvider: options.eventLoopProvider, calibrationProvider: options.calibrationProvider, workloadProvider: options.workloadProvider });
    const evaluation = evaluateEnvironmentQualification(raw, { threshold, rules });
    const attempt = { attempt: attemptNumber, ...raw, evaluation };
    attempts.push(attempt);
    snapshot = raw.probes?.at(-1)?.snapshotAfter || raw.probes?.at(-1)?.snapshotBefore || snapshot;
    if (evaluation.qualified) {
      return {
        fit: true,
        environmentQualified: true,
        environmentQualificationReason: evaluation.reason,
        qualificationVersion: QUALIFICATION_VERSION,
        threshold,
        rules,
        attempts: attemptNumber,
        attemptsLimit,
        samples: attempts,
        selectedAttempt: attemptNumber,
        snapshot
      };
    }
    if (attemptNumber < attemptsLimit) await (options.sleepFn || sleep)(waitMs);
  }
  const lastEvaluation = attempts.at(-1)?.evaluation;
  return {
    fit: false,
    environmentQualified: false,
    environmentQualificationReason: lastEvaluation?.reason || 'ENVIRONMENT_UNFIT:missing_probe_data',
    qualificationVersion: QUALIFICATION_VERSION,
    threshold,
    rules,
    attempts: attempts.length,
    attemptsLimit,
    samples: attempts,
    selectedAttempt: null,
    snapshot
  };
}

export class PerfEnvironmentUnfitError extends Error {
  constructor(stage, guard) {
    super(`[${stage}] ENVIRONMENT_UNFIT: ${guard.environmentQualificationReason}; preflight attempts=${guard.attempts}/${guard.attemptsLimit}. 正式产品 benchmark 未开始，16.7ms 预算未放宽。`);
    this.name = 'PerfEnvironmentUnfitError';
    this.code = 'ENVIRONMENT_UNFIT';
    this.environmentUnfit = true;
    this.guard = guard;
  }
}
