import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REQUIRED_PATHS, SANDBOX_TESTS } from './verify-b2-2-delivery-package.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const archive = path.join(root, 'iron-command-stage8-2D-B-2-2-complete.zip');
const expectedFormalHash = '2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab';
const execFileAsync = promisify(execFile);

function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function run(label, command, args, options = {}) { console.log(`\n== ${label} ==`); execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options }); }
async function runAsync(label, command, args, options = {}) { console.log(`\n== ${label} ==`); const result = await execFileAsync(command, args, { cwd: root, timeout: 60000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, ...options }); if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr); }
function requiredPathsExist() { const missing = REQUIRED_PATHS.filter((file) => !fs.existsSync(path.join(root, file))); if (missing.length) throw new Error(`missing required paths:\n${missing.join('\n')}`); }
function checkManifest() { const manifest = JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/contract-demo/screenshots/capture-manifest.json'), 'utf8')); const rows = [...manifest.captures.map((row) => ({ row, directory: '' })), ...Object.entries(manifest.scenarioCaptures || {}).flatMap(([directory, captures]) => captures.map((row) => ({ row, directory })) )]; const hashes = rows.map(({ row, directory }) => { const file = path.join(root, 'experiments/battle-sandbox/contract-demo/screenshots', directory, row.file); if (!fs.existsSync(file) || hashFile(file) !== row.pngSha256) throw new Error(`screenshot manifest mismatch: ${row.file}`); return row.pngSha256; }); if (!manifest.sha256Unique || new Set(hashes).size !== hashes.length || manifest.browserErrors.length) throw new Error('screenshot manifest invalid'); console.log(`PASS screenshot manifest (${hashes.length} unique SHA)`); }

async function main() {
  requiredPathsExist();
  run('formal npm test', 'npm', ['test']);
  for (const test of SANDBOX_TESTS.filter((test) => !test.endsWith('sandbox-report-adapter-integrity-test.mjs'))) run(path.basename(test), process.execPath, [test]);
  run('fixture check', process.execPath, ['experiments/battle-sandbox/report-adapter/fixture-generator.mjs', '--check']);
  run('cross-process determinism', process.execPath, ['experiments/battle-sandbox/report-adapter/cross-process-determinism.mjs']);
  checkManifest();
  const { formalBoundaryHash } = await import(pathToFileURL(path.join(root, 'experiments/battle-sandbox/report-adapter/fixture-integrity.js')).href); if (formalBoundaryHash(root) !== expectedFormalHash) throw new Error('formal boundary hash changed'); console.log(`PASS formal boundary hash ${expectedFormalHash}`);
  const { createServer } = await import(pathToFileURL(path.join(root, 'scripts/serve.mjs')).href); const server = createServer(root); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { await runAsync('adapter integrity', process.execPath, ['experiments/battle-sandbox/tests/sandbox-report-adapter-integrity-test.mjs'], { env: { ...process.env, ADAPTER_BASE_URL: baseUrl } }); } finally { await new Promise((resolve) => server.close(resolve)); }
  console.log(`PASS adapter integrity server cleanup (${baseUrl})`);
  const tempArchive = path.join(root, `.b2-2-package-${process.pid}.zip`); execFileSync('zip', ['-rq', tempArchive, '.', '-x', '*.zip', '.git/*', 'node_modules/*', 'output/*', 'tmp/*', '*.log', '*.tmp', '*.backup', '*/.*'], { cwd: root, stdio: 'inherit' }); fs.renameSync(tempArchive, archive);
  run('self-contained verification', process.execPath, ['experiments/battle-sandbox/report-adapter/verify-b2-2-delivery-package.mjs', archive]);
  console.log(`delivery package: ${archive}`); console.log(`sha256: ${hashFile(archive)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

export { REQUIRED_PATHS, SANDBOX_TESTS };
