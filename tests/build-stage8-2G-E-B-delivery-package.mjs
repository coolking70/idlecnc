import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packageName = 'iron-command-stage8-2G-E-B-mission-deployment-command-flow.zip';
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
  'screenshots/stage8-2G-D-B-1', 'screenshots/stage8-2G-D-B-1a', 'screenshots/stage8-2G-D-C', 'screenshots/stage8-2G-E-A',
  'screenshots/stage8-2G-E-A-1', 'screenshots/stage8-2G-E-B'
];
const skip = (rel, name) => {
  const lower = name.toLowerCase();
  if (name === '.DS_Store' || lower.endsWith('.zip') || lower.endsWith('.pem') || lower.endsWith('.key')) return true;
  if (['node_modules', '.git', 'output', 'artifacts', '__MACOSX', '.codex', 'browser-profiles'].includes(name)) return true;
  if (rel.startsWith('tests/outputs/') || rel.startsWith('tests/evidence/')) return true;
  if (rel.startsWith('screenshots/') && !allowedScreenshots.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) return true;
  if (/^stage8_2g_eb_(?:final_package_record|clean_package_test)\.json$/.test(name)) return true;
  if (/^(?:\.env|.*\.secret)$/i.test(name)) return true;
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

run('npm', ['run', 'build']);
run('npm', ['run', 'browser:stage8-2G-E-B']);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-EB-package-'));
try {
  copy(root, staging);
  const entriesBeforeManifest = walk(staging).sort();
  const forbidden = entriesBeforeManifest.filter((entry) => entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.includes('browser-profiles/') || entry.includes('__MACOSX/') || entry.endsWith('.DS_Store'));
  if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
  const required = [
    'package.json', 'index.html', 'css/style.css', 'js/ui.js', 'js/main.js', 'js/theater.js', 'js/mission-command-presentation.js',
    'tests/stage8-2G-E-B-command-flow-test.mjs', 'tests/stage8-2G-E-B-performance-test.mjs',
    'tests/browser/stage8-2G-E-B-command-flow.mjs', 'tests/generate-stage8-2G-EB-machine-evidence.mjs', 'tests/generate-stage8-2G-EB-evidence.mjs',
    'tests/lib/stage8-2G-EB-strong-integration-verifier.mjs', 'tests/stage8-2G-E-B-strong-evidence-test.mjs',
    'tests/stage8-2G-E-B-evidence-tamper-test.mjs', 'tests/generate-stage8-2G-EB-developer-selfcheck.mjs',
    'tests/build-stage8-2G-E-B-delivery-package.mjs', 'tests/verify-stage8-2G-E-B-delivery-package.mjs',
    'STAGE8-2G-E-B-DELIVERY.md',
    'stage8_2g_eb_mission_eligibility_check.json', 'stage8_2g_eb_deployment_review_check.json', 'stage8_2g_eb_command_flow_check.json',
    'stage8_2g_eb_idempotency_check.json', 'stage8_2g_eb_real_reload_check.json', 'stage8_2g_eb_ui_path_check.json',
    'stage8_2g_eb_save_diff_check.json', 'stage8_2g_eb_authority_check.json', 'stage8_2g_eb_regression_check.json',
    'stage8_2g_eb_tamper_results.json', 'stage8_2g_eb_machine_evidence.json', 'stage8_2g_eb_browser_capture_manifest.json',
    'stage8_2g_eb_evidence_bundle.json', 'stage8_2g_eb_strong_evidence_verdict.json', 'stage8_2g_eb_developer_selfcheck.json',
    'stage8_2g_eb_performance_check.json',
    'screenshots/stage8-2G-E-B/e-b-03-deployment-review.png', 'screenshots/stage8-2G-E-B/e-b-12-operation-review.png'
  ];
  const missing = required.filter((file) => !fs.existsSync(path.join(staging, file)));
  if (missing.length) throw new Error(`missing E-B package files: ${missing.join(', ')}`);
  fs.writeFileSync(path.join(staging, 'delivery-file-manifest.json'), `${JSON.stringify({ stage: '8.2G-E-B', package: packageName, recordType: 'source_manifest', entries: entriesBeforeManifest.map((file) => ({ path: file, sha256: sha(path.join(staging, file)) })) }, null, 2)}\n`);
  fs.rmSync(packagePath, { force: true });
  run('zip', ['-qr', packagePath, '.'], staging);
  const browser = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_eb_browser_capture_manifest.json'), 'utf8'));
  const tamper = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_eb_tamper_results.json'), 'utf8'));
  const selfcheck = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_eb_developer_selfcheck.json'), 'utf8'));
  const performance = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_eb_performance_check.json'), 'utf8'));
  const head = run('git', ['rev-parse', 'HEAD']).stdout.trim();
  const record = {
    stage: '8.2G-E-B', recordType: 'external_final_package_record', package: packageName,
    packageSha256: sha(packagePath), packageBytes: fs.statSync(packagePath).size, entries: entriesBeforeManifest.length + 1,
    branch: run('git', ['branch', '--show-current']).stdout.trim(), baseline: { stage: '8.2G-E-A.1', commit: '17a965df9772ef0beb65b0e1d48c88c4671ae311' }, finalHead: head,
    scope: { missionDeploymentUx: true, commandFlow: true, authorityModified: false, formalReportReadOnly: true, solverModified: false, plannerModified: false, choreographerModified: false, settlementCalculationModified: false, dcPresentationModified: false, replayPresentationModified: false },
    browser: { captureCount: browser.browser.captureCount, uniqueImageHashes: browser.browser.uniqueImageHashes, realReloads: browser.realReloads.length, pageErrors: browser.browser.pageErrors, consoleErrors: browser.browser.consoleErrors, productionUiActions: browser.actionProvenance.length, dispatchApiUsed: browser.dispatchApiUsed, replayApiUsed: browser.replayApiUsed },
    performance: { passed: performance.passed, warmupSamples: performance.warmupSamples, sampleCount: performance.sampleCount, p95BudgetMs: performance.limits.p95Ms, scenarios: performance.scenarios.map((row) => ({ scenario: row.scenario, p95Ms: row.p95Ms })) },
    tamper: { rejectionCount: tamper.rejectionCount, passedFlagOnlyCases: tamper.passedFlagOnlyCases, passed: tamper.passed },
    selfcheck: selfcheck.passed === true,
    packageHygiene: { forbiddenEntries: forbidden, nestedZipFound: false, staleFinalPackageRecordInZip: false },
    cleanPackageGate: 'pending-package-verifier'
  };
  fs.writeFileSync(path.join(root, 'stage8_2g_eb_final_package_record.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, stage: record.stage, package: packagePath, sha256: record.packageSha256, bytes: record.packageBytes, entries: record.entries, tamperRejectionCount: record.tamper.rejectionCount }));
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
