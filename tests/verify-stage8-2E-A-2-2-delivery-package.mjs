import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  abortVerification,
  cleanupVerificationRunner,
  collectTestSummary,
  createVerificationRunner,
  buildChildTestEnv,
  registerVerificationChild,
  registerVerificationServer,
  runVerificationStage,
  unregisterVerificationChild,
  unregisterVerificationServer
} from './verification-runner.mjs';
import { buildIsolatedTempEnv, createIsolatedTempRoot, assertIsolatedTempRootClean } from './browser/isolated-temp-root.mjs';
import { launchManagedVerifierProcess, terminateManagedVerifierProcess } from './managed-verifier-process.mjs';
import { EXTRA_NODE_TESTS, NPM_TEST, SERVER_REQUIRED_TESTS } from './verification-test-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ARCHIVE = path.join(root, 'iron-command-stage8-2E-A-2-2-verifier-final.zip');
const outputPrefix = process.env.IRON_COMMAND_VERIFY_OUTPUT_PREFIX || 'stage8-2E-A-2-2';
const deliveryFile = (name) => name.replace('stage8-2E-A-2-2', outputPrefix);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const required = [
  'tests/browser/chromium-resolver.mjs', 'tests/browser/managed-browser-process.mjs', 'tests/browser/formal-withdraw-evidence.mjs',
  'tests/browser/isolated-temp-root.mjs', 'tests/browser/browser-policy-diagnostics.mjs', 'tests/browser/formal-battle-evidence.mjs',
  'tests/managed-verifier-process.mjs', 'tests/verification-runner.mjs', 'tests/verification-test-manifest.mjs',
  'tests/stage8-2E-A-2-test.mjs', 'tests/stage8-2E-A-2-1-test.mjs', 'tests/stage8-2E-A-2-2-test.mjs',
  'tests/verify-stage8-2E-A-2-2-delivery-package.mjs', 'tests/build-stage8-2E-A-2-delivery-package.mjs',
  'tests/browser/formal-battle-evidence-config.js', 'screenshots/stage8-2E-A2-screenshot-manifest.json',
  deliveryFile('tests/outputs/stage8-2E-A-2-2-full-test-output.txt'), deliveryFile('tests/outputs/stage8-2E-A-2-2-browser-evidence-output.txt'),
  deliveryFile('STAGE8-2E-A-2-2-DELIVERY.md')
];
if (outputPrefix === 'stage8-2E-A-2-4') {
  required.push(
    'tests/stage8-2E-A-2-4-test.mjs',
    'tests/verify-stage8-2E-A-2-4-delivery-package.mjs',
    'tests/build-stage8-2E-A-2-4-delivery-package.mjs',
    'tests/fixtures/verifier-timeout-output-worker.mjs',
    'tests/fixtures/verifier-ready-worker.mjs',
    deliveryFile('tests/outputs/stage8-2E-A-2-4-full-test-output.txt'),
    deliveryFile('tests/outputs/stage8-2E-A-2-4-browser-evidence-output.txt'),
    deliveryFile('STAGE8-2E-A-2-4-DELIVERY.md')
  );
}

const portClosed = (port) => new Promise((resolve) => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const done = (value) => { socket.destroy(); resolve(value); };
  socket.once('connect', () => done(false));
  socket.once('error', () => done(true));
});

