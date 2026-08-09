import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyEA1EvidenceBundle } from './lib/stage8-2G-EA1-strong-integration-verifier.mjs';

const root = process.cwd();
const arg = process.argv.find((item) => item.endsWith('.zip'));
const zipPath = path.resolve(arg || path.join(root, 'iron-command-stage8-2G-E-A-1-replay-persistence-closure.zip'));
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-EA1-verify-'));
const run = (command, args, cwd = staging, options = {}) => spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 3_600_000, ...options });
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const child = rel ? `${rel}/${entry.name}` : entry.name; return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child]; });
const required = [
  'package.json', 'js/save-diff.js', 'js/production-battle-session.js', 'tests/stage8-2G-E-A-test.mjs', 'tests/stage8-2G-E-A-1-replay-reload-test.mjs',
  'tests/lib/stage8-2G-EA1-strong-integration-verifier.mjs', 'tests/browser/stage8-2G-E-A-1-replay-persistence.mjs', 'stage8_2g_ea1_browser_capture_manifest.json',
  'stage8_2g_ea1_final_report.md',
  'stage8_2g_ea1_evidence_bundle.json', 'stage8_2g_ea1_strong_evidence_verdict.json', 'stage8_2g_ea1_developer_selfcheck.json',
  'stage8_2g_ea1_replay_persistence_check.json', 'stage8_2g_ea1_replay_formation_check.json', 'stage8_2g_ea1_real_reload_check.json', 'stage8_2g_ea1_ui_path_check.json',
  'stage8_2g_ea1_save_diff_check.json', 'stage8_2g_ea1_settlement_reload_check.json', 'stage8_2g_ea1_authority_check.json', 'stage8_2g_ea1_tamper_results.json',
  'screenshots/stage8-2G-E-A-1/e-a1-01-base-before-battle.png', 'screenshots/stage8-2G-E-A-1/e-a1-11-save-diff-summary.png'
];
try {
  if (!fs.existsSync(zipPath)) throw new Error(`package not found: ${zipPath}`);
  const unzip = run('unzip', ['-q', zipPath, '-d', staging], root);
  if (unzip.status !== 0) throw new Error(unzip.stderr || 'unzip failed');
  const entries = walk(staging);
  const forbidden = entries.filter((entry) => entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.includes('browser-profiles/') || entry.includes('.DS_Store'));
  if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
  const missing = required.filter((file) => !fs.existsSync(path.join(staging, file)));
  if (missing.length) throw new Error(`missing E-A.1 package files: ${missing.join(', ')}`);
  const install = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  if (install.status !== 0) throw new Error(install.stderr || 'clean npm install failed');
  const focused = run(process.execPath, ['tests/stage8-2G-E-A-1-replay-reload-test.mjs']);
  if (focused.status !== 0) throw new Error(focused.stderr || focused.stdout || 'E-A.1 focused test failed');
  const originalEA = run(process.execPath, ['tests/stage8-2G-E-A-test.mjs']);
  if (originalEA.status !== 0) throw new Error(originalEA.stderr || originalEA.stdout || 'original E-A test failed');
  // This is deliberately a fresh browser run inside the extracted package;
  // it regenerates the manifest and PNGs instead of trusting packaged evidence.
  const browserRun = run('npm', ['run', 'browser:stage8-2G-E-A-1']);
  if (browserRun.status !== 0) throw new Error(browserRun.stderr || browserRun.stdout || 'clean package browser rerun failed');
  const bundle = JSON.parse(fs.readFileSync(path.join(staging, 'stage8_2g_ea1_evidence_bundle.json'), 'utf8'));
  const verdict = verifyEA1EvidenceBundle(bundle, { root: staging });
  if (!verdict.ok) throw new Error(`E-A.1 strong verifier failed: ${verdict.errors.join(',')}`);
  const tamper = run(process.execPath, ['tests/stage8-2G-E-A-1-evidence-tamper-test.mjs']);
  if (tamper.status !== 0) throw new Error(tamper.stderr || tamper.stdout || 'E-A.1 tamper test failed');
  const ordinary = run('npm', ['test'], staging, { timeout: 1_800_000 });
  if (ordinary.status !== 0) throw new Error(ordinary.stderr || ordinary.stdout || 'clean npm test failed');
  const record = { stage: '8.2G-E-A.1', package: path.basename(zipPath), packageSha256: sha(zipPath), packageBytes: fs.statSync(zipPath).size, entries: walk(staging).length, packageHygiene: { forbiddenEntries: forbidden, nestedZipFound: false, staleFinalPackageRecordInZip: false }, install: 'passed', focusedEA1: 'passed', originalEA13of13: 'passed', cleanPackageBrowserRerun: 'passed', strongEvidence: 'passed', tamper: 'passed', ordinaryNpmTest: 'passed', passed: true };
  fs.writeFileSync(path.join(root, 'stage8_2g_ea1_clean_package_test.json'), `${JSON.stringify(record, null, 2)}\n`);
  const finalRecordPath = path.join(root, 'stage8_2g_ea1_final_package_record.json');
  if (fs.existsSync(finalRecordPath)) { const final = JSON.parse(fs.readFileSync(finalRecordPath, 'utf8')); final.cleanPackageGate = 'passed'; final.cleanPackageTest = record; fs.writeFileSync(finalRecordPath, `${JSON.stringify(final, null, 2)}\n`); }
  console.log(JSON.stringify({ ok: true, stage: record.stage, package: zipPath, sha256: record.packageSha256, bytes: record.packageBytes, entries: record.entries }));
} catch (error) { console.error(JSON.stringify({ ok: false, stage: '8.2G-E-A.1', package: zipPath, message: error.message || String(error) })); process.exitCode = 1; }
finally { fs.rmSync(staging, { recursive: true, force: true }); }
