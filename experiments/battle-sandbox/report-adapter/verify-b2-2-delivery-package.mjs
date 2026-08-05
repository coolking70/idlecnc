import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { processExists, recentStderr, spawnManagedProcess, terminateProcessTree } from './process-tree-manager.mjs';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(here, '../../..');
const archive = path.resolve(process.argv[2] || 'iron-command-stage8-2D-B-2-2-complete.zip');
const expectedFormalHash = '2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab';
const REQUIRED_PATHS = [
  'index.html', 'package.json', 'css/style.css', 'scripts/serve.mjs', 'js/main.js', 'js/config.js', 'js/state.js', 'js/economy.js', 'js/events.js', 'js/battle.js', 'js/battle-targeting.js', 'js/battle-outcome.js', 'js/integrity.js', 'js/theater.js',
  'experiments/battle-sandbox/index.html', 'experiments/battle-sandbox/sandbox.js', 'experiments/battle-sandbox/sandbox-director.js', 'experiments/battle-sandbox/sandbox-renderer.js', 'experiments/battle-sandbox/sandbox-pulse-scheduler.js', 'experiments/battle-sandbox/sandbox-damage-model.js', 'experiments/battle-sandbox/sandbox-objective-director.js',
  'experiments/battle-sandbox/contract-demo/index.html', 'experiments/battle-sandbox/contract-demo/route-deconflictor.js', 'experiments/battle-sandbox/contract-demo/continuous-layout-validator.js', 'experiments/battle-sandbox/contract-demo/screenshots/capture-manifest.json',
  'experiments/battle-sandbox/report-adapter/fixture-manifest.json', 'experiments/battle-sandbox/report-adapter/process-tree-manager.mjs', 'experiments/battle-sandbox/report-adapter/verify-b2-2-delivery-package.mjs', 'experiments/battle-sandbox/report-adapter/build-b2-2-delivery-package.mjs',
  'experiments/battle-sandbox/tests/contract-route-deconfliction-test.mjs', 'experiments/battle-sandbox/tests/delivery-verifier-process-test.mjs', 'STAGE8-2D-B-2-2-DELIVERY.md', 'progress.md'
];
const SANDBOX_TESTS = [
  'sandbox-opening-test.mjs', 'sandbox-opening-patch-test.mjs', 'sandbox-damage-repair-test.mjs', 'sandbox-breakthrough-capture-test.mjs', 'sandbox-integration-readiness-test.mjs', 'sandbox-report-adapter-test.mjs',
  'contract-driven-victory-demo-test.mjs', 'contract-demo-visual-integrity-test.mjs', 'contract-victory-template-parameterization-test.mjs', 'contract-victory-layout-generalization-test.mjs', 'contract-route-deconfliction-test.mjs', 'delivery-verifier-process-test.mjs'
].map((file) => `experiments/battle-sandbox/tests/${file}`);

function fail(message) { throw new Error(message); }
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function withTimeout(promise, milliseconds, label) { return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}_timeout`)), milliseconds))]); }
async function run(label, command, args, cwd, env = process.env, timeoutMs = 60000) {
  try {
    const result = await execFileAsync(command, args, { cwd, env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr); console.log(`PASS ${label}`);
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim(); fail(`${label} failed${output ? `\n${output.slice(-5000)}` : ''}`);
  }
}
function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
function portFree(port) { return new Promise((resolve) => { const server = net.createServer(); server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => server.close(() => resolve(true))); }); }
async function waitForHttp(url, managed) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    if (managed.child.exitCode !== null) fail(`server exited before HTTP check: ${managed.child.exitCode}\n${recentStderr(managed)}`);
    try { const response = await fetch(url); if (response.status === 200) return response; } catch { /* continue until deadline */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  fail(`http_ready_timeout pid=${managed.pid}\n${recentStderr(managed)}`);
}
async function checkNpmStart(root) {
  const port = await freePort(); const managed = spawnManagedProcess('npm', ['start'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let failure = null;
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, managed);
    for (const route of ['/', '/experiments/battle-sandbox/', '/experiments/battle-sandbox/contract-demo/?source=scenario-e']) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`); if (response.status !== 200) fail(`HTTP ${route} returned ${response.status}`);
    }
    console.log('PASS npm start and HTTP routes');
  } catch (error) { failure = error; }
  const termination = await terminateProcessTree(managed, { graceMs: 1500, forceMs: 1500 });
  const released = await portFree(port);
  if (!termination.closed || processExists(managed.pid) || !released) fail(`${failure ? `${failure.message}\n` : ''}process cleanup failed pid=${managed.pid} closed=${termination.closed} released=${released}\nstderr=${recentStderr(managed)}`);
  console.log(`PASS process tree cleanup pid=${managed.pid} durationMs=${termination.durationMs}`);
  if (failure) throw failure;
}
function assertNoProcessesForPath(target) {
  if (process.platform === 'win32') return;
  const output = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  const matches = output.split(/\r?\n/).filter((line) => line.includes(target) && !line.includes('verify-b2-2-delivery-package'));
  if (matches.length) fail(`orphan processes for ${target}: ${matches.join(' | ')}`);
}
function checkManifest(root) {
  const file = path.join(root, 'experiments/battle-sandbox/contract-demo/screenshots/capture-manifest.json'); const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rows = [...manifest.captures.map((row) => ({ row, directory: '' })), ...Object.entries(manifest.scenarioCaptures || {}).flatMap(([directory, captures]) => captures.map((row) => ({ row, directory })) )];
  const hashes = [];
  for (const { row, directory } of rows) { const screenshot = path.join(root, 'experiments/battle-sandbox/contract-demo/screenshots', directory, row.file); if (!fs.existsSync(screenshot)) fail(`missing screenshot ${row.file}`); const actual = hashFile(screenshot); if (actual !== row.pngSha256) fail(`screenshot hash mismatch ${row.file}`); hashes.push(actual); }
  if (!manifest.sha256Unique || new Set(hashes).size !== hashes.length || manifest.browserErrors.length) fail('screenshot manifest invalid');
  console.log(`PASS screenshot manifest (${hashes.length} unique SHA)`);
}

