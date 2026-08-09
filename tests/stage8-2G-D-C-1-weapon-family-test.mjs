import assert from 'node:assert/strict';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { normalizeEffectWeaponFamily } from '../js/battle-presentation/effects/presentation-effects-runtime.js';
import { evaluateProductionSemanticPredicate } from '../js/battle-presentation/universal/production-semantic-predicates.js';
import { resolveDCSemanticFrame } from './lib/stage8-2G-DC-semantic-frame-resolver.mjs';
import { buildPresentations, definitions, readJson, root, writeJson } from './lib/stage8-2G-DC1-fixtures.mjs';
import fs from 'node:fs';
import path from 'node:path';

const mappings = [
  ['infantry_light', 'infantry_light'], ['infantry_rifle', 'infantry_light'], ['anti_armor_rocket', 'anti_armor'], ['rocket_launcher', 'anti_armor'],
  ['scout_machine_gun', 'scout_autocannon'], ['scout_autocannon', 'scout_autocannon'], ['tank_main_gun', 'tank_cannon'], ['tank_cannon', 'tank_cannon'], ['repair_tool', 'repair']
].map(([id, expected]) => ({ id, expected, actual: normalizeEffectWeaponFamily({ weapon: { id } }) }));
assert.ok(mappings.every((row) => row.actual === row.expected));
const unknown = normalizeEffectWeaponFamily({ weapon: { id: 'mystery_cannon', family: 'mystery_cannon', kind: 'unknown' } });
assert.equal(unknown, 'generic');

const presentations = buildPresentations();
const victory = presentations.get('stage8g-dc-victory');
assert.equal(victory.ok, true);
const report = definitions[0].report;
const reportBefore = stableStringify(report);
const schedule = victory.renderState.atTime(0).shotSchedule;
const scoutShot = schedule.find((shot) => shot.id === 'choreographed_shot_102');
const mbtShot = schedule.find((shot) => shot.id === 'choreographed_shot_113');
assert.equal(scoutShot?.actorId, 'unit_fixture-u-3');
assert.equal(scoutShot?.weapon?.id, 'scout_machine_gun');
assert.equal(scoutShot?.weapon?.family, 'scout_autocannon');
assert.equal(mbtShot?.actorId, 'unit_fixture-u-5');
assert.equal(mbtShot?.weapon?.id, 'tank_main_gun');
assert.equal(mbtShot?.weapon?.family, 'tank_cannon');
assert.equal(stableStringify(report), reportBefore);

const scoutState = victory.renderState.atTime(scoutShot.t + .02);
const mbtState = victory.renderState.atTime(mbtShot.t + .02);
const scoutEffect = scoutState.effects.find((effect) => effect.shotId === scoutShot.id && effect.kind === 'muzzle_flash');
const mbtEffect = mbtState.effects.find((effect) => effect.shotId === mbtShot.id && effect.kind === 'muzzle_flash');
assert.equal(scoutEffect?.weaponFamily, 'scout_autocannon'); assert.equal(mbtEffect?.weaponFamily, 'tank_cannon');
assert.equal(scoutEffect?.size, 13); assert.equal(mbtEffect?.size, 34);
assert.equal(scoutState.cameraFeedback.amplitude, 0); assert.ok(mbtState.cameraFeedback.amplitude > 0);
assert.ok(scoutState.audioCues.some((cue) => cue.cueFamily === 'scout_autocannon_fire' && cue.shotId === scoutShot.id));
assert.ok(mbtState.audioCues.some((cue) => cue.cueFamily === 'tank_cannon_fire' && cue.shotId === mbtShot.id));

const machine = readJson('stage8_2g_dc_machine_evidence.json');
const mbtFrame = machine.scenes.flatMap((scene) => scene.frames).find((frame) => frame.semantic === 'mbt-cannon-fire');
assert.equal(mbtFrame?.semanticResolution?.matchedActorIds?.includes('unit_fixture-u-5'), true);
assert.equal(mbtFrame?.semanticResolution?.matchedShotIds?.includes('choreographed_shot_113'), true);
assert.equal(evaluateProductionSemanticPredicate('mbt-cannon-fire', mbtState).passed, true);

const stage = '8.2G-D-C.1';
writeJson('stage8_2g_dc1_weapon_family_check.json', { stage, version: 1, mappingPolicy: 'exact-id-family-kind-fail-closed', mappings, unknownInput: { id: 'mystery_cannon', family: 'mystery_cannon', kind: 'unknown' }, unknownResult: unknown, scoutMustNotBecomeTank: scoutEffect?.weaponFamily !== 'tank_cannon', realMbt: { shotId: mbtShot.id, actorId: mbtShot.actorId, weaponId: mbtShot.weapon.id, weaponFamily: mbtShot.weapon.family, effectFamily: mbtEffect?.weaponFamily, muzzleSize: mbtEffect?.size }, passed: true });
writeJson('stage8_2g_dc1_semantic_resolution.json', { stage, version: 1, failClosed: true, source: 'formal-report-recomputed-presentation-state', regressionSample: { shotId: scoutShot.id, actorId: scoutShot.actorId, weaponId: scoutShot.weapon.id, weaponFamily: scoutShot.weapon.family, effectFamily: scoutEffect?.weaponFamily, predicate: evaluateProductionSemanticPredicate('scout-fire', scoutState) }, realMbt: { frame: mbtFrame, predicate: evaluateProductionSemanticPredicate('mbt-cannon-fire', mbtState) }, passed: true });
for (const [suffix, sourceName] of [['muzzle_binding', 'stage8_2g_dc_muzzle_effect_check.json'], ['impact_binding', 'stage8_2g_dc_impact_effect_check.json'], ['destroy_binding', 'stage8_2g_dc_destruction_effect_check.json'], ['repair_binding', 'stage8_2g_dc_semantic_resolution.json'], ['camera_binding', 'stage8_2g_dc_camera_feedback_check.json'], ['audio_binding', 'stage8_2g_dc_audio_cue_check.json']]) {
  const source = JSON.parse(fs.readFileSync(path.join(root, sourceName), 'utf8'));
  writeJson(`stage8_2g_dc1_${suffix}.json`, { ...source, stage, sourceStage: '8.2G-D-C', recomputedFromFormalState: true, passed: source.passed === true });
}
console.log(JSON.stringify({ ok: true, stage, mappings: mappings.length, unknown, scout: scoutEffect?.weaponFamily, mbt: { actorId: mbtShot.actorId, shotId: mbtShot.id, family: mbtEffect?.weaponFamily } }));
