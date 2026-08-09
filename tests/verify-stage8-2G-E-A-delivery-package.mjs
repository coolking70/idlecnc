import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyEAEvidenceBundle } from './lib/stage8-2G-EA-strong-integration-verifier.mjs';

const root = process.cwd();
const arg = process.argv.find((item) => item.endsWith('.zip'));
const zipPath = path.resolve(arg || path.join(root, 'iron-command-stage8-2G-E-A-production-loop-integration.zip'));
const skipFull = process.argv.includes('--skip-full');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-EA-verify-'));
const run = (command, args, cwd = staging, options = {}) => spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 3_600_000, ...options });
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const child = rel ? `${rel}/${entry.name}` : entry.name; return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child]; });
const required = ['package.json', 'js/production-battle-session.js', 'tests/stage8-2G-E-A-test.mjs', 'tests/lib/stage8-2G-EA-strong-integration-verifier.mjs', 'tests/browser/stage8-2G-E-A-production-loop.mjs', 'stage8_2g_ea_browser_capture_manifest.json', 'stage8_2g_ea_evidence_bundle.json', 'stage8_2g_ea_strong_evidence_verdict.json', 'stage8_2g_ea_developer_selfcheck.json', 'screenshots/stage8-2G-E-A/e-a-01-base-overview.png', 'screenshots/stage8-2G-E-A/e-a-11-returned-base.png'];
try {
  if (!fs.existsSync(zipPath)) throw new Error(`package not found: ${zipPath}`);
  const unzip = run('unzip', ['-q', zipPath, '-d', staging], root); if (unzip.status !== 0) throw new Error(unzip.stderr || 'unzip failed');
  const entries = walk(staging); const forbidden = entries.filter((entry) => entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.includes('browser-profiles/') || entry.includes('.DS_Store')); if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
  const missing = required.filter((file) => !fs.existsSync(path.join(staging, file))); if (missing.length) throw new Error(`missing E-A package files: ${missing.join(', ')}`);
  const stale = entries.filter((entry) => /stage8_2g_ea_(?:final_package_record|clean_package_test)\.json$/.test(path.basename(entry))); if (stale.length) throw new Error(`stale package record in zip: ${stale.join(', ')}`);
  const install = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']); if (install.status !== 0) throw new Error(install.stderr || 'clean npm install failed');
  const focused = run(process.execPath, ['tests/stage8-2G-E-A-test.mjs']); if (focused.status !== 0) throw new Error(focused.stderr || focused.stdout || 'focused E-A test failed');
  const generate = run(process.execPath, ['tests/generate-stage8-2G-EA-evidence.mjs']); if (generate.status !== 0) throw new Error(generate.stderr || generate.stdout || 'E-A evidence generation failed');
  const strong = run(process.execPath, ['tests/stage8-2G-E-A-strong-evidence-test.mjs']); if (strong.status !== 0) throw new Error(strong.stderr || strong.stdout || 'E-A strong verifier failed');
  const bundle = JSON.parse(fs.readFileSync(path.join(staging, 'stage8_2g_ea_evidence_bundle.json'), 'utf8')); const verdict = verifyEAEvidenceBundle(bundle, { root: staging }); if (!verdict.ok) throw new Error(`E-A package evidence failed: ${verdict.errors.join(',')}`);
  const full = skipFull ? { status: 0, stdout: 'SKIPPED by --skip-full', stderr: '' } : run('npm', ['test'], staging, { timeout: 1_800_000 }); if (!skipFull && full.status !== 0) throw new Error(full.stderr || full.stdout || 'clean npm test failed');
  const record = { stage: '8.2G-E-A', package: path.basename(zipPath), packageSha256: sha(zipPath), packageBytes: fs.statSync(zipPath).size, entries: entries.length, packageHygiene: { forbiddenEntries: forbidden, staleFinalPackageRecordInZip: false }, install: { command: 'npm install --ignore-scripts --no-audit --no-fund', status: install.status }, focused: 'passed', strongEvidence: 'passed', cleanNpmTest: skipFull ? 'skipped' : 'passed', passed: true };
  fs.writeFileSync(path.join(root, 'stage8_2g_ea_clean_package_test.json'), `${JSON.stringify(record, null, 2)}\n`);
  const finalRecordPath = path.join(root, 'stage8_2g_ea_final_package_record.json'); if (fs.existsSync(finalRecordPath)) { const final = JSON.parse(fs.readFileSync(finalRecordPath, 'utf8')); final.cleanPackageGate = skipFull ? 'passed-install-focused-strong-skip-full' : 'passed'; final.cleanPackageTest = record; fs.writeFileSync(finalRecordPath, `${JSON.stringify(final, null, 2)}\n`); }
  console.log(JSON.stringify({ ok: true, stage: record.stage, package: zipPath, sha256: record.packageSha256, bytes: record.packageBytes, entries: record.entries, cleanNpmTest: record.cleanNpmTest }));
} catch (error) { console.error(JSON.stringify({ ok: false, stage: '8.2G-E-A', package: zipPath, message: error.message || String(error) })); process.exitCode = 1; } finally { fs.rmSync(staging, { recursive: true, force: true }); }
