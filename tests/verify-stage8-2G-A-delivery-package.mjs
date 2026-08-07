import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const zipPath = path.resolve(process.argv[2] || path.join(root, 'iron-command-stage8-2G-A-1-production-visual-core-hardening.zip'));
const required = [
  'package.json', 'README.md', 'STAGE8-2G-A-DELIVERY.md', 'STAGE8-2G-A-1-DELIVERY.md', 'AUDIT-START-HERE.md', 'stage8_2g_a1_developer_selfcheck.json', 'stage8_2g_a1_clean_package_test.json',
  'js/main.js', 'js/battle-presentation/universal/universal-battle-renderer.js',
  'js/battle-presentation/universal/universal-visual-scene.js', 'js/battle-presentation/universal/visual-weapon-profiles.js',
  'js/battle-presentation/universal/visual-state-machine.js', 'js/battle-presentation/universal/universal-battle-phase-resolver.js', 'js/battle-presentation/universal/visual-footprints.js',
  'js/battle-presentation/universal/universal-debug-overlay.js', 'js/battle-presentation/universal/universal-render-state.js',
  'tests/stage8-2G-A-test.mjs', 'tests/stage8-2G-A-1-test.mjs', 'tests/browser/stage8-2G-A-evidence.mjs',
  'tests/fixtures/formal-browser-manifest-a1.json', 'tests/fixtures/formal-browser-manifest-a2.json', 'tests/fixtures/formal-browser-output-a2.txt',
  'screenshots/stage8-2G-A-visual-manifest.json', 'screenshots/stage8-2G-A/01-production-deploy.png', 'screenshots/stage8-2G-A/10-formal-narrow-size.png'
];
const forbidden = ['node_modules/', '.git/', '.browser-temp/', 'browser-cache/', 'temporary-logs/'];
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (command, args, cwd) => { const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: 'inherit' }); if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`); };

if (!fs.existsSync(zipPath)) throw new Error(`package missing: ${zipPath}`);
run('unzip', ['-tq', zipPath], root);
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8-2G-A-verify-'));
try {
  run('unzip', ['-q', zipPath, '-d', staging], root);
  const entries = spawnSync('unzip', ['-Z1', zipPath], { cwd: root, encoding: 'utf8' }).stdout.split(/\r?\n/).filter(Boolean);
  const allowedScreenshots = new Set(['01-production-deploy.png', '02-production-turn-and-brake.png', '03-production-first-contact.png', '04-production-main-engagement.png', '05-production-projectile-anchor.png', '06-production-destruction.png', '07-production-battle-end.png', '08-debug-overlay-same-frame.png', '09-formal-default-size.png', '10-formal-narrow-size.png']);
  const forbiddenEntry = entries.find((entry) => {
    const forbiddenPrefix = forbidden.some((prefix) => entry.startsWith(prefix));
    const oldScreenshot = entry.startsWith('screenshots/stage8-2G-A/') && !allowedScreenshots.has(path.basename(entry));
    const unrelatedScreenshot = entry.startsWith('screenshots/') && !entry.startsWith('screenshots/stage8-2G-A/') && entry !== 'screenshots/stage8-2G-A-visual-manifest.json';
    return forbiddenPrefix || entry.endsWith('.zip') || oldScreenshot || unrelatedScreenshot;
  });
  if (forbiddenEntry) throw new Error(`forbidden package entry: ${forbiddenEntry}`);
  for (const file of required) if (!fs.existsSync(path.join(staging, file))) throw new Error(`required package file missing: ${file}`);
  const selfcheck = JSON.parse(fs.readFileSync(path.join(staging, 'stage8_2g_a1_developer_selfcheck.json'), 'utf8'));
  if (selfcheck.independentAudit !== false || selfcheck.authorityBoundary?.formalReportRemainsAuthoritative !== true) throw new Error('selfcheck boundary is invalid');
  const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'screenshots/stage8-2G-A-visual-manifest.json'), 'utf8'));
  if (manifest.stage !== '8.2G-A.1' || manifest.screenshots?.length !== 10 || manifest.errors?.pageErrors?.length || manifest.errors?.consoleErrors?.length) throw new Error('browser evidence manifest gate failed');
  for (const entry of manifest.screenshots) {
    const file = path.join(staging, 'screenshots/stage8-2G-A', entry.file);
    if (!fs.existsSync(file) || sha256(file) !== entry.pngSha256) throw new Error(`evidence hash mismatch: ${entry.file}`);
  }
  const cleanTest = JSON.parse(fs.readFileSync(path.join(staging, 'stage8_2g_a1_clean_package_test.json'), 'utf8'));
  if (cleanTest.status !== 'passed') throw new Error('clean package evidence is not passed');
  run('npm', ['install'], staging);
  run('npm', ['test'], staging);
  run(process.execPath, ['tests/stage8-2G-A-1-test.mjs'], staging);
  console.log(JSON.stringify({ ok: true, package: zipPath, zipSha256: sha256(zipPath), sizeBytes: fs.statSync(zipPath).size, entries: entries.length, screenshots: manifest.screenshots.length, reportResult: manifest.report.result, seed: manifest.report.seed, cleanPackageTest: cleanTest }, null, 2));
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
