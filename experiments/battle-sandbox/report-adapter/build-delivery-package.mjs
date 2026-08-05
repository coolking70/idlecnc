import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stableStringify } from './report-normalizer.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const archive = path.join(root, 'iron-command-stage8-2D-A-3-cross-engine-determinism.zip');
const fixtureRoot = path.join(here, 'fixtures');
const manifestPath = path.join(here, 'fixture-manifest.json');
const sandboxTests = [
  'experiments/battle-sandbox/tests/sandbox-opening-test.mjs',
  'experiments/battle-sandbox/tests/sandbox-opening-patch-test.mjs',
  'experiments/battle-sandbox/tests/sandbox-damage-repair-test.mjs',
  'experiments/battle-sandbox/tests/sandbox-breakthrough-capture-test.mjs',
  'experiments/battle-sandbox/tests/sandbox-integration-readiness-test.mjs'
];

const execFileAsync = promisify(execFile);
async function run(label, args, env = process.env) {
  console.log(`\n== ${label} ==`);
  const { stdout, stderr } = await execFileAsync(process.execPath, args, { cwd: root, env, maxBuffer: 64 * 1024 * 1024 });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

function assertCleanTree() {
  const dirty = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.endsWith('.zip')) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.name.includes('.backup') || entry.name.includes('.tmp') || entry.name === '.DS_Store') dirty.push(path.relative(root, absolute));
      if (entry.isDirectory()) visit(absolute);
    }
  }
  visit(root);
  if (dirty.length) throw new Error(`workspace contains forbidden temporary entries: ${dirty.join(', ')}`);
}

function assertScreenshotBindings() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const row of manifest.fixtures) {
    const screenshot = row.viewerScreenshot;
    if (!screenshot || screenshot.fixtureReportHash !== row.reportHash) throw new Error(`screenshot binding missing or stale: ${row.id}`);
    const file = path.join(here, 'screenshots', screenshot.file);
    if (!fs.existsSync(file) || hashFile(file) !== screenshot.sha256) throw new Error(`screenshot hash mismatch: ${row.id}`);
    const fixture = JSON.parse(fs.readFileSync(path.join(fixtureRoot, row.file), 'utf8'));
    if (hashFile(path.join(fixtureRoot, row.file)) !== row.fileHash) throw new Error(`fixture file hash mismatch: ${row.id}`);
    if (!fixture.report || row.reportHash !== crypto.createHash('sha256').update(stableStringify(fixture.report)).digest('hex')) throw new Error(`fixture report hash mismatch: ${row.id}`);
  }
  console.log('screenshot/manifest bindings: ok');
}

async function main() {
  assertCleanTree();
  await run('fixture write', ['experiments/battle-sandbox/report-adapter/fixture-generator.mjs', '--write']);
  await run('fixture check', ['experiments/battle-sandbox/report-adapter/fixture-generator.mjs', '--check']);
  await run('cross-process determinism', ['experiments/battle-sandbox/report-adapter/cross-process-determinism.mjs']);
  await run('formal npm test', ['-e', "import { execFileSync } from 'node:child_process'; execFileSync('npm', ['test'], { stdio: 'inherit' });"]);
  for (const test of sandboxTests) await run(path.basename(test), [test]);
  await run('adapter test', ['experiments/battle-sandbox/tests/sandbox-report-adapter-test.mjs']);

  const { createServer } = await import(pathToFileURL(path.join(root, 'scripts/serve.mjs')).href);
  const server = createServer(root);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await run('adapter integrity test', ['experiments/battle-sandbox/tests/sandbox-report-adapter-integrity-test.mjs'], { ...process.env, ADAPTER_BASE_URL: baseUrl });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assertScreenshotBindings();

  if (fs.existsSync(archive)) fs.rmSync(archive, { force: true });
  execFileSync('zip', [
    '-rq', path.basename(archive), '.',
    '-x', '*.zip', '.git/*', 'node_modules/*', '.*', '*/.*', '*.log', '*.tmp', '*.backup', '*.backup/*', '*/.backup/*', '*/.tmp/*', 'output/*', 'tmp/*'
  ], { cwd: root, stdio: 'inherit' });
  await run('self-contained package verification', ['experiments/battle-sandbox/report-adapter/verify-delivery-package.mjs', path.basename(archive)]);
  console.log(`delivery package: ${archive}`);
  console.log(`sha256: ${hashFile(archive)}`);
}

main().catch((error) => {
  if (fs.existsSync(archive)) fs.rmSync(archive, { force: true });
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
