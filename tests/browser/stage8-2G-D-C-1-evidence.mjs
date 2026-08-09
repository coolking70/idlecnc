import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const run = spawnSync(process.execPath, [path.join(root, 'tests/browser/stage8-2G-D-C-evidence.mjs')], { cwd: root, stdio: 'inherit', encoding: 'utf8', timeout: 600_000 });
if (run.status !== 0) process.exit(run.status || 1);
const source = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_dc_browser_capture_manifest.json'), 'utf8'));
const output = { ...source, stage: '8.2G-D-C.1', version: 1, sourceStage: '8.2G-D-C', generatedBy: 'tests/browser/stage8-2G-D-C-1-evidence.mjs', strongEvidence: { browserRecomputed: source.semantic?.browserRecomputed === true, terminalChecksCaptured: source.scenes.every((scene) => Boolean(scene.terminal)), wreckBindingsCaptured: source.scenes.flatMap((scene) => scene.frames).every((frame) => Array.isArray(frame.wrecks)) } };
fs.writeFileSync(path.join(root, 'stage8_2g_dc1_browser_capture_manifest.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, screenshots: output.browser.captureCount, uniqueImageHashes: output.browser.uniqueImageHashes, terminalChecks: output.scenes.filter((scene) => scene.terminal).length }));