function formalBoundaryHash(projectRoot) {
  const boundary = JSON.parse(fs.readFileSync(path.join(projectRoot, 'tests/stage8-2E-A-1-boundary.json'), 'utf8'));
  const fileHash = (file) => {
    if (file !== 'package.json') return sha256(path.join(projectRoot, file));
    // package.json is an allowed delivery-tool surface. Hash its A.2.1 form so
    // the formal game/presentation boundary remains comparable after A.2.2
    // adds the new verifier commands and test entry.
    const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, file), 'utf8'));
    pkg.scripts.test = pkg.scripts.test.replace(/ && node tests\/stage8-2E-A-2-2-test\.mjs/, '');
    pkg.scripts.test = pkg.scripts.test.replace(/ && node tests\/stage8-2E-A-2-3-test\.mjs/, '');
    pkg.scripts.test = pkg.scripts.test.replace(/ && node tests\/stage8-2E-A-2-4-test\.mjs/, '');
    delete pkg.scripts['verify:stage8-2E-A-2-2'];
    delete pkg.scripts['build:stage8-2E-A-2-2'];
    delete pkg.scripts['verify:stage8-2E-A-2-3'];
    delete pkg.scripts['build:stage8-2E-A-2-3'];
    delete pkg.scripts['verify:stage8-2E-A-2-4'];
    delete pkg.scripts['build:stage8-2E-A-2-4'];
    return crypto.createHash('sha256').update(`${JSON.stringify(pkg, null, 2)}\n`).digest('hex');
  };
  return crypto.createHash('sha256').update(boundary.formalBoundaryFiles.slice().sort().map((file) => `${file}\0${fileHash(file)}\n`).join('')).digest('hex');
}

