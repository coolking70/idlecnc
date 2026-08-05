import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = path.resolve(process.argv[2] || path.join(root, 'iron-command-stage8-2E-A-1-formal-sidecar-hardening.zip'));
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const required = [
  'js/battle-presentation/formal-hud-policy.js', 'js/battle-presentation/report-fingerprint.js', 'js/battle-presentation/runtime-fallback-registry.js', 'js/battle-presentation/return-choreography.js',
  'tests/stage8-2E-A-1-test.mjs', 'tests/browser/cdp-client.mjs', 'tests/browser/formal-battle-evidence.mjs', 'tests/browser/formal-battle-evidence-config.js',
  'tests/verify-stage8-2E-A-1-delivery-package.mjs', 'STAGE8-2E-A-1-DELIVERY.md', 'screenshots/stage8-2E-A1-screenshot-manifest.json'
];
const startStaticServerProcess = (cwd) => new Promise((resolve, reject) => {
  const source = "import { createServer } from './scripts/serve.mjs'; const server = createServer(process.cwd()); server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));";
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  let output = '';
  const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('static server start timeout')); }, 10000);
  child.stdout.on('data', (chunk) => {
    output += chunk;
    const line = output.split(/\r?\n/)[0];
    try {
      const { port } = JSON.parse(line);
      clearTimeout(timer);
      resolve({ child, baseUrl: `http://127.0.0.1:${port}` });
    } catch {}
  });
  child.once('error', (error) => { clearTimeout(timer); reject(error); });
  child.once('exit', (code) => { if (code !== null && !output) { clearTimeout(timer); reject(new Error(`static server exited with ${code}`)); } });
});
if (!fs.existsSync(archive)) throw new Error(`archive not found: ${archive}`);
execFileSync('unzip', ['-tq', archive], { stdio: 'inherit' });
const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
assert.equal(entries.some((entry) => entry.includes('..') || entry.includes('\\') || entry.endsWith('.zip') || entry.includes('node_modules') || entry.includes('/.')), false, 'unsafe archive entry');
required.forEach((file) => assert.ok(entries.includes(file), `missing ${file}`));

const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-ea1-'));
try {
  execFileSync('unzip', ['-q', archive, '-d', extracted]);
  const boundary = JSON.parse(fs.readFileSync(path.join(extracted, 'tests/stage8-2E-A-1-boundary.json'), 'utf8'));
  const boundaryHash = crypto.createHash('sha256').update(boundary.formalBoundaryFiles.slice().sort().map((file) => `${file}\0${sha256(path.join(extracted, file))}\n`).join('')).digest('hex');
  assert.equal(boundaryHash, boundary.formalBoundaryHash, 'formal boundary hash mismatch');
  const { child: serverProcess, baseUrl: adapterBaseUrl } = await startStaticServerProcess(extracted);
  try {
    execFileSync('npm', ['test'], { cwd: extracted, stdio: 'pipe', maxBuffer: 128 * 1024 * 1024, env: { ...process.env, ADAPTER_BASE_URL: adapterBaseUrl } });
    const sandboxTests = fs.readdirSync(path.join(extracted, 'experiments/battle-sandbox/tests')).filter((file) => file.endsWith('.mjs')).sort();
    for (const test of sandboxTests) execFileSync(process.execPath, [path.join('experiments/battle-sandbox/tests', test)], { cwd: extracted, stdio: 'pipe', maxBuffer: 128 * 1024 * 1024, env: { ...process.env, ADAPTER_BASE_URL: adapterBaseUrl } });
  } finally {
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => serverProcess.once('exit', resolve));
  }
  execFileSync(process.execPath, ['tests/browser/formal-battle-evidence.mjs'], { cwd: extracted, stdio: 'pipe', maxBuffer: 128 * 1024 * 1024 });
  const manifest = JSON.parse(fs.readFileSync(path.join(extracted, 'screenshots/stage8-2E-A1-screenshot-manifest.json'), 'utf8'));
  assert.equal(manifest.screenshots.length, 11);
  const pngHashes = manifest.screenshots.map((capture) => { const file = path.join(extracted, 'screenshots', capture.file); assert.ok(fs.existsSync(file), capture.file); const hash = sha256(file); assert.equal(hash, capture.pngSha256, capture.file); return hash; });
  assert.equal(new Set(pngHashes).size, 11, 'screenshot PNG SHA values must be unique');
  assert.ok(manifest.screenshots.every((capture) => capture.reportFingerprint && capture.renderedMode && capture.canvasSignature && capture.stateSignature));
  assert.ok(manifest.screenshots.some((capture) => capture.renderedMode === 'contract_road_victory' && capture.presentationPhase === 'returning'));
  assert.ok(manifest.screenshots.some((capture) => capture.renderedMode === 'legacy'));
  assert.ok(manifest.screenshots.some((capture) => capture.modeButtonText.includes('自动')));
  assert.ok(manifest.screenshots.some((capture) => capture.modeButtonText.includes('兼容')));
  const source = fs.readFileSync(path.join(extracted, 'tests/browser/formal-battle-evidence.mjs'), 'utf8');
  assert.doesNotMatch(source, /playwright|puppeteer/i);
  console.log(`verify-stage8-2E-A-1-delivery-package: ok boundary=${boundary.formalBoundaryHash} screenshots=${pngHashes.length} browser=cdp pageErrors=0 consoleErrors=0`);
} finally {
  fs.rmSync(extracted, { recursive: true, force: true });
}
