import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  cleanupVerificationRunner,
  createVerificationRunner,
  registerVerificationChild,
  registerVerificationServer,
  runVerificationStage
} from '../verification-runner.mjs';
import { assertIsolatedTempRootClean, createIsolatedTempRoot } from '../browser/isolated-temp-root.mjs';

const fixtureWorker = path.join(path.dirname(fileURLToPath(import.meta.url)), 'global-timeout-worker.mjs');

function waitForPortClosed(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (value) => { socket.destroy(); resolve(value); };
    socket.once('connect', () => finish(false));
    socket.once('error', () => finish(true));
  });
}

export async function runActualGlobalTimeoutFixture({ globalTimeoutMs = 1500, stageTimeoutMs = 1600 } = {}) {
  const isolatedRoot = createIsolatedTempRoot('iron-command-a23-global-timeout-');
  const extractedRoot = path.join(isolatedRoot, 'extracted', 'fake-project');
  fs.mkdirSync(extractedRoot, { recursive: true });
  const runner = createVerificationRunner({
    globalTimeoutMs,
    stageTimeouts: { node: stageTimeoutMs },
    isolatedRoot,
    extractedRoot,
    heartbeatMs: 0,
    logger: { log() {}, error() {} }
  });
  const server = net.createServer();
  let serverPort = null;
  let externalChild = null;
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverPort = server.address().port;
    registerVerificationServer(runner, 'actual-timeout-server', { terminate: () => new Promise((resolve) => server.close(resolve)) });
    externalChild = spawn(process.execPath, [fixtureWorker, 'external-child', '10000'], { stdio: 'ignore' });
    registerVerificationChild(runner, externalChild, { stage: 'actual external child' });
    const stagePromise = runVerificationStage(runner, {
      name: 'actual-global-timeout-stage',
      command: process.execPath,
      args: [fixtureWorker, 'stage-child', '10000'],
      timeoutMs: stageTimeoutMs,
      kind: 'node'
    });
    const stageResult = await Promise.allSettled([stagePromise]);
    while (!runner.timeoutCleanupPromise) await new Promise((resolve) => setTimeout(resolve, 5));
    await runner.timeoutCleanupPromise;
    const externalExited = externalChild.exitCode !== null || externalChild.signalCode !== null;
    return {
      abortReason: runner.abortReason,
      timedOutStage: runner.timedOutStage,
      activeChildren: runner.activeChildren.size,
      activeServers: runner.activeServers.size,
      externalExited,
      externalExitCode: externalChild.exitCode,
      externalSignalCode: externalChild.signalCode,
      stageResult: stageResult[0],
      portClosed: await waitForPortClosed(serverPort),
      isolatedRootExists: fs.existsSync(isolatedRoot),
      extractedRootExists: fs.existsSync(extractedRoot),
      exitCode: process.exitCode,
      cleanupDone: runner.cleanupDone
    };
  } finally {
    if (externalChild && externalChild.exitCode === null && externalChild.signalCode === null) externalChild.kill('SIGKILL');
    await cleanupVerificationRunner(runner);
    process.exitCode = originalExitCode;
  }
}

export { waitForPortClosed };
