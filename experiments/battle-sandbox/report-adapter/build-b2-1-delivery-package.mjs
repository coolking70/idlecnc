import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const archive = path.join(root, 'iron-command-stage8-2D-B-2-1-complete.zip');
const REQUIRED_PATHS = [
  'index.html', 'package.json', 'css/style.css', 'scripts/serve.mjs',
  'js/main.js', 'js/config.js', 'js/state.js', 'js/economy.js', 'js/events.js', 'js/battle.js', 'js/battle-targeting.js', 'js/battle-outcome.js', 'js/integrity.js', 'js/theater.js',
  'experiments/battle-sandbox/index.html', 'experiments/battle-sandbox/sandbox.js', 'experiments/battle-sandbox/sandbox-director.js', 'experiments/battle-sandbox/sandbox-renderer.js', 'experiments/battle-sandbox/sandbox-pulse-scheduler.js', 'experiments/battle-sandbox/sandbox-damage-model.js', 'experiments/battle-sandbox/sandbox-objective-director.js',
  'experiments/battle-sandbox/contract-demo/index.html', 'experiments/battle-sandbox/report-adapter/fixture-manifest.json'
];
const TESTS = [
  ['sandbox-opening-test.mjs'], ['sandbox-opening-patch-test.mjs'], ['sandbox-damage-repair-test.mjs'], ['sandbox-breakthrough-capture-test.mjs'], ['sandbox-integration-readiness-test.mjs'],
  ['sandbox-report-adapter-test.mjs'], ['sandbox-report-adapter-integrity-test.mjs'], ['contract-driven-victory-demo-test.mjs'], ['contract-demo-visual-integrity-test.mjs'], ['contract-victory-template-parameterization-test.mjs'], ['contract-victory-layout-generalization-test.mjs']
].map(([name]) => `experiments/battle-sandbox/tests/${name}`);
const execFileAsync = promisify(execFile);

function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function run(label, command, args, options = {}) {
  console.log(`\n== ${label} ==`);
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}
async function runAsync(label, command, args, options = {}) {
  console.log(`\n== ${label} ==`);
  const result = await execFileAsync(command, args, { cwd: root, maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}
function requiredPathsExist(base = root) {
  const missing = REQUIRED_PATHS.filter((file) => !fs.existsSync(path.join(base, file)));
  if (missing.length) throw new Error(`missing required paths:\n${missing.join('\n')}`);
}
function checkManifest() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/contract-demo/screenshots/capture-manifest.json'), 'utf8'));
  const rows = [
    ...manifest.captures.map((row) => ({ row, directory: '' })),
    ...Object.entries(manifest.scenarioCaptures || {}).flatMap(([source, captures]) => captures.map((row) => ({ row, directory: source })))
  ];
  for (const { row, directory } of rows) {
    const file = path.join(root, 'experiments/battle-sandbox/contract-demo/screenshots', directory, row.file);
    if (!fs.existsSync(file) || hashFile(file) !== row.pngSha256) throw new Error(`screenshot manifest hash mismatch: ${row.file}`);
  }
  if (!manifest.sha256Unique || manifest.browserErrors.length) throw new Error('screenshot manifest is not browser-clean/unique');
}
async function checkServer() {
  const { createServer } = await import(pathToFileURL(path.join(root, 'scripts/serve.mjs')).href);
  const server = createServer(root);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/', '/experiments/battle-sandbox/', '/experiments/battle-sandbox/contract-demo/?source=scenario-e']) {
      const response = await fetch(`${base}${route}`);
      if (response.status !== 200) throw new Error(`${route} returned HTTP ${response.status}`);
    }
    console.log(`server HTTP checks: ok (${base})`);
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function main() {
  requiredPathsExist();
  run('formal npm test', 'npm', ['test']);
  for (const test of TESTS.filter((test) => !test.endsWith('sandbox-report-adapter-integrity-test.mjs'))) run(path.basename(test), process.execPath, [test]);
  run('fixture check', process.execPath, ['experiments/battle-sandbox/report-adapter/fixture-generator.mjs', '--check']);
  run('cross-process determinism', process.execPath, ['experiments/battle-sandbox/report-adapter/cross-process-determinism.mjs']);
  checkManifest();
  const { createServer } = await import(pathToFileURL(path.join(root, 'scripts/serve.mjs')).href);
  const server = createServer(root);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await runAsync('adapter integrity', process.execPath, ['experiments/battle-sandbox/tests/sandbox-report-adapter-integrity-test.mjs'], { env: { ...process.env, ADAPTER_BASE_URL: baseUrl } });
    for (const route of ['/', '/experiments/battle-sandbox/', '/experiments/battle-sandbox/contract-demo/?source=scenario-e']) {
      const response = await fetch(`${baseUrl}${route}`); if (response.status !== 200) throw new Error(`${route} returned HTTP ${response.status}`);
    }
    console.log(`server HTTP checks: ok (${baseUrl})`);
  } finally { await new Promise((resolve) => server.close(resolve)); }
  const expected = '2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab';
  const { formalBoundaryHash } = await import(pathToFileURL(path.join(root, 'experiments/battle-sandbox/report-adapter/fixture-integrity.js')).href);
  if (formalBoundaryHash(root) !== expected) throw new Error('formal boundary hash changed');
  const tempArchive = path.join(root, `.b2-1-package-${process.pid}.zip`);
  execFileSync('zip', ['-rq', tempArchive, '.', '-x', '*.zip', '.git/*', 'node_modules/*', 'output/*', 'tmp/*', '*.log', '*.tmp', '*.backup', '*/.*'], { cwd: root, stdio: 'inherit' });
  fs.renameSync(tempArchive, archive);
  run('self-contained verification', process.execPath, ['experiments/battle-sandbox/report-adapter/verify-b2-1-delivery-package.mjs', archive]);
  console.log(`delivery package: ${archive}`);
  console.log(`sha256: ${hashFile(archive)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}

export { REQUIRED_PATHS, TESTS };
