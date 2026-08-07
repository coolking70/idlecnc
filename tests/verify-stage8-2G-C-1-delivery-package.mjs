import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const zipArg = process.argv.find((arg) => arg.endsWith('.zip'));
const zipPath = path.resolve(zipArg || path.join(root, 'iron-command-stage8-2G-C-1-production-visual-consumption-hardening.zip'));
const skipFull = process.argv.includes('--skip-full');
const run = (command, args, cwd, options = {}) => spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const child = rel ? `${rel}/${entry.name}` : entry.name; return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child]; });
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-C1-verify-'));
const clean = () => fs.rmSync(staging, { recursive: true, force: true });
try {
  if (!fs.existsSync(zipPath)) throw new Error(`package not found: ${zipPath}`);
  const unzip = run('unzip', ['-q', zipPath, '-d', staging], root); if (unzip.status !== 0) throw new Error(unzip.stderr || 'unzip failed');
  const entries = walk(staging);
  const forbidden = entries.filter((entry) => entry === '.DS_Store' || entry.includes('/.DS_Store') || entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.startsWith('output/') || entry.startsWith('artifacts/') || entry.includes('browser-profiles/'));
  if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
  const required = ['STAGE8-2G-C-1-DELIVERY.md', 'tests/stage8-2G-C-1-test.mjs', 'tests/stage8-2G-C-1-evidence-tamper-test.mjs', 'tests/generate-stage8-2G-C-1-evidence.mjs', 'tests/verify-stage8-2G-C-1-evidence.mjs', 'tests/browser/stage8-2G-C-1-evidence.mjs', 'js/battle-presentation/environment/asset-runtime.js', 'js/battle-presentation/environment/production-visual-draw-spec.js', 'assets/battle/sample-assets/unit-friendly-infantry.svg', 'assets/battle/sample-assets/unit-friendly-mbt.svg', 'assets/battle/sample-assets/wreck-tank.svg', 'assets/battle/sample-assets/industrial-cover.svg', 'assets/battle/sample-assets/terrain-scrap-pile.svg', 'stage8_2g_c1_machine_semantic_evidence.json', 'stage8_2g_c1_browser_capture_manifest.json', 'stage8_2g_c1_evidence_aggregate.json', 'stage8_2g_c1_evidence_tamper_results.json', 'stage8_2g_c1_asset_runtime_check.json', 'stage8_2g_c1_fallback_check.json', 'stage8_2g_c1_minimum_screen_footprint.json', 'stage8_2g_c1_route_polyline_clearance.json', 'stage8_2g_c1_decal_render_check.json', 'stage8_2g_c1_weapon_profile_render_check.json', 'stage8_2g_c1_seek_determinism.json', 'stage8_2g_c1_authority_check.json', 'stage8_2g_c1_performance_check.json', 'stage8_2g_c1_evidence_tamper_results.json', 'stage8_2g_c1_clean_package_test.json', 'stage8_2g_c1_developer_selfcheck.json', 'stage8_2g_c1_package_hygiene.json'];
  const missing = required.filter((file) => !fs.existsSync(path.join(staging, file))); if (missing.length) throw new Error(`missing C.1 delivery files: ${missing.join(', ')}`);
  const evidence = run(process.execPath, ['tests/verify-stage8-2G-C-1-evidence.mjs'], staging, { timeout: 120000 }); if (evidence.status !== 0) throw new Error(evidence.stderr || evidence.stdout || 'C.1 evidence verification failed');
  const stage = run(process.execPath, ['tests/stage8-2G-C-1-test.mjs'], staging, { timeout: 120000 }); if (stage.status !== 0) throw new Error(stage.stderr || stage.stdout || 'C.1 stage test failed');
  const tamper = run(process.execPath, ['tests/stage8-2G-C-1-evidence-tamper-test.mjs'], staging, { timeout: 120000 }); if (tamper.status !== 0) throw new Error(tamper.stderr || tamper.stdout || 'C.1 tamper test failed');
  const install = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], staging, { timeout: 120000 }); if (install.status !== 0) throw new Error(install.stderr || 'clean npm install failed');
  const full = skipFull ? { status: 0, stdout: 'SKIPPED by --skip-full', stderr: '' } : run('npm', ['test'], staging, { timeout: 900000 }); if (!skipFull && full.status !== 0) throw new Error(full.stderr || full.stdout || 'clean npm test failed');
  const aggregate = JSON.parse(fs.readFileSync(path.join(staging, 'stage8_2g_c1_evidence_aggregate.json'), 'utf8')); const tamperRecord = JSON.parse(fs.readFileSync(path.join(staging, 'stage8_2g_c1_evidence_tamper_results.json'), 'utf8')); if (aggregate.status !== 'passed' || !tamperRecord.ok || !tamperRecord.cases.every((item) => item.rejected)) throw new Error('C.1 aggregate evidence is not passed');
  const output = { ok: true, stage: '8.2G-C.1', package: zipPath, packageSha256: sha(zipPath), packageBytes: fs.statSync(zipPath).size, entries: entries.length, hygiene: { forbiddenCount: forbidden.length, screenshots: entries.filter((entry) => entry.startsWith('screenshots/stage8-2G-C-1/')).length }, evidence: JSON.parse(evidence.stdout), stageC1: (stage.stdout || '').trim(), tamper: JSON.parse(tamper.stdout), full: { status: skipFull ? 'skipped' : 'passed', outputTail: `${full.stdout || ''}${full.stderr || ''}`.slice(-5000) } };
  clean(); console.log(JSON.stringify(output));
} catch (error) { clean(); console.error(JSON.stringify({ ok: false, stage: '8.2G-C.1', package: zipPath, message: error.message || String(error) })); process.exitCode = 1; }
