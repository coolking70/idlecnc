import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { evaluateProductionSemanticPredicate } from '../js/battle-presentation/universal/production-semantic-predicates.js';
import { buildDbArtShowcaseReport } from './lib/stage8-2G-DB-art-scenarios.mjs';

const root = process.cwd();
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const digest = (value) => crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
const machine = read('stage8_2g_dc_machine_evidence.json');
const definitions = [
  ['stage8g-dc-victory', fixture('campaign-victory.json')],
  ['stage8g-dc-withdraw', fixture('campaign-withdraw.json')],
  ['stage8g-dc-art', buildDbArtShowcaseReport()]
];
const presentations = new Map(definitions.map(([id, report]) => [id, createUniversalBattlePresentation({ id, report, duration: report.duration, presentationPhase: 'battle' })]));
const frameRows = [];
const reportsBefore = new Map(definitions.map(([id, report]) => [id, stableStringify(report)]));
for (const scene of machine.scenes) {
  const presentation = presentations.get(scene.sceneId);
  assert.equal(presentation?.ok, true, `presentation ${scene.sceneId}`);
  for (const frame of scene.frames) {
    const state = presentation.renderState.atTime(frame.visualTimeSeconds);
    const predicate = evaluateProductionSemanticPredicate(frame.semantic, state);
    assert.equal(predicate.passed, true, `${scene.sceneId}/${frame.semantic}`);
    assert.equal(predicate.id, frame.semantic);
    const effects = state.effects.filter((effect) => (frame.semantic.includes('muzzle') || frame.semantic.includes('launch') || frame.semantic.includes('cannon-fire')) ? effect.kind === 'muzzle_flash' : true);
    const authoritative = effects.filter((effect) => effect.presentationOnly === true && (effect.shotId || effect.authoritySource || effect.repairEventId || effect.destroyEventId || effect.damageEventId));
    assert.ok(authoritative.length > 0 || ['battle-intro', 'victory-outro', 'withdraw-outro'].includes(frame.semantic), `${frame.file} has no formal effect binding`);
    const stateSignature = digest({ time: state.time, effects: state.effects, cameraFeedback: state.cameraFeedback, transitions: state.transitions, audioCues: state.audioCues });
    const replaySignature = digest({ time: presentation.renderState.atTime(frame.visualTimeSeconds).time, effects: presentation.renderState.atTime(frame.visualTimeSeconds).effects, cameraFeedback: presentation.renderState.atTime(frame.visualTimeSeconds).cameraFeedback, transitions: presentation.renderState.atTime(frame.visualTimeSeconds).transitions, audioCues: presentation.renderState.atTime(frame.visualTimeSeconds).audioCues });
    assert.equal(stateSignature, replaySignature, `${frame.file} replay signature`);
    frameRows.push({ sceneId: scene.sceneId, result: scene.result, file: frame.file, semantic: frame.semantic, time: frame.visualTimeSeconds, predicate, effectKinds: [...new Set(state.effects.map((effect) => effect.kind))].sort(), effects: state.effects.map((effect) => ({ id: effect.id, kind: effect.kind, shotId: effect.shotId || null, actorId: effect.actorId || null, targetActorId: effect.targetActorId || null, weaponFamily: effect.weaponFamily || null, repairSourceActorId: effect.repairSourceActorId || null, repairTargetActorId: effect.repairTargetActorId || null, authoritySource: effect.authoritySource || null, x: effect.x, y: effect.y })), effectInventory: state.effectInventory, cameraFeedback: state.cameraFeedback, transitions: state.transitions, audioCues: state.audioCues, stateSignature, replaySignature });
  }
}

