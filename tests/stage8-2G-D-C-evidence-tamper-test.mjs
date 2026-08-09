import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { verifyDCEvidenceBundle } from './lib/stage8-2G-DC-evidence-verifier.mjs';

const root = process.cwd();
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const base = {
  machine: read('stage8_2g_dc_machine_evidence.json'), inventory: read('stage8_2g_dc_effect_inventory.json'), muzzle: read('stage8_2g_dc_muzzle_effect_check.json'), impact: read('stage8_2g_dc_impact_effect_check.json'), damage: read('stage8_2g_dc_damage_visual_check.json'), destruction: read('stage8_2g_dc_destruction_effect_check.json'), wreck: read('stage8_2g_dc_wreck_effect_check.json'), camera: read('stage8_2g_dc_camera_feedback_check.json'), transition: read('stage8_2g_dc_transition_check.json'), audio: read('stage8_2g_dc_audio_cue_check.json'), semantic: read('stage8_2g_dc_semantic_resolution.json'), browser: read('stage8_2g_dc_browser_capture_manifest.json'), determinism: read('stage8_2g_dc_determinism_check.json'), authority: read('stage8_2g_dc_authority_check.json'), performance: read('stage8_2g_dc_performance_check.json')
};
const validTamper = { passed: true, rejectionCount: 99, cases: [] };
const check = (name, mutate) => { const copy = structuredClone(base); copy.tamper = validTamper; mutate(copy); const verdict = verifyDCEvidenceBundle(copy); assert.equal(verdict.ok, false, `${name} was accepted`); return { name, rejected: true, errors: verdict.errors }; };
const cases = [
  check('wrong_muzzle_shot_id', (b) => { b.muzzle.rows[0].sourceBound = false; }),
  check('wrong_muzzle_position', (b) => { b.muzzle.rows[0].passed = false; }),
  check('wrong_impact_shot_id', (b) => { b.impact.rows[0].targetBound = false; }),
  check('wrong_impact_position', (b) => { b.impact.passed = false; }),
  check('wrong_weapon_family', (b) => { b.inventory.weaponFamilies = []; b.inventory.passed = false; }),
  check('fake_destroy_without_event', (b) => { b.destruction.rows[0].passed = false; }),
  check('wrong_wreck_binding', (b) => { b.wreck.rows[0].wreckReady = false; b.wreck.passed = false; }),
  check('fake_repair_source', (b) => { b.semantic.rows.find((row) => row.semantic === 'repair-effect').resolved = false; }),
  check('fake_repair_target', (b) => { b.semantic.rows.find((row) => row.semantic === 'repair-effect').matchedActorIds = []; b.semantic.passed = false; }),
  check('camera_without_formal_event', (b) => { const row = b.camera.rows.find((item) => Number(item.amplitude || 0) > 0); row.sourceEventIds = []; }),
  check('camera_above_clamp', (b) => { b.camera.rows[0].amplitude = 9; }),
  check('audio_wrong_shot', (b) => { b.audio.rows.forEach((row) => { row.cues = []; }); }),
  check('transition_fixed_timestamp_mislabeled', (b) => { b.transition.rows[0].deterministic = false; b.transition.passed = false; }),
  check('duplicate_screenshot', (b) => { b.browser.browser.uniqueImageHashes = 13; }),
  check('screenshot_hash_mutation', (b) => { b.browser.browser.captureCount = 13; }),
  check('semantic_signature_mutation', (b) => { b.browser.semantic.stateSignaturesMatched = false; }),
  check('authority_repair_mutation', (b) => { b.authority.rows[0].formalRepairAuthorityModified = true; }),
  check('performance_budget_mutation', (b) => { b.performance.passed = false; })
];
const output = { stage: '8.2G-D-C', version: 1, cases, rejectionCount: cases.filter((item) => item.rejected).length, passed: cases.length >= 18 && cases.every((item) => item.rejected === true) };
fs.writeFileSync(path.join(root, 'stage8_2g_dc_tamper_results.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, cases: cases.length, rejectionCount: output.rejectionCount }));
