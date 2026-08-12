/**
 * 性能门禁的环境守卫。
 *
 * 背景：D-C.1 的 16.7ms 是 60fps 单帧预算（1000/60 = 16.6667），衡量的是
 * 战斗表现层每帧状态计算耗时，属于**产品需求**而非测试自身的开销限制。
 * 因此该阈值任何情况下都不得放宽。
 *
 * 但在被其他进程占满的机器上测量帧耗时是无效的——同一份代码连续两次运行
 * 可以从 13.6ms 跳到 19.2ms。此时给出「性能不达标」是一个关于产品的错误结论。
 *
 * 本模块的职责是把「测不准」和「真变慢」区分开：
 *   - 环境合格   → 正常测量并断言预算（预算不变）
 *   - 环境不合格 → 先等待；持续不合格则明确报告「环境不合格、未能测量」，
 *                  fail-closed，绝不静默放行。
 *
 * 判定标准使用 1 分钟负载均值除以 CPU 核数，与 tests/verification-runner.mjs
 * 中子进程超时自适应所用的归一化口径保持一致。
 */
import os from 'node:os';

/** 与 verification-runner.mjs 的 LOAD_NORMALIZATION_THRESHOLD 保持一致 */
export const DEFAULT_LOAD_THRESHOLD = 0.75;
export const DEFAULT_ATTEMPTS = 6;
export const DEFAULT_WAIT_MS = 10_000;

const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** 读取一次归一化负载快照。 */
export function loadSnapshot() {
  const cpus = os.cpus();
  const cpuCount = Math.max(1, cpus.length || 1);
  const loadAverage = os.loadavg().map((value) => (Number.isFinite(value) ? Number(value.toFixed(3)) : 0));
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cpuCount,
    cpuModel: cpus[0]?.model || 'unknown',
    loadAverage,
    normalizedLoad1: Number((loadAverage[0] / cpuCount).toFixed(3)),
    spareCores: Number((cpuCount - loadAverage[0]).toFixed(3))
  };
}

/** 环境阈值可通过 IRON_PERF_LOAD_THRESHOLD 覆盖（仅允许收紧或放宽判定条件，不影响性能预算本身）。 */
export function loadThreshold() {
  return positiveNumber(process.env.IRON_PERF_LOAD_THRESHOLD, DEFAULT_LOAD_THRESHOLD);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * 等待机器安静到足以进行帧耗时测量。
 * @returns {Promise<{fit:boolean, threshold:number, attempts:number, samples:object[], snapshot:object}>}
 */
export async function awaitFitEnvironment(options = {}) {
  const threshold = positiveNumber(options.threshold, loadThreshold());
  const attempts = Math.max(1, Math.floor(positiveNumber(options.attempts, DEFAULT_ATTEMPTS)));
  const waitMs = Math.max(0, positiveNumber(options.waitMs, DEFAULT_WAIT_MS));
  const samples = [];
  let snapshot = loadSnapshot();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    snapshot = loadSnapshot();
    samples.push({ attempt, normalizedLoad1: snapshot.normalizedLoad1, spareCores: snapshot.spareCores });
    if (snapshot.normalizedLoad1 < threshold) {
      return { fit: true, threshold, attempts: attempt, samples, snapshot };
    }
    if (attempt < attempts) await sleep(waitMs);
  }
  return { fit: false, threshold, attempts, samples, snapshot };
}

/** 环境不合格时抛出的错误，带独立标记以便与性能回归区分。 */
export class PerfEnvironmentUnfitError extends Error {
  constructor(stage, guard) {
    super(
      `[${stage}] 性能门禁未执行：环境不合格。`
      + ` normalizedLoad1=${guard.snapshot.normalizedLoad1} >= threshold=${guard.threshold}`
      + `（${guard.attempts} 次采样后仍不合格，cpuCount=${guard.snapshot.cpuCount}）。`
      + ' 这不是性能回归，而是本次测量无效：请在空闲机器或固定规格 runner 上重跑。'
      + ' 性能预算未被放宽。'
    );
    this.name = 'PerfEnvironmentUnfitError';
    this.environmentUnfit = true;
    this.guard = guard;
  }
}
