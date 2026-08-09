import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalEvidenceString, buildEvidenceStateSignature } from '../../js/battle-presentation/universal/evidence-integrity.js';
import { createUniversalBattlePresentation } from '../../js/battle-presentation/universal/universal-battle-adapter.js';
import { evaluateProductionSemanticPredicate } from '../../js/battle-presentation/universal/production-semantic-predicates.js';
import { normalizeEffectWeaponFamily } from '../../js/battle-presentation/effects/presentation-effects-runtime.js';

const round = (value, digits = 6) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
const digest = (value) => crypto.createHash('sha256').update(fs.readFileSync(value)).digest('hex');
const compare = (left, right) => canonicalEvidenceString(left) === canonicalEvidenceString(right);
const list = (value) => Array.isArray(value) ? value : [];
const snapshotAuthority = (value) => value ? Object.fromEntries(Object.entries(value).sort().map(([key, child]) => [key, typeof child === 'number' ? round(child) : child])) : null;

function effectSnapshot(effect) {
  return {
    id: effect?.id || null,
    kind: effect?.kind || null,
    x: round(effect?.x),
    y: round(effect?.y),
    life: round(effect?.life),
    maxLife: round(effect?.maxLife),
    shotId: effect?.shotId || null,
    actorId: effect?.actorId || null,
    targetActorId: effect?.targetActorId || effect?.target || null,
    weaponFamily: effect?.weaponFamily || null,
    weaponProfileId: effect?.weaponProfileId || null,
    sourceEventId: effect?.sourceEventId || null,
    impactEventId: effect?.impactEventId || null,
    damageEventId: effect?.damageEventId || null,
    destroyEventId: effect?.destroyEventId || null,
    repairEventId: effect?.repairEventId || null,
    repairSourceActorId: effect?.repairSourceActorId || null,
    repairTargetActorId: effect?.repairTargetActorId || null,
    damageTier: effect?.damageTier || null,
    wreckReady: effect?.wreckReady === true,
    wreckFacing: effect?.kind === 'wreck_fire' ? round(effect?.wreckFacing, 5) : null,
    authoritySource: snapshotAuthority(effect?.authoritySource)
  };
}

function cameraSnapshot(camera) {
  if (!camera) return null;
  return {
    amplitude: round(camera.amplitude),
    unclampedAmplitude: round(camera.unclampedAmplitude),
    offsetX: round(camera.offsetX),
    offsetY: round(camera.offsetY),
    zoomDelta: round(camera.zoomDelta),
    impulseCount: Number(camera.impulseCount || 0),
    sourceEventIds: [...list(camera.sourceEventIds)],
    reducedMotionApplied: camera.reducedMotionApplied === true,
    impulses: list(camera.impulses).map((impulse) => ({ eventId: impulse.eventId || null, shotId: impulse.shotId || null, amplitude: round(impulse.amplitude), kind: impulse.kind || null })).sort((a, b) => `${a.kind}:${a.eventId}:${a.shotId}`.localeCompare(`${b.kind}:${b.eventId}:${b.shotId}`))
  };
}

