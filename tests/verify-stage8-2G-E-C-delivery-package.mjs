import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyECEvidenceBundle } from './lib/stage8-2G-EC-strong-integration-verifier.mjs';

const root = process.cwd();
const arg = process.argv.find((item) => item.endsWith('.zip'));
const zipPath = path.resolve(arg || path.join(root, 'iron-command-stage8-2G-E-C-offline-progression-closure.zip'));
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-EC-verify-'));
const run = (command, args, cwd = staging, options = {}) => spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 3_600_000, ...options });
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const child = rel ? `${rel}/${entry.name}` : entry.name; return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child]; });
const required = [
  'package.json', 'index.html', 'js/offline.js', 'js/save.js', 'js/ui.js', 'tests/stage8-2G-E-C-offline-progression-test.mjs',
  'tests/stage8-2G-E-C-performance-test.mjs', 'tests/lib/stage8-2G-EC-strong-integration-verifier.mjs', 'tests/browser/stage8-2G-E-C-offline-progression.mjs',
  'stage8_2g_ec_browser_capture_manifest.json', 'stage8_2g_ec_evidence_bundle.json', 'stage8_2g_ec_strong_evidence_verdict.json',
  'stage8_2g_ec_developer_selfcheck.json', 'stage8_2g_ec_tamper_results.json', 'stage8_2g_ec_performance_check.json', 'STAGE8-2G-E-C-DELIVERY.md',
  'screenshots/stage8-2G-E-C/ec-04-offline-report-viewed.png', 'screenshots/stage8-2G-E-C/ec-08-running-after-offline-reload.png'
];
try {
  if (!fs.existsSync(zipPath)) throw new Error(`package not found: ${zipPath}`);
  const unzip = run('unzip', ['-q', zipPath, '-d', staging], root);
  if (unzip.status !== 0) throw new Error(unzip.stderr || 'unzip failed');
  const entries = walk(staging);
  const forbidden = entries.filter((entry) => entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.includes('browser-profiles/') || entry.includes('__MACOSX/') || entry.endsWith('.DS_Store'));
  if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
  const stale = entries.filter((entry) => /stage8_2g_(?:ec|eb)_(?:final_package_record|clean_package_test)\.json$/.test(entry));
  if (stale.length) throw new Error(`stale package records in ZIP: ${stale.join(', ')}`);
  const missing = required.filter((file) => !fs.existsSync(path.join(staging, file)));
  if (missing.length) throw new Error(`missing E-C package files: ${missing.join(', ')}`);
  const install = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  if (install.status !== 0) throw new Error(install.stderr || 'clean npm install failed');
  const focused = run('npm', ['run', 'test:stage8-2G-E-C']);
  if (focused.status !== 0) throw new Error(focused.stderr || focused.stdout || 'E-C focused test failed');
  const regression = run('npm', ['run', 'browser:stage8-2G-E-B']);
  if (regression.status !== 0) throw new Error(regression.stderr || regression.stdout || 'clean E-B regression browser failed');
  const browserRun = run('npm', ['run', 'browser:stage8-2G-E-C']);
  if (browserRun.status !== 0) throw new Error(browserRun.stderr || browserRun.stdout || 'clean E-C browser rerun failed');
  const bundle = JSON.parse(fs.readFileSync(path.join(staging, 'stage8_2g_ec_evidence_bundle.json'), 'utf8'));
  const verdict = verifyECEvidenceBundle(bundle, { root: staging });
  if (!verdict.ok) throw new Error(`E-C strong verifier failed: ${verdict.errors.join(',')}`);
  const strong = run(process.execPath, ['tests/stage8-2G-E-C-strong-evidence-test.mjs']);
  if (strong.status !== 0) throw new Error(strong.stderr || strong.stdout || 'E-C strong evidence test failed');
  const tamper = run(process.execPath, ['tests/stage8-2G-E-C-evidence-tamper-test.mjs']);
  if (tamper.status !== 0) throw new Error(tamper.stderr || tamper.stdout || 'E-C tamper test failed');
  const ordinary = run('npm', ['test'], staging, { timeout: 1_800_000 });
  if (ordinary.status !== 0) throw new Error(ordinary.stderr || ordinary.stdout || 'clean npm test failed');
  const record = { stage: '8.2G-E-C', package: path.basename(zipPath), packageSha256: sha(zipPath), packageBytes: fs.statSync(zipPath).size, entries: entries.length, packageHygiene: { forbiddenEntries: forbidden, nestedZipFound: false, staleFinalPackageRecordInZip: false }, install: 'passed', focusedEC: 'passed', regressionEBBrowser: 'passed', cleanPackageBrowserRerun: 'passed', strongEvidence: 'passed', tamper: 'passed', ordinaryNpmTest: 'passed', passed: true };
  fs.writeFileSync(path.join(root, 'stage8_2g_ec_clean_package_test.json'), `${JSON.stringify(record, null, 2)}\n`);
  const finalRecordPath = path.join(root, 'stage8_2g_ec_final_package_record.json');
  if (fs.existsSync(finalRecordPath)) { const final = JSON.parse(fs.readFileSync(finalRecordPath, 'utf8')); final.cleanPackageGate = 'passed'; final.cleanPackageTest = record; fs.writeFileSync(finalRecordPath, `${JSON.stringify(final, null, 2)}\n`); }
  console.log(JSON.stringify({ ok: true, stage: record.stage, package: zipPath, sha256: record.packageSha256, bytes: record.packageBytes, entries: record.entries }));
} catch (error) { console.error(JSON.stringify({ ok: false, stage: '8.2G-E-C', package: zipPath, message: error.message || String(error) })); process.exitCode = 1; }
finally { fs.rmSync(staging, { recursive: true, force: true }); }
