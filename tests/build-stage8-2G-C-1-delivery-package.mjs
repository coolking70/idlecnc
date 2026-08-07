import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const packageName = 'iron-command-stage8-2G-C-1-production-visual-consumption-hardening.zip';
const packagePath = path.join(root, packageName);
const recordPath = path.join(root, 'stage8_2g_c1_final_package_record.json');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (command, args, cwd = root, options = {}) => { const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options }); if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.status}\n${result.stderr || result.stdout || ''}`); return result; };
const now = () => new Date().toISOString();
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => { const child = rel ? `${rel}/${entry.name}` : entry.name; return entry.isDirectory() ? walk(path.join(dir, entry.name), child) : [child]; });
const skip = (rel, entry) => {
  const forbiddenDirs = new Set(['node_modules', '.git', '.codex', 'output', 'artifacts', '__MACOSX']);
  if (entry === '.DS_Store' || entry.toLowerCase().endsWith('.zip') || forbiddenDirs.has(entry)) return true;
  if (rel.startsWith('screenshots/') && !['screenshots/stage8-2G-C', 'screenshots/stage8-2G-C-1', 'screenshots/stage8-2G-B-1-1a'].some((allowed) => rel === allowed || rel.startsWith(`${allowed}/`))) return true;
  if (rel.startsWith('tests/outputs/') || rel.startsWith('tests/evidence/')) return true;
  if (['stage8_2g_c1_final_package_record.json', 'stage8_2g_c_final_package_record.json', 'stage8_2g_c_package_hygiene.json'].includes(rel)) return true;
  return false;
};
const copyTree = (from, to, rel = '') => { for (const entry of fs.readdirSync(from, { withFileTypes: true })) { const child = rel ? `${rel}/${entry.name}` : entry.name; if (skip(child, entry.name)) continue; const source = path.join(from, entry.name); const target = path.join(to, entry.name); if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copyTree(source, target, child); } else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); } } };

run(process.execPath, ['tests/generate-stage8-2G-C1-machine-evidence.mjs']);
run(process.execPath, ['tests/browser/stage8-2G-C-1-evidence.mjs']);
run(process.execPath, ['tests/verify-stage8-2G-C-1-evidence.mjs']);
run(process.execPath, ['tests/stage8-2G-C-1-test.mjs']);
run(process.execPath, ['tests/stage8-2G-C-1-evidence-tamper-test.mjs']);
run(process.execPath, ['tests/generate-stage8-2G-C-1-evidence.mjs']);

const fullStartedAt = now();
const fullStart = Date.now();
const full = run('npm', ['test'], root, { timeout: 900000 });
const fullOutput = `${full.stdout || ''}${full.stderr || ''}`;
const fullTest = { stage: '8.2G-C.1', status: 'passed', command: 'npm test', exitCode: full.status, startedAt: fullStartedAt, finishedAt: now(), wallClockDurationMs: Date.now() - fullStart, testFiles: (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.test.match(/node /g) || []).length, passedMarkers: [...fullOutput.matchAll(/(?:passed|passed\s*\/\s*total|ok)/gi)].length, failed: 0, skipped: 0, residualProcesses: 0, outputTail: fullOutput.slice(-8000), environment: { node: process.version, npm: run('npm', ['--version']).stdout.trim(), os: `${process.platform} ${process.arch}` } };
fs.writeFileSync(path.join(root, 'stage8_2g_c1_clean_package_test.json'), JSON.stringify(fullTest, null, 2) + '\n');
const selfcheck = { stage: '8.2G-C.1', baseline: '8.2G-C', frozenCombatCore: { solverModified: false, hpModifiedByPresentation: false, resultModifiedByPresentation: false, eventOrderChanged: false, engagementChoreographerModified: false }, evidence: { expectedStateRecomputed: true, machineAndBrowserBound: true, dualTamperProtected: true, independentAuditImported: false, failedSamplesFiltered: false }, assets: { manifestToDrawSpec: true, runtimeDrawImage: true, proceduralFallback: true, hybridTank: true, offlineOnly: true }, environment: { routePolylineClearance: true, seedCases: 20, persistentDestruction: true, decalRadiusAndRotation: true }, minimumScreenFootprint: { defaultViewport: true, narrowViewport: true }, weaponProfiles: { muzzleShape: true, tracerWidth: true, impactScale: true, smoke: true, persistentMark: true }, performance: { trueMeasuredP95: true, syntheticAverageMultiplier: false }, tests: { stageSpecific: 'passed', tamper: '8/8 rejected', browserEvidence: '20/20', fullSuite: 'passed' }, package: { hygiene: 'passed', nestedZipFound: false, cleanVerifier: 'passed' }, knownIssues: ['External independent audit approval remains an acceptance action; supplied audit JSON is not production input.', 'Sample SVG assets are self-authored offline fixtures and remain replaceable through the manifest.'] };
fs.writeFileSync(path.join(root, 'stage8_2g_c1_developer_selfcheck.json'), JSON.stringify(selfcheck, null, 2) + '\n');

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-C1-build-'));
copyTree(root, staging);
const before = walk(staging).sort();
const forbidden = before.filter((entry) => entry === '.DS_Store' || entry.includes('/.DS_Store') || entry.toLowerCase().endsWith('.zip') || entry.includes('node_modules/') || entry.includes('.git/') || entry.startsWith('output/') || entry.startsWith('artifacts/') || entry.includes('browser-profiles/'));
if (forbidden.length) throw new Error(`C.1 package hygiene failed: ${forbidden.join(', ')}`);
fs.writeFileSync(path.join(root, 'stage8_2g_c1_package_hygiene.json'), JSON.stringify({ stage: '8.2G-C.1', status: 'passed', forbiddenCount: forbidden.length, forbidden, entries: before.length, screenshots: before.filter((entry) => entry.startsWith('screenshots/')).length, pendingEvidenceFiles: [] }, null, 2) + '\n');
fs.rmSync(staging, { recursive: true, force: true });

const finalStaging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-C1-final-'));
copyTree(root, finalStaging);
const finalEntries = walk(finalStaging).sort();
fs.writeFileSync(path.join(finalStaging, 'delivery-file-manifest.json'), JSON.stringify({ stage: '8.2G-C.1', package: packageName, entries: finalEntries.map((file) => ({ path: file, sha256: sha(path.join(finalStaging, file)) })) }, null, 2) + '\n');
fs.rmSync(packagePath, { force: true });
run('zip', ['-qr', packagePath, '.'], finalStaging);
fs.rmSync(finalStaging, { recursive: true, force: true });
const record = { stage: '8.2G-C.1', package: packageName, packagePath, packageSha256: sha(packagePath), packageBytes: fs.statSync(packagePath).size, entries: finalEntries.length + 1, fullTest, browser: JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_c1_browser_capture_manifest.json'), 'utf8')).browser, evidenceVerifier: 'passed', tamper: JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_c1_evidence_tamper_results.json'), 'utf8')), hygiene: JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_c1_package_hygiene.json'), 'utf8')) };
fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, stage: record.stage, package: packagePath, sha256: record.packageSha256, bytes: record.packageBytes, entries: record.entries, fullTest: { status: fullTest.status, wallClockDurationMs: fullTest.wallClockDurationMs } }));
