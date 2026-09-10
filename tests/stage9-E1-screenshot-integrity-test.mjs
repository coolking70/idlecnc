import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyStage9EEvidence } from './stage9-E-evidence-verifier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage9-e1-screenshot-integrity-'));
const copy = (relativePath) => {
  const source = path.join(root, relativePath);
  const target = path.join(evidenceRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
};

try {
  [
    'stage9_e_machine_evidence.json',
    'stage9_e_browser_capture_manifest.json',
    'stage9_e_evidence.json',
    'stage9_e_strong_evidence_verdict.json',
    'stage9_e_tamper_results.json',
  ].forEach(copy);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'stage9_e_browser_capture_manifest.json'), 'utf8'));
  const frames = manifest.scenes?.[0]?.frames || [];
  frames.forEach((frame) => copy(frame.screenshot.path));
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'stage9_e_evidence.json'), 'utf8'));
  const targetPath = path.join(evidenceRoot, frames[0].screenshot.path);
  const originalBytes = fs.readFileSync(targetPath);
  const tampered = Buffer.from(originalBytes);
  const offset = Math.min(32, tampered.length - 1);
  tampered[offset] ^= 0x01;
  fs.writeFileSync(targetPath, tampered);
  const rejected = verifyStage9EEvidence(candidate, { checkFiles: true, evidenceRoot });
  assert.equal(rejected.passed, false, 'byte tamper must fail file-backed verification');
  assert.ok(rejected.failures.some((failure) => failure.path.includes('frame[0]')), JSON.stringify(rejected.failures));
  fs.writeFileSync(targetPath, originalBytes);
  const restored = verifyStage9EEvidence(candidate, { checkFiles: true, evidenceRoot });
  assert.equal(restored.passed, true, JSON.stringify(restored.failures));
  const restoredHash = crypto.createHash('sha256').update(originalBytes).digest('hex');
  console.log(JSON.stringify({ stage: '9-E.1', tamperedRejected: true, restoredPassed: true, restoredHash }));
} finally {
  fs.rmSync(evidenceRoot, { recursive: true, force: true });
}
