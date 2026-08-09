import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packageName = 'iron-command-stage8-2G-E-A-production-loop-integration.zip';
const packagePath = path.join(root, packageName);
const run = (command, args, cwd = root, options = {}) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 3_600_000, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`);
  return result;
};
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const allowedScreenshots = ['screenshots/stage8-2G-B-1-1a', 'screenshots/stage8-2G-C-1', 'screenshots/stage8-2G-C-1-1', 'screenshots/stage8-2G-C-1-1a', 'screenshots/stage8-2G-D-A', 'screenshots/stage8-2G-D-A-1', 'screenshots/stage8-2G-D-A-1a', 'screenshots/stage8-2G-D-B', 'screenshots/stage8-2G-D-B-1', 'screenshots/stage8-2G-D-B-1a', 'screenshots/stage8-2G-D-C', 'screenshots/stage8-2G-E-A'];
const skip = (rel, name) => {
  if (name === '.DS_Store' || name.toLowerCase().endsWith('.zip')) return true;
  if (['node_modules', '.git', 'output', 'artifacts', '__MACOSX', '.codex', 'browser-profiles'].includes(name)) return true;
  if (rel.startsWith('tests/outputs/') || rel.startsWith('tests/evidence/')) return true;
  if (rel.startsWith('screenshots/') && !allowedScreenshots.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) return true;
  if (/^stage8_2g_ea_(?:final_package_record|clean_package_test)\.json$/.test(name)) return true;
  return false;
};
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const child = rel ? `${rel}/${entry.name}` : entry.name; return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child]; });
const copy = (from, to, rel = '') => {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (skip(child, entry.name)) continue;
    const source = path.join(from, entry.name); const target = path.join(to, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copy(source, target, child); }
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
  }
};

run('npm', ['run', 'browser:stage8-2G-E-A']);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-EA-package-'));
try {
  copy(root, staging);
  const entriesBeforeManifest = walk(staging).sort();
  const forbidden = entriesBeforeManifest.filter((entry) => entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.includes('browser-profiles/'));
  if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
  const required = [
    'package.json', 'js/production-battle-session.js', 'js/state.js', 'js/save.js', 'js/theater.js', 'js/main.js', 'js/ui.js',
    'tests/stage8-2G-E-A-test.mjs', 'tests/lib/stage8-2G-EA-strong-integration-verifier.mjs', 'tests/browser/stage8-2G-E-A-production-loop.mjs',
    'tests/generate-stage8-2G-EA-machine-evidence.mjs', 'tests/generate-stage8-2G-EA-evidence.mjs', 'tests/generate-stage8-2G-EA-developer-selfcheck.mjs',
    'tests/stage8-2G-E-A-strong-evidence-test.mjs', 'stage8_2g_ea_machine_evidence.json', 'stage8_2g_ea_browser_capture_manifest.json',
    'stage8_2g_ea_battle_session_check.json', 'stage8_2g_ea_deployment_binding.json', 'stage8_2g_ea_formal_report_binding.json',
    'stage8_2g_ea_settlement_check.json', 'stage8_2g_ea_save_diff_check.json', 'stage8_2g_ea_resume_check.json',
    'stage8_2g_ea_replay_protection_check.json', 'stage8_2g_ea_authority_check.json', 'stage8_2g_ea_tamper_results.json',
    'stage8_2g_ea_developer_selfcheck.json', 'stage8_2g_ea_evidence_bundle.json', 'stage8_2g_ea_strong_evidence_verdict.json',
    'screenshots/stage8-2G-E-A/e-a-01-base-overview.png', 'screenshots/stage8-2G-E-A/e-a-11-returned-base.png'
  ];
  const missing = required.filter((file) => !fs.existsSync(path.join(staging, file)));
  if (missing.length) throw new Error(`missing E-A package files: ${missing.join(', ')}`);
  fs.writeFileSync(path.join(staging, 'delivery-file-manifest.json'), `${JSON.stringify({ stage: '8.2G-E-A', package: packageName, recordType: 'source_manifest', entries: entriesBeforeManifest.map((file) => ({ path: file, sha256: sha(path.join(staging, file)) })) }, null, 2)}\n`);
  fs.rmSync(packagePath, { force: true });
  run('zip', ['-qr', packagePath, '.'], staging);
  const selfcheck = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_ea_developer_selfcheck.json'), 'utf8'));
  const tamper = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_ea_tamper_results.json'), 'utf8'));
  const browser = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_ea_browser_capture_manifest.json'), 'utf8'));
  const record = { stage: '8.2G-E-A', recordType: 'external_final_package_record', package: packageName, packageSha256: sha(packagePath), packageBytes: fs.statSync(packagePath).size, entries: entriesBeforeManifest.length + 1, branch: 'agent/stage8-2G-E-A-production-loop-integration', baseline: { stage: '8.2G-D-C.1', commit: 'd2afd98113c5410022df5ccc5bfd28c41977a4d7' }, scope: { productionLoopIntegrationOnly: true, formalReportConsumedAsReadOnly: true, solverModified: false, plannerModified: false, choreographerModified: false, formalRepairAuthorityModified: false, settlementCalculationModified: false }, browser: { captureCount: browser.browser.captureCount, uniqueImageHashes: browser.browser.uniqueImageHashes, pageErrors: browser.browser.pageErrors, consoleErrors: browser.browser.consoleErrors }, tamper: { rejectionCount: tamper.rejectionCount, passed: tamper.passed }, selfcheck: selfcheck.passed === true, cleanPackageGate: 'pending-package-verifier' };
  fs.writeFileSync(path.join(root, 'stage8_2g_ea_final_package_record.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, stage: record.stage, package: packagePath, sha256: record.packageSha256, bytes: record.packageBytes, entries: record.entries, screenshots: record.browser.captureCount }));
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