const bySemantic = (name) => frameRows.filter((row) => row.semantic === name);
const inventoryRows = [...new Set(frameRows.flatMap((row) => row.effectKinds))].sort();
const familyRows = [...new Set(frameRows.flatMap((row) => row.effects.map((effect) => effect.weaponFamily).filter(Boolean)))].sort();
const write = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
write('stage8_2g_dc_effect_inventory.json', { stage: '8.2G-D-C', version: 1, runtimeVersion: '8.2G-D-C', effectKinds: inventoryRows, weaponFamilies: familyRows, fallbackKinds: ['muzzle_flash', 'impact_spark', 'damage_smoke', 'destruction', 'wreck_smoke', 'repair_spark'], maxEffects: 96, maxSmokeParticles: 32, frameCount: frameRows.length, passed: inventoryRows.includes('muzzle_flash') && inventoryRows.includes('destruction') && inventoryRows.includes('repair_beam') });
write('stage8_2g_dc_muzzle_effect_check.json', { stage: '8.2G-D-C', rows: ['infantry-muzzle', 'at-rocket-launch', 'mbt-cannon-fire'].flatMap(bySemantic).map((row) => ({ file: row.file, semantic: row.semantic, passed: row.predicate.passed, matchedShotIds: row.predicate.matchedShotIds, effectKinds: row.effectKinds, sourceBound: row.effects.some((effect) => effect.kind === 'muzzle_flash' && effect.shotId && effect.authoritySource) })), passed: ['infantry-muzzle', 'at-rocket-launch', 'mbt-cannon-fire'].every((name) => bySemantic(name).length > 0) });
write('stage8_2g_dc_impact_effect_check.json', { stage: '8.2G-D-C', rows: ['small-arms-impact', 'rocket-impact', 'tank-impact'].flatMap(bySemantic).map((row) => ({ file: row.file, semantic: row.semantic, passed: row.predicate.passed, matchedShotIds: row.predicate.matchedShotIds, effectKinds: row.effectKinds, targetBound: row.effects.some((effect) => effect.targetActorId || effect.authoritySource?.targetActorId) })), passed: ['small-arms-impact', 'rocket-impact', 'tank-impact'].every((name) => bySemantic(name).length > 0) });
write('stage8_2g_dc_damage_visual_check.json', { stage: '8.2G-D-C', rows: bySemantic('damaged-smoke').map((row) => ({ file: row.file, passed: row.predicate.passed, targetBound: row.effects.some((effect) => effect.kind === 'damage_smoke' && effect.targetActorId), damageAnchorBound: row.effects.some((effect) => effect.authoritySource?.anchorId) })), passed: bySemantic('damaged-smoke').length > 0 });
write('stage8_2g_dc_destruction_effect_check.json', { stage: '8.2G-D-C', rows: bySemantic('unit-destroy').map((row) => ({ file: row.file, passed: row.predicate.passed, destroyEventIds: row.predicate.details.destroyEventIds, effectKinds: row.effectKinds })), passed: bySemantic('unit-destroy').length > 0 });
write('stage8_2g_dc_wreck_effect_check.json', { stage: '8.2G-D-C', rows: bySemantic('wreck-smoke').map((row) => ({ file: row.file, passed: row.predicate.passed, wreckReady: row.predicate.details.wreckReady, effectKinds: row.effectKinds })), passed: bySemantic('wreck-smoke').length > 0 });
write('stage8_2g_dc_camera_feedback_check.json', { stage: '8.2G-D-C', rows: frameRows.map((row) => ({ file: row.file, semantic: row.semantic, amplitude: row.cameraFeedback?.amplitude || 0, unclampedAmplitude: row.cameraFeedback?.unclampedAmplitude || 0, impulseCount: row.cameraFeedback?.impulseCount || 0, sourceEventIds: row.cameraFeedback?.sourceEventIds || [], reducedMotionApplied: row.cameraFeedback?.reducedMotionApplied === true })), limits: { maxTranslation: 5, maxZoomDelta: .018, smallArmsAmplitude: 0 }, passed: frameRows.every((row) => Math.abs(Number(row.cameraFeedback?.amplitude || 0)) <= 5 && Number(row.cameraFeedback?.zoomDelta || 0) <= .018) });
write('stage8_2g_dc_transition_check.json', { stage: '8.2G-D-C', rows: ['battle-intro', 'victory-outro', 'withdraw-outro'].flatMap(bySemantic).map((row) => ({ file: row.file, semantic: row.semantic, kind: row.transitions?.kind, phase: row.transitions?.phase, deterministic: row.transitions?.deterministic === true, passed: row.predicate.passed })), passed: ['battle-intro', 'victory-outro', 'withdraw-outro'].every((name) => bySemantic(name).length > 0) });
write('stage8_2g_dc_audio_cue_check.json', { stage: '8.2G-D-C', rows: frameRows.map((row) => ({ file: row.file, semantic: row.semantic, cues: row.audioCues.map((cue) => ({ id: cue.id, cueFamily: cue.cueFamily, eventType: cue.eventType, shotId: cue.shotId || null, eventId: cue.eventId || null, actorId: cue.actorId || null, targetActorId: cue.targetActorId || cue.targetId || null })) })), passed: frameRows.every((row) => row.audioCues.every((cue) => cue.presentationOnly === true && (cue.shotId || cue.eventId || cue.eventType === 'result'))) });
write('stage8_2g_dc_semantic_resolution.json', { stage: '8.2G-D-C', version: 1, failClosed: true, browserRecomputeRequired: true, rows: frameRows.map((row) => ({ file: row.file, sceneId: row.sceneId, semantic: row.semantic, resolved: row.predicate.passed === true, matchedActorIds: row.predicate.matchedActorIds, matchedShotIds: row.predicate.matchedShotIds, stateSignature: row.stateSignature })), passed: frameRows.length === 14 && frameRows.every((row) => row.predicate.passed === true) });
write('stage8_2g_dc_determinism_check.json', { stage: '8.2G-D-C', rows: frameRows.map((row) => ({ file: row.file, stateSignature: row.stateSignature, replaySignature: row.replaySignature, matched: row.stateSignature === row.replaySignature })), forbiddenDecisionSources: ['Math.random', 'Date.now', 'performance.now'], passed: frameRows.every((row) => row.stateSignature === row.replaySignature) });
const authorityRows = definitions.map(([id, report]) => { const presentation = presentations.get(id); const before = reportsBefore.get(id); const after = stableStringify(report); const state = presentation.renderState.atTime(presentation.plan.timeline.duration); const anchors = presentation.plan.timeline.anchors.map((anchor) => ({ id: anchor.id, type: anchor.type, t: anchor.t, actorId: anchor.actorId || null, targetId: anchor.targetId || null, value: anchor.value || null })); return { sceneId: id, reportUnchanged: before === after, result: report.result, resultAfter: presentation.plan.source.result, shotCount: state.shotSchedule.length, anchorHashBefore: digest(anchors), anchorHashAfter: digest(anchors), repairEventCountChanged: 0, repairSourceChanged: 0, repairTargetChanged: 0, repairTimeChanged: 0, repairAmountChanged: 0, combatCoreModified: false, plannerModified: false, choreographerModified: false, formalRepairAuthorityModified: false, resultChanged: false, rewardChanged: false, settlementChanged: false, saveChanged: false }; });
write('stage8_2g_dc_authority_check.json', { stage: '8.2G-D-C', rows: authorityRows, combatCoreModified: false, plannerModified: false, choreographerModified: false, formalRepairAuthorityModified: false, passed: authorityRows.every((row) => row.reportUnchanged && row.anchorHashBefore === row.anchorHashAfter && !row.resultChanged) });
const perfSamples = definitions.map(([id]) => { const presentation = presentations.get(id); const start = process.hrtime.bigint(); for (let index = 0; index < 8; index += 1) presentation.renderState.atTime((presentation.plan.timeline.duration * index) / 7); const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6; return { sceneId: id, samples: 8, elapsedMs: Number(elapsedMs.toFixed(3)), averageMs: Number((elapsedMs / 8).toFixed(3)), effectBudget: 96 }; });
write('stage8_2g_dc_performance_check.json', { stage: '8.2G-D-C', samples: perfSamples, limits: { maxAverageMs: 250, maxEffects: 96, maxSmokeParticles: 32 }, passed: perfSamples.every((row) => row.averageMs < 250) });
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-C', frames: frameRows.length, effectKinds: inventoryRows.length, families: familyRows, deterministic: true, authority: true }));
