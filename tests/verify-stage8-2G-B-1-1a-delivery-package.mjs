import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyEvidenceDirectory } from './lib/verify-stage8-2G-B-1-1a-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipArg = process.argv.find((arg) => arg.endsWith('.zip'));
const zipPath = path.resolve(zipArg || path.join(root, 'iron-command-stage8-2G-B-1-1a-evidence-integrity-hotfix.zip'));
const skipFull = process.argv.includes('--skip-full');
const run = (command, args, cwd, options = {}) => spawnSync(command, args, { cwd, encoding: 'utf8', ...options });
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-B11a-verify-'));
const cleanup = () => fs.rmSync(staging, { recursive: true, force: true });
try {
  if (!fs.existsSync(zipPath)) throw new Error(`package not found: ${zipPath}`);
  const unzip = run('unzip', ['-q', zipPath, '-d', staging], root); if (unzip.status !== 0) throw new Error(unzip.stderr || 'unzip failed');
  const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const child = rel ? `${rel}/${entry.name}` : entry.name; return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child]; });
  const entries = walk(staging); const forbidden = entries.filter((entry) => entry === '.DS_Store' || entry.includes('/.DS_Store') || entry === '__MACOSX' || entry.startsWith('__MACOSX/') || entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.startsWith('artifacts/') || entry.includes('browser-profiles/') || /(^|\/)(\.env|.*\.(pem|key|p12))$/i.test(entry));
  if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
  const stale = entries.filter((entry) => /(^|\/)stage8_2g_b11_(browser_evidence_manifest|evidence_binding_check|full_test|package_hygiene|developer_selfcheck)\.json$/i.test(entry)); if (stale.length) throw new Error(`stale B.1.1 evidence included: ${stale.join(', ')}`);
  const required = ['stage8_2g_b11a_machine_semantic_evidence.json', 'stage8_2g_b11a_browser_capture_manifest.json', 'stage8_2g_b11a_evidence_binding_check.json', 'stage8_2g_b11a_full_test.json', 'stage8_2g_b11a_package_hygiene.json', 'stage8_2g_b11a_developer_selfcheck.json', 'STAGE8-2G-B-1-1A-DELIVERY.md', 'tests/stage8-2G-B-1-1a-test.mjs', 'tests/stage8-2G-B-1-1a-evidence-tamper-test.mjs']; const missing = required.filter((file) => !fs.existsSync(path.join(staging, file))); if (missing.length) throw new Error(`missing B.1.1a delivery files: ${missing.join(', ')}`);
  for (const file of ['stage8_2g_b11a_full_test.json', 'stage8_2g_b11a_package_hygiene.json']) { const text = fs.readFileSync(path.join(staging, file), 'utf8'); if (/pending[_-]/i.test(text)) throw new Error(`pending final evidence: ${file}`); }
  const evidence = verifyEvidenceDirectory(staging); if (!evidence.ok) throw new Error(`strong evidence binding failed: ${JSON.stringify(evidence)}`);
  const b11 = run(process.execPath, ['tests/stage8-2G-B-1-1-test.mjs'], staging, { timeout: 120000 }); if (b11.status !== 0) throw new Error(b11.stderr || b11.stdout || 'B.1.1 regression failed');
  const b1 = run(process.execPath, ['tests/stage8-2G-B-1-test.mjs'], staging, { timeout: 120000 }); if (b1.status !== 0) throw new Error(b1.stderr || b1.stdout || 'B.1 regression failed');
  const install = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], staging, { timeout: 120000 }); if (install.status !== 0) throw new Error(install.stderr || 'clean npm install failed');
  const fullStarted = Date.now(); const full = skipFull ? { status: 0, stdout: 'SKIPPED by --skip-full', stderr: '' } : run('npm', ['test'], staging, { timeout: 900000 }); const fullDuration = Date.now() - fullStarted; if (!skipFull && full.status !== 0) throw new Error(full.stderr || full.stdout || 'clean npm test failed');
  const packageSha256 = sha(zipPath); const output = { ok: true, stage: '8.2G-B.1.1a', package: zipPath, packageSha256, packageBytes: fs.statSync(zipPath).size, evidence, b1: { exitCode: b1.status, output: (b1.stdout || '').trim() }, b11: { exitCode: b11.status, output: (b11.stdout || '').trim() }, full: { status: skipFull ? 'skipped' : 'passed', exitCode: skipFull ? null : full.status, wallClockDurationMs: fullDuration, outputTail: `${full.stdout || ''}${full.stderr || ''}`.slice(-5000) }, hygiene: { forbiddenCount: forbidden.length, staleCount: stale.length, entries: entries.length } };
  cleanup(); console.log(JSON.stringify(output));
} catch (error) { cleanup(); console.error(JSON.stringify({ ok: false, stage: '8.2G-B.1.1a', package: zipPath, message: error.message || String(error) })); process.exitCode = 1; }
