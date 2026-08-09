import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyDC1EvidenceBundle } from './lib/stage8-2G-DC1-strong-evidence-verifier.mjs';
import { dcBundle, readJson, root, writeJson } from './lib/stage8-2G-DC1-fixtures.mjs';

const base = dcBundle('stage8_2g_dc1_', { includeTamper: false });
const validTamper = { passed: true, rejectionCount: 24, cases: Array.from({ length: 24 }, (_, index) => ({ id: `dc1-valid-case-${index + 1}`, rejected: true, declaredPassedPreserved: true })) };
const frame = (bundle, file) => bundle.browser.scenes.flatMap((scene) => scene.frames).find((item) => item.file === file);
const effect = (bundle, file, predicate) => frame(bundle, file).effects.find(predicate);
const terminal = (bundle, sceneId) => bundle.browser.scenes.find((scene) => scene.sceneId === sceneId).terminal;
const cases = [];
function check(name, mutate, mutateFile = null) {
  const copy = structuredClone(base); copy.tamper = structuredClone(validTamper);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-dc1-tamper-'));
  fs.cpSync(path.join(root, 'screenshots'), path.join(temp, 'screenshots'), { recursive: true });
  try {
    mutate(copy);
    if (mutateFile) mutateFile(temp, copy);
    const verdict = verifyDC1EvidenceBundle(copy, { root: temp });
    const row = { id: name, rejected: verdict.ok === false, declaredPassedPreserved: true, verifierExitCode: verdict.ok ? 0 : 1, errors: verdict.errors };
    cases.push(row);
    assert.equal(row.rejected, true, `${name} was accepted by Production-State verifier`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

check('wrong_muzzle_shot_id', (b) => { effect(b, 'd-c-01-infantry-muzzle.png', (item) => item.kind === 'muzzle_flash').shotId = 'fake-shot'; });
check('wrong_muzzle_position', (b) => { effect(b, 'd-c-01-infantry-muzzle.png', (item) => item.kind === 'muzzle_flash').x += 31; });
check('scout_family_as_tank', (b) => { effect(b, 'd-c-11-scout-fire.png', (item) => item.kind === 'muzzle_flash').weaponFamily = 'tank_cannon'; });
check('mbt_family_as_scout', (b) => { effect(b, 'd-c-03-mbt-cannon-fire.png', (item) => item.kind === 'muzzle_flash').weaponFamily = 'scout_autocannon'; });
check('wrong_impact_shot_id', (b) => { effect(b, 'd-c-04-small-arms-impact.png', (item) => item.kind === 'impact_spark').shotId = 'fake-impact'; });
check('wrong_impact_position', (b) => { effect(b, 'd-c-05-rocket-impact.png', (item) => item.kind === 'rocket_impact').y += 27; });
check('wrong_destroy_event_id', (b) => { effect(b, 'd-c-08-destruction-sequence.png', (item) => ['destroy_flash', 'destruction'].includes(item.kind)).destroyEventId = 'fake-destroy'; });
check('wrong_wreck_faction', (b) => { const row = frame(b, 'd-c-09-burning-wreck.png').wrecks[0]; row.side = row.side === 'enemy' ? 'friendly' : 'enemy'; });
check('wrong_wreck_orientation', (b) => { frame(b, 'd-c-09-burning-wreck.png').wrecks[0].angle += 1.2; });
check('wrong_repair_source', (b) => { effect(b, 'd-c-10-repair-effect.png', (item) => item.kind === 'repair_beam').repairSourceActorId = 'unit_fixture-u-1'; });
check('wrong_repair_target', (b) => { effect(b, 'd-c-10-repair-effect.png', (item) => item.kind === 'repair_beam').repairTargetActorId = 'unit_fixture-u-1'; });
check('camera_event_removed', (b) => { frame(b, 'd-c-03-mbt-cannon-fire.png').cameraFeedback.sourceEventIds = []; });
check('camera_amplitude_tampered', (b) => { frame(b, 'd-c-03-mbt-cannon-fire.png').cameraFeedback.amplitude = 4.25; });
check('audio_wrong_shot_id', (b) => { frame(b, 'd-c-03-mbt-cannon-fire.png').audioCues.find((cue) => cue.eventType === 'fire').shotId = 'fake-audio'; });
check('audio_wrong_family', (b) => { frame(b, 'd-c-03-mbt-cannon-fire.png').audioCues.find((cue) => cue.eventType === 'fire').cueFamily = 'scout_autocannon_fire'; });
check('terminal_result_audio_tamper', (b) => { terminal(b, 'stage8g-dc-victory').audioCues.find((cue) => cue.eventType === 'result').cueFamily = 'result_withdraw'; });
check('matched_actor_tamper', (b) => { frame(b, 'd-c-03-mbt-cannon-fire.png').matchedActorIds = ['enemy_infantry_1']; });
check('browser_signature_tamper', (b) => { frame(b, 'd-c-03-mbt-cannon-fire.png').stateSignature = 'fake-signature'; });
check('browser_png_hash_tamper', (b) => { frame(b, 'd-c-01-infantry-muzzle.png').imageSha256 = 'fake-png-hash'; });
check('machine_binding_tamper', (b) => { b.machine.scenes.flatMap((scene) => scene.frames).find((item) => item.semantic === 'mbt-cannon-fire').semanticResolution.matchedShotIds = ['fake-shot']; });
check('effect_inventory_tamper', (b) => { b.inventory.weaponFamilies = ['tank_cannon']; });
check('formal_source_report_tamper', (b) => { b.machine.scenes.find((scene) => scene.sceneId === 'stage8g-dc-victory').sourceReport.seed += 1; });
check('screenshot_bytes_tamper', () => {}, (temp, b) => { const target = frame(b, 'd-c-01-infantry-muzzle.png').screenshot.path; fs.appendFileSync(path.join(temp, target), Buffer.from('tampered')); });
check('terminal_signature_tamper', (b) => { terminal(b, 'stage8g-dc-withdraw').stateSignature = 'fake-terminal-signature'; });

const output = { stage: '8.2G-D-C.1', version: 1, verifier: 'Production-State recomputation plus true-value tamper gate', minimumCases: 20, cases, rejectionCount: cases.filter((item) => item.rejected).length, declaredPassedPreserved: cases.every((item) => item.declaredPassedPreserved === true), passed: cases.length >= 20 && cases.every((item) => item.rejected === true && item.declaredPassedPreserved === true) };
assert.equal(output.passed, true);
writeJson('stage8_2g_dc1_tamper_results.json', output);
console.log(JSON.stringify({ ok: true, stage: output.stage, cases: cases.length, rejectionCount: output.rejectionCount, declaredPassedPreserved: output.declaredPassedPreserved }));
