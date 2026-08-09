import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyECEvidenceBundle } from './lib/stage8-2G-EC-strong-integration-verifier.mjs';

const bundle = JSON.parse(fs.readFileSync('stage8_2g_ec_evidence_bundle.json', 'utf8'));
const verdict = verifyECEvidenceBundle(bundle, { root: process.cwd() });
fs.writeFileSync('stage8_2g_ec_strong_evidence_verdict.json', `${JSON.stringify(verdict, null, 2)}\n`);
assert.equal(verdict.ok, true, verdict.errors.join(', '));
console.log(JSON.stringify({ ok: true, stage: '8.2G-E-C', checks: verdict.probe.checks }));
