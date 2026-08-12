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
 *   2. 在临时目录 fetch 只读的 Stage 9-C authority 基线对象
 *   3. 在临时目录执行 `npm install --ignore-scripts`
 *   4. 在临时目录跑完整门禁链 `npm run gate:stage8-2G`
 *   5. 输出 JSON 结果：克隆的 commit SHA、各步骤结论、总体 passed
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
const steps = [];
const outputTail = (value, limit = 4000) => String(value || '').slice(-limit);

const record = (step, passed, exitCode = null, extra = {}) => {
  const entry = { step, passed };
  if (exitCode !== null) entry.exitCode = exitCode;
  Object.assign(entry, extra);
  steps.push(entry);
};

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-clone-'));
let overallPassed = false;

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
  const currentHead = run('git', ['rev-parse', 'HEAD'], root).trim();
  const clonedHead = run('git', ['rev-parse', 'HEAD'], cloneDir).trim();
  const headMatches = currentHead === clonedHead;
  record('clone-head-matches', headMatches, null, { currentHead, clonedHead });
  if (!headMatches) throw new Error(`clone HEAD mismatch: current=${currentHead} cloned=${clonedHead}`);

  // 2. 为浅克隆补齐唯一的 authority 基线对象。业务代码和 gate 仍只运行于
  // 克隆目录；这一步只是让 source-diff verifier 能独立比较冻结路径。
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

  // 4. 在干净克隆内跑完整门禁链 gate:stage8-2G（含 npm test 与全部 browser 门禁）
  try {
    const gateOutput = run('npm', ['run', 'gate:stage8-2G'], cloneDir, { timeout: 1800000 });
    record('gate:stage8-2G', true, 0, { tail: outputTail(gateOutput, 2000) });
  } catch (error) {
    record('gate:stage8-2G', false, null, {
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
  commitSha: (() => { try { return run('git', ['rev-parse', 'HEAD'], root).trim(); } catch { return null; } })(),
  cloneMethod: 'git-clone-file-local',
  steps,
  overallPassed,
  tempCleaned: !fs.existsSync(tmpRoot),
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = process.exitCode || (overallPassed ? 0 : 1);
