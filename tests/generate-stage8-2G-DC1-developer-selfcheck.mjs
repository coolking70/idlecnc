import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dcBundle, readJson, writeJson } from './lib/stage8-2G-DC1-fixtures.mjs';
import { verifyDC1EvidenceBundle } from './lib/stage8-2G-DC1-strong-evidence-verifier.mjs';

const bundle = dcBundle('stage8_2g_dc1_');
const verdict = verifyDC1EvidenceBundle(bundle);
const required = ['stage8_2g_dc1_weapon_family_check.json', 'stage8_2g_dc1_semantic_resolution.json', 'stage8_2g_dc1_muzzle_binding.json', 'stage8_2g_dc1_impact_binding.json', 'stage8_2g_dc1_destroy_binding.json', 'stage8_2g_dc1_repair_binding.json', 'stage8_2g_dc1_camera_binding.json', 'stage8_2g_dc1_audio_binding.json', 'stage8_2g_dc1_reduced_motion_check.json', 'stage8_2g_dc1_performance_check.json', 'stage8_2g_dc1_determinism_check.json', 'stage8_2g_dc1_authority_check.json', 'stage8_2g_dc1_tamper_results.json', 'stage8_2g_dc1_browser_capture_manifest.json', 'stage8_2g_dc1_strong_evidence_verdict.json'];
const missing = required.filter((name) => !fs.existsSync(name));
assert.equal(verdict.ok, true, verdict.errors.join(','));
assert.deepEqual(missing, []);
const performance = readJson('stage8_2g_dc1_performance_check.json');
const tamper = readJson('stage8_2g_dc1_tamper_results.json');
const browser = readJson('stage8_2g_dc1_browser_capture_manifest.json');
assert.equal(performance.passed, true); assert.equal(tamper.passed, true); assert.equal(tamper.declaredPassedPreserved, true); assert.equal(browser.browser.captureCount, 14); assert.equal(browser.browser.uniqueImageHashes, 14);
const output = { stage: '8.2G-D-C.1', version: 1, requiredArtifacts: required, missing, strongVerifier: verdict, performanceP95Ms: performance.scenes.map((row) => ({ sceneId: row.sceneId, p95Ms: row.p95Ms })), tamperRejectionCount: tamper.rejectionCount, browserCaptureCount: browser.browser.captureCount, uniqueImageHashes: browser.browser.uniqueImageHashes, formalReportImportedAsReadOnly: true, formalRepairAuthorityModified: bundle.authority.formalRepairAuthorityModified === true, passed: true };
writeJson('stage8_2g_dc1_developer_selfcheck.json', output);
console.log(JSON.stringify({ ok: true, stage: output.stage, requiredArtifacts: required.length, tamperRejectionCount: output.tamperRejectionCount, browserCaptureCount: output.browserCaptureCount }));
