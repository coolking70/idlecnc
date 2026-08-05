import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchManagedVerifierProcess, terminateManagedVerifierProcess } from './managed-verifier-process.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = path.resolve(process.argv[2] || path.join(root, 'iron-command-stage8-2E-A-2-browser-evidence-final.zip'));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const required = [
  'tests/browser/chromium-resolver.mjs', 'tests/browser/managed-browser-process.mjs', 'tests/browser/formal-withdraw-evidence.mjs',
  'tests/browser/formal-battle-evidence.mjs', 'tests/managed-verifier-process.mjs', 'tests/stage8-2E-A-2-test.mjs',
  'tests/verify-stage8-2E-A-2-delivery-package.mjs', 'tests/build-stage8-2E-A-2-delivery-package.mjs',
  'tests/browser/formal-battle-evidence-config.js', 'screenshots/stage8-2E-A2-screenshot-manifest.json',
  'tests/outputs/stage8-2E-A-2-full-test-output.txt', 'tests/outputs/stage8-2E-A-2-browser-evidence-output.txt',
  'STAGE8-2E-A-2-DELIVERY.md'
];

function killGroup(child, signal = 'SIGTERM') { try { process.platform === 'win32' ? child.kill(signal) : process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} } }
function runCommand(label, command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 300000;
  return new Promise((resolve, reject) => {
    console.log(`START ${label}`);
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let settled = false;
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString()).slice(-128 * 1024 * 1024); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-128 * 1024 * 1024); });
    const timer = setTimeout(() => { if (settled) return; killGroup(child, 'SIGTERM'); setTimeout(() => killGroup(child, 'SIGKILL'), 1000); settled = true; reject(new Error(`${label} timeout after ${timeoutMs}ms\n${stderr.slice(-4000)}`)); }, timeoutMs);
    child.once('error', (error) => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error(`${label} spawn failed: ${error.message}`)); });
    child.once('exit', (code, signal) => { if (settled) return; settled = true; clearTimeout(timer); const result = { code, signal, stdout, stderr }; if (code === 0) { console.log(`PASS ${label}`); resolve(result); } else reject(new Error(`${label} failed code=${code} signal=${signal}\n${stderr.slice(-6000)}\n${stdout.slice(-6000)}`)); });
  });
}

async function run() {
  if (!fs.existsSync(archive)) throw new Error(`archive not found: ${archive}`);
  const entries = (await runCommand('archive integrity', 'unzip', ['-tq', archive], { cwd: root })).stdout;
  assert.equal(entries.includes('error'), false);
  const names = (await runCommand('archive listing', 'unzip', ['-Z1', archive], { cwd: root })).stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(names.some((entry) => entry.includes('..') || entry.includes('\\') || entry.endsWith('.zip') || entry.includes('node_modules') || entry.includes('/.')), false, 'unsafe archive entry');
  required.forEach((file) => assert.ok(names.includes(file), `missing ${file}`));
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-ea2-'));
  let server;
  try {
    await runCommand('extract archive', 'unzip', ['-q', archive, '-d', extracted], { cwd: root });
    const boundary = JSON.parse(fs.readFileSync(path.join(extracted, 'tests/stage8-2E-A-1-boundary.json'), 'utf8'));
    const boundaryHash = crypto.createHash('sha256').update(boundary.formalBoundaryFiles.slice().sort().map((file) => `${file}\0${sha256(path.join(extracted, file))}\n`).join('')).digest('hex');
    assert.equal(boundaryHash, boundary.formalBoundaryHash, 'formal boundary hash mismatch');
    server = launchManagedVerifierProcess({ cwd: extracted, root: extracted });
    await server.ready;
    const env = { ...process.env, ADAPTER_BASE_URL: `http://127.0.0.1:${server.port}` };
    const npmResult = await runCommand('npm test', 'npm', ['test'], { cwd: extracted, env });
    const testsOutputPath = path.join(root, 'tests/outputs/stage8-2E-A-2-full-test-output.txt');
    fs.mkdirSync(path.dirname(testsOutputPath), { recursive: true });
    fs.writeFileSync(testsOutputPath, npmResult.stdout + npmResult.stderr);
    const sandboxTests = fs.readdirSync(path.join(extracted, 'experiments/battle-sandbox/tests')).filter((file) => file.endsWith('.mjs')).sort();
    for (const test of sandboxTests) await runCommand(`sandbox ${test}`, process.execPath, [path.join('experiments/battle-sandbox/tests', test)], { cwd: extracted, env });
    const serverExit = await terminateManagedVerifierProcess(server, { termTimeoutMs: 3000, killTimeoutMs: 1000 });
    assert.equal(serverExit.exited, true, 'server did not exit'); server = null;
    const browserResult = await runCommand('browser evidence', process.execPath, ['tests/browser/formal-battle-evidence.mjs'], { cwd: extracted, env: process.env });
    const browserOutputPath = path.join(root, 'tests/outputs/stage8-2E-A-2-browser-evidence-output.txt'); fs.writeFileSync(browserOutputPath, browserResult.stdout + browserResult.stderr);
    const manifestPath = path.join(extracted, 'screenshots/stage8-2E-A2-screenshot-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.screenshots.length, 12); assert.equal(new Set(manifest.screenshots.map((entry) => entry.pngSha256)).size, 12);
    assert.equal(manifest.battles.length, 2);
    const victory = manifest.battles.find((battle) => battle.reportResult === 'victory'); const withdraw = manifest.battles.find((battle) => battle.reportResult === 'withdraw');
    assert.ok(victory && withdraw); assert.notEqual(victory.battleId, withdraw.battleId); assert.notEqual(victory.reportId, withdraw.reportId);
    assert.equal(withdraw.retreatEventCount, 1); assert.equal(withdraw.capture, false); assert.deepEqual(withdraw.rewards, {});
    const withdrawShots = manifest.screenshots.filter((entry) => entry.reportResult === 'withdraw');
    assert.ok(withdrawShots.length >= 2); assert.ok(withdrawShots.every((entry) => entry.renderedMode === 'legacy' && ['auto', 'contract'].includes(entry.preference)));
    assert.equal(manifest.errors.pageErrors.length, 0); assert.equal(manifest.errors.consoleErrors.length, 0);
    for (const entry of manifest.screenshots) { const file = path.join(extracted, 'screenshots', entry.file); assert.equal(sha256(file), entry.pngSha256, entry.file); assert.ok(entry.canvasSignature && entry.stateSignature && entry.reportFingerprint); }
    assert.ok(browserResult.stdout.includes('"screenshots": 12')); assert.ok(browserResult.stdout.includes('"pageErrors": []')); assert.ok(browserResult.stdout.includes('"consoleErrors": []'));
    const output = `verify-stage8-2E-A-2-delivery-package: ok boundary=${boundaryHash} screenshots=12 victory=${victory.reportId} withdraw=${withdraw.reportId} browser=cdp pageErrors=0 consoleErrors=0 server=clean`;
    fs.writeFileSync(path.join(root, 'tests/outputs/stage8-2E-A-2-verification-output.txt'), `${output}\n`);
    console.log(output);
  } finally {
    if (server) await terminateManagedVerifierProcess(server, { termTimeoutMs: 3000, killTimeoutMs: 1000 }).catch(() => {});
    fs.rmSync(extracted, { recursive: true, force: true });
  }
}

const timer = setTimeout(() => { console.error('stage8-2E-A-2 verifier timeout after 300000ms'); process.exit(124); }, 300000);
run().then(() => { clearTimeout(timer); }).catch((error) => { clearTimeout(timer); console.error(error.stack || error); process.exitCode = 1; });
