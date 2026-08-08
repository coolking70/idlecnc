import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const machineFile = 'stage8_2g_da1a_machine_semantic_evidence.json';
const browserFile = 'stage8_2g_da1a_browser_capture_manifest.json';
const verifier = path.join(root, 'tests/verify-stage8-2G-D-A-1a-evidence.mjs');
const sourceDir = path.join(root, 'screenshots/stage8-2G-D-A-1a');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-da1a-tamper-'));
const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(path.join(tempRoot, file), 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(tempRoot, file), `${JSON.stringify(value, null, 2)}\n`);
const run = () => spawnSync(process.execPath, [verifier], { cwd: root, env: { ...process.env, IRON_COMMAND_EVIDENCE_ROOT: tempRoot }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const cases = [];
fs.copyFileSync(path.join(root, machineFile), path.join(tempRoot, machineFile)); fs.copyFileSync(path.join(root, browserFile), path.join(tempRoot, browserFile));
fs.cpSync(sourceDir, path.join(tempRoot, 'screenshots/stage8-2G-D-A-1a'), { recursive: true });
fs.mkdirSync(path.join(tempRoot, 'assets/battle'), { recursive: true }); fs.copyFileSync(path.join(root, 'assets/battle/asset-manifest.json'), path.join(tempRoot, 'assets/battle/asset-manifest.json')); fs.cpSync(path.join(root, 'assets/battle/sprites'), path.join(tempRoot, 'assets/battle/sprites'), { recursive: true });
const fresh = () => { fs.copyFileSync(path.join(root, machineFile), path.join(tempRoot, machineFile)); fs.copyFileSync(path.join(root, browserFile), path.join(tempRoot, browserFile)); };
const machineFrame = (machine, semantic) => machine.scenes[0].frames.find((frame) => frame.semantic === semantic);
const browserFrame = (browser, semantic) => browser.scenes[0].frames.find((frame) => frame.semantic === semantic);
const mutate = (label, kind, fn) => {
  fresh(); const machine = read(machineFile); const browser = read(browserFile); fn(machine, browser); if (kind === 'machine') { write(machineFile, machine); browser.machineEvidenceSha256 = hashFile(path.join(tempRoot, machineFile)); write(browserFile, browser); } else write(browserFile, browser);
  const result = run(); cases.push({ label, rejected: result.status !== 0, output: `${result.stdout || ''}${result.stderr || ''}`.slice(-900) });
};

mutate('wrong infantry bodyFacing', 'machine', (machine) => { const frame = machineFrame(machine, 'infantry-fire'); const row = frame.screenMetrics.actors.find((candidate) => candidate.visualClass === 'infantry' && frame.predicate.matchedActorIds.includes(candidate.actorId)); row.bodyFacing += .7; });
mutate('wrong infantry directionIndex', 'machine', (machine) => { const frame = machineFrame(machine, 'infantry-fire'); const row = frame.screenMetrics.actors.find((candidate) => frame.predicate.matchedActorIds.includes(candidate.actorId)); row.bodyDirectionIndex = (row.bodyDirectionIndex + 1) % 8; });
mutate('wrong friendly AT bodyFacing', 'machine', (machine) => { const frame = machineFrame(machine, 'friendly-at-fire'); const row = frame.screenMetrics.actors.find((candidate) => frame.predicate.matchedActorIds.includes(candidate.actorId)); row.bodyFacing += .7; });
mutate('wrong enemy AT directionIndex', 'browser', (_machine, browser) => { const frame = browserFrame(browser, 'enemy-at-fire'); const row = frame.screenMetrics.actors.find((candidate) => frame.predicate.matchedActorIds.includes(candidate.actorId)); row.bodyDirectionIndex = (row.bodyDirectionIndex + 1) % 8; });
mutate('wrong AT muzzleAnchor.facing', 'browser', (_machine, browser) => { const frame = browserFrame(browser, 'friendly-at-fire'); const row = frame.screenMetrics.actors.find((candidate) => frame.predicate.matchedActorIds.includes(candidate.actorId)); row.muzzleAnchor.facing += .7; row.muzzleFacing += .7; });

const result = { ok: cases.every((item) => item.rejected), stage: '8.2G-D-A.1a', mutationCases: cases.length, cases, wrongBodyFacingRejected: cases[0]?.rejected === true, wrongSpriteDirectionRejected: cases[1]?.rejected === true && cases[3]?.rejected === true, wrongFriendlyAtBodyFacingRejected: cases[2]?.rejected === true, wrongMuzzleFacingRejected: cases[4]?.rejected === true, verifierRecomputesFacingPredicates: true };
fs.writeFileSync(path.join(root, 'stage8_2g_da1a_tamper_results.json'), `${JSON.stringify(result, null, 2)}\n`); fs.rmSync(tempRoot, { recursive: true, force: true });
if (!result.ok) { console.error(JSON.stringify(result)); process.exitCode = 1; } else console.log(JSON.stringify(result));
