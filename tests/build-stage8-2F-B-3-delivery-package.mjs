import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const planner = path.join(root, 'experiments/battle-sandbox/universal-planner');
const zipPath = path.join(root, 'iron-command-stage8-2F-B-3-formal-coverage-default-final.zip');
const screenshotNames = new Set(['01-repair-contact.png', '02-multiple-repair-contact.png', '03-convoy-victory-clear.png', '04-convoy-withdraw-returned.png', '05-convoy-wiped-stopped.png', '06-salvage-standoff.png', '07-fortified-obstacle-routing.png', '08-wreck-avoidance.png', '09-withdraw-obstacle-routing.png', '10-many-actors-no-collision.png', '11-pyrrhic-partial-objective.png', '12-spatial-debug-overlay.png']);
const run = (command, args) => { const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit' }); if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`); };
const runBrowserEvidence = () => {
  const result = spawnSync(process.execPath, ['tests/browser/formal-battle-evidence.mjs'], { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  if (result.status !== 0) throw new Error(`browser evidence failed with ${result.status}`);
  fs.mkdirSync(path.join(root, 'tests/outputs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests/outputs/stage8-2E-A-2-4-browser-evidence-output.txt'), result.stdout || '');
};
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const shouldCopy = (source) => { const rel = path.relative(root, source).split(path.sep).join('/'); const base = path.basename(source); if (!rel) return true; if (['node_modules', '.git', 'dist', 'output', 'artifacts', '.browser-temp'].some((name) => rel.split('/').includes(name))) return false; if (base.endsWith('.zip') || base === '.DS_Store') return false; if (rel.endsWith('/scenarios/fuzz.json')) return false; if (rel.includes('/screenshots/') && base.endsWith('.png') && !screenshotNames.has(base)) return false; if (/^STAGE.*\.md$/i.test(base) && base !== 'STAGE8-2F-B-3-DELIVERY.md') return false; return true; };
function walk(dir) { const result = []; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) result.push(...walk(file)); else if (entry.isFile()) result.push(file); } return result; }

if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
runBrowserEvidence();
run(process.execPath, ['experiments/battle-sandbox/universal-planner/scenario-corpus-generator.mjs', '--write']);
run(process.execPath, ['experiments/battle-sandbox/universal-planner/capture-universal-planner-evidence.mjs']);
run(process.execPath, ['experiments/battle-sandbox/universal-planner/coverage-report.mjs']);
run('npm', ['test']);
const coverage = JSON.parse(fs.readFileSync(path.join(planner, 'scenarios/coverage.json'), 'utf8'));
const matrix = coverage.missionResultMatrix;
const formalManifest = JSON.parse(fs.readFileSync(path.join(root, 'screenshots/stage8-2E-A2-screenshot-manifest.json'), 'utf8'));
if (coverage.canonicalCount !== 120 || coverage.fuzzCount !== 1000 || coverage.planFailures.length || coverage.continuousLayoutFailures.length || coverage.semanticFailures.length || matrix.coveredCells !== 26 || matrix.unobservedCells.length !== 4 || formalManifest.screenshots.length !== 12 || formalManifest.errors.pageErrors.length || formalManifest.errors.consoleErrors.length) throw new Error('B.3 delivery gate failed');
const activeWithdraw = formalManifest.screenshots.filter((entry) => entry.reportResult === 'withdraw' && entry.activeBattleAfterReturn !== false);
if (!activeWithdraw.length || activeWithdraw.some((entry) => entry.preference !== 'auto' || entry.renderedMode !== 'universal_battle')) throw new Error('B.3 default withdraw evidence gate failed');
const required = [
  'js/battle-presentation/universal/universal-coverage-matrix.js', 'js/battle-presentation/presentation-router.js', 'js/battle-presentation/presentation-diagnostics.js',
  'tests/stage8-2F-B-1-test.mjs', 'tests/stage8-2F-B-2-test.mjs', 'tests/stage8-2F-B-3-test.mjs',
  'tests/browser/formal-battle-evidence.mjs', 'tests/browser/universal-default-b3-smoke.html', 'screenshots/stage8-2E-A2-screenshot-manifest.json', 'STAGE8-2F-B-3-DELIVERY.md'
];
for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error(`B.3 delivery input missing: ${file}`);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8-2F-B-3-'));
try {
  fs.cpSync(root, staging, { recursive: true, filter: shouldCopy });
  const copied = walk(staging).filter((file) => path.relative(staging, file) !== 'delivery-file-manifest.json');
  const entries = copied.map((file) => { const rel = path.relative(staging, file).split(path.sep).join('/'); return { path: rel, reason: rel.startsWith('js/battle-presentation') ? 'B.3 formal coverage/default-enable runtime' : rel.startsWith('screenshots/') ? 'formal browser evidence' : rel.startsWith('experiments/battle-sandbox/universal-planner') ? 'B.0 spatial planner, corpus, evidence or verifier input' : 'runtime/test source required by final verifier', sha256: sha256(file) }; }).sort((a, b) => a.path.localeCompare(b.path));
  fs.writeFileSync(path.join(staging, 'delivery-file-manifest.json'), `${JSON.stringify({ version: '8.2F-B.3', package: 'iron-command-stage8-2F-B-3-formal-coverage-default-final.zip', generatedAt: new Date().toISOString(), entries }, null, 2)}\n`);
  const files = walk(staging).map((file) => path.relative(staging, file).split(path.sep).join('/')); const zipped = spawnSync('zip', ['-q', '-r', zipPath, ...files], { cwd: staging, encoding: 'utf8', stdio: 'inherit' }); if (zipped.status !== 0) throw new Error('zip failed');
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
run(process.execPath, ['experiments/battle-sandbox/universal-planner/verify-universal-spatial-delivery-package.mjs', zipPath]);
const zipEntries = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean).length;
console.log(JSON.stringify({ ok: true, zip: zipPath, zipSha256: sha256(zipPath), sizeBytes: fs.statSync(zipPath).size, entries: zipEntries, canonical: coverage.canonicalCount, fuzz: coverage.fuzzCount, coveredCells: matrix.coveredCells, unobservedCells: matrix.unobservedCells.length, formalScreenshots: formalManifest.screenshots.length }, null, 2));
