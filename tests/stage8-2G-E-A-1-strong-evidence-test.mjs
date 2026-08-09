import fs from 'node:fs';
import assert from 'node:assert/strict';
import { verifyEA1EvidenceBundle } from './lib/stage8-2G-EA1-strong-integration-verifier.mjs';

const bundle = JSON.parse(fs.readFileSync('stage8_2g_ea1_evidence_bundle.json', 'utf8'));
const verdict = verifyEA1EvidenceBundle(bundle);
assert.equal(verdict.ok, true, verdict.errors.join(','));
const output = {
  stage: '8.2G-E-A.1',
  verifier: 'independent replay/save-diff/UI/reload recomputation',
  checks: verdict.probe.checks,
  replay: verdict.probe.replay,
  settlement: verdict.probe.settlement,
  tamperRejectionCount: verdict.probe.tamper.rejectionCount,
  screenshots: verdict.screenshots,
  browserErrors: verdict.browserErrors,
  errors: verdict.errors,
  passed: verdict.ok
};
fs.writeFileSync('stage8_2g_ea1_strong_evidence_verdict.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, tamperRejectionCount: output.tamperRejectionCount, screenshots: output.screenshots }));
