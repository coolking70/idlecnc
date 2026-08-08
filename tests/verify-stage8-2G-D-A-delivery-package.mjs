import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const skipFull = process.argv.includes('--skip-full');
const arg = process.argv.find((item) => item.endsWith('.zip'));
const zipPath = path.resolve(arg || path.join(root, 'iron-command-stage8-2G-D-A-production-unit-art.zip'));
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-DA-verify-'));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const child = rel ? `${rel}/${entry.name}` : entry.name; return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child]; });
const run = (command, args, cwd = staging) => spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900000 });
const check = (command, args, label) => { const result = run(command, args); if (result.status !== 0) throw new Error(`${label} failed\n${result.stderr || result.stdout || ''}`); return result; };
const clean = () => fs.rmSync(staging, { recursive: true, force: true });
try {
  if (!fs.existsSync(zipPath)) throw new Error(`package not found: ${zipPath}`);
  const unzip = run('unzip', ['-q', zipPath, '-d', staging], root); if (unzip.status !== 0) throw new Error(unzip.stderr || 'unzip failed');
  const entries = walk(staging); const forbidden = entries.filter((entry) => entry === '.DS_Store' || entry.includes('/.DS_Store') || entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.includes('browser-profiles/')); if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
  const required = [
    'AUDIT-START-HERE.md', 'STAGE8-2G-D-A-DELIVERY.md', 'assets/battle/asset-manifest.json', 'scripts/generate-stage8-2G-D-A-assets.mjs', 'js/battle-presentation/environment/animation-resolver.js',
    'tests/stage8-2G-D-A-test.mjs', 'tests/stage8-2G-D-A-animation-determinism-test.mjs', 'tests/browser/stage8-2G-D-A-evidence.mjs', 'tests/verify-stage8-2G-D-A-evidence.mjs', 'tests/stage8-2G-D-A-evidence-tamper-test.mjs',
    'stage8_2g_da_asset_manifest_check.json', 'stage8_2g_da_animation_matrix.json', 'stage8_2g_da_animation_determinism.json', 'stage8_2g_da_browser_capture_manifest.json', 'stage8_2g_da_machine_semantic_evidence.json', 'stage8_2g_da_tamper_results.json',
    'screenshots/stage8-2G-D-A/d-a-01-friendly-unit-lineup.png', 'screenshots/stage8-2G-D-A/d-a-12-asset-fallback.png',
    'tests/stage8-2G-C-1-1a-test.mjs', 'tests/verify-stage8-2G-C-1-1a-evidence.mjs', 'stage8_2g_c11a_machine_semantic_evidence.json', 'stage8_2g_c11a_browser_capture_manifest.json',
    'tests/stage8-2G-B-1-1a-test.mjs', 'tests/stage8-2G-B-1-1a-evidence-tamper-test.mjs', 'stage8_2g_b11a_machine_semantic_evidence.json', 'stage8_2g_b11a_browser_capture_manifest.json'
  ];
  const missing = required.filter((file) => !fs.existsSync(path.join(staging, file))); if (missing.length) throw new Error(`missing D-A package files: ${missing.join(', ')}`);
  check(process.execPath, ['tests/verify-stage8-2G-D-A-evidence.mjs'], 'D-A evidence'); check(process.execPath, ['tests/stage8-2G-D-A-test.mjs'], 'D-A node'); check(process.execPath, ['tests/stage8-2G-D-A-animation-determinism-test.mjs'], 'D-A determinism'); check(process.execPath, ['tests/stage8-2G-D-A-evidence-tamper-test.mjs'], 'D-A tamper');
  check(process.execPath, ['tests/stage8-2G-C-1-1a-test.mjs'], 'C.1.1a regression'); check(process.execPath, ['tests/stage8-2G-C-1-1a-evidence-tamper-test.mjs'], 'C.1.1a tamper'); check(process.execPath, ['tests/stage8-2G-C-1-1-test.mjs'], 'C.1.1 regression'); check(process.execPath, ['tests/stage8-2G-C-1-1-evidence-tamper-test.mjs'], 'C.1.1 tamper'); check(process.execPath, ['tests/stage8-2G-B-1-1a-test.mjs'], 'B.1.1a regression'); check(process.execPath, ['tests/stage8-2G-B-1-1a-evidence-tamper-test.mjs'], 'B.1.1a tamper');
  let cleanInstall = null; let npmTest = null;
  if (!skipFull) { cleanInstall = check('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], 'clean npm install'); npmTest = check('npm', ['test'], 'clean npm test'); }
  const record = { stage: '8.2G-D-A', package: path.basename(zipPath), packageSha256: sha(zipPath), packageBytes: fs.statSync(zipPath).size, entries: entries.length, cleanInstall: cleanInstall ? { command: 'npm install --ignore-scripts --no-audit --no-fund', status: cleanInstall.status } : 'skipped', npmTest: npmTest ? { command: 'npm test', status: npmTest.status } : 'skipped', passed: true };
  fs.writeFileSync(path.join(root, 'stage8_2g_da_clean_package_test.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, stage: '8.2G-D-A', package: zipPath, packageSha256: record.packageSha256, packageBytes: record.packageBytes, entries: record.entries, evidence: 'passed', regressions: 'passed', fullGate: skipFull ? 'skipped' : 'passed' }));
} catch (error) { console.error(JSON.stringify({ ok: false, stage: '8.2G-D-A', package: zipPath, message: error.message || String(error), fullGate: skipFull ? 'skipped' : 'required' })); process.exitCode = 1; } finally { clean(); }
