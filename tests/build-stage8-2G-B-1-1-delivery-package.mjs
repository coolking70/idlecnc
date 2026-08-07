import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageName = 'iron-command-stage8-2G-B-1-1-phase-continuous-fire-evidence-closure.zip';
const zipPath = path.join(root, packageName);
const run = (command, args, cwd = root) => { const result = spawnSync(command, args, { cwd, stdio: 'inherit' }); if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.status}`); };
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

run(process.execPath, ['tests/stage8-2G-B-1-1-test.mjs']);
run(process.execPath, ['tests/generate-stage8-2G-B-1-1-machine-evidence.mjs']);
run(process.execPath, ['tests/browser/stage8-2G-B-1-1-evidence.mjs']);
run(process.execPath, ['tests/validate-stage8-2G-B-1-1-browser-evidence.mjs']);

const selfcheck = { stage: '8.2G-B.1.1', baseline: '8.2G-B.1', kind: 'developer_self_check', independentAudit: false, implemented: ['assignment phase slices', 'continuous first/main/critical fire', 'cover retreat rear guard shots', 'projectile-vector authority facing', 'AT infantry target classification', 'live Chromium semantic capture', 'PNG/capture/machine binding', 'native npm test chain inclusion', 'package hygiene verifier'], authority: { solverModified: false, hpModifiedByPresentation: false, resultModifiedByPresentation: false, rewardModifiedByPresentation: false, saveModifiedByPresentation: false, authoritativeEventOrderChanged: false }, testResults: { stageSpecific: 'tests/stage8-2G-B-1-1-test.mjs', b1Regression: 'tests/stage8-2G-B-1-test.mjs', fullSuite: 'npm test', cleanPackage: 'verify:stage8-2G-B-1-1' }, evidenceFiles: ['stage8_2g_b11_assignment_phase_slices.json', 'stage8_2g_b11_cover_retreat_fire.json', 'stage8_2g_b11_authoritative_shot_facing.json', 'stage8_2g_b11_target_classification.json', 'stage8_2g_b11_browser_evidence_manifest.json', 'stage8_2g_b11_evidence_binding_check.json', 'stage8_2g_b11_authority_check.json', 'stage8_2g_b11_determinism_check.json', 'stage8_2g_b11_full_test.json', 'stage8_2g_b11_package_hygiene.json'], knownIssues: ['stage8_2g_b1_independent_audit.json and prior full audit log were not found; independent audit is not claimed'], packageExclusions: ['.DS_Store', '__MACOSX', '*.zip', 'node_modules', '.git', 'artifacts', 'browser profiles', 'temporary screenshots', 'API keys', 'tokens'] };
fs.writeFileSync(path.join(root, 'stage8_2g_b11_developer_selfcheck.json'), JSON.stringify(selfcheck, null, 2) + '\n');
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-stage8G-B11-'));
const forbiddenDirs = new Set(['node_modules', '.git', '.codex', 'output', '__MACOSX', 'artifacts']);
const skip = (rel, entry) => { if (entry === '.DS_Store' || entry.toLowerCase().endsWith('.zip') || forbiddenDirs.has(entry)) return true; if (rel.startsWith('screenshots/') && rel !== 'screenshots/stage8-2G-B-1-1' && !rel.startsWith('screenshots/stage8-2G-B-1-1/')) return true; if (rel.startsWith('tests/outputs/') || rel.startsWith('tests/evidence/')) return true; return false; };
const copyTree = (from, to, rel = '') => { for (const entry of fs.readdirSync(from, { withFileTypes: true })) { const child = rel ? `${rel}/${entry.name}` : entry.name; if (skip(child, entry.name)) continue; const source = path.join(from, entry.name); const target = path.join(to, entry.name); if (entry.isDirectory()) { fs.mkdirSync(target, { recursive: true }); copyTree(source, target, child); } else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target); } } };
copyTree(root, staging);
const required = ['stage8_2g_b11_assignment_phase_slices.json', 'stage8_2g_b11_cover_retreat_fire.json', 'stage8_2g_b11_authoritative_shot_facing.json', 'stage8_2g_b11_target_classification.json', 'stage8_2g_b11_browser_evidence_manifest.json', 'stage8_2g_b11_evidence_binding_check.json', 'stage8_2g_b11_authority_check.json', 'stage8_2g_b11_determinism_check.json', 'stage8_2g_b11_full_test.json', 'stage8_2g_b11_package_hygiene.json', 'stage8_2g_b11_developer_selfcheck.json']; const missing = required.filter((file) => !fs.existsSync(path.join(staging, file))); if (missing.length) throw new Error(`missing B.1.1 evidence: ${missing.join(', ')}`);
const entries = []; const walk = (dir, rel = '') => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const child = rel ? `${rel}/${entry.name}` : entry.name; const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full, child); else entries.push({ path: child, sha256: sha(full) }); } }; walk(staging); fs.writeFileSync(path.join(staging, 'delivery-file-manifest.json'), JSON.stringify({ stage: '8.2G-B.1.1', package: packageName, entries: entries.sort((a, b) => a.path.localeCompare(b.path)) }, null, 2) + '\n');
fs.rmSync(zipPath, { force: true }); run('zip', ['-qr', zipPath, '.'], staging); fs.rmSync(staging, { recursive: true, force: true }); console.log(JSON.stringify({ ok: true, stage: '8.2G-B.1.1', package: zipPath, sha256: sha(zipPath), bytes: fs.statSync(zipPath).size, screenshots: fs.readdirSync(path.join(root, 'screenshots/stage8-2G-B-1-1')).length }));
