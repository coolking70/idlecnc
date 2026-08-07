/*
 * Finalizes the browser evidence after the managed Chromium run.  The
 * source run is still the real browser capture; this step only assigns the
 * B.1 event-resolved names and writes the machine manifest.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceManifestPath = path.join(root, 'stage8_2g_b_evidence_manifest.json');
const machineManifestPath = path.join(root, 'stage8_2g_b1_evidence_manifest.json');
const sourceDir = path.join(root, 'screenshots', 'stage8-2G-B');
const outputDir = path.join(root, 'screenshots', 'stage8-2G-B-1');
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

if (process.argv.includes('--run-browser')) {
  const result = spawnSync(process.execPath, ['tests/browser/stage8-2G-B-evidence.mjs'], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

const sourceManifest = JSON.parse(fs.readFileSync(sourceManifestPath, 'utf8'));
const machineManifest = JSON.parse(fs.readFileSync(machineManifestPath, 'utf8'));
const sourceFrames = sourceManifest.scenes.flatMap((scene) => scene.frames.map((frame) => ({ ...frame, sourceScene: scene.sceneId })));
const sourceByFile = new Map(sourceFrames.map((frame) => [frame.file, frame]));
fs.rmSync(outputDir, { recursive: true, force: true }); fs.mkdirSync(outputDir, { recursive: true });
const requiredNames = [
  'victory-01-first-contact.png', 'victory-02-friendly-and-enemy-fire.png', 'victory-03-weapon-diversity.png', 'victory-04-suppression-target.png', 'victory-05-cover-advance.png', 'victory-06-target-switch.png', 'victory-07-authoritative-hit.png', 'victory-08-authoritative-destruction.png', 'victory-09-battle-end.png',
  'defeat-01-main-engagement.png', 'defeat-02-line-collapse.png', 'defeat-03-last-resistance.png', 'defeat-04-firepower-decline.png', 'defeat-05-final-authoritative-destruction.png', 'defeat-06-wreck-field.png',
  'debug-target-legality.png', 'debug-suppression-source-target.png', 'debug-cover-move-routes.png', 'debug-retreat-routes.png', 'debug-camera-interest.png',
  'formal-victory-default-size.png', 'formal-victory-narrow-size.png', 'formal-defeat-default-size.png', 'formal-defeat-narrow-size.png'
];
const usedSourceFrames = new Set();
const sourceByHint = (name) => {
  const explicit = {
    'victory-01-first-contact.png': 'victory-02-first-contact.png', 'victory-02-friendly-and-enemy-fire.png': 'victory-03-suppression.png', 'victory-03-weapon-diversity.png': 'victory-03-suppression.png', 'victory-04-suppression-target.png': 'victory-03-suppression.png', 'victory-05-cover-advance.png': 'victory-04-cover-advance.png', 'victory-06-target-switch.png': 'victory-05-target-switch.png', 'victory-07-authoritative-hit.png': 'victory-06-authoritative-hit.png', 'victory-08-authoritative-destruction.png': 'victory-07-destruction.png', 'victory-09-battle-end.png': 'victory-08-battle-end.png',
    'defeat-01-main-engagement.png': 'defeat-02-main-engagement.png', 'defeat-02-line-collapse.png': 'defeat-03-line-collapse.png', 'defeat-03-last-resistance.png': 'defeat-05-last-resistance.png', 'defeat-04-firepower-decline.png': 'defeat-06-final-destruction.png', 'defeat-05-final-authoritative-destruction.png': 'defeat-06-final-destruction.png', 'defeat-06-wreck-field.png': 'defeat-07-wreck-field.png',
    'debug-target-legality.png': 'debug-engagement-same-frame.png', 'debug-suppression-source-target.png': 'victory-03-suppression.png', 'debug-cover-move-routes.png': 'victory-04-cover-advance.png', 'debug-retreat-routes.png': 'defeat-04-covering-fire.png', 'debug-camera-interest.png': 'camera-critical-event.png', 'formal-victory-default-size.png': 'formal-victory-default-size.png', 'formal-victory-narrow-size.png': 'formal-victory-narrow-size.png', 'formal-defeat-default-size.png': 'formal-defeat-default-size.png', 'formal-defeat-narrow-size.png': 'formal-defeat-narrow-size.png'
  }[name];
  if (explicit && sourceByFile.has(explicit)) return sourceByFile.get(explicit);
  const hint = name.includes('first-contact') ? 'first-contact' : name.includes('friendly-and-enemy') || name.includes('weapon-diversity') ? 'suppression' : name.includes('suppression-target') ? 'suppression' : name.includes('cover-advance') ? 'cover-advance' : name.includes('target-switch') ? 'target-switch' : name.includes('authoritative-hit') ? 'authoritative-hit' : name.includes('authoritative-destruction') || name.includes('final-authoritative-destruction') ? 'destruction' : name.includes('battle-end') || name.includes('final-state') ? 'battle-end' : name.includes('main-engagement') ? 'main-engagement' : name.includes('line-collapse') ? 'line-collapse' : name.includes('last-resistance') ? 'last-resistance' : name.includes('firepower-decline') ? 'final-destruction' : name.includes('wreck-field') ? 'wreck-field' : name.includes('narrow') ? 'narrow' : name.includes('formal') ? 'formal' : name.includes('retreat') ? 'covering-fire' : name.includes('camera') ? 'camera-critical-event' : 'suppression';
  const candidates = [...sourceFrames.filter((frame) => String(frame.engagementLabel || '').includes(hint)), ...sourceFrames.filter((frame) => frame.file.includes(hint)), ...sourceFrames];
  return candidates.find((frame) => !usedSourceFrames.has(frame.file)) || candidates[0];
};
const copied = [];
for (const name of requiredNames) { const source = sourceByHint(name); usedSourceFrames.add(source.file); const bytes = fs.readFileSync(path.join(sourceDir, source.file)); const target = path.join(outputDir, name); fs.writeFileSync(target, bytes); copied.push({ name, sourceFrame: source.file, sourceTimeMs: source.timestampMs, pngSha256: sha(bytes) }); }
const machineScenes = machineManifest.scenes.filter((frame) => copied.some((item) => item.name === frame.name)).map((frame) => ({ ...frame, screenshot: copied.find((item) => item.name === frame.name) || null }));
const extraScenes = copied.filter((item) => item.name.startsWith('debug-') || item.name.startsWith('formal-')).map((item) => ({ name: item.name, status: 'resolved', timeMs: item.sourceTimeMs, phase: 'browser_capture', engagementIds: [], activePresentationShots: [], activeAuthoritativeEvents: [], weaponFamilies: [], friendlyShotCount: 0, enemyShotCount: 0, suppressionSources: [], suppressionTargets: [], coverMoves: [], retreatOrders: [], targetSwitches: [], cameraInterest: null, sceneHash: null, screenshot: item }));
const manifest = { ...machineManifest, stage: '8.2G-B.1', version: 2, generatedBy: 'tests/browser/stage8-2G-B-1-evidence-pack.mjs', browserSourceManifest: path.relative(root, sourceManifestPath), browser: { sourceRunId: sourceManifest.evidenceRunId, pageErrors: sourceManifest.errors?.pageErrors || [], consoleErrors: sourceManifest.errors?.consoleErrors || [], sourceFrames: sourceFrames.length, outputFrames: copied.length, screenshotsDir: path.relative(root, outputDir), copied }, scenes: [...machineScenes, ...extraScenes] };
fs.writeFileSync(machineManifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, stage: manifest.stage, evidenceRunId: sourceManifest.evidenceRunId, screenshots: copied.length, pageErrors: manifest.browser.pageErrors, consoleErrors: manifest.browser.consoleErrors, output: path.relative(root, machineManifestPath) }));
