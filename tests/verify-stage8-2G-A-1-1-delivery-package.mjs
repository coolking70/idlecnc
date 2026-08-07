import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = path.resolve(process.argv[2] || path.join(root, 'iron-command-stage8-2G-A-1-1-production-visual-core-closure.zip'));
const required = ['package.json', 'README.md', 'STAGE8-2G-A-1-1-DELIVERY.md', 'AUDIT-START-HERE.md', 'stage8_2g_a11_developer_selfcheck.json', 'stage8_2g_a11_clean_package_test.json', 'js/battle-presentation/universal/universal-battle-renderer.js', 'js/battle-presentation/universal/universal-debug-overlay.js', 'js/battle-presentation/universal/universal-visual-scene.js', 'js/battle-presentation/universal/universal-render-state.js', 'js/battle-presentation/universal/visual-state-machine.js', 'js/battle-presentation/universal/visual-footprints.js', 'js/battle-presentation/universal/universal-battle-phase-resolver.js', 'tests/stage8-2E-A-2-4-test.mjs', 'tests/stage8-2G-A-1-test.mjs', 'tests/stage8-2G-A-1-1-test.mjs', 'tests/run-full-test-evidence.mjs', 'tests/browser/stage8-2G-A-evidence.mjs', 'tests/evidence/stage8_2g_a11_full_npm_test.log', 'tests/evidence/stage8_2g_a11_full_npm_test.json', 'tests/evidence/stage8_2g_a11_spatial_validation.json', 'tests/fixtures/battle-phases/rapid-contact.json', 'tests/fixtures/battle-phases/long-approach.json', 'tests/fixtures/battle-phases/prolonged-engagement.json', 'screenshots/stage8-2G-A-visual-manifest.json'];
const screenshots = new Set(['01-production-deploy-end.png', '02-production-first-contact.png', '03-production-main-engagement.png', '04-production-critical-destruction.png', '05-production-battle-end.png', '06-debug-grid-same-frame.png', '07-formal-default-size.png', '08-formal-narrow-size.png', '09-footprint-debug-main-engagement.png', '10-clean-package-test-result.png']);
const forbiddenPrefixes = ['node_modules/', '.git/', '.browser-temp/', 'browser-cache/', 'temporary-logs/'];
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (command, args, cwd = root, env = process.env) => { const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: 'inherit', maxBuffer: 128 * 1024 * 1024 }); if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`); };
if (!fs.existsSync(zipPath)) throw new Error(`package missing: ${zipPath}`);
run('unzip', ['-tq', zipPath], root);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8-2G-A-1-1-verify-'));
try {
  run('unzip', ['-q', zipPath, '-d', staging], root);
  const entries = spawnSync('unzip', ['-Z1', zipPath], { cwd: root, encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean);
  const forbidden = entries.find((entry) => forbiddenPrefixes.some((prefix) => entry.startsWith(prefix)) || entry.endsWith('.zip') || (entry.startsWith('screenshots/stage8-2G-A/') && !screenshots.has(path.basename(entry))) || (entry.startsWith('screenshots/') && !entry.startsWith('screenshots/stage8-2G-A/') && entry !== 'screenshots/stage8-2G-A-visual-manifest.json'));
  if (forbidden) throw new Error(`forbidden package entry: ${forbidden}`);
  for (const file of required) if (!fs.existsSync(path.join(staging, file))) throw new Error(`required file missing: ${file}`);
  for (const fixture of ['rapid-contact.json', 'long-approach.json', 'prolonged-engagement.json']) { const data = JSON.parse(fs.readFileSync(path.join(staging, 'tests/fixtures/battle-phases', fixture), 'utf8')); if (data.fixture !== fixture.replace('.json', '')) throw new Error(`fixture mismatch: ${fixture}`); }
  const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'screenshots/stage8-2G-A-visual-manifest.json'), 'utf8'));
  if (manifest.stage !== '8.2G-A.1.1' || manifest.screenshots?.length !== 10 || manifest.errors?.pageErrors?.length || manifest.errors?.consoleErrors?.length) throw new Error('browser manifest gate failed');
  if (new Set(manifest.screenshots.map((entry) => entry.file)).size !== 10 || !manifest.screenshots.every((entry) => screenshots.has(entry.file))) throw new Error('screenshot name contract failed');
  for (const entry of manifest.screenshots) { const file = path.join(staging, 'screenshots/stage8-2G-A', entry.file); if (!fs.existsSync(file) || sha256(file) !== entry.pngSha256) throw new Error(`screenshot hash mismatch: ${entry.file}`); }
  if (!manifest.productionDebugComparison?.sameSceneHash || !manifest.productionDebugComparison?.sameStateSignature || !manifest.productionDebugComparison?.debugAddsOnlyOverlay) throw new Error('production/debug same-state gate failed');
  const selfcheck = JSON.parse(fs.readFileSync(path.join(staging, 'stage8_2g_a11_developer_selfcheck.json'), 'utf8'));
  if (selfcheck.stage !== '8.2G-A.1.1' || selfcheck.independentAudit !== false || selfcheck.authority?.solverModified !== false || selfcheck.authority?.hpModifiedByPresentation !== false) throw new Error('selfcheck authority gate failed');
  const spatial = JSON.parse(fs.readFileSync(path.join(staging, 'tests/evidence/stage8_2g_a11_spatial_validation.json'), 'utf8'));
  if (spatial.stage !== '8.2G-A.1.1' || spatial.frames.length < 15 || !spatial.obstacleChecks || !spatial.wreckChecks || !spatial.jitterChecks) throw new Error('spatial evidence gate failed');
  const logText = fs.readFileSync(path.join(staging, 'tests/evidence/stage8_2g_a11_full_npm_test.log'), 'utf8');
  const evidence = JSON.parse(fs.readFileSync(path.join(staging, 'tests/evidence/stage8_2g_a11_full_npm_test.json'), 'utf8'));
  if (!logText.includes('command=npm test') || !logText.includes('cleanExtract=true') || evidence.cleanExtract !== true || evidence.exitCode !== 0 || evidence.failed !== 0 || evidence.skipped !== 0) throw new Error('full test evidence gate failed');
  run('npm', ['install', '--no-audit', '--no-fund'], staging);
  run(process.execPath, ['tests/run-full-test-evidence.mjs'], staging, { ...process.env, IRON_COMMAND_CLEAN_EXTRACT: 'true' });
  const rerunEvidence = JSON.parse(fs.readFileSync(path.join(staging, 'tests/evidence/stage8_2g_a11_full_npm_test.json'), 'utf8'));
  if (rerunEvidence.exitCode !== 0 || rerunEvidence.failed !== 0 || rerunEvidence.skipped !== 0) throw new Error('clean full npm test failed');
  run(process.execPath, ['tests/stage8-2E-A-2-4-test.mjs'], staging);
  run(process.execPath, ['tests/stage8-2G-A-1-1-test.mjs'], staging);
  const clean = JSON.parse(fs.readFileSync(path.join(staging, 'stage8_2g_a11_clean_package_test.json'), 'utf8'));
  console.log(JSON.stringify({ ok: true, stage: '8.2G-A.1.1', package: zipPath, zipSha256: sha256(zipPath), sizeBytes: fs.statSync(zipPath).size, entries: entries.length, screenshots: manifest.screenshots.length, fullSuite: { total: rerunEvidence.total, passed: rerunEvidence.passed, failed: rerunEvidence.failed, skipped: rerunEvidence.skipped, durationMs: rerunEvidence.durationMs, slowestTests: rerunEvidence.slowestTests }, historicalPid: '37/37', cleanPackageTest: { ...clean, verifierRerun: true } }, null, 2));
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
