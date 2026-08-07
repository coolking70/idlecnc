import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyEvidenceDirectory } from './lib/verify-stage8-2G-B-1-1a-evidence.mjs';

const root = process.cwd();
const baseFiles = ['stage8_2g_b11a_machine_semantic_evidence.json', 'stage8_2g_b11a_browser_capture_manifest.json'];
const baseScreenshotDir = path.join(root, 'screenshots', 'stage8-2G-B-1-1a');
const copyFixture = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-b11a-tamper-')); for (const file of baseFiles) fs.copyFileSync(path.join(root, file), path.join(dir, file)); fs.cpSync(baseScreenshotDir, path.join(dir, 'screenshots', 'stage8-2G-B-1-1a'), { recursive: true }); return dir; };
const load = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const save = (dir, file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2) + '\n');
const firstFrame = (manifest) => manifest.scenes[0].frames[0];
const expectRejected = (label, mutate) => { const dir = copyFixture(); try { mutate(dir); const result = verifyEvidenceDirectory(dir); assert.equal(result.ok, false, `${label}: mutation unexpectedly passed`); return { label, rejected: true, failureCodes: [...new Set(result.failures.map((failure) => failure.code))] }; } finally { fs.rmSync(dir, { recursive: true, force: true }); } };
const tests = [];
const clean = verifyEvidenceDirectory(root); assert.equal(clean.ok, true, `clean evidence must pass: ${JSON.stringify(clean)}`); tests.push({ label: 'clean evidence', passed: true });

tests.push(expectRejected('wrong sceneHash', (dir) => { const file = 'stage8_2g_b11a_browser_capture_manifest.json'; const manifest = load(dir, file); firstFrame(manifest).sceneHash = 'tampered_scene_hash'; save(dir, file, manifest); }));
tests.push(expectRejected('wrong stateSignature', (dir) => { const file = 'stage8_2g_b11a_browser_capture_manifest.json'; const manifest = load(dir, file); firstFrame(manifest).stateSignature = 'tampered_but_nonempty'; save(dir, file, manifest); }));
tests.push(expectRejected('wrong semanticFrameId', (dir) => { const file = 'stage8_2g_b11a_browser_capture_manifest.json'; const manifest = load(dir, file); firstFrame(manifest).semanticFrameId = 'tampered_semantic_id'; save(dir, file, manifest); }));
tests.push(expectRejected('wrong timestamp', (dir) => { const file = 'stage8_2g_b11a_browser_capture_manifest.json'; const manifest = load(dir, file); firstFrame(manifest).captureTimeMs += 500; save(dir, file, manifest); }));
tests.push(expectRejected('wrong event semantics', (dir) => { const file = 'stage8_2g_b11a_browser_capture_manifest.json'; const manifest = load(dir, file); const frame = manifest.scenes[0].frames.find((item) => item.file.includes('authoritative-hit')); frame.semanticPredicates.authoritativeDamage = false; save(dir, file, manifest); }));
tests.push(expectRejected('wrong PNG hash', (dir) => { const file = 'stage8_2g_b11a_browser_capture_manifest.json'; const manifest = load(dir, file); const target = firstFrame(manifest); const source = manifest.scenes[0].frames[1]; fs.copyFileSync(path.join(dir, source.screenshot.path), path.join(dir, target.screenshot.path)); save(dir, file, manifest); }));
tests.push(expectRejected('duplicate PNG', (dir) => { const file = 'stage8_2g_b11a_browser_capture_manifest.json'; const manifest = load(dir, file); const target = manifest.scenes[0].frames[1]; const duplicate = manifest.scenes[0].frames[3]; const bytes = fs.readFileSync(path.join(dir, target.screenshot.path)); fs.writeFileSync(path.join(dir, duplicate.screenshot.path), bytes); const digest = crypto.createHash('sha256').update(bytes).digest('hex'); duplicate.imageSha256 = digest; duplicate.screenshot.sha256 = digest; save(dir, file, manifest); }));
tests.push(expectRejected('machine evidence stateSignature', (dir) => { const file = 'stage8_2g_b11a_machine_semantic_evidence.json'; const machine = load(dir, file); machine.scenes[0].frames[0].stateSignature = 'tampered_machine_state'; save(dir, file, machine); }));
tests.push(expectRejected('machine evidence sceneHash', (dir) => { const file = 'stage8_2g_b11a_machine_semantic_evidence.json'; const machine = load(dir, file); machine.scenes[0].frames[0].sceneHash = 'tampered_machine_scene'; save(dir, file, machine); }));
tests.push(expectRejected('machine semantic predicate', (dir) => { const file = 'stage8_2g_b11a_machine_semantic_evidence.json'; const machine = load(dir, file); const frame = machine.scenes[0].frames.find((item) => item.file.includes('authoritative-hit')); frame.semanticPredicates.authoritativeDamage = false; save(dir, file, machine); }));
tests.push(expectRejected('browser manifest fallback flag', (dir) => { const file = 'stage8_2g_b11a_browser_capture_manifest.json'; const manifest = load(dir, file); manifest.browser.legacyFallbackUsed = true; save(dir, file, manifest); }));
tests.push(expectRejected('browser state snapshot', (dir) => { const file = 'stage8_2g_b11a_browser_capture_manifest.json'; const manifest = load(dir, file); firstFrame(manifest).browserStateSnapshot.actors[0].presentationPosition.x += 1; save(dir, file, manifest); }));

assert.equal(tests.filter((test) => test.rejected).length, 12, 'all 12 tamper cases must be rejected');
console.log(JSON.stringify({ ok: true, stage: '8.2G-B.1.1a', mutationCases: tests.length - 1, cleanEvidence: clean, tests }));