async function main() {
  const startedAt = performance.now();
  if (!fs.existsSync(archive)) fail(`archive not found: ${archive}`);
  execFileSync('unzip', ['-tq', archive], { stdio: 'inherit' });
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
  const forbidden = entries.filter((entry) => entry.includes('..') || entry.includes('\\') || entry.endsWith('.zip') || entry.includes('node_modules') || entry.includes('/.') || entry.startsWith('.'));
  if (forbidden.length) fail(`forbidden archive entries: ${forbidden.join(', ')}`);
  REQUIRED_PATHS.forEach((file) => { if (!entries.includes(file)) fail(`missing required archive entry: ${file}`); });
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-b2-2-')); let server = null;
  try {
    execFileSync('unzip', ['-q', archive, '-d', extracted]); REQUIRED_PATHS.forEach((file) => { if (!fs.existsSync(path.join(extracted, file))) fail(`missing extracted path: ${file}`); });
    await run('npm test', 'npm', ['test'], extracted, process.env, 60000);
    for (const test of SANDBOX_TESTS) await run(path.basename(test), process.execPath, [test], extracted, process.env, 45000);
    await run('fixture-generator --check', process.execPath, ['experiments/battle-sandbox/report-adapter/fixture-generator.mjs', '--check'], extracted, process.env, 30000);
    await run('cross-process determinism', process.execPath, ['experiments/battle-sandbox/report-adapter/cross-process-determinism.mjs'], extracted, process.env, 30000);
    await checkNpmStart(extracted);
    const { createServer } = await import(pathToFileURL(path.join(extracted, 'scripts/serve.mjs')).href); server = createServer(extracted);
    await withTimeout(new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }), 5000, 'adapter_server_start');
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await run('sandbox-report-adapter-integrity-test', process.execPath, ['experiments/battle-sandbox/tests/sandbox-report-adapter-integrity-test.mjs'], extracted, { ...process.env, ADAPTER_BASE_URL: baseUrl }, 45000);
    await withTimeout(new Promise((resolve) => server.close(resolve)), 3000, 'adapter_server_close'); server = null;
    const { formalBoundaryHash } = await import(pathToFileURL(path.join(extracted, 'experiments/battle-sandbox/report-adapter/fixture-integrity.js')).href);
    if (formalBoundaryHash(extracted) !== expectedFormalHash) fail('formal boundary hash mismatch'); console.log(`PASS formal boundary hash ${expectedFormalHash}`);
    checkManifest(extracted);
    assertNoProcessesForPath(extracted);
    console.log(`verify-b2-2-delivery-package: ok elapsedMs=${Math.round(performance.now() - startedAt)}`);
  } finally {
    if (server) await withTimeout(new Promise((resolve) => server.close(resolve)), 3000, 'adapter_server_close').catch(() => {});
    fs.rmSync(extracted, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { console.error(`verify-b2-2-delivery-package: failed\n${error.stack || error.message}`); process.exitCode = 1; });

export { REQUIRED_PATHS, SANDBOX_TESTS, checkNpmStart, waitForHttp };
