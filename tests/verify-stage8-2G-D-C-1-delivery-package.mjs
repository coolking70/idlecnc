import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const arg = process.argv.find((item) => item.endsWith('.zip'));
const zipPath = path.resolve(arg || path.join(root, 'iron-command-stage8-2G-D-C-1-strong-evidence-performance.zip'));
const skipFull = process.argv.includes('--skip-full');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-DC1-verify-'));
const run = (command, args, cwd = staging, options = {}) => spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 3_600_000, ...options });
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const child = rel ? `${rel}/${entry.name}` : entry.name; return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child]; });
const required = ['package.json', 'js/battle-presentation/effects/presentation-effects-runtime.js', 'js/battle-presentation/universal/universal-render-state.js', 'tests/lib/stage8-2G-DC1-strong-evidence-verifier.mjs', 'tests/stage8-2G-D-C-1-weapon-family-test.mjs', 'tests/stage8-2G-D-C-1-performance-test.mjs', 'tests/stage8-2G-D-C-1-reduced-motion-test.mjs', 'tests/stage8-2G-D-C-1-evidence-tamper-test.mjs', 'tests/stage8-2G-D-C-1-strong-evidence-test.mjs', 'tests/browser/stage8-2G-D-C-1-evidence.mjs', 'stage8_2g_dc1_machine_evidence.json', 'stage8_2g_dc1_weapon_family_check.json', 'stage8_2g_dc1_semantic_resolution.json', 'stage8_2g_dc1_reduced_motion_check.json', 'stage8_2g_dc1_performance_check.json', 'stage8_2g_dc1_determinism_check.json', 'stage8_2g_dc1_authority_check.json', 'stage8_2g_dc1_tamper_results.json', 'stage8_2g_dc1_browser_capture_manifest.json', 'stage8_2g_dc1_strong_evidence_verdict.json', 'stage8_2g_dc1_developer_selfcheck.json', 'screenshots/stage8-2G-D-C/d-c-03-mbt-cannon-fire.png', 'screenshots/stage8-2G-D-C/d-c-09-burning-wreck.png', 'screenshots/stage8-2G-D-C/d-c-11-scout-fire.png', 'screenshots/stage8-2G-D-C/d-c-14-defeat-withdraw-outro.png'];
try {
  if (!fs.existsSync(zipPath)) throw new Error(`package not found: ${zipPath}`);
  const unzip = run('unzip', ['-q', zipPath, '-d', staging], root); if (unzip.status !== 0) throw new Error(unzip.stderr || 'unzip failed');
  const entries = walk(staging); const forbidden = entries.filter((entry) => entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.includes('browser-profiles/') || entry.includes('.DS_Store')); if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
  const missing = required.filter((file) => !fs.existsSync(path.join(staging, file))); if (missing.length) throw new Error(`missing D-C.1 package files: ${missing.join(', ')}`);
  const stale = entries.filter((entry) => /stage8_2g_dc1_(?:final_package_record|clean_package_test)\.json$/.test(path.basename(entry))); if (stale.length) throw new Error(`stale package record in zip: ${stale.join(', ')}`);
  const install = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']); if (install.status !== 0) throw new Error(install.stderr || 'clean npm install failed');
  const strong = run(process.execPath, ['tests/stage8-2G-D-C-1-strong-evidence-test.mjs']); if (strong.status !== 0) throw new Error(strong.stderr || strong.stdout || 'strong evidence failed');
  const tamper = run(process.execPath, ['tests/stage8-2G-D-C-1-evidence-tamper-test.mjs']); if (tamper.status !== 0) throw new Error(tamper.stderr || tamper.stdout || 'tamper gate failed');
  const selfcheck = run(process.execPath, ['tests/generate-stage8-2G-DC1-developer-selfcheck.mjs']); if (selfcheck.status !== 0) throw new Error(selfcheck.stderr || selfcheck.stdout || 'developer selfcheck failed');
  // The complete suite includes the 1,120-plan presentation corpus and the
  // browser-backed D-C/D-C.1 posttest chain. Keep the clean-package gate
  // strict, but give that same suite a bounded window that is larger than the
  // slowest supported local environment observed in practice.
  const full = skipFull ? { status: 0, stdout: 'SKIPPED by --skip-full', stderr: '' } : run('npm', ['test'], staging, { timeout: 1_800_000 }); if (!skipFull && full.status !== 0) throw new Error(full.stderr || full.stdout || 'clean npm test failed');
  const record = { stage: '8.2G-D-C.1', package: path.basename(zipPath), packageSha256: sha(zipPath), packageBytes: fs.statSync(zipPath).size, entries: entries.length, packageHygiene: { forbiddenEntries: forbidden, staleFinalPackageRecordInZip: false }, install: { command: 'npm install --ignore-scripts --no-audit --no-fund', status: install.status }, strongEvidence: JSON.parse(strong.stdout.trim().split('\n').at(-1)), tamper: JSON.parse(tamper.stdout.trim().split('\n').at(-1)), selfcheck: JSON.parse(selfcheck.stdout.trim().split('\n').at(-1)), cleanNpmTest: skipFull ? 'skipped' : 'passed', passed: true };
  fs.writeFileSync(path.join(root, 'stage8_2g_dc1_clean_package_test.json'), `${JSON.stringify(record, null, 2)}\n`);
  const finalRecordPath = path.join(root, 'stage8_2g_dc1_final_package_record.json'); if (fs.existsSync(finalRecordPath)) { const final = JSON.parse(fs.readFileSync(finalRecordPath, 'utf8')); final.cleanPackageGate = skipFull ? 'passed-install-strong-tamper-skip-full' : 'passed'; final.cleanPackageTest = record; fs.writeFileSync(finalRecordPath, `${JSON.stringify(final, null, 2)}\n`); }
  console.log(JSON.stringify({ ok: true, stage: record.stage, package: zipPath, sha256: record.packageSha256, bytes: record.packageBytes, entries: record.entries, cleanNpmTest: record.cleanNpmTest }));
} catch (error) { console.error(JSON.stringify({ ok: false, stage: '8.2G-D-C.1', package: zipPath, message: error.message || String(error) })); process.exitCode = 1; } finally { fs.rmSync(staging, { recursive: true, force: true }); }
