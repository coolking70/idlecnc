import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packageName = 'iron-command-stage8-2G-D-A-1-semantic-turret-closure.zip';
const packagePath = path.join(root, packageName);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (command, args, cwd = root) => { const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_200_000 }); if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`); return result; };
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const child = rel ? `${rel}/${entry.name}` : entry.name; return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child]; });
const allowedScreenshots = ['screenshots/stage8-2G-B-1-1a', 'screenshots/stage8-2G-C-1', 'screenshots/stage8-2G-C-1-1', 'screenshots/stage8-2G-C-1-1a', 'screenshots/stage8-2G-D-A', 'screenshots/stage8-2G-D-A-1'];
const skip = (rel, name) => {
  if (name === '.DS_Store' || name.toLowerCase().endsWith('.zip')) return true;
  if (['node_modules', '.git', 'output', 'artifacts', '__MACOSX', '.codex', 'browser-profiles'].includes(name)) return true;
  if (rel.startsWith('tests/outputs/') || rel.startsWith('tests/evidence/')) return true;
  if (rel.startsWith('screenshots/') && !allowedScreenshots.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) return true;
  return false;
};
const copy = (from, to, rel = '') => { for (const entry of fs.readdirSync(from, { withFileTypes: true })) { const child = rel ? `${rel}/${entry.name}` : entry.name; if (skip(child, entry.name)) continue; const source = path.join(from, entry.name); const target = path.join(to, entry.name); if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copy(source, target, child); } else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); } } };

run(process.execPath, ['tests/stage8-2G-D-A-1-test.mjs']);
run(process.execPath, ['tests/generate-stage8-2G-DA1-machine-evidence.mjs']);
run(process.execPath, ['tests/browser/stage8-2G-D-A-1-evidence.mjs']);
run(process.execPath, ['tests/verify-stage8-2G-D-A-1-evidence.mjs']);
run(process.execPath, ['tests/stage8-2G-D-A-1-evidence-tamper-test.mjs']);
run(process.execPath, ['tests/stage8-2G-D-A-test.mjs']);
run(process.execPath, ['tests/stage8-2G-D-A-animation-determinism-test.mjs']);
run(process.execPath, ['tests/generate-stage8-2G-DA-machine-evidence.mjs']);
run(process.execPath, ['tests/browser/stage8-2G-D-A-evidence.mjs']);
run(process.execPath, ['tests/verify-stage8-2G-D-A-evidence.mjs']);
run(process.execPath, ['tests/stage8-2G-D-A-evidence-tamper-test.mjs']);
run(process.execPath, ['tests/stage8-2G-C-1-1a-test.mjs']);
run(process.execPath, ['tests/generate-stage8-2G-C11a-machine-evidence.mjs']);
run(process.execPath, ['tests/browser/stage8-2G-C-1-1a-evidence.mjs']);
run(process.execPath, ['tests/verify-stage8-2G-C-1-1a-evidence.mjs']);
run(process.execPath, ['tests/stage8-2G-C-1-1a-evidence-tamper-test.mjs']);
run(process.execPath, ['tests/stage8-2G-C-1-1-test.mjs']);
run(process.execPath, ['tests/stage8-2G-C-1-1-evidence-tamper-test.mjs']);
run(process.execPath, ['tests/generate-stage8-2G-B-1-1a-machine-semantic-evidence.mjs']);
run(process.execPath, ['tests/browser/stage8-2G-B-1-1a-evidence.mjs']);
run(process.execPath, ['tests/stage8-2G-B-1-1a-test.mjs']);
run(process.execPath, ['tests/stage8-2G-B-1-1a-evidence-tamper-test.mjs']);

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-DA1-package-'));
try {
  copy(root, staging);
  fs.writeFileSync(path.join(staging, 'stage8_2g_da1_clean_package_test.json'), `${JSON.stringify({ stage: '8.2G-D-A.1', package: packageName, cleanInstall: 'pending-verifier-default-gate', npmTest: 'pending-verifier-default-gate', generatedBy: 'tests/verify-stage8-2G-D-A-1-delivery-package.mjs' }, null, 2)}\n`);
  let entries = walk(staging).sort();
  const forbidden = entries.filter((entry) => entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.includes('browser-profiles/'));
  if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
  fs.writeFileSync(path.join(staging, 'delivery-file-manifest.json'), `${JSON.stringify({ stage: '8.2G-D-A.1', package: packageName, externalZipOmitted: true, entries: entries.map((file) => ({ path: file, sha256: sha(path.join(staging, file)) })) }, null, 2)}\n`);
  entries = walk(staging).sort();
  fs.rmSync(packagePath, { force: true });
  run('zip', ['-qr', packagePath, '.'], staging);
  const browser = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_da1_browser_capture_manifest.json'), 'utf8'));
  const tamper = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_da1_tamper_results.json'), 'utf8'));
  const record = {
    stage: '8.2G-D-A.1', externalRecord: true, package: packageName, packageSha256: sha(packagePath), packageBytes: fs.statSync(packagePath).size, entries: entries.length,
    browser: { captureCount: browser.browser?.captureCount || 0, uniqueImageHashes: browser.browser?.uniqueImageHashes || 0, pageErrors: browser.browser?.pageErrors || [], consoleErrors: browser.browser?.consoleErrors || [] },
    tamper: { mutationCases: tamper.mutationCases, passed: tamper.ok === true },
    cleanPackageGate: 'pending-default-package-verifier'
  };
  fs.writeFileSync(path.join(root, 'stage8_2g_da1_final_package_record.json'), `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, stage: record.stage, package: packagePath, sha256: record.packageSha256, bytes: record.packageBytes, entries: record.entries, externalRecord: true, zipCommittedToGit: false }));
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