function writeOutput(name, content) {
  const file = path.join(root, 'tests/outputs', deliveryFile(name));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function printStageTable(runner) {
  console.log('\n阶段\t状态\t耗时\t退出码');
  for (const result of runner.stageResults) console.log(`${result.stage}\t${result.status}\t${(result.durationMs / 1000).toFixed(2)}s\t${result.exitCode}`);
}

async function runPackage(archive = DEFAULT_ARCHIVE) {
  const isolatedRoot = createIsolatedTempRoot('iron-command-verify-');
  const isolatedEnv = buildIsolatedTempEnv(isolatedRoot);
  const testGlobalTimeoutMs = Number(process.env.IRON_COMMAND_VERIFY_TEST_GLOBAL_TIMEOUT_MS);
  const runner = createVerificationRunner({ isolatedRoot, logger: console, ...(Number.isInteger(testGlobalTimeoutMs) && testGlobalTimeoutMs > 0 ? { globalTimeoutMs: testGlobalTimeoutMs } : {}) });
  const childEnv = buildChildTestEnv(isolatedEnv);
  let extracted = null;
  let server = null;
  let serverKey = null;
  let serverPort = null;
  const outputs = [];
  try {
    if (!fs.existsSync(archive)) throw new Error(`archive not found: ${archive}`);
    await runVerificationStage(runner, { name: 'ZIP structure check', command: 'unzip', args: ['-tq', archive], cwd: root, env: childEnv, timeoutMs: 120000, kind: 'node' });
    const listing = await runVerificationStage(runner, { name: 'ZIP listing check', command: 'unzip', args: ['-Z1', archive], cwd: root, env: childEnv, timeoutMs: 120000, kind: 'node' });
    const names = listing.stdout.split(/\r?\n/).filter(Boolean);
    assert.equal(names.some((entry) => entry.includes('..') || entry.includes('\\') || entry.endsWith('.zip') || entry.split('/').some((part) => part === '.git' || part === 'node_modules' || part === 'browser-profiles' || part === 'extracted')), false, 'unsafe archive entry');
    required.forEach((file) => assert.ok(names.includes(file), `missing ${file}`));

    extracted = fs.mkdtempSync(path.join(isolatedRoot, 'extracted', 'project-'));
    runner.extractedRoot = extracted;
    await runVerificationStage(runner, { name: 'extract archive', command: 'unzip', args: ['-q', archive, '-d', extracted], cwd: root, env: childEnv, timeoutMs: 120000, kind: 'node' });
    const boundary = JSON.parse(fs.readFileSync(path.join(extracted, 'tests/stage8-2E-A-1-boundary.json'), 'utf8'));
    const boundaryHash = formalBoundaryHash(extracted);
    assert.equal(boundaryHash, boundary.formalBoundaryHash, 'formal boundary hash mismatch');

    if (process.env.IRON_COMMAND_VERIFY_TEST_MANIFEST) {
      const slimManifest = JSON.parse(process.env.IRON_COMMAND_VERIFY_TEST_MANIFEST);
      assert.ok(Array.isArray(slimManifest) && slimManifest.length > 0, 'test manifest must contain stages');
      for (const testStage of slimManifest) {
        await runVerificationStage(runner, {
          ...testStage,
          cwd: testStage.cwd || extracted,
          env: childEnv
        });
      }
      return { runner, verification: 'test-manifest=passed', summary: {} };
    }

    const npmResult = await runVerificationStage(runner, { ...NPM_TEST, cwd: extracted, env: childEnv });
    outputs.push(npmResult.stdout + npmResult.stderr);
    writeOutput('stage8-2E-A-2-2-full-test-output.txt', outputs.join('\n'));

    for (const test of EXTRA_NODE_TESTS) {
      const result = await runVerificationStage(runner, {
        name: test.name,
        command: process.execPath,
        args: [path.join('experiments/battle-sandbox/tests', test.file)],
        cwd: extracted,
        env: childEnv,
        timeoutMs: test.timeoutMs,
        kind: 'node'
      });
      outputs.push(result.stdout + result.stderr);
    }

    await runVerificationStage(runner, {
      name: 'Fixture --check',
      command: process.execPath,
      args: ['experiments/battle-sandbox/report-adapter/fixture-generator.mjs', '--check'],
      cwd: extracted,
      env: childEnv,
      timeoutMs: 120000,
      kind: 'node'
    });
    await runVerificationStage(runner, {
      name: 'cross-process determinism',
      command: process.execPath,
      args: ['experiments/battle-sandbox/report-adapter/cross-process-determinism.mjs'],
      cwd: extracted,
      env: childEnv,
      timeoutMs: 180000,
      kind: 'crossProcess'
    });

    server = launchManagedVerifierProcess({ cwd: extracted, root: extracted, env: isolatedEnv });
    serverKey = registerVerificationServer(runner, `adapter-server-${server.child.pid}`, {
      terminate: () => terminateManagedVerifierProcess(server, { termTimeoutMs: 3000, killTimeoutMs: 1000 })
    });
    registerVerificationChild(runner, server.child, { stage: 'adapter server' });
    await server.ready;
    serverPort = server.port;
    const serverEnv = { ...childEnv, ADAPTER_BASE_URL: `http://127.0.0.1:${server.port}` };
    const integrity = SERVER_REQUIRED_TESTS[0];
    assert.equal(integrity.file, 'sandbox-report-adapter-integrity-test.mjs');
    const integrityResult = await runVerificationStage(runner, {
      name: integrity.name,
      command: process.execPath,
      args: [path.join('experiments/battle-sandbox/tests', integrity.file)],
      cwd: extracted,
      env: serverEnv,
      timeoutMs: integrity.timeoutMs,
      kind: 'node'
    });
    outputs.push(integrityResult.stdout + integrityResult.stderr);
    await runVerificationStage(runner, {
      name: 'HTTP route check',
      timeoutMs: 3000,
      kind: 'node',
      run: async () => {
        const response = await fetch(`${serverEnv.ADAPTER_BASE_URL}/package.json`);
        assert.equal(response.status, 200);
        assert.match(await response.text(), /iron-command/);
      }
    });
    const terminated = await runVerificationStage(runner, {
      name: 'server close and port release',
      timeoutMs: runner.stageTimeouts.serverClose,
      kind: 'serverClose',
      run: async () => {
        const result = await terminateManagedVerifierProcess(server, { termTimeoutMs: 1500, killTimeoutMs: 1000 });
        assert.equal(result.exited, true, 'server did not exit');
        assert.equal(await portClosed(serverPort), true, 'server port did not release');
        return result;
      }
    });
    unregisterVerificationChild(runner, server.child);
    unregisterVerificationServer(runner, serverKey);
    server = null;
    serverKey = null;
    outputs.push(JSON.stringify({ serverPort, serverClosed: terminated.exited, portReleased: true }));

    const staticManifestPath = path.join(extracted, 'screenshots/stage8-2E-A2-screenshot-manifest.json');
    const staticBrowserOutputPath = path.join(extracted, deliveryFile('tests/outputs/stage8-2E-A-2-2-browser-evidence-output.txt'));
    const staticManifest = JSON.parse(fs.readFileSync(staticManifestPath, 'utf8'));
    const staticBrowserOutput = fs.readFileSync(staticBrowserOutputPath, 'utf8');
    const temporaryEvidenceRoot = path.join(isolatedRoot, 'temporary-browser-evidence');
    fs.mkdirSync(temporaryEvidenceRoot, { recursive: true });
    const browserResult = await runVerificationStage(runner, process.env.IRON_COMMAND_VERIFY_SIMULATE_POLICY_BLOCK === '1'
      ? {
        name: 'browser evidence',
        timeoutMs: runner.stageTimeouts.browser,
        kind: 'browser',
        run: async () => {
          const error = new Error('navigation_blocked_by_policy: simulated browser policy block');
          error.code = 'navigation_blocked_by_policy';
          throw error;
        }
      }
      : {
        name: 'browser evidence',
        command: process.execPath,
        args: ['tests/browser/formal-battle-evidence.mjs'],
        cwd: extracted,
        env: { ...childEnv, IRON_COMMAND_EVIDENCE_DIR: path.join(temporaryEvidenceRoot, 'screenshots') },
        timeoutMs: runner.stageTimeouts.browser,
        kind: 'browser'
      });
    const browserOutput = browserResult.stdout + browserResult.stderr;
    outputs.push(browserOutput);

    const manifest = staticManifest;
    const temporaryManifest = JSON.parse(fs.readFileSync(path.join(temporaryEvidenceRoot, 'screenshots/stage8-2E-A2-screenshot-manifest.json'), 'utf8'));
    const parseEvidenceOutput = (value) => [...String(value).split(/\r?\n/)].reverse().map((line) => { try { return JSON.parse(line); } catch { return null; } }).find((payload) => payload?.ok === true || payload?.ok === false);
    const staticBrowserPayload = parseEvidenceOutput(staticBrowserOutput);
    const temporaryBrowserPayload = parseEvidenceOutput(browserOutput);
    assert.ok(staticBrowserPayload?.ok, 'static browser evidence output is not successful JSON');
    assert.ok(temporaryBrowserPayload?.ok, 'temporary browser evidence output is not successful JSON');
    assert.equal(staticManifest.evidenceRunId, staticBrowserPayload.evidenceRunId, 'static browser output/manifest evidenceRunId mismatch');
    assert.equal(temporaryManifest.evidenceRunId, temporaryBrowserPayload.evidenceRunId, 'temporary browser output/manifest evidenceRunId mismatch');
    assert.notEqual(staticManifest.evidenceRunId, temporaryManifest.evidenceRunId, 'temporary browser run reused static evidenceRunId');
    const semanticBattle = (data, result) => data.battles.find((battle) => battle.reportResult === result);
    for (const result of ['victory', 'withdraw']) {
      const staticBattle = semanticBattle(staticManifest, result);
      const temporaryBattle = semanticBattle(temporaryManifest, result);
      assert.ok(staticBattle && temporaryBattle, `${result} battle missing from evidence runs`);
      assert.equal(staticBattle.reportResult, temporaryBattle.reportResult);
      assert.equal(staticBattle.retreatEventCount, temporaryBattle.retreatEventCount);
      assert.equal(staticBattle.capture, temporaryBattle.capture);
      assert.deepEqual(staticBattle.rewards, temporaryBattle.rewards);
      const staticShots = manifest.screenshots.filter((entry) => entry.reportResult === result);
      const temporaryShots = temporaryManifest.screenshots.filter((entry) => entry.reportResult === result);
      assert.equal(staticShots.length, temporaryShots.length, `${result} screenshot semantics changed`);
      if (result === 'withdraw') assert.ok(staticShots.filter((entry) => entry.activeBattleAfterReturn !== false).every((entry) => entry.renderedMode === 'universal_battle'));
      else {
        assert.ok(staticShots.every((entry) => ['contract_road_victory', 'legacy'].includes(entry.renderedMode)));
        assert.ok(staticShots.some((entry) => entry.renderedMode === 'contract_road_victory'));
      }
    }
    assert.equal(manifest.screenshots.length, 12);
    assert.equal(new Set(manifest.screenshots.map((entry) => entry.pngSha256)).size, 12);
    assert.equal(manifest.battles.length, 2);
    const victory = manifest.battles.find((battle) => battle.reportResult === 'victory');
    const withdraw = manifest.battles.find((battle) => battle.reportResult === 'withdraw');
    assert.ok(victory && withdraw);
    assert.notEqual(victory.battleId, withdraw.battleId);
    assert.notEqual(victory.reportId, withdraw.reportId);
    assert.equal(withdraw.retreatEventCount, 1);
    assert.equal(withdraw.capture, false);
    assert.deepEqual(withdraw.rewards, {});
    assert.equal(manifest.errors.pageErrors.length, 0);
    assert.equal(manifest.errors.consoleErrors.length, 0);
    for (const entry of manifest.screenshots) {
      const file = path.join(extracted, 'screenshots', entry.file);
      assert.equal(sha256(file), entry.pngSha256, entry.file);
      assert.ok(entry.canvasSignature && entry.stateSignature && entry.reportFingerprint);
    }
    const summary = collectTestSummary(outputs);
    const staticVictory = semanticBattle(manifest, 'victory');
    const staticWithdraw = semanticBattle(manifest, 'withdraw');
    const verification = [
      `verify-${outputPrefix}-delivery-package: ok`,
      `boundary=${boundaryHash}`,
      `evidenceRunId=${manifest.evidenceRunId}`,
      'screenshots=12',
      `victory=${victory.reportId} victoryReportId=${victory.reportId} victoryBattleId=${staticVictory.battleId}`,
      `withdraw=${withdraw.reportId} withdrawReportId=${withdraw.reportId} withdrawBattleId=${staticWithdraw.battleId}`,
      'browser=cdp pageErrors=0 consoleErrors=0 server=clean',
      `globalTimeoutMs=${runner.globalTimeoutMs}`,
      `testSummary=${JSON.stringify(summary)}`
    ].join(' ');
    writeOutput('stage8-2E-A-2-2-verification-output.txt', `${verification}\n`);
    writeOutput('stage8-2E-A-2-2-process-cleanup-output.txt', JSON.stringify({ activeChildren: runner.activeChildren.size, activeServers: runner.activeServers.size, serverPort, portReleased: true, isolatedRoot: runner.isolatedRoot, staticEvidenceRunId: manifest.evidenceRunId, temporaryEvidenceRunId: temporaryManifest.evidenceRunId, temporaryEvidenceRoot: temporaryEvidenceRoot }, null, 2) + '\n');
    console.log(verification);
    return { runner, verification, summary };
  } catch (error) {
    if (runner.aborted) {
      error.abortReason = runner.abortReason;
      error.timedOutStage = runner.timedOutStage || runner.currentStage;
    }
    throw error;
  } finally {
    if (server) {
      await terminateManagedVerifierProcess(server, { termTimeoutMs: 1500, killTimeoutMs: 1000 }).catch(() => {});
      if (serverKey) unregisterVerificationServer(runner, serverKey);
      unregisterVerificationChild(runner, server.child);
    }
    printStageTable(runner);
    await cleanupVerificationRunner(runner);
    assert.equal(assertIsolatedTempRootClean(isolatedRoot), true, 'isolated verifier temp root remains');
  }
}

export { runPackage };

const archive = path.resolve(process.argv[2] || DEFAULT_ARCHIVE);
runPackage(archive).catch((error) => {
  console.error(error.stack || error);
  if (/navigation_blocked_by_policy/.test(error.message || '') || error.code === 'navigation_blocked_by_policy') writeOutput('stage8-2E-A-2-2-policy-block-output.txt', `exitCode=1 code=navigation_blocked_by_policy\n${error.stack || error}\n`);
  if (error.abortReason === 'global_verification_timeout' || error.code === 'verification_stage_timeout') writeOutput('stage8-2E-A-2-2-timeout-cleanup-output.txt', `${error.stack || error}\ncurrentStage=${error.timedOutStage || 'unknown'}\n`);
  process.exitCode = error.abortReason === 'global_verification_timeout' ? 124 : 1;
});
