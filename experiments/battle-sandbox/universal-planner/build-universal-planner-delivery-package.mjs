import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const run = (command, args, allowFailure = false) => { const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit' }); if (result.status !== 0 && !allowFailure) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`); return result.status === 0; };
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const planner = path.join(root, 'experiments/battle-sandbox/universal-planner');
const zipPath = path.join(root, 'iron-command-stage8-2F-A-1-universal-planner-hardening.zip');

if (fs.existsSync(zipPath)) fs.rmSync(zipPath);

run(process.execPath, ['experiments/battle-sandbox/universal-planner/scenario-corpus-generator.mjs', '--write']);
run(process.execPath, ['experiments/battle-sandbox/tests/universal-presentation-planner-test.mjs']);
run(process.execPath, ['experiments/battle-sandbox/tests/universal-presentation-corpus-test.mjs']);
run(process.execPath, ['experiments/battle-sandbox/tests/universal-presentation-input-stability-test.mjs']);
run(process.execPath, ['experiments/battle-sandbox/tests/universal-presentation-semantics-test.mjs']);
run(process.execPath, ['experiments/battle-sandbox/tests/universal-presentation-continuous-layout-test.mjs']);
run(process.execPath, ['experiments/battle-sandbox/universal-planner/capture-universal-planner-evidence.mjs']);
const npmPass = run('npm', ['test']);
run(process.execPath, ['experiments/battle-sandbox/tests/universal-presentation-delivery-test.mjs']);
run(process.execPath, ['experiments/battle-sandbox/universal-planner/coverage-report.mjs']);
const coverage = JSON.parse(fs.readFileSync(path.join(planner, 'scenarios/coverage.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(planner, 'screenshots/manifest.json'), 'utf8'));
if (coverage.total.total !== 1120 || coverage.canonicalCount !== 120 || coverage.fuzzCount !== 1000 || coverage.planFailures.length || coverage.continuousLayoutFailures.length || coverage.semanticFailures.length || manifest.screenshots.length !== 12 || !manifest.sha256Unique || manifest.pageErrors.length || manifest.consoleErrors.length || new Set(manifest.screenshots.map((item) => item.actualTime)).size < 8) throw new Error('universal planner delivery gate failed');
run('zip', ['-qr', zipPath, '.', '-x', '.git/*', 'node_modules/*', '*.zip', 'experiments/battle-sandbox/universal-planner/.browser-temp/*']);
run(process.execPath, ['experiments/battle-sandbox/universal-planner/verify-universal-planner-delivery-package.mjs', zipPath]);
console.log(JSON.stringify({ ok: true, npmPass, canonical: coverage.canonical.total, fuzz: coverage.fuzz.total, total: coverage.total.total, screenshots: manifest.screenshots.length, zip: zipPath, zipSha256: sha256(zipPath) }, null, 2));
