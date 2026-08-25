import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * verify-clean-clone.mjs
 *
 * 干净克隆可复现性验证：替代废弃的 ZIP 干净包验证。
 *
 * 行为：
 *   1. 把当前仓库 HEAD 通过 `git clone --depth 1 file://<repo>` 克隆到临时目录
 *      （必须从 git 克隆，而不是复制工作目录，否则未提交的脏文件会污染验证）
 *   2. 在临时目录 fetch 只读的 authority 基线对象（Stage 9-A/B/C 与历史基线）
 *   3. 在临时目录执行 `npm install --ignore-scripts`
 *   4. 在临时目录跑由 IRON_CLEAN_CLONE_GATE_SCRIPT 选择的功能门禁
 *   5. 输出 JSON 结果：当前/克隆 commit SHA、门禁脚本、各步骤结论、总体 passed
 *   6. 结束后清理临时目录
 *
 * 约束：
 *   - 必须真实执行 browser 门禁，不得跳过
 *   - 不得读取或信任仓库中任何既有 evidence 的 `passed` 字段，一切以本次实跑结果为准
 */

const run = (cmd, args, cwd, opts = {}) => {
  const result = execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  return result;
};

const root = process.cwd();
const authorityBaseline = 'e72eedac27423902b94ebab69b2fa053ca99b112';
// All Stage 9 source-diff verifiers on the current release branch use the
// accepted Stage 9-D.1 baseline; shallow clones must fetch that exact object.
const stage9Baseline = '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6';
const DEFAULT_GATE_TIMEOUT_MS = 3_600_000;
const DEFAULT_GATE_SCRIPT = 'gate:stage8-2G';
const steps = [];
const outputTail = (value, limit = 4000) => String(value || '').slice(-limit);
const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
const gateTimeoutMs = positiveInteger(process.env.IRON_CLEAN_CLONE_TIMEOUT_MS, DEFAULT_GATE_TIMEOUT_MS);
const gateScript = process.env.IRON_CLEAN_CLONE_GATE_SCRIPT || DEFAULT_GATE_SCRIPT;
const qualifiedPerformanceInput = process.env.IRON_CLEAN_CLONE_PERFORMANCE_INPUT || null;

const record = (step, passed, exitCode = null, extra = {}) => {
  const entry = { step, passed };
  if (exitCode !== null) entry.exitCode = exitCode;
  Object.assign(entry, extra);
  steps.push(entry);
};

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-clone-'));
let overallPassed = false;
let currentHead = null;
let clonedHead = null;
let headMatches = false;

