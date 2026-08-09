import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyEAEvidenceBundle } from './lib/stage8-2G-EA-strong-integration-verifier.mjs';

const bundle = JSON.parse(fs.readFileSync('stage8_2g_ea_evidence_bundle.json', 'utf8'));
const verdict = verifyEAEvidenceBundle(bundle);
assert.equal(verdict.ok, true, verdict.errors.join(','));
const output = { stage: '8.2G-E-A', verifier: 'independent production integration recomputation', recomputedChecks: verdict.probe.checks, tamperRejectionCount: verdict.probe.tamper.rejectionCount, screenshots: verdict.screenshots, errors: verdict.errors, passed: verdict.ok };
fs.writeFileSync('stage8_2g_ea_strong_evidence_verdict.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, tamperRejectionCount: output.tamperRejectionCount, screenshots: output.screenshots }));
