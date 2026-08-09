import assert from 'node:assert/strict';
import { verifyDC1EvidenceBundle } from './lib/stage8-2G-DC1-strong-evidence-verifier.mjs';
import { dcBundle, writeJson } from './lib/stage8-2G-DC1-fixtures.mjs';

const bundle = dcBundle('stage8_2g_dc1_');
const verdict = verifyDC1EvidenceBundle(bundle);
assert.equal(verdict.ok, true, verdict.errors.join(','));
assert.equal(verdict.recomputedFrames, 14);
assert.equal(verdict.recomputedPngHashes, 14);
assert.deepEqual(verdict.weaponFamilies, ['anti_armor', 'infantry_light', 'scout_autocannon', 'tank_cannon']);
writeJson('stage8_2g_dc1_strong_evidence_verdict.json', { stage: '8.2G-D-C.1', verifier: 'Production-State recomputation', recomputedFrames: verdict.recomputedFrames, recomputedPngHashes: verdict.recomputedPngHashes, weaponFamilies: verdict.weaponFamilies, errors: verdict.errors, passed: verdict.ok });
writeJson('stage8_2g_dc1_determinism_check.json', { ...bundle.determinism, stage: '8.2G-D-C.1', strongVerifierRecomputed: true, productionStateRecomputed: true, passed: verdict.ok && bundle.determinism.passed === true });
writeJson('stage8_2g_dc1_authority_check.json', { ...bundle.authority, stage: '8.2G-D-C.1', formalReportImportedAsReadOnly: true, strongVerifierRecomputed: true, passed: verdict.ok && bundle.authority.passed === true });
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-C.1', recomputedFrames: verdict.recomputedFrames, recomputedPngHashes: verdict.recomputedPngHashes, weaponFamilies: verdict.weaponFamilies }));
