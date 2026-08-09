import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packageName = 'iron-command-stage8-2G-E-A-1-replay-persistence-closure.zip';
const packagePath = path.join(root, packageName);
const run = (command, args, cwd = root, options = {}) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, timeout: 3_600_000, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`);
  return result;
};
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const allowedScreenshots = [
  'screenshots/stage8-2G-B-1-1a', 'screenshots/stage8-2G-C-1', 'screenshots/stage8-2G-C-1-1', 'screenshots/stage8-2G-C-1-1a',
  'screenshots/stage8-2G-D-A', 'screenshots/stage8-2G-D-A-1', 'screenshots/stage8-2G-D-A-1a', 'screenshots/stage8-2G-D-B',
  'screenshots/stage8-2G-D-B-1', 'screenshots/stage8-2G-D-B-1a', 'screenshots/stage8-2G-D-C', 'screenshots/stage8-2G-E-A', 'screenshots/stage8-2G-E-A-1'
];
const skip = (rel, name) => {
  if (name === '.DS_Store' || name.toLowerCase().endsWith('.zip')) return true;
  if (['node_modules', '.git', 'output', 'artifacts', '__MACOSX', '.codex', 'browser-profiles'].includes(name)) return true;
  if (rel.startsWith('tests/outputs/') || rel.startsWith('tests/evidence/')) return true;
  if (rel.startsWith('screenshots/') && !allowedScreenshots.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) return true;
  if (/^stage8_2g_ea1_(?:final_package_record|clean_package_test)\.json$/.test(name)) return true;
  return false;
};
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const child = rel ? `${rel}/${entry.name}` : entry.name;
  return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child];
});
const copy = (from, to, rel = '') => {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (skip(child, entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copy(source, target, child); }
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
  }
};

run('npm', ['run', 'browser:stage8-2G-E-A-1']);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-EA1-package-'));
try {
  copy(root, staging);
  const entriesBeforeManifest = walk(staging).sort();
  const forbidden = entriesBeforeManifest.filter((entry) => entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.includes('browser-profiles/'));
  if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
  const required = [
    'package.json', 'js/save-diff.js', 'js/production-battle-session.js', 'js/save.js', 'js/theater.js', 'js/main.js', 'js/ui.js',
    'tests/stage8-2G-E-A-test.mjs', 'tests/stage8-2G-E-A-1-replay-reload-test.mjs', 'tests/lib/stage8-2G-EA1-strong-integration-verifier.mjs',
    'tests/browser/stage8-2G-E-A-1-replay-persistence.mjs', 'tests/generate-stage8-2G-EA1-machine-evidence.mjs', 'tests/generate-stage8-2G-EA1-evidence.mjs',
    'tests/stage8-2G-E-A-1-strong-evidence-test.mjs', 'tests/stage8-2G-E-A-1-evidence-tamper-test.mjs', 'tests/generate-stage8-2G-EA1-developer-selfcheck.mjs',
    'stage8_2g_ea1_final_report.md',
    'stage8_2g_ea1_machine_evidence.json', 'stage8_2g_ea1_browser_capture_manifest.json', 'stage8_2g_ea1_evidence_bundle.json',
    'stage8_2g_ea1_replay_persistence_check.json', 'stage8_2g_ea1_replay_formation_check.json', 'stage8_2g_ea1_real_reload_check.json',
    'stage8_2g_ea1_ui_path_check.json', 'stage8_2g_ea1_save_diff_check.json', 'stage8_2g_ea1_settlement_reload_check.json',
    'stage8_2g_ea1_authority_check.json', 'stage8_2g_ea1_tamper_results.json', 'stage8_2g_ea1_strong_evidence_verdict.json', 'stage8_2g_ea1_developer_selfcheck.json',
    'screenshots/stage8-2G-E-A-1/e-a1-01-base-before-battle.png', 'screenshots/stage8-2G-E-A-1/e-a1-11-save-diff-summary.png'
  ];
  const missing = required.filter((file) => !fs.existsSync(path.join(staging, file)));
  if (missing.length) throw new Error(`missing E-A.1 package files: ${missing.join(', ')}`);
  fs.writeFileSync(path.join(staging, 'delivery-file-manifest.json'), `${JSON.stringify({ stage: '8.2G-E-A.1', package: packageName, recordType: 'source_manifest', entries: entriesBeforeManifest.map((file) => ({ path: file, sha256: sha(path.join(staging, file)) })) }, null, 2)}\n`);
  fs.rmSync(packagePath, { force: true });
  run('zip', ['-qr', packagePath, '.'], staging);
  const browser = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_ea1_browser_capture_manifest.json'), 'utf8'));
  const tamper = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_ea1_tamper_results.json'), 'utf8'));
  const saveDiff = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_ea1_save_diff_check.json'), 'utf8'));
  const selfcheck = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_ea1_developer_selfcheck.json'), 'utf8'));
  const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const record = {
    stage: '8.2G-E-A.1', recordType: 'external_final_package_record', package: packageName,
    packageSha256: sha(packagePath), packageBytes: fs.statSync(packagePath).size, entries: entriesBeforeManifest.length + 1,
    branch: run('git', ['branch', '--show-current']).stdout.trim(), baseline: { stage: '8.2G-E-A', commit: '58cb6c97fd2000fd6c7c7bb11a8e54e053c0ebac' }, finalHead: head,
    scope: { replayPersistenceAndSaveDiffClosure: true, formalReportReadOnly: true, solverModified: false, plannerModified: false, choreographerModified: false, formalRepairAuthorityModified: false, settlementCalculationModified: false, presentationModifiedOnlyForUiBinding: true },
    browser: { captureCount: browser.browser.captureCount, uniqueImageHashes: browser.browser.uniqueImageHashes, realReloads: browser.realReloads.length, pageErrors: browser.browser.pageErrors, consoleErrors: browser.browser.consoleErrors, productionUiActions: browser.actionProvenance.length, dispatchApiUsed: browser.dispatchApiUsed, replayApiUsed: browser.replayApiUsed },
    saveDiff: { passed: saveDiff.passed, beforeHash: saveDiff.beforeHash, afterHash: saveDiff.afterHash, changedPaths: saveDiff.changedPaths.length, unexpectedChangedPaths: saveDiff.unexpectedChangedPaths },
    tamper: { rejectionCount: tamper.rejectionCount, passed: tamper.passed }, selfcheck: selfcheck.passed === true,
    packageHygiene: { forbiddenEntries: forbidden, nestedZipFound: false, staleFinalPackageRecordInZip: false }, cleanPackageGate: 'pending-package-verifier'
  };
  fs.writeFileSync(path.join(root, 'stage8_2g_ea1_final_package_record.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, stage: record.stage, package: packagePath, sha256: record.packageSha256, bytes: record.packageBytes, entries: record.entries, realReloads: record.browser.realReloads, tamperRejectionCount: record.tamper.rejectionCount }));
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
