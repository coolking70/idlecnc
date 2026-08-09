import fs from 'node:fs';
import assert from 'node:assert/strict';
import { verifyEBEvidenceBundle } from './lib/stage8-2G-EB-strong-integration-verifier.mjs';

const bundle = JSON.parse(fs.readFileSync('stage8_2g_eb_evidence_bundle.json', 'utf8'));
const verdict = verifyEBEvidenceBundle(bundle);
assert.equal(verdict.ok, true, JSON.stringify(verdict.errors));

const output = {
  stage: '8.2G-E-B',
  checks: verdict.probe.checks,
  sourceChecks: verdict.probe.source.checks,
  browserErrors: verdict.probe.browserErrors,
  independentRecompute: true,
  passed: verdict.ok
};
fs.writeFileSync('stage8_2g_eb_strong_evidence_verdict.json', JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, browserErrors: output.browserErrors }));
