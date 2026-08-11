import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import {
  buildChildTestEnv,
  cleanupVerificationRunner,
  createVerificationRunner,
  getAdaptiveTimeoutMs,
  getVerificationLoadSnapshot,
  runVerificationStage
} from './verification-runner.mjs';
import { runActualGlobalTimeoutFixture } from './fixtures/global-timeout-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const timeoutWorker = path.join(root, 'tests/fixtures/verifier-timeout-output-worker.mjs');
const readyWorker = path.join(root, 'tests/fixtures/verifier-ready-worker.mjs');
const a22Source = fs.readFileSync(path.join(root, 'tests/stage8-2E-A-2-2-test.mjs'), 'utf8');
const runnerSource = fs.readFileSync(path.join(root, 'tests/verification-runner.mjs'), 'utf8');
const verifierSource = fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-2-delivery-package.mjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, timeoutMs = 2000, intervalMs = 10) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(intervalMs);
  }
  return Boolean(predicate());
};
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${name}`); };

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.2E-A.2.4 稳定性测试');
console.log('════════════════════════════════════════════');

await check('load snapshot records runtime environment', () => {
  const load = getVerificationLoadSnapshot();
  assert.ok(load.cpuCount >= 1);
  assert.equal(load.loadAverage.length, 3);
  assert.equal(typeof load.cpuModel, 'string');
  assert.ok(load.timeoutMultiplier >= 1);
});
await check('adaptive timeout margin follows load pressure', () => {
  assert.equal(getAdaptiveTimeoutMs(1000, { timeoutMultiplier: 1.25 }), 1250);
  assert.equal(getAdaptiveTimeoutMs(1000, { timeoutMultiplier: 2 }), 2000);
});

async function runStage(stage) {
  const runner = createVerificationRunner({ globalTimeoutMs: 60000, heartbeatMs: 0 });
  try {
    return await runVerificationStage(runner, stage);
  } finally {
    await cleanupVerificationRunner(runner);
  }
}

async function expectTimeout(stage, expectedPattern) {
  const runner = createVerificationRunner({ globalTimeoutMs: 60000, heartbeatMs: 0 });
  const startedAt = Date.now();
  let error;
  try {
    await runVerificationStage(runner, stage);
  } catch (caught) {
    error = caught;
  } finally {
    await cleanupVerificationRunner(runner);
  }
  assert.ok(error, 'stage should reject');
  assert.equal(error.code, 'verification_stage_timeout');
  assert.match(error.message, expectedPattern);
  assert.equal(runner.activeChildren.size, 0);
  return { durationMs: Date.now() - startedAt, runner, error };
}

await check('readyPattern is supported by the runner', () => assert.match(runnerSource, /readyPattern/));
await check('ready handshake detects worker-ready', async () => {
  const result = await runStage({ name: 'ready-handshake', command: process.execPath, args: [readyWorker, '300', 'stdout', '50'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 2000, timeoutMs: 1000 });
  assert.equal(result.code, 0);
  assert.ok(result.readyAt);
});
await check('business timeout starts after ready', async () => {
  const result = await runStage({ name: 'slow-ready-success', command: process.execPath, args: [readyWorker, '700', 'stdout', '50'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 1500, timeoutMs: 1000 });
  assert.equal(result.code, 0);
  assert.ok(result.startupDurationMs >= 600);
  console.log(`readyHandshakeObservation=${JSON.stringify({ startupMs: result.startupDurationMs, startupTimeoutMs: 1500, businessTimeoutMs: 1000 })}`);
});
await check('startup timeout is bounded and classified', async () => {
  const runner = createVerificationRunner({ globalTimeoutMs: 60000, heartbeatMs: 0 });
  const startedAt = Date.now();
  let error;
  try {
    await runVerificationStage(runner, { name: 'startup-timeout', command: process.execPath, args: [readyWorker, '800', 'stdout', '10000'], readyPattern: /never-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 350, timeoutMs: 1000 });
  } catch (caught) { error = caught; }
  await cleanupVerificationRunner(runner);
  assert.equal(error?.code, 'verification_stage_startup_timeout');
  assert.ok(Date.now() - startedAt < 3000);
});
await check('ready-before output is preserved on startup failure', async () => {
  const runner = createVerificationRunner({ globalTimeoutMs: 60000, heartbeatMs: 0 });
  let error;
  try { await runVerificationStage(runner, { name: 'startup-output-preserved', command: process.execPath, args: [readyWorker, '800', 'stdout', '10000'], readyPattern: /never-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 350, timeoutMs: 1000 }); } catch (caught) { error = caught; }
  await cleanupVerificationRunner(runner);
  assert.match(error?.message || '', /startup-output/);
});
await check('ready-after output is preserved on business timeout', async () => {
  const result = await expectTimeout({ name: 'ready-output-timeout', command: process.execPath, args: [timeoutWorker, 'stdout', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1000 }, /stdout-marker/);
  assert.ok(result.error.stdout.includes('worker-ready'));
  const observation = result.runner.timeoutObservations.at(-1);
  assert.equal(observation.declaredTimeoutMs, 1000);
  assert.ok(observation.effectiveTimeoutMs >= observation.declaredTimeoutMs);
  assert.ok(observation.load.cpuCount >= 1);
});
await check('stderr is preserved on business timeout', async () => {
  const result = await expectTimeout({ name: 'ready-stderr-timeout', command: process.execPath, args: [timeoutWorker, 'stderr', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1000 }, /stderr-marker/);
  assert.ok(result.error.stderr.includes('stderr-marker'));
});
await check('missing readyPattern returns a clear error', async () => {
  const runner = createVerificationRunner({ globalTimeoutMs: 60000, heartbeatMs: 0 });
  let error;
  try { await runVerificationStage(runner, { name: 'missing-ready', command: process.execPath, args: [readyWorker, '800', 'stdout', '10000'], readyPattern: /not-present/, startTimeoutAfterReady: true, startupTimeoutMs: 350, timeoutMs: 1000 }); } catch (caught) { error = caught; }
  await cleanupVerificationRunner(runner);
  assert.equal(error?.code, 'verification_stage_startup_timeout');
  assert.match(error?.message || '', /startup timeout/);
});
await check('startup failure leaves no active child', async () => {
  const runner = createVerificationRunner({ globalTimeoutMs: 60000, heartbeatMs: 0 });
  try { await runVerificationStage(runner, { name: 'startup-cleanup', command: process.execPath, args: [readyWorker, '800', 'stdout', '10000'], readyPattern: /nope/, startTimeoutAfterReady: true, startupTimeoutMs: 350, timeoutMs: 1000 }); } catch {}
  await cleanupVerificationRunner(runner);
  assert.equal(runner.activeChildren.size, 0);
});

const stdoutRuns = [];
for (let index = 0; index < 10; index += 1) stdoutRuns.push(await expectTimeout({ name: `stdout stability ${index + 1}`, command: process.execPath, args: [timeoutWorker, 'stdout', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1000 }, /stdout-marker/));
console.log(`stdoutStability10=${JSON.stringify({ count: stdoutRuns.length, maxDurationMs: Math.max(...stdoutRuns.map((run) => run.durationMs)) })}`);
await check('stdout timeout is stable for ten runs', () => assert.equal(stdoutRuns.length, 10));

const stderrRuns = [];
for (let index = 0; index < 10; index += 1) stderrRuns.push(await expectTimeout({ name: `stderr stability ${index + 1}`, command: process.execPath, args: [timeoutWorker, 'stderr', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1000 }, /stderr-marker/));
console.log(`stderrStability10=${JSON.stringify({ count: stderrRuns.length, maxDurationMs: Math.max(...stderrRuns.map((run) => run.durationMs)) })}`);
await check('stderr timeout is stable for ten runs', () => assert.equal(stderrRuns.length, 10));

const pidRuns = [];
for (let index = 0; index < 10; index += 1) {
  const runner = createVerificationRunner({ globalTimeoutMs: 60000, heartbeatMs: 0 });
  const promise = runVerificationStage(runner, { name: `pid stability ${index + 1}`, command: process.execPath, args: [timeoutWorker, 'none', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1000 });
  const registered = await waitFor(() => runner.activeChildren.size === 1, 2000);
  try { await promise; } catch {}
  await cleanupVerificationRunner(runner);
  pidRuns.push(registered && runner.activeChildren.size === 0);
}
console.log(`pidStability10=${JSON.stringify({ count: pidRuns.length, allClean: pidRuns.every(Boolean) })}`);
await check('PID timeout observation is stable for ten runs', () => assert.ok(pidRuns.every(Boolean)));
await check('redirected A.2.2 output remains successful', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-a24-redirect-'));
  const stdoutFile = path.join(tempRoot, 'stdout.log');
  const stderrFile = path.join(tempRoot, 'stderr.log');
  const out = fs.openSync(stdoutFile, 'w');
  const err = fs.openSync(stderrFile, 'w');
  try {
    const result = spawnSync(process.execPath, ['tests/stage8-2E-A-2-2-test.mjs'], { cwd: root, env: buildChildTestEnv(process.env), stdio: ['ignore', out, err], encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(fs.readFileSync(stdoutFile, 'utf8'), /62 passed \/ 62 total/);
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
await check('slow-start worker does not false-timeout', async () => {
  const result = await runStage({ name: 'slow-start-worker', command: process.execPath, args: [readyWorker, '800', 'stderr', '50'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 1500, timeoutMs: 1000 });
  assert.equal(result.code, 0);
  assert.ok(result.startupDurationMs >= 700);
});
await check('CPU pressure leaves timeout behavior bounded', async () => {
  const load = Array.from({ length: 2 }, () => spawn(process.execPath, ['-e', 'const end=Date.now()+300; while(Date.now()<end){}'], { stdio: 'ignore' }));
  try {
    const result = await expectTimeout({ name: 'CPU-pressure-timeout', command: process.execPath, args: [timeoutWorker, 'stdout', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1000 }, /stdout-marker/);
    assert.ok(result.durationMs < 5000);
  } finally {
    await Promise.all(load.map((child) => child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve(child.exitCode)
      : new Promise((resolve) => child.once('close', resolve))));
  }
});
await check('A.2.2 has no sub-second external timeout', () => assert.doesNotMatch(a22Source, /timeoutMs:\s*(?:[0-9]|[1-9][0-9]{1,2})\b/));
await check('A.2.2 has no one-millisecond PID window', () => assert.doesNotMatch(a22Source, /wait\(1\)/));
await check('slim verifier manifest path is wired', () => assert.match(verifierSource, /IRON_COMMAND_VERIFY_TEST_MANIFEST/));
await check('child timeout environment remains isolated', () => { const env = buildChildTestEnv({ IRON_COMMAND_VERIFY_TIMEOUT_MS: '60000', IRON_COMMAND_VERIFY_STAGE_DELAY_MS: '250', KEEP: 'yes' }); assert.equal(env.IRON_COMMAND_VERIFY_TIMEOUT_MS, undefined); assert.equal(env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS, undefined); assert.equal(env.KEEP, 'yes'); });
await check('default final verifier runs npm test before browser', () => assert.ok(verifierSource.indexOf('const npmResult') < verifierSource.indexOf("name: 'browser evidence'")));
await check('policy blocking remains structured', () => assert.match(verifierSource, /navigation_blocked_by_policy/));
await check('policy path retains cleanup finally', () => assert.match(verifierSource, /finally \{/));
await check('temporary roots are cleaned by verifier', () => assert.match(verifierSource, /assertIsolatedTempRootClean\(isolatedRoot\)/));
const timeoutObservation = await runActualGlobalTimeoutFixture();
await check('global timeout still returns 124 and cleans', () => { assert.equal(timeoutObservation.exitCode, 124); assert.equal(timeoutObservation.activeChildren, 0); assert.equal(timeoutObservation.activeServers, 0); assert.equal(timeoutObservation.cleanupDone, true); });
const manifestPath = path.join(root, 'tests/fixtures/formal-browser-manifest-a2.json');
const browserOutputPath = path.join(root, 'tests/fixtures/formal-browser-output-a2.txt');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const browserPayload = JSON.parse(fs.readFileSync(browserOutputPath, 'utf8').trim().split(/\r?\n/)[0]);
await check('evidenceRunId remains three-way consistent', () => assert.equal(manifest.evidenceRunId, browserPayload.evidenceRunId));
await check('victory IDs remain consistent', () => { const battle = manifest.battles.find((entry) => entry.reportResult === 'victory'); const output = browserPayload.battles.find((entry) => entry.result === 'victory'); assert.equal(battle.battleId, output.battleId); assert.equal(battle.reportId, output.reportId); });
await check('withdraw IDs remain consistent', () => { const battle = manifest.battles.find((entry) => entry.reportResult === 'withdraw'); const output = browserPayload.battles.find((entry) => entry.result === 'withdraw'); assert.equal(battle.battleId, output.battleId); assert.equal(battle.reportId, output.reportId); });
await check('twelve evidence hashes are unique and structurally valid', () => { assert.equal(manifest.screenshots.length, 12); assert.equal(new Set(manifest.screenshots.map((entry) => entry.pngSha256)).size, 12); for (const entry of manifest.screenshots) assert.match(entry.pngSha256, /^[a-f0-9]{64}$/); });
await check('Manifest hash fields are present', () => { for (const entry of manifest.screenshots) assert.match(entry.pngSha256, /^[a-f0-9]{64}$/); });
await check('temporary evidence cannot overwrite static output', () => assert.match(verifierSource, /temporaryEvidenceRoot/) && assert.match(verifierSource, /staticBrowserOutputPath/));
await check('npm test includes the A.2.4 suite', () => assert.match(packageJson.scripts.test, /stage8-2E-A-2-4-test\.mjs/));
await check('extra experiment manifest remains populated', () => assert.ok(fs.existsSync(path.join(root, 'tests/verification-test-manifest.mjs'))));
await check('Fixture check and cross-process scripts remain wired', () => { assert.ok(fs.existsSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixture-generator.mjs'))); assert.ok(fs.existsSync(path.join(root, 'experiments/battle-sandbox/report-adapter/cross-process-determinism.mjs'))); });
await check('SAVE_VERSION remains seven', () => assert.match(fs.readFileSync(path.join(root, 'js/config.js'), 'utf8'), /SAVE_VERSION\s*=\s*7/));
await check('protected game surfaces are not referenced for mutation', () => assert.doesNotMatch(fs.readFileSync(path.join(root, 'tests/build-stage8-2E-A-2-3-delivery-package.mjs'), 'utf8'), /writeFileSync\([^\n]*(?:js|css|index\.html)/));
await check('runner does not add generic product-test retries', () => assert.doesNotMatch(runnerSource, /retry|retries|retryCount/i));
await check('all A.2.4 JavaScript passes syntax', () => ['tests/verification-runner.mjs', 'tests/fixtures/verifier-timeout-output-worker.mjs', 'tests/fixtures/verifier-ready-worker.mjs', 'tests/stage8-2E-A-2-4-test.mjs', 'tests/verify-stage8-2E-A-2-4-delivery-package.mjs', 'tests/build-stage8-2E-A-2-4-delivery-package.mjs'].forEach((file) => spawnSync(process.execPath, ['--check', file], { cwd: root, stdio: 'pipe' }).status === 0 || assert.fail(`${file} syntax failed`)));

console.log(`stage8-2E-A-2-4-test: ${passed} passed / ${passed} total`);
