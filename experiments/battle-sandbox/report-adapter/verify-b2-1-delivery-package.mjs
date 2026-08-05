import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REQUIRED_PATHS, TESTS } from './build-b2-1-delivery-package.mjs';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const archive = path.resolve(process.argv[2] || 'iron-command-stage8-2D-B-2-1-complete.zip');
const expectedHash = '2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab';
const sandboxTests = TESTS;

function fail(message) { throw new Error(message); }
async function run(label, command, args, cwd, env = process.env) {
  try { const result = await execFileAsync(command, args, { cwd, env, maxBuffer: 64 * 1024 * 1024 }); if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr); console.log(`PASS ${label}`); }
  catch (error) { const output = `${error.stdout || ''}${error.stderr || ''}`.trim(); fail(`${label} failed${output ? `\n${output.slice(-5000)}` : ''}`); }
}
function freePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); }); }
async function waitForHttp(url, child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) fail(`server exited before HTTP check: ${child.exitCode}`);
    try { const response = await fetch(url); if (response.status === 200) return response; } catch { /* wait for listen */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  fail(`server did not answer: ${url}`);
}
async function checkNpmStart(root) {
  const port = await freePort();
  const child = spawn('npm', ['start'], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, child);
    for (const route of ['/', '/experiments/battle-sandbox/', '/experiments/battle-sandbox/contract-demo/?source=scenario-e']) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`); if (response.status !== 200) fail(`HTTP ${route} returned ${response.status}`);
    }
    console.log('PASS npm start and HTTP routes');
  } finally { child.kill('SIGTERM'); await new Promise((resolve) => child.once('close', resolve)); if (stderr && child.exitCode && child.exitCode !== 143) process.stderr.write(stderr); }
}

if (!fs.existsSync(archive)) fail(`archive not found: ${archive}`);
execFileSync('unzip', ['-tq', archive], { stdio: 'inherit' });
const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const forbidden = entries.filter((entry) => entry.includes('..') || entry.includes('\\') || entry.endsWith('.zip') || entry.includes('node_modules') || entry.includes('/.') || entry.startsWith('.'));
if (forbidden.length) fail(`forbidden archive entries: ${forbidden.join(', ')}`);
for (const file of REQUIRED_PATHS) if (!entries.includes(file)) fail(`missing required archive entry: ${file}`);

const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-b2-1-'));
let server = null;
try {
  execFileSync('unzip', ['-q', archive, '-d', extracted]);
  for (const file of REQUIRED_PATHS) if (!fs.existsSync(path.join(extracted, file))) fail(`missing extracted path: ${file}`);
  await run('npm test', 'npm', ['test'], extracted);
  for (const test of sandboxTests.filter((test) => !test.endsWith('sandbox-report-adapter-integrity-test.mjs'))) await run(path.basename(test), process.execPath, [test], extracted);
  await run('fixture-generator --check', process.execPath, ['experiments/battle-sandbox/report-adapter/fixture-generator.mjs', '--check'], extracted);
  await run('cross-process determinism', process.execPath, ['experiments/battle-sandbox/report-adapter/cross-process-determinism.mjs'], extracted);
  await checkNpmStart(extracted);
  const { createServer } = await import(pathToFileURL(path.join(extracted, 'scripts/serve.mjs')).href);
  server = createServer(extracted);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const adapterBaseUrl = `http://127.0.0.1:${server.address().port}`;
  await run('sandbox-report-adapter-integrity-test', process.execPath, ['experiments/battle-sandbox/tests/sandbox-report-adapter-integrity-test.mjs'], extracted, { ...process.env, ADAPTER_BASE_URL: adapterBaseUrl });
  await new Promise((resolve) => server.close(resolve)); server = null;
  const { formalBoundaryHash } = await import(pathToFileURL(path.join(extracted, 'experiments/battle-sandbox/report-adapter/fixture-integrity.js')).href);
  if (formalBoundaryHash(extracted) !== expectedHash) fail('formal boundary hash mismatch');
  const manifest = JSON.parse(fs.readFileSync(path.join(extracted, 'experiments/battle-sandbox/contract-demo/screenshots/capture-manifest.json'), 'utf8'));
  const manifestRows = [
    ...manifest.captures.map((row) => ({ row, directory: '' })),
    ...Object.entries(manifest.scenarioCaptures || {}).flatMap(([source, captures]) => captures.map((row) => ({ row, directory: source })))
  ];
  for (const { row, directory } of manifestRows) {
    const file = path.join(extracted, 'experiments/battle-sandbox/contract-demo/screenshots', directory, row.file);
    const actual = (await import('node:crypto')).createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== row.pngSha256) fail(`screenshot hash mismatch: ${row.file}`);
  }
  console.log('verify-b2-1-delivery-package: ok');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(extracted, { recursive: true, force: true });
}