try {
  // 1. 从 git 克隆当前 HEAD（depth 1，file:// 协议），非复制工作目录
  const repoUrl = `file://${root}`;
  const cloneDir = path.join(tmpRoot, 'repo');
  try {
    run('git', ['clone', '--depth', '1', repoUrl, cloneDir], tmpRoot, { timeout: 120000 });
    record('git-clone', true, 0);
  } catch (error) {
    record('git-clone', false, null, {
      message: String(error.stderr || error.message),
      stdout: outputTail(error.stdout),
      stderr: outputTail(error.stderr),
    });
    throw error;
  }

  // 克隆的 HEAD 必须等于当前仓库 HEAD
  currentHead = run('git', ['rev-parse', 'HEAD'], root).trim();
  clonedHead = run('git', ['rev-parse', 'HEAD'], cloneDir).trim();
  headMatches = currentHead === clonedHead;
  record('clone-head-matches', headMatches, null, { currentHead, clonedHead });
  if (!headMatches) throw new Error(`clone HEAD mismatch: current=${currentHead} cloned=${clonedHead}`);

  // 2. 为浅克隆补齐 authority 基线对象。业务代码和 gate 仍只运行于克隆目录；
  // 这些对象只是让各阶段 source-diff verifier 能独立比较冻结路径。
  try {
    run('git', ['fetch', '--depth', '1', 'origin', authorityBaseline], cloneDir, { timeout: 120000 });
    record('authority-baseline-fetch', true, 0, { baseline: authorityBaseline });
  } catch (error) {
    record('authority-baseline-fetch', false, null, {
      baseline: authorityBaseline,
      message: String(error.stderr || error.message),
      stdout: outputTail(error.stdout),
      stderr: outputTail(error.stderr),
    });
    throw error;
  }
  try {
    run('git', ['fetch', '--depth', '1', 'origin', stage9Baseline], cloneDir, { timeout: 120000 });
    record('stage9-baseline-fetch', true, 0, { baseline: stage9Baseline });
  } catch (error) {
    record('stage9-baseline-fetch', false, null, {
      baseline: stage9Baseline,
      message: String(error.stderr || error.message),
      stdout: outputTail(error.stdout),
      stderr: outputTail(error.stderr),
    });
    throw error;
  }

  // 3. npm install --ignore-scripts（干净克隆内）
  try {
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], cloneDir, { timeout: 300000 });
    record('npm-install', true, 0);
  } catch (error) {
    record('npm-install', false, null, {
      message: String(error.stderr || error.message),
      stdout: outputTail(error.stdout),
      stderr: outputTail(error.stderr),
    });
    throw error;
  }

  // Reuse the same-run qualified D-C.1 artifact when the selected functional
  // gate needs its read-only input. This copies evidence into the temporary
  // clone without running the formal performance measurement a second time.
  if (qualifiedPerformanceInput) {
    try {
      const source = path.resolve(root, qualifiedPerformanceInput);
      const rootPrefix = `${root}${path.sep}`;
      if (source !== root && !source.startsWith(rootPrefix)) throw new Error('qualified performance input must stay inside repository root');
      if (!fs.existsSync(source)) throw new Error(`qualified performance input missing: ${qualifiedPerformanceInput}`);
      fs.copyFileSync(source, path.join(cloneDir, 'stage8_2g_dc1_performance_check.json'));
      record('qualified-performance-input', true, 0, {
        source: path.relative(root, source),
        target: 'stage8_2g_dc1_performance_check.json',
        reusedSameRunArtifact: true,
        formalMeasurementRerun: false
      });
    } catch (error) {
      record('qualified-performance-input', false, null, {
        source: qualifiedPerformanceInput,
        message: String(error.message || error)
      });
      throw error;
    }
  }

  // 4. 在干净克隆内跑选定功能门禁。Stage 9-E.1 使用 release functional，
  // 避免在 clean clone 再次执行正式 D-C.1 performance measurement。
  const gateStartedAt = Date.now();
  try {
    const gateOutput = run('npm', ['run', gateScript], cloneDir, { timeout: gateTimeoutMs });
    record(`gate:${gateScript}`, true, 0, {
      gateScript,
      timeoutMs: gateTimeoutMs,
      elapsedMs: Date.now() - gateStartedAt,
      tail: outputTail(gateOutput, 2000)
    });
  } catch (error) {
    const elapsedMs = Date.now() - gateStartedAt;
    const timeoutTriggered = error?.code === 'ETIMEDOUT'
      || (error?.signal === 'SIGTERM' && elapsedMs >= gateTimeoutMs - 1000);
    record(`gate:${gateScript}`, false, null, {
      gateScript,
      timeoutMs: gateTimeoutMs,
      elapsedMs,
      timeoutTriggered,
      message: String(error.stderr || error.message),
      stdout: outputTail(error.stdout),
      stderr: outputTail(error.stderr),
    });
    throw error;
  }

  overallPassed = steps.every((entry) => entry.passed);
} catch (error) {
  // 步骤已记录，overallPassed 保持 false
  if (!steps.length) {
    record('setup', false, null, { message: String(error.message) });
  }
  process.exitCode = 1;
} finally {
  // 5. 清理临时目录
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
}

const result = {
  commitSha: currentHead || (() => { try { return run('git', ['rev-parse', 'HEAD'], root).trim(); } catch { return null; } })(),
  currentHead,
  clonedHead,
  headMatches,
  cloneMethod: 'git-clone-file-local',
  gateScript,
  gateTimeoutMs,
  steps,
  overallPassed,
  tempCleaned: !fs.existsSync(tmpRoot),
};
const serializedResult = `${JSON.stringify(result, null, 2)}\n`;
if (process.env.IRON_CLEAN_CLONE_RESULT_PATH) {
  const resultPath = path.resolve(root, process.env.IRON_CLEAN_CLONE_RESULT_PATH);
  fs.mkdirSync(path.dirname(resultPath), { recursive: true });
  fs.writeFileSync(resultPath, serializedResult);
}
console.log(serializedResult.trimEnd());
process.exitCode = process.exitCode || (overallPassed ? 0 : 1);