function audioSnapshot(cues) {
  return list(cues).map((cue) => ({ id: cue.id || null, cueFamily: cue.cueFamily || null, eventType: cue.eventType || null, shotId: cue.shotId || null, eventId: cue.eventId || null, actorId: cue.actorId || null, targetActorId: cue.targetActorId || cue.targetId || null, result: cue.result || null, time: round(cue.time, 3) })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function transitionSnapshot(transition) {
  if (!transition) return null;
  return { kind: transition.kind || null, phase: transition.phase || null, progress: round(transition.progress), alpha: round(transition.alpha), result: transition.result || null, deterministic: transition.deterministic === true };
}

function wreckSnapshot(wreck) {
  return {
    id: wreck?.id || null,
    sourceActorId: wreck?.sourceActorId || null,
    sourceType: wreck?.sourceType || null,
    side: wreck?.side || null,
    visualClass: wreck?.visualClass || null,
    x: round(wreck?.x),
    y: round(wreck?.y),
    angle: round(wreck?.angle),
    wreckType: wreck?.wreckType || null,
    smoke: wreck?.smoke === true,
    persistent: wreck?.persistent === true,
    createdAt: round(wreck?.createdAt)
  };
}

function expectedFrame(presentation, scene, frame) {
  const state = presentation.renderState.atTime(frame.visualTimeSeconds);
  const predicate = evaluateProductionSemanticPredicate(frame.semantic, state);
  const stateSignature = buildEvidenceStateSignature({ sceneId: scene.sceneId, seed: scene.seed, state, timeMs: frame.visualTimeSeconds * 1000 });
  const effects = list(state.effects).map(effectSnapshot).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return {
    state,
    predicate,
    stateSignature,
    effectKinds: [...new Set(effects.map((effect) => effect.kind))].sort(),
    effectIds: effects.map((effect) => effect.id),
    effects,
    wrecks: list(state.wrecks).map(wreckSnapshot).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    cameraFeedback: cameraSnapshot(state.cameraFeedback),
    audioCues: audioSnapshot(state.audioCues),
    transitions: transitionSnapshot(state.transitions),
    matchedActorIds: [...list(predicate.matchedActorIds)].sort(),
    matchedShotIds: [...list(predicate.matchedShotIds)].sort()
  };
}

function rowFor(rows, file) { return list(rows).find((row) => row.file === file) || null; }
function browserFrameFor(manifest, file) { return list(manifest?.scenes).flatMap((scene) => list(scene.frames)).find((frame) => frame.file === file) || null; }
function browserSceneFor(manifest, sceneId) { return list(manifest?.scenes).find((scene) => scene.sceneId === sceneId) || null; }

function verifyScreenshot(frame, root, errors) {
  const screenshotPath = frame?.screenshot?.path;
  if (!screenshotPath || path.isAbsolute(screenshotPath) || screenshotPath.includes('..')) { errors.push(`png_path:${frame?.file || 'unknown'}`); return; }
  const absolute = path.resolve(root, screenshotPath);
  if (!fs.existsSync(absolute)) { errors.push(`png_missing:${frame.file}`); return; }
  const actual = digest(absolute);
  if (actual !== frame.imageSha256 || actual !== frame.screenshot?.sha256) errors.push(`png_hash:${frame.file}`);
}

function verifyDeclaredRows(bundle, errors) {
  const required = ['inventory', 'muzzle', 'impact', 'damage', 'destruction', 'wreck', 'camera', 'transition', 'audio', 'semantic', 'determinism', 'authority', 'performance'];
  for (const key of required) if (bundle[key]?.passed !== true) errors.push(`declared_${key}`);
  for (const key of ['muzzle', 'impact', 'damage', 'destruction', 'wreck', 'camera', 'transition']) {
    if (list(bundle[key]?.rows).some((row) => row.passed === false || (Object.prototype.hasOwnProperty.call(row, 'passed') && row.passed !== true))) errors.push(`declared_${key}_row`);
  }
  if (list(bundle.muzzle?.rows).some((row) => row.sourceBound === false)) errors.push('declared_muzzle_binding');
  if (list(bundle.impact?.rows).some((row) => row.targetBound === false)) errors.push('declared_impact_binding');
  if (list(bundle.damage?.rows).some((row) => row.targetBound === false || row.damageAnchorBound === false)) errors.push('declared_damage_binding');
  if (list(bundle.wreck?.rows).some((row) => row.wreckReady === false)) errors.push('declared_wreck_binding');
  if (list(bundle.camera?.rows).some((row) => Number(row.amplitude || 0) > 5 || (Number(row.amplitude || 0) > 0 && list(row.sourceEventIds).length === 0))) errors.push('declared_camera_binding');
  const audioBindingRows = list(bundle.audio?.rows).filter((row) => ['infantry-muzzle', 'at-rocket-launch', 'mbt-cannon-fire', 'small-arms-impact', 'rocket-impact', 'tank-impact', 'damaged-smoke', 'unit-destroy', 'wreck-smoke', 'repair-effect'].includes(row.semantic));
  if (audioBindingRows.some((row) => Object.prototype.hasOwnProperty.call(row, 'cues') && list(row.cues).length === 0)) errors.push('declared_audio_binding');
  if (list(bundle.semantic?.rows).some((row) => Object.prototype.hasOwnProperty.call(row, 'resolved') && row.resolved !== true)) errors.push('declared_semantic_binding');
}

export function verifyDC1EvidenceBundle(bundle = {}, { root = process.cwd() } = {}) {
  const errors = [];
  verifyDeclaredRows(bundle, errors);
  const machine = bundle.machine;
  const browser = bundle.browser;
  if (!machine || !['8.2G-D-C', '8.2G-D-C.1'].includes(machine.stage) || machine.sceneCount !== 3 || machine.frameCount !== 14) errors.push('machine_shape');
  if (!browser || !['8.2G-D-C', '8.2G-D-C.1'].includes(browser.stage) || browser.browser?.pageErrors?.length || browser.browser?.consoleErrors?.length) errors.push('browser_runtime');
  const machineFrames = list(machine?.scenes).flatMap((scene) => list(scene.frames));
  const browserFrames = list(browser?.scenes).flatMap((scene) => list(scene.frames));
  const seenFiles = new Set(); const imageHashes = new Set(); const expectedRows = [];
  for (const scene of list(machine?.scenes)) {
    if (!scene.sourceReport || !scene.sceneHash) { errors.push(`source_state:${scene.sceneId}`); continue; }
    const presentation = createUniversalBattlePresentation({ id: scene.sceneId, report: scene.sourceReport, duration: scene.sourceReport.duration, presentationPhase: 'battle' });
    if (!presentation.ok) { errors.push(`presentation:${scene.sceneId}`); continue; }
    if (presentation.plan.planFingerprint !== scene.sceneHash && presentation.plan.source?.reportFingerprint !== scene.sceneHash) errors.push(`scene_hash:${scene.sceneId}`);
    for (const frame of list(scene.frames)) {
      if (seenFiles.has(frame.file)) errors.push(`duplicate_frame:${frame.file}`);
      seenFiles.add(frame.file);
      const expected = expectedFrame(presentation, scene, frame);
      const semanticRow = frame.semanticResolution;
      const browserFrame = browserFrameFor(browser, frame.file);
      if (!expected.predicate.passed) errors.push(`semantic_recompute:${frame.file}`);
      if (!semanticRow || semanticRow.resolved !== true || semanticRow.stateSignature !== expected.stateSignature || !compare(semanticRow.matchedActorIds, expected.matchedActorIds) || !compare(semanticRow.matchedShotIds, expected.matchedShotIds)) errors.push(`machine_binding:${frame.file}`);
      if (!browserFrame) { errors.push(`browser_frame:${frame.file}`); continue; }
      if (browserFrame.semantic !== frame.semantic || Number(browserFrame.visualTimeSeconds) !== Number(frame.visualTimeSeconds)) errors.push(`browser_label:${frame.file}`);
      if (browserFrame.stateSignature !== expected.stateSignature) errors.push(`browser_signature:${frame.file}`);
      const browserPredicate = browserFrame.productionSemanticPredicate;
      if (!browserPredicate?.passed || browserPredicate.id !== expected.predicate.id || !compare(browserPredicate.matchedActorIds, expected.matchedActorIds) || !compare(browserPredicate.matchedShotIds, expected.matchedShotIds)) errors.push(`browser_semantic:${frame.file}`);
      if (!compare(browserFrame.matchedActorIds, expected.matchedActorIds) || !compare(browserFrame.matchedShotIds, expected.matchedShotIds)) errors.push(`browser_binding:${frame.file}`);
      const browserEffects = list(browserFrame.effects).map(effectSnapshot).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      if (!compare(browserEffects, expected.effects)) errors.push(`effect_recompute:${frame.file}`);
      const browserWrecks = list(browserFrame.wrecks).map(wreckSnapshot).sort((a, b) => String(a.id).localeCompare(String(b.id)));
      if (!compare(browserWrecks, expected.wrecks)) errors.push(`wreck_recompute:${frame.file}`);
      if (!compare(browserFrame.cameraFeedback && cameraSnapshot(browserFrame.cameraFeedback), expected.cameraFeedback)) errors.push(`camera_recompute:${frame.file}`);
      if (!compare(audioSnapshot(browserFrame.audioCues), expected.audioCues)) errors.push(`audio_recompute:${frame.file}`);
      if (!compare(transitionSnapshot(browserFrame.transitions), expected.transitions)) errors.push(`transition_recompute:${frame.file}`);
      verifyScreenshot(browserFrame, root, errors);
      if (browserFrame.imageSha256) imageHashes.add(browserFrame.imageSha256);
      expectedRows.push({ file: frame.file, sceneId: scene.sceneId, semantic: frame.semantic, expected, browserFrame });
    }
    const browserScene = browserSceneFor(browser, scene.sceneId);
    if (scene.frames.length) {
      const terminalState = presentation.renderState.atTime(presentation.plan.timeline.duration);
      const expectedTerminal = {
        timeSeconds: Number(terminalState.time),
        result: scene.result,
        stateSignature: buildEvidenceStateSignature({ sceneId: scene.sceneId, seed: scene.seed, state: terminalState, timeMs: Number(terminalState.time) * 1000 }),
        audioCues: audioSnapshot(terminalState.audioCues),
        transitions: transitionSnapshot(terminalState.transitions),
        wrecks: list(terminalState.wrecks).map(wreckSnapshot).sort((a, b) => String(a.id).localeCompare(String(b.id)))
      };
      const actualTerminal = browserScene?.terminal;
      if (!actualTerminal || Number(actualTerminal.timeSeconds) !== expectedTerminal.timeSeconds || actualTerminal.result !== expectedTerminal.result || actualTerminal.stateSignature !== expectedTerminal.stateSignature || !compare(audioSnapshot(actualTerminal.audioCues), expectedTerminal.audioCues) || !compare(transitionSnapshot(actualTerminal.transitions), expectedTerminal.transitions) || !compare(list(actualTerminal.wrecks).map(wreckSnapshot).sort((a, b) => String(a.id).localeCompare(String(b.id))), expectedTerminal.wrecks)) errors.push(`terminal_recompute:${scene.sceneId}`);
      if (!expectedTerminal.audioCues.some((cue) => cue.eventType === 'result' && cue.result === scene.result)) errors.push(`terminal_result_audio:${scene.sceneId}`);
    }
  }
  if (machineFrames.length !== 14 || browserFrames.length !== 14 || seenFiles.size !== 14) errors.push('frame_count');
  if (imageHashes.size !== 14) errors.push('png_unique_hashes');
  if (browser?.browser?.captureCount !== browserFrames.length || browser?.browser?.uniqueImageHashes !== imageHashes.size) errors.push('manifest_counts');
  if (browser?.semantic?.browserRecomputed !== true || browser?.semantic?.stateSignaturesMatched !== true || browser?.effects?.traceable !== true || browser?.effects?.inventoryPresent !== true) errors.push('manifest_claims');
  const expectedKinds = [...new Set(expectedRows.flatMap((row) => row.expected.effectKinds))].sort();
  const expectedFamilies = [...new Set(expectedRows.flatMap((row) => row.expected.effects.map((effect) => effect.weaponFamily).filter(Boolean)))].sort();
  if (!compare(bundle.inventory?.effectKinds, expectedKinds) || !compare(bundle.inventory?.weaponFamilies, expectedFamilies)) errors.push('inventory_recompute');
  if (bundle.camera?.rows?.some((row) => !row.file || !browserFrameFor(browser, row.file))) errors.push('camera_rows');
  if (bundle.audio?.rows?.some((row) => !row.file || !browserFrameFor(browser, row.file))) errors.push('audio_rows');
  const cues = expectedRows.flatMap((row) => row.expected.audioCues);
  if (!cues.some((cue) => cue.eventType === 'fire') || !cues.some((cue) => cue.eventType === 'impact') || !cues.some((cue) => cue.eventType === 'destroy') || !cues.some((cue) => cue.eventType === 'repair')) errors.push('audio_event_coverage');
  if (!cues.every((cue) => cue.shotId || cue.eventId || cue.eventType === 'result')) errors.push('audio_traceability');
  const resultCues = list(machine?.scenes).map((scene) => {
    const presentation = createUniversalBattlePresentation({ id: scene.sceneId, report: scene.sourceReport, duration: scene.sourceReport.duration, presentationPhase: 'battle' });
    const state = presentation.ok ? presentation.renderState.atTime(presentation.plan.timeline.duration) : null;
    return state?.audioCues?.find((cue) => cue.eventType === 'result' && cue.result === scene.result);
  });
  if (resultCues.some((cue) => !cue)) errors.push('result_audio');
  if (bundle.authority?.rows?.some((row) => row.reportUnchanged !== true || row.anchorHashBefore !== row.anchorHashAfter || row.formalRepairAuthorityModified === true || row.resultChanged === true || row.rewardChanged === true || row.settlementChanged === true || row.saveChanged === true)) errors.push('authority_immutability');
  if (!bundle.tamper || bundle.tamper.passed !== true || Number(bundle.tamper.rejectionCount || 0) < 18 || list(bundle.tamper.cases).some((item) => item.rejected !== true)) errors.push('tamper');
  return { ok: errors.length === 0, errors: [...new Set(errors)], recomputedFrames: expectedRows.length, recomputedPngHashes: imageHashes.size, weaponFamilies: expectedFamilies };
}

export const verifyDCEvidenceBundle = verifyDC1EvidenceBundle;
