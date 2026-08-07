import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packageName = 'iron-command-stage8-2G-C-1-1-runtime-readability-route-clearance.zip';
const packagePath = path.join(root, packageName);
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 900000 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`);
  return result;
};
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const child = rel ? `${rel}/${entry.name}` : entry.name;
  return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child];
});
const skip = (rel, name) => {
  if (name === '.DS_Store' || name.toLowerCase().endsWith('.zip')) return true;
  if (['node_modules', '.git', 'output', 'artifacts', '__MACOSX', '.codex', 'browser-profiles'].includes(name)) return true;
  if (rel.startsWith('tests/outputs/') || rel.startsWith('tests/evidence/')) return true;
  if (rel.startsWith('screenshots/stage8-2G-C-1/')) return true;
  if (rel.startsWith('screenshots/') && rel !== 'screenshots/stage8-2G-C-1-1' && !rel.startsWith('screenshots/stage8-2G-C-1-1/')) return true;
  return false;
};
const copy = (from, to, rel = '') => {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (skip(child, entry.name)) continue;
    const source = path.join(from, entry.name); const target = path.join(to, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copy(source, target, child); }
    else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); }
  }
};

run(process.execPath, ['tests/stage8-2G-C-1-1-test.mjs']);
run(process.execPath, ['tests/generate-stage8-2G-C11-machine-evidence.mjs']);
run(process.execPath, ['tests/browser/stage8-2G-C-1-1-evidence.mjs']);
run(process.execPath, ['tests/verify-stage8-2G-C-1-1-evidence.mjs']);
run(process.execPath, ['tests/stage8-2G-C-1-1-evidence-tamper-test.mjs']);

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-C11-package-'));
copy(root, staging);
const entries = walk(staging).sort();
const forbidden = entries.filter((entry) => entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.includes('browser-profiles/'));
if (forbidden.length) throw new Error(`package hygiene failed: ${forbidden.join(', ')}`);
fs.writeFileSync(path.join(staging, 'delivery-file-manifest.json'), `${JSON.stringify({ stage: '8.2G-C.1.1', package: packageName, entries: entries.map((file) => ({ path: file, sha256: sha(path.join(staging, file)) })) }, null, 2)}\n`);
fs.rmSync(packagePath, { force: true });
run('zip', ['-qr', packagePath, '.'], staging);
const record = { stage: '8.2G-C.1.1', package: packageName, packagePath, packageSha256: sha(packagePath), packageBytes: fs.statSync(packagePath).size, entries: entries.length + 1, browser: JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_c11_browser_capture_manifest.json'), 'utf8')).browser, tamper: JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_c11_evidence_tamper_results.json'), 'utf8')), hygiene: { forbiddenCount: forbidden.length, screenshots: entries.filter((entry) => entry.startsWith('screenshots/stage8-2G-C-1-1/')).length } };
fs.writeFileSync(path.join(root, 'stage8_2g_c11_final_package_record.json'), `${JSON.stringify(record, null, 2)}\n`);
fs.rmSync(staging, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, stage: record.stage, package: packagePath, sha256: record.packageSha256, bytes: record.packageBytes, entries: record.entries }));
