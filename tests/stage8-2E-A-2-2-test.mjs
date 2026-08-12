import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  cleanupVerificationRunner,
  collectTestSummary,
  createVerificationRunner,
  registerVerificationChild,
  registerVerificationServer,
  runVerificationStage
} from './verification-runner.mjs';
import { createIsolatedTempRoot, assertIsolatedTempRootClean } from './browser/isolated-temp-root.mjs';
import { runActualGlobalTimeoutFixture } from './fixtures/global-timeout-fixture.mjs';
import { EXTRA_NODE_TESTS, NPM_TEST, SERVER_REQUIRED_TESTS } from './verification-test-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const timeoutWorker = path.join(root, 'tests/fixtures/verifier-timeout-output-worker.mjs');
const readyWorker = path.join(root, 'tests/fixtures/verifier-ready-worker.mjs');
let passed = 0;
const check = async (name, fn) => { await fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${name}`); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, timeoutMs = 2000, intervalMs = 10) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(intervalMs);
  }
  return Boolean(predicate());
};
const isClosed = (port) => new Promise((resolve) => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  socket.once('connect', () => { socket.destroy(); resolve(false); });
  socket.once('error', () => resolve(true));
});
let actualTimeoutObservation;

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.2E-A.2.2 验证运行器测试');
console.log('════════════════════════════════════════════');

await check('global watchdog never calls bare process.exit', () => {
  const source = fs.readFileSync(path.join(root, 'tests/verification-runner.mjs'), 'utf8');
  assert.doesNotMatch(source, /process\.exit\s*\(/);
});
await check('timeout sets global abort reason', async () => {
  const runner = createVerificationRunner({ globalTimeoutMs: 60000 });
  runner.aborted = true; runner.abortReason = 'global_verification_timeout';
  assert.equal(runner.abortReason, 'global_verification_timeout');
  await cleanupVerificationRunner(runner);
});
await check('runner exposes current stage', () => assert.ok(Object.hasOwn(createVerificationRunner({ globalTimeoutMs: 60000 }), 'currentStage')));
await check('runner tracks active children', () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1000)']); registerVerificationChild(runner, child); assert.equal(runner.activeChildren.size, 1); child.kill(); return cleanupVerificationRunner(runner); });
await check('runner tracks active servers', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); const server = net.createServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); registerVerificationServer(runner, 'unit-server', { terminate: () => new Promise((resolve) => server.close(resolve)) }); assert.equal(runner.activeServers.size, 1); await cleanupVerificationRunner(runner); assert.equal(await isClosed(server.address()?.port || 0), true); });
await check('isolated root is stored on runner', async () => { const isolated = createIsolatedTempRoot('iron-command-a22-runner-'); const runner = createVerificationRunner({ isolatedRoot: isolated, globalTimeoutMs: 60000 }); assert.equal(runner.isolatedRoot, isolated); await cleanupVerificationRunner(runner); assert.equal(assertIsolatedTempRootClean(isolated), true); });
await check('extracted root is stored on runner', async () => { const extracted = createIsolatedTempRoot('iron-command-a22-extracted-'); const runner = createVerificationRunner({ extractedRoot: extracted, globalTimeoutMs: 60000 }); assert.equal(runner.extractedRoot, extracted); await cleanupVerificationRunner(runner); });
await check('default global timeout is 900 seconds', async () => { const oldTimeout = process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; const oldDelay = process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS; delete process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; delete process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS; try { const runner = createVerificationRunner(); assert.equal(runner.globalTimeoutMs, 900000); await cleanupVerificationRunner(runner); } finally { if (oldTimeout === undefined) delete process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; else process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS = oldTimeout; if (oldDelay === undefined) delete process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS; else process.env.IRON_COMMAND_VERIFY_STAGE_DELAY_MS = oldDelay; } });
await check('environment overrides global timeout', async () => { const old = process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS = '60000'; try { const runner = createVerificationRunner(); assert.equal(runner.globalTimeoutMs, 60000); await cleanupVerificationRunner(runner); } finally { if (old === undefined) delete process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; else process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS = old; } });
await check('invalid timeout falls back to default', async () => { const old = process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS = 'invalid'; try { const runner = createVerificationRunner(); assert.equal(runner.globalTimeoutMs, 900000); await cleanupVerificationRunner(runner); } finally { if (old === undefined) delete process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS; else process.env.IRON_COMMAND_VERIFY_TIMEOUT_MS = old; } });
await check('global timeout maximum is enforced', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 1800001 }); assert.equal(runner.globalTimeoutMs, 900000); await cleanupVerificationRunner(runner); });
await check('npm stage default is 300 seconds', async () => { const runner = createVerificationRunner(); assert.equal(runner.stageTimeouts.npm, 300000); await cleanupVerificationRunner(runner); });
await check('ordinary stage default is 120 seconds', async () => { const runner = createVerificationRunner(); assert.equal(runner.stageTimeouts.node, 120000); await cleanupVerificationRunner(runner); });
await check('cross-process stage default is 180 seconds', async () => { const runner = createVerificationRunner(); assert.equal(runner.stageTimeouts.crossProcess, 180000); await cleanupVerificationRunner(runner); });
await check('browser stage default is 120 seconds', async () => { const runner = createVerificationRunner(); assert.equal(runner.stageTimeouts.browser, 120000); await cleanupVerificationRunner(runner); });
await check('server close default is 3 seconds', async () => { const runner = createVerificationRunner(); assert.equal(runner.stageTimeouts.serverClose, 3000); await cleanupVerificationRunner(runner); });
await check('stage delay configuration is read', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000, stageDelayMs: 25 }); const started = Date.now(); await runVerificationStage(runner, { name: 'delayed fake stage', run: async () => undefined }); assert.ok(Date.now() - started >= 20); await cleanupVerificationRunner(runner); });
await check('successful stage records result', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); await runVerificationStage(runner, { name: 'successful fake stage', run: async () => ({ code: 0 }) }); assert.equal(runner.stageResults[0].status, 'passed'); await cleanupVerificationRunner(runner); });
await check('failed stage records result', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); await assert.rejects(() => runVerificationStage(runner, { name: 'failed fake stage', run: async () => { throw new Error('expected failure'); } })); assert.equal(runner.stageResults[0].status, 'failed'); await cleanupVerificationRunner(runner); });
await check('stage log includes START and PASS', async () => { const lines = []; const logger = { log: (line) => lines.push(line), error: () => {} }; const runner = createVerificationRunner({ globalTimeoutMs: 60000, logger }); await runVerificationStage(runner, { name: 'logged stage', run: async () => undefined }); assert.ok(lines.some((line) => line === 'START logged stage')); assert.ok(lines.some((line) => line.startsWith('PASS logged stage'))); await cleanupVerificationRunner(runner); });
await check('heartbeat includes stage and remaining', async () => { const lines = []; const logger = { log: (line) => lines.push(line), error: () => {} }; const runner = createVerificationRunner({ globalTimeoutMs: 60000, heartbeatMs: 5, logger }); await runVerificationStage(runner, { name: 'heartbeat stage', run: async () => wait(15) }); assert.ok(lines.some((line) => String(line).includes('HEARTBEAT'))); assert.ok(lines.some((line) => String(line).includes('stage=heartbeat stage'))); await cleanupVerificationRunner(runner); });
await check('test summary reads actual totals', () => assert.deepEqual(collectTestSummary('stage8-2E-A-2-test: 72 passed / 72 total\nstage8-2E-A-2-1-test: 37 passed / 37 total'), { 'stage8-2E-A-2-test': { passed: 72, total: 72 }, 'stage8-2E-A-2-1-test': { passed: 37, total: 37 } }));
await check('test summary includes A.2.2 actual total', () => assert.deepEqual(collectTestSummary('stage8-2E-A-2-2-test: 50 passed / 50 total'), { 'stage8-2E-A-2-2-test': { passed: 50, total: 50 } }));
await check('manifest has explicit npm command', () => assert.deepEqual(NPM_TEST.args, ['test']));
await check('manifest has twelve extra node tests', () => assert.equal(EXTRA_NODE_TESTS.length, 12));
await check('manifest has one server test', () => assert.equal(SERVER_REQUIRED_TESTS.length, 1));
await check('server manifest is integrity only', () => assert.equal(SERVER_REQUIRED_TESTS[0].file, 'sandbox-report-adapter-integrity-test.mjs'));
await check('formal integration is not duplicated', () => assert.equal(EXTRA_NODE_TESTS.some((test) => test.file.includes('formal-contract-presentation-integration')), false));
await check('sidecar hardening is not duplicated', () => assert.equal(EXTRA_NODE_TESTS.some((test) => test.file.includes('formal-sidecar-runtime-hardening')), false));
await check('manifest does not use directory scanning', () => { const source = fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-2-delivery-package.mjs'), 'utf8'); assert.doesNotMatch(source, /readdirSync\([^)]*battle-sandbox/); });
await check('every manifest test has one file', () => assert.equal(new Set([...EXTRA_NODE_TESTS, ...SERVER_REQUIRED_TESTS].map((test) => test.file)).size, EXTRA_NODE_TESTS.length + SERVER_REQUIRED_TESTS.length));
await check('command stage succeeds', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); const result = await runVerificationStage(runner, { name: 'echo stage', command: process.execPath, args: ['-e', 'process.stdout.write("ok")'], timeoutMs: 1000 }); assert.equal(result.code, 0); assert.equal(result.stdout, 'ok'); await cleanupVerificationRunner(runner); });
await check('command stage tracks child pid after registration', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); const promise = runVerificationStage(runner, { name: 'pid stage', command: process.execPath, args: [readyWorker, '300', 'stdout', '1000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 2000, timeoutMs: 1500 }); const seen = await waitFor(() => runner.activeChildren.size >= 1, 2000); await promise; assert.equal(seen, true); await cleanupVerificationRunner(runner); });
await check('command timeout waits for process exit', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); await assert.rejects(() => runVerificationStage(runner, { name: 'timeout stage', command: process.execPath, args: [timeoutWorker, 'none', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1500 }), /timeout after 1500ms/); assert.equal(runner.activeChildren.size, 0); await cleanupVerificationRunner(runner); });
await check('command timeout includes stdout', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); await assert.rejects(() => runVerificationStage(runner, { name: 'stdout timeout', command: process.execPath, args: [timeoutWorker, 'stdout', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1500 }), /stdout-marker/); await cleanupVerificationRunner(runner); });
await check('command timeout includes stderr', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); await assert.rejects(() => runVerificationStage(runner, { name: 'stderr timeout', command: process.execPath, args: [timeoutWorker, 'stderr', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1500 }), /stderr-marker/); await cleanupVerificationRunner(runner); });
await check('command timeout includes pid', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); await assert.rejects(() => runVerificationStage(runner, { name: 'pid timeout', command: process.execPath, args: [timeoutWorker, 'none', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1500 }), /pid=\d+/); await cleanupVerificationRunner(runner); });
await check('command timeout reports SIGKILL field', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); await assert.rejects(() => runVerificationStage(runner, { name: 'kill timeout', command: process.execPath, args: [timeoutWorker, 'none', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1500 }), /killedBySigkill=(true|false)/); await cleanupVerificationRunner(runner); });
await check('timeout leaves no active child', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000 }); await assert.rejects(() => runVerificationStage(runner, { name: 'cleanup child', command: process.execPath, args: [timeoutWorker, 'none', '10000'], readyPattern: /worker-ready/, startTimeoutAfterReady: true, startupTimeoutMs: 3000, timeoutMs: 1500 })); assert.equal(runner.activeChildren.size, 0); await cleanupVerificationRunner(runner); });
await check('normal cleanup is idempotent', async () => { const isolated = createIsolatedTempRoot('iron-command-a22-idempotent-'); const runner = createVerificationRunner({ isolatedRoot: isolated, globalTimeoutMs: 60000 }); await cleanupVerificationRunner(runner); await cleanupVerificationRunner(runner); assert.equal(assertIsolatedTempRootClean(isolated), true); });
await check('abort stops active child', async () => { const isolated = createIsolatedTempRoot('iron-command-a22-abort-child-'); const runner = createVerificationRunner({ isolatedRoot: isolated, globalTimeoutMs: 60000 }); const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)']); registerVerificationChild(runner, child); await cleanupVerificationRunner(runner); assert.equal(runner.activeChildren.size, 0); assert.equal(child.exitCode !== null || child.signalCode !== null, true); });
await check('abort stops active server', async () => { const isolated = createIsolatedTempRoot('iron-command-a22-abort-server-'); const runner = createVerificationRunner({ isolatedRoot: isolated, globalTimeoutMs: 60000 }); const server = net.createServer(); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; registerVerificationServer(runner, 'abort-server', { terminate: () => new Promise((resolve) => server.close(resolve)) }); await cleanupVerificationRunner(runner); assert.equal(await isClosed(port), true); });
await check('slow environment fake flow completes', async () => { const runner = createVerificationRunner({ globalTimeoutMs: 60000, stageDelayMs: 25 }); await runVerificationStage(runner, { name: 'slow fake one', run: async () => undefined }); await runVerificationStage(runner, { name: 'slow fake two', run: async () => undefined }); assert.equal(runner.aborted, false); await cleanupVerificationRunner(runner); });
await check('forced global timeout is bounded', async () => { const started = Date.now(); actualTimeoutObservation = await runActualGlobalTimeoutFixture(); assert.ok(Date.now() - started < 10000); assert.equal(actualTimeoutObservation.abortReason, 'global_verification_timeout'); });
await check('global timeout empties active children', () => assert.equal(actualTimeoutObservation.activeChildren, 0));
await check('global timeout empties active servers', () => assert.equal(actualTimeoutObservation.activeServers, 0));
await check('global timeout leaves port released', () => assert.equal(actualTimeoutObservation.portClosed, true));
await check('global timeout removes extracted root', () => assert.equal(actualTimeoutObservation.extractedRootExists, false));
await check('global timeout removes isolated root', () => assert.equal(actualTimeoutObservation.isolatedRootExists, false));
await check('global timeout uses exit code 124', () => assert.equal(actualTimeoutObservation.exitCode, 124));
await check('global timeout records current stage', () => assert.equal(actualTimeoutObservation.timedOutStage, 'actual-global-timeout-stage'));
await check('new verifier command is exported', () => assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /verify:stage8-2E-A-2-2/));
await check('new builder command is exported', () => assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /build:stage8-2E-A-2-2/));
await check('A.2.2 verifier has no directory scan', () => assert.doesNotMatch(fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-2-delivery-package.mjs'), 'utf8'), /readdirSync/));
await check('A.2.2 verifier starts server after pure stages', () => { const source = fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-2-delivery-package.mjs'), 'utf8'); assert.ok(source.indexOf('Fixture --check') < source.lastIndexOf('launchManagedVerifierProcess')); });
await check('A.2.2 verifier closes server before browser', () => { const source = fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-2-delivery-package.mjs'), 'utf8'); assert.ok(source.indexOf('server close and port release') < source.indexOf("name: 'browser evidence'")); });
await check('A.2.2 output records global timeout', () => assert.match(fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-2-delivery-package.mjs'), 'utf8'), /globalTimeoutMs=/));
await check('SAVE_VERSION is incremented to nine', () => assert.match(fs.readFileSync(path.join(root, 'js/config.js'), 'utf8'), /SAVE_VERSION\s*=\s*9/));
await check('formal source remains outside verifier imports', () => assert.doesNotMatch(fs.readFileSync(path.join(root, 'tests/verify-stage8-2E-A-2-2-delivery-package.mjs'), 'utf8'), /from ['"].*js\/battle\.js/));
await check('all A.2.2 source passes syntax', () => ['tests/verification-runner.mjs', 'tests/verification-test-manifest.mjs', 'tests/stage8-2E-A-2-2-test.mjs', 'tests/verify-stage8-2E-A-2-2-delivery-package.mjs'].forEach((file) => assert.doesNotThrow(() => requireSyntax(file))));
await check('A.2.1 test remains wired', () => assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /stage8-2E-A-2-1-test\.mjs/));
await check('A.2 test remains wired', () => assert.match(fs.readFileSync(path.join(root, 'package.json'), 'utf8'), /stage8-2E-A-2-test\.mjs/));

function requireSyntax(file) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

console.log(`stage8-2E-A-2-2-test: ${passed} passed / ${passed} total`);
