import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyEA1EvidenceBundle } from './lib/stage8-2G-EA1-strong-integration-verifier.mjs';

const bundle = JSON.parse(fs.readFileSync('stage8_2g_ea1_evidence_bundle.json', 'utf8'));
const cases = [];
const tamper = (name, mutate) => {
  const candidate = JSON.parse(JSON.stringify(bundle));
  mutate(candidate);
  const verdict = verifyEA1EvidenceBundle(candidate);
  const rejected = verdict.ok === false;
  cases.push({ case: name, rejected, errors: verdict.errors });
  assert.equal(rejected, true, `${name} was accepted`);
};

tamper('fake_ui_provenance', (candidate) => { candidate.browser.actionProvenance[0].source = 'debug_api'; });
tamper('fake_reload_method', (candidate) => { candidate.browser.realReloads[0].method = 'window.__IRON_COMMAND__.load'; });
tamper('fake_reload_time_origin', (candidate) => { candidate.browser.realReloads[1].timeOriginChanged = false; });
tamper('fake_production_entry', (candidate) => { candidate.browser.productionEntry = false; });
tamper('fake_dispatch_api_used', (candidate) => { candidate.browser.dispatchApiUsed = true; });
tamper('fake_replay_api_used', (candidate) => { candidate.browser.replayApiUsed = true; });
tamper('tampered_png_hash', (candidate) => { candidate.browser.scenes[0].frames[0].imageSha256 = '0'.repeat(64); });

const core = JSON.parse(fs.readFileSync('stage8_2g_ea1_tamper_results.json', 'utf8'));
const output = {
  stage: '8.2G-E-A.1',
  cases: [...(core.cases || []), ...cases],
  coreRejectionCount: core.rejectionCount,
  evidenceTamperRejectionCount: cases.filter((item) => item.rejected).length,
  rejectionCount: (core.rejectionCount || 0) + cases.filter((item) => item.rejected).length,
  declaredPassedPreserved: true,
  passed: core.passed === true && cases.every((item) => item.rejected === true)
};
fs.writeFileSync('stage8_2g_ea1_tamper_results.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, rejectionCount: output.rejectionCount }));
