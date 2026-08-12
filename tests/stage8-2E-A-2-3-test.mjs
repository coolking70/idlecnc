import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildChildTestEnv,
  cleanupVerificationRunner,
  createVerificationRunner,
  runVerificationStage
} from './verification-runner.mjs';
import { runActualGlobalTimeoutFixture } from './fixtures/global-timeout-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerSource = fs.readFileSync(path.join(root, 'tests/verification-runner.mjs'), 'utf8');
const verifierSource = fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-2-delivery-package.mjs'), 'utf8');
const browserSource = fs.readFileSync(path.join(root, 'tests/browser/formal-battle-evidence.mjs'), 'utf8');
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${name}`); };
const worker = path.join(root, 'tests/fixtures/global-timeout-worker.mjs');

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.2E-A.2.3 收口测试');
console.log('════════════════════════════════════════════');

await check('child environment helper is exported', () => assert.match(runnerSource, /export function buildChildTestEnv/));
await check('child environment removes outer timeout', () => { const env = buildChildTestEnv({ KEEP_ME: 'yes', IRON_COMMAND_VERIFY_TIMEOUT_MS: '60000' }); assert.equal(env.IRON_COMMAND_VERIFY_TIMEOUT_MS, undefined); assert.equal(env.KEEP_ME, 'yes'); });
await check('child environment removes stage delay', () => { const env = buildChildTestEnv({ IRON_COMMAND_VERIFY_STAGE_DELAY_MS: '5' }); assert.equal(env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS, undefined); });
await check('child environment does not remove ordinary variables', () => { const env = buildChildTestEnv({ PATH: '/bin', NODE_ENV: 'test', CUSTOM_MARKER: 'kept' }); assert.deepEqual(env, { PATH: '/bin', NODE_ENV: 'test', CUSTOM_MARKER: 'kept' }); });
await check('outer runner reads a 60 second override', async () => { const old = process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS = '60000'; try { const runner = createVerificationRunner(); assert.equal(runner.globalTimeoutMs, 60000); await cleanupVerificationRunner(runner); } finally { if (old === undefined) delete process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; else process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS = old; } });
await check('default timeout test is environment independent', async () => { const oldTimeout = process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; const oldDelay = process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS; delete process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; delete process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS; try { const runner = createVerificationRunner(); assert.equal(runner.globalTimeoutMs, 900000); assert.equal(runner.stageDelayMs, 0); await cleanupVerificationRunner(runner); } finally { if (oldTimeout === undefined) delete process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; else process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS = oldTimeout; if (oldDelay === undefined) delete process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS; else process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS = oldDelay; } });
await check('stage delay is not inherited by child tests', async () => { const old = process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS; process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS = '250'; try { const env = buildChildTestEnv(process.env); assert.equal(env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS, undefined); } finally { if (old === undefined) delete process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS; else process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS = old; } });
await check('real global timeout fixture records the correct reason', async () => { const observation = await runActualGlobalTimeoutFixture(); assert.equal(observation.abortReason, 'global_verification_timeout'); });
const observation = await runActualGlobalTimeoutFixture();
console.log(`actualGlobalTimeoutObservation=${JSON.stringify(observation)}`);
await check('real global timeout records the active stage', () => assert.equal(observation.timedOutStage, 'actual-global-timeout-stage'));
await check('real timeout leaves no child records', () => assert.equal(observation.activeChildren, 0));
await check('real timeout leaves no server records', () => assert.equal(observation.activeServers, 0));
await check('real external child exited', () => assert.equal(observation.externalExited, true));
await check('real stage child was rejected or terminated', () => assert.equal(observation.stageResult.status, 'rejected'));
await check('real timeout released the TCP port', () => assert.equal(observation.portClosed, true));
await check('real timeout removed the isolated root', () => assert.equal(observation.isolatedRootExists, false));
await check('real timeout removed the extracted root', () => assert.equal(observation.extractedRootExists, false));
await check('real timeout sets exit code 124', () => assert.equal(observation.exitCode, 124));
await check('fixture restores parent exit code', () => assert.equal(process.exitCode, undefined));
await check('cleanup completion is observed', () => assert.equal(observation.cleanupDone, true));
await check('global timeout cleanup is not a placeholder', () => assert.doesNotMatch(fs.readFileSync(path.join(root, 'tests/stage8-2E-A-2-2-test.mjs'), 'utf8'), /assert\.equal\(true, true\)/));
await check('fixture worker is a real long-running child', () => assert.match(fs.readFileSync(worker, 'utf8'), /setTimeout/));

async function runStageTimeoutRace(globalTimeoutMs, stageTimeoutMs) {
  const runner = createVerificationRunner({ globalTimeoutMs, stageTimeouts: { node: stageTimeoutMs }, heartbeatMs: 0 });
  const started = Date.now();
  const result = await Promise.allSettled([runVerificationStage(runner, { name: 'race-stage', command: process.execPath, args: [worker, 'race', '10000'], timeoutMs: stageTimeoutMs })]);
  await cleanupVerificationRunner(runner);
  return { runner, result: result[0], durationMs: Date.now() - started };
}

const globalFirst = observation;
const stageFirst = await runStageTimeoutRace(1600, 1500);
await check('global timeout can win before a stage timeout', () => assert.equal(globalFirst.abortReason, 'global_verification_timeout'));
await check('stage timeout can win before global timeout', () => assert.equal(stageFirst.runner.abortReason, 'stage_timeout'));
await check('stage-first race is bounded', () => assert.ok(stageFirst.durationMs < 5000));
await check('stage-first race has one rejected primary result', () => assert.equal(stageFirst.result.status, 'rejected'));
await check('stage-first race leaves no children', () => assert.equal(stageFirst.runner.activeChildren.size, 0));
await check('global and stage race cleanup is idempotent', async () => { await cleanupVerificationRunner(stageFirst.runner); assert.equal(stageFirst.runner.cleanupDone, true); });
await check('pure Promise stage is globally abortable', async () => { const oldExit = process.exitCode; try { const runner = createVerificationRunner({ globalTimeoutMs: 100, stageTimeouts: { node: 1000 }, heartbeatMs: 0 }); const started = Date.now(); const result = await Promise.allSettled([runVerificationStage(runner, { name: 'pure-promise-stage', run: () => new Promise(() => {}) })]); while (!runner.timeoutCleanupPromise) await new Promise((resolve) => setTimeout(resolve, 5)); await runner.timeoutCleanupPromise; assert.equal(result[0].status, 'rejected'); assert.equal(runner.abortReason, 'global_verification_timeout'); assert.ok(Date.now() - started < 2000); } finally { process.exitCode = oldExit; } });
await check('runner exposes an abort signal', () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); assert.equal(runner.abortSignal.aborted, false); return cleanupVerificationRunner(runner); });
await check('runner has one cleanup promise per timeout', () => assert.match(runnerSource, /timeoutCleanupPromise/));
await check('browser evidence creates a run id', () => assert.match(browserSource, /randomUUID\(\)|evidenceRunId/));
await check('browser manifest writes the run id', () => assert.match(browserSource, /evidenceRunId, generatedBy/));
await check('browser output writes the run id', () => assert.match(browserSource, /ok: true, evidenceRunId/));
await check('verifier reads static browser output', () => assert.match(verifierSource, /staticBrowserOutputPath/));
await check('verifier uses an isolated temporary evidence directory', () => assert.match(verifierSource, /temporaryEvidenceRoot/));
await check('verifier compares static and temporary run ids', () => assert.match(verifierSource, /notEqual\(staticManifest\.evidenceRunId/));
await check('verifier compares victory report references', () => assert.match(verifierSource, /victoryReportId/));
await check('verifier compares withdraw battle references', () => assert.match(verifierSource, /withdrawBattleId/));
await check('verifier supports a slim test manifest', () => assert.match(verifierSource, /IRON_COMMAND_VERIFY_TEST_MANIFEST/));
await check('verifier retains browser diagnostic cause codes', () => assert.match(runnerSource, /causeCode/));
await check('browser failure output is machine-readable', () => assert.match(browserSource, /ok: false, code/));
await check('policy diagnostic code remains structured', () => assert.match(fs.readFileSync(path.join(root, 'tests/fixtures/stage8-2E-A-2-2-policy-block-output.txt'), 'utf8'), /navigation_blocked_by_policy/));
await check('12-file evidence contract remains declared', () => assert.equal((fs.readFileSync(path.join(root, 'tests/browser/formal-battle-evidence-config.js'), 'utf8').match(/\.png'/g) || []).length, 12));
await check('A.2.3 package command is declared', () => assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /stage8-2E-A-2-3/));
await check('A.2.3 builder is wired', () => assert.ok(fs.existsSync(path.join(root, 'tests/build-stage8-2E-A-2-3-delivery-package.mjs'))));
await check('A.2.3 verifier is wired', () => assert.ok(fs.existsSync(path.join(root, 'tests/verify-stage8-2E-A-2-3-delivery-package.mjs'))));
await check('fixture check is present', () => assert.ok(fs.existsSync(worker)));
await check('all new JS passes syntax', () => ['tests/verification-runner.mjs', 'tests/fixtures/global-timeout-worker.mjs', 'tests/fixtures/global-timeout-fixture.mjs', 'tests/stage8-2E-A-2-3-test.mjs', 'tests/verify-stage8-2E-A-2-3-delivery-package.mjs', 'tests/build-stage8-2E-A-2-3-delivery-package.mjs'].forEach((file) => execFileSync(process.execPath, ['--check', file])));
await check('formal game source is not imported by verifier', () => assert.doesNotMatch(verifierSource, /from ['"].*js\/battle\.js/));
await check('SAVE_VERSION is incremented to nine', () => assert.match(fs.readFileSync(path.join(root, 'js/config.js'), 'utf8'), /SAVE_VERSION\s*=\s*9/));
await check('runner does not call bare process.exit', () => assert.doesNotMatch(runnerSource, /process\.exit\s*\(/));
await check('npm test remains wired', () => assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /stage8-2E-A-2-2-test\.mjs/));

console.log(`stage8-2E-A-2-3-test: ${passed} passed / ${passed} total`);
