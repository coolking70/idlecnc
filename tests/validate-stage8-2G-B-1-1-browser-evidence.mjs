import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'stage8_2g_b11_browser_evidence_manifest.json'), 'utf8'));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const frames = manifest.scenes.flatMap((scene) => scene.frames.map((frame) => ({ ...frame, sceneId: scene.sceneId, seed: scene.seed })));
const unique = new Set(frames.map((frame) => frame.imageSha256));
const checks = { currentCodeCaptured: manifest.browser?.currentCodeCaptured === true, timestamp: frames.filter((frame) => frame.resolverTimeMs !== null).every((frame) => Math.abs(frame.captureTimeMs - frame.resolverTimeMs) <= 16.7), sceneHash: frames.every((frame) => typeof frame.sceneHash === 'string' && frame.sceneHash.length > 0), stateSignature: frames.every((frame) => typeof frame.stateSignature === 'string' && frame.stateSignature.length > 0), semanticFrameId: frames.every((frame) => typeof frame.semanticFrameId === 'string' && frame.semanticFrameId.length > 0), pngHash: frames.every((frame) => frame.screenshot?.sha256 === frame.imageSha256 && sha(path.join(root, frame.screenshot.path)) === frame.imageSha256), duplicateImageHash: unique.size === frames.length, noLegacyFallback: !('browserSourceManifest' in manifest) && manifest.generatedBy.includes('B-1-1-evidence.mjs'), noBrowserErrors: !manifest.browser?.pageErrors?.length && !manifest.browser?.consoleErrors?.length };
const result = { stage: '8.2G-B.1.1', status: Object.values(checks).every(Boolean) ? 'passed' : 'failed', checks, frameCount: frames.length, uniqueImageHashes: unique.size, exactTimestampToleranceMs: 16.7, scenes: manifest.scenes.map((scene) => ({ sceneId: scene.sceneId, frames: scene.frames.length })) };
fs.writeFileSync(path.join(root, 'stage8_2g_b11_evidence_binding_check.json'), JSON.stringify(result, null, 2) + '\n');
if (result.status !== 'passed') throw new Error(JSON.stringify(result));
console.log(JSON.stringify({ ok: true, ...result }));
