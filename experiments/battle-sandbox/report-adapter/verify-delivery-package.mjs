import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');
const archive = path.resolve(process.argv[2] || 'iron-command-stage8-2D-A-2-outcome-fixture-hotfix.zip');
const requiredFiles = [
  'package.json',
  'js/battle.js', 'js/battle-outcome.js', 'js/battle-targeting.js', 'js/utils.js', 'js/integrity.js',
  'tests/stage8-2D-A-2-test.mjs', 'tests/stage8-2D-A-3-test.mjs',
  'experiments/battle-sandbox/report-adapter/fixture-generator.mjs',
  'experiments/battle-sandbox/report-adapter/cross-process-determinism.mjs',
  'experiments/battle-sandbox/report-adapter/build-delivery-package.mjs',
  'experiments/battle-sandbox/report-adapter/verify-delivery-package.mjs',
  'experiments/battle-sandbox/report-adapter/fixture-manifest.json',
  'experiments/battle-sandbox/report-adapter/fixtures/index.json',
  'experiments/battle-sandbox/report-adapter/fixtures/campaign-victory.json',
  'experiments/battle-sandbox/report-adapter/fixtures/campaign-withdraw.json',
  'experiments/battle-sandbox/report-adapter/fixtures/campaign-defeat-or-wiped.json',
  'experiments/battle-sandbox/report-adapter/fixtures/operation-result.json',
  'experiments/battle-sandbox/report-adapter/screenshots/01-victory-contract.png',
  'experiments/battle-sandbox/report-adapter/screenshots/02-withdraw-contract.png',
  'experiments/battle-sandbox/report-adapter/screenshots/03-wiped-contract.png',
  'experiments/battle-sandbox/report-adapter/screenshots/04-operation-contract.png',
  'STAGE8-2D-A-3-DELIVERY.md'
];
const sandboxTests = [
  'experiments/battle-sandbox/tests/sandbox-opening-test.mjs',
  'experiments/battle-sandbox/tests/sandbox-opening-patch-test.mjs',
  'experiments/battle-sandbox/tests/sandbox-damage-repair-test.mjs',
  'experiments/battle-sandbox/tests/sandbox-breakthrough-capture-test.mjs',
  'experiments/battle-sandbox/tests/sandbox-integration-readiness-test.mjs'
];

function fail(message) { throw new Error(message); }
const execFileAsync = promisify(execFile);
async function run(label, args, environment = {}) {
  let result;
  try {
    result = await execFileAsync(process.execPath, args, { cwd: extracted, encoding: 'utf8', env: { ...process.env, ...environment }, maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim();
    fail(`${label} failed${output ? `\n${output.slice(-4000)}` : ''}`);
  }
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  console.log(`PASS ${label}`);
}

if (!fs.existsSync(archive)) fail(`archive not found: ${archive}`);
const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const forbidden = entries.filter((entry) => entry.includes('backup') || entry.includes('node_modules') || entry.includes('\\') || entry.endsWith('.zip') || entry.includes('.tmp') || entry.split('/').some((part) => part.startsWith('.')));
if (forbidden.length) fail(`forbidden archive entries: ${forbidden.join(', ')}`);
for (const file of requiredFiles) if (!entries.includes(file)) fail(`missing required archive entry: ${file}`);

const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-delivery-'));
let server = null;
try {
  execFileSync('unzip', ['-q', archive, '-d', extracted]);
  for (const file of requiredFiles) if (!fs.existsSync(path.join(extracted, file))) fail(`missing extracted file: ${file}`);
  await run('fixture-generator --check', ['experiments/battle-sandbox/report-adapter/fixture-generator.mjs', '--check']);
  await run('cross-process-determinism', ['experiments/battle-sandbox/report-adapter/cross-process-determinism.mjs']);
  await run('sandbox-report-adapter-test', ['experiments/battle-sandbox/tests/sandbox-report-adapter-test.mjs']);
  await run('npm test', ['--input-type=module', '-e', "import { execFileSync } from 'node:child_process'; execFileSync('npm', ['test'], { stdio: 'inherit' });"]);
  for (const test of sandboxTests) await run(path.basename(test), [test]);
  const { createServer } = await import(pathToFileURL(path.join(extracted, 'scripts/serve.mjs')).href);
  server = createServer(extracted);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  await run('sandbox-report-adapter-integrity-test', ['experiments/battle-sandbox/tests/sandbox-report-adapter-integrity-test.mjs'], { ADAPTER_BASE_URL: baseUrl });
  await run('stage8-2D-A-2-test', ['tests/stage8-2D-A-2-test.mjs'], { ADAPTER_BASE_URL: baseUrl });
  await run('stage8-2D-A-3-test', ['tests/stage8-2D-A-3-test.mjs'], { ADAPTER_BASE_URL: baseUrl });
  console.log(`temporary server: ${baseUrl}`);
  console.log('verify-delivery-package: ok');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  fs.rmSync(extracted, { recursive: true, force: true });
}
