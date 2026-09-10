import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyStage9EEvidence } from './stage9-E-evidence-verifier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = path.join(root, 'stage9_e_evidence.json');
const verdictPath = path.join(root, 'stage9_e_strong_evidence_verdict.json');
const candidate = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const verdict = verifyStage9EEvidence(candidate, { checkFiles: true });
assert.equal(verdict.passed, true, JSON.stringify(verdict.failures, null, 2));
const output = {
  stage: '9-E', verifier: 'tests/stage9-E-evidence-verifier.mjs', independentRecompute: true,
  passed: true, failureCount: verdict.failures.length, failures: [],
  recomputed: { ok: verdict.recomputed.ok, productionId: verdict.recomputed.productionId, salvageEquipmentId: verdict.recomputed.salvageEquipmentId, settlementUntouched: verdict.recomputed.settlementUntouched }
};
fs.writeFileSync(verdictPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ stage: output.stage, passed: output.passed, failureCount: output.failureCount, verifier: output.verifier }));
