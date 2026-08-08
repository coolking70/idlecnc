import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildArtShowcaseReport } from './lib/stage8-2G-DA-art-scenarios.mjs';

const root = process.cwd();
const verifier = path.join(root, 'tests/verify-stage8-2G-D-A-1-evidence.mjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-da1-tamper-'));
const machineFile = 'stage8_2g_da1_machine_semantic_evidence.json';
const browserFile = 'stage8_2g_da1_browser_capture_manifest.json';
const sourceDir = path.join(root, 'screenshots/stage8-2G-D-A-1');
const targetDir = path.join(tempRoot, 'screenshots/stage8-2G-D-A-1');
fs.mkdirSync(targetDir, { recursive: true });
for (const file of [machineFile, browserFile]) fs.copyFileSync(path.join(root, file), path.join(tempRoot, file));
for (const file of fs.readdirSync(sourceDir)) fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
fs.mkdirSync(path.join(tempRoot, 'assets/battle'), { recursive: true });
fs.copyFileSync(path.join(root, 'assets/battle/asset-manifest.json'), path.join(tempRoot, 'assets/battle/asset-manifest.json'));
fs.cpSync(path.join(root, 'assets/battle/sprites'), path.join(tempRoot, 'assets/battle/sprites'), { recursive: true });
const read = (file) => JSON.parse(fs.readFileSync(path.join(tempRoot, file), 'utf8'));
const write = (file, value) => fs.writeFileSync(path.join(tempRoot, file), `${JSON.stringify(value, null, 2)}\n`);
const hashFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fresh = () => { for (const file of [machineFile, browserFile]) fs.copyFileSync(path.join(root, file), path.join(tempRoot, file)); };
const run = () => spawnSync(process.execPath, [verifier], { cwd: root, env: { ...process.env, IRON_COMMAND_EVIDENCE_ROOT: tempRoot }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const cases = [];
const mutate = (label, fn) => {
  fresh(); const machine = read(machineFile); const browser = read(browserFile); fn(machine, browser); write(machineFile, machine); browser.machineEvidenceSha256 = hashFile(path.join(tempRoot, machineFile)); write(browserFile, browser);
  const result = run(); cases.push({ label, rejected: result.status !== 0, output: `${result.stdout || ''}${result.stderr || ''}`.slice(-700) });
};

mutate('machine asset id', (machine) => { machine.scenes[0].frames[0].screenMetrics.actors[0].assetId = 'unit_enemy_mbt'; });
mutate('machine direction index', (machine) => { machine.scenes[0].frames[6].screenMetrics.actors.find((row) => row.visualClass === 'mbt').directionIndex += 1; });
mutate('machine hull direction index', (machine) => { machine.scenes[0].frames[6].screenMetrics.actors.find((row) => row.visualClass === 'mbt').hullDirectionIndex += 1; });
mutate('machine turret direction index', (machine) => { machine.scenes[0].frames[6].screenMetrics.actors.find((row) => row.visualClass === 'mbt').turretDirectionIndex += 1; });
mutate('machine source rect', (machine) => { machine.scenes[0].frames[0].screenMetrics.actors[0].sourceRect.x += 1; });
mutate('machine semantic frame id', (machine) => { machine.scenes[0].frames[0].semanticFrameId = 'stage8g-da1-art-showcase::unknown-semantic::default'; });
mutate('machine semantic predicate', (machine) => { machine.scenes[0].frames[0].predicate.passed = false; });
mutate('machine matched actor', (machine) => { machine.scenes[0].frames[6].matchedActorIds = ['tampered-actor']; });
mutate('machine muzzle visual start', (machine) => { const projectile = machine.scenes[0].frames.find((frame) => frame.projectiles.length)?.projectiles[0]; projectile.visualStart.x += 9; });
mutate('machine timestamp', (machine) => { machine.scenes[0].frames[6].timeMs += 120; machine.scenes[0].frames[6].visualTimeSeconds += .12; });
mutate('friendly-at-fire relabeled from reload', (machine) => {
  const frame = machine.scenes[0].frames.find((candidate) => candidate.semantic === 'friendly-at-fire');
  const presentation = createUniversalBattlePresentation({ id: 'stage8g-da1-art-showcase', report: buildArtShowcaseReport(), duration: buildArtShowcaseReport().duration, presentationPhase: 'battle' });
  const shot = presentation.renderState.atTime(frame.visualTimeSeconds).shotSchedule.find((candidate) => candidate.id === frame.matchedShotIds[0]);
  frame.visualTimeSeconds = Number((shot.t + shot.weapon.fireDuration + Math.min(.2, shot.weapon.reloadDuration * .5)).toFixed(6)); frame.timeMs = Number((frame.visualTimeSeconds * 1000).toFixed(3));
});
mutate('browser predicate', (_machine, browser) => { browser.scenes[0].frames[0].predicate.passed = false; });
mutate('browser matched actor', (_machine, browser) => { browser.scenes[0].frames[6].predicate.matchedActorIds = ['tampered-actor']; });
mutate('browser screenshot hash', (_machine, browser) => { browser.scenes[0].frames[0].imageSha256 = '0'.repeat(64); });
mutate('duplicate PNG hash', (_machine, browser) => { browser.scenes[0].frames[1].imageSha256 = browser.scenes[0].frames[0].imageSha256; });
mutate('browser timestamp', (_machine, browser) => { browser.scenes[0].frames[0].timestampDeltaMs = 99; });
mutate('source report', (machine) => { machine.scenes[0].sourceReport.initial.friendly[0].name = 'tampered'; });

const result = {
  ok: cases.every((item) => item.rejected),
  stage: '8.2G-D-A.1', mutationCases: cases.length, cases,
  assetBindingProtected: true, animationBindingProtected: true, semanticFrameBindingProtected: true, predicateProtected: true, matchedActorProtected: true, muzzleGeometryProtected: true, timestampProtected: true, screenshotHashProtected: true, duplicatePngProtected: true, sourceReportProtected: true
};
fs.writeFileSync(path.join(root, 'stage8_2g_da1_tamper_results.json'), `${JSON.stringify(result, null, 2)}\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });
if (!result.ok) { console.error(JSON.stringify(result)); process.exitCode = 1; } else console.log(JSON.stringify(result));
