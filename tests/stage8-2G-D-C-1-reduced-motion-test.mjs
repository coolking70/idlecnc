import assert from 'node:assert/strict';
import { buildEvidenceStateSignature } from '../js/battle-presentation/universal/evidence-integrity.js';
import { buildPresentations, writeJson } from './lib/stage8-2G-DC1-fixtures.mjs';

const presentation = buildPresentations().get('stage8g-dc-victory');
const schedule = presentation.renderState.atTime(0).shotSchedule;
const shot = schedule.find((item) => item.id === 'choreographed_shot_113');
const timeSeconds = Number((shot.t + .02).toFixed(6));
const normal = presentation.renderState.atTime(timeSeconds, { reducedMotion: false });
const reduced = presentation.renderState.atTime(timeSeconds, { reducedMotion: true });
const effectKey = (state) => state.effects.map((effect) => `${effect.id}:${effect.kind}:${effect.shotId || ''}:${effect.weaponFamily || ''}`).sort();
const audioKey = (state) => state.audioCues.map((cue) => `${cue.id}:${cue.cueFamily}:${cue.eventType}:${cue.shotId || ''}`).sort();
assert.deepEqual(effectKey(reduced), effectKey(normal));
assert.deepEqual(audioKey(reduced), audioKey(normal));
assert.equal(normal.cameraFeedback.reducedMotionApplied, false);
assert.equal(reduced.cameraFeedback.reducedMotionApplied, true);
assert.equal(reduced.cameraFeedback.amplitude, 0);
assert.ok(Math.abs(reduced.cameraFeedback.offsetX) <= 1e-9);
assert.ok(Math.abs(reduced.cameraFeedback.offsetY) <= 1e-9);
assert.ok(Math.abs(reduced.cameraFeedback.zoomDelta) <= 1e-9);
assert.equal(reduced.transitions?.deterministic, true);

const terminalTime = presentation.plan.timeline.duration;
const normalTerminal = presentation.renderState.atTime(terminalTime, { reducedMotion: false });
const reducedTerminal = presentation.renderState.atTime(terminalTime, { reducedMotion: true });
assert.deepEqual(audioKey(reducedTerminal), audioKey(normalTerminal));
assert.ok(reducedTerminal.audioCues.some((cue) => cue.eventType === 'result' && cue.result === 'victory'));

const output = { stage: '8.2G-D-C.1', version: 1, runtimeFlag: 'renderState.atTime(seconds, { reducedMotion: true })', sceneId: 'stage8g-dc-victory', timeSeconds, shotId: shot.id, normal: { effectIds: effectKey(normal), cameraFeedback: normal.cameraFeedback, audioCues: normal.audioCues, stateSignature: buildEvidenceStateSignature({ sceneId: 'stage8g-dc-victory', seed: presentation.plan.source.seed, state: normal, timeMs: timeSeconds * 1000 }) }, reducedMotion: { effectIds: effectKey(reduced), cameraFeedback: reduced.cameraFeedback, audioCues: reduced.audioCues, stateSignature: buildEvidenceStateSignature({ sceneId: 'stage8g-dc-victory', seed: presentation.plan.source.seed, state: reduced, timeMs: timeSeconds * 1000 }) }, terminal: { resultAudioPreserved: true, normalAudio: normalTerminal.audioCues, reducedMotionAudio: reducedTerminal.audioCues, reducedMotionCamera: reducedTerminal.cameraFeedback }, passed: true };
writeJson('stage8_2g_dc1_reduced_motion_check.json', output);
console.log(JSON.stringify({ ok: true, stage: output.stage, shotId: shot.id, normalAmplitude: normal.cameraFeedback.amplitude, reducedMotionAmplitude: reduced.cameraFeedback.amplitude, effectsPreserved: effectKey(normal).length === effectKey(reduced).length }));
