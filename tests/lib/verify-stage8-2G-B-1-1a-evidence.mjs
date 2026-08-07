import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createUniversalBattlePresentation } from '../../js/battle-presentation/universal/universal-battle-adapter.js';
import { compileUniversalPlan } from '../../js/battle-presentation/universal/universal-plan-compiler.js';
import { sampleSpatialEntityPosition } from '../../js/battle-presentation/universal/universal-position-sampler.js';
import { buildUniversalEngagementSchedule } from '../../js/battle-presentation/universal/universal-engagement-choreographer.js';
import { describeEvidenceFrameAt } from '../../js/battle-presentation/universal/evidence-frame-resolver.js';
import { buildEvidenceSceneHash, buildEvidenceStatePayload, buildEvidenceStateSignature, canonicalEvidenceString, semanticPredicateForName, requiredPredicateForName, sha256Hex } from '../../js/battle-presentation/universal/evidence-integrity.js';

const shaFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const equal = (left, right) => canonicalEvidenceString(left) === canonicalEvidenceString(right);
const fail = (failures, code, detail = {}) => failures.push({ code, ...detail });

function pngSize(file) {
  const bytes = fs.readFileSync(file); if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47 || bytes.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function browserPredicates(frame, payload) {
  const actors = new Map((payload.actors || []).map((actor) => [actor.actorId, actor]));
  const shots = payload.activePresentationShots || []; const eventTypes = (payload.activeAuthoritativeEvents || []).map((item) => item.type);
  const friendlyShotCount = shots.filter((shot) => actors.get(shot.attackerId)?.side === 'friendly').length;
  const enemyShotCount = shots.filter((shot) => actors.get(shot.attackerId)?.side === 'enemy').length;
  const rearGuardIds = new Set((payload.retreatOrders || []).filter((item) => item.role === 'rear_guard').map((item) => item.actorId));
  const rearGuardCoverFire = rearGuardIds.size > 0 && (payload.suppressionSources || []).length > 0 && shots.some((shot) => rearGuardIds.has(shot.attackerId));
  return semanticPredicateForName(frame.file, { phase: payload.phase, friendlyShotCount, enemyShotCount, weaponFamilies: shots.map((shot) => shot.weaponProfileId).filter(Boolean), suppressionTargets: payload.suppressionTargets || [], coverMoves: payload.coverMoves || [], targetSwitches: payload.targetSwitches || [], activeAuthoritativeEvents: eventTypes, retreatOrders: payload.retreatOrders || [], cameraInterest: payload.cameraInterest, rearGuardCoverFire });
}

function rebuildScene(machineScene) {
  const report = machineScene.sourceReport;
  const presentation = createUniversalBattlePresentation({ id: machineScene.sceneId, theaterId: report.theaterId, report, elapsed: 0, duration: report.duration, presentationPhase: 'battle' });
  if (!presentation.ok) throw new Error(`machine scene failed to rebuild: ${machineScene.sceneId}`);
  const plan = presentation.plan; const compiled = compileUniversalPlan(plan); const schedule = buildUniversalEngagementSchedule(plan, (actorId, time) => sampleSpatialEntityPosition(compiled, actorId, time));
  return { presentation, plan, schedule };
}

export function verifyEvidenceDirectory(root, options = {}) {
  const failures = []; const machineFile = path.join(root, 'stage8_2g_b11a_machine_semantic_evidence.json'); const browserFile = path.join(root, 'stage8_2g_b11a_browser_capture_manifest.json');
  if (!fs.existsSync(machineFile) || !fs.existsSync(browserFile)) return { ok: false, failures: [{ code: 'evidence_file_missing' }] };
  let machine; let browser; try { machine = json(machineFile); browser = json(browserFile); } catch (error) { return { ok: false, failures: [{ code: 'evidence_json_invalid', message: String(error) }] }; }
  if (machine.stage !== '8.2G-B.1.1a') fail(failures, 'machine_stage_mismatch');
  if (machine.frameCount !== 24 || machine.scenes?.flatMap((scene) => scene.frames || []).length !== 24) fail(failures, 'machine_frame_count');
  if (machine.browserFallbackAllowed !== false) fail(failures, 'machine_fallback_not_disabled');
  if (browser.stage !== '8.2G-B.1.1a' || browser.browser?.currentCodeCaptured !== true || browser.browser?.legacyFallbackUsed !== false) fail(failures, 'browser_capture_gate');
  if (browser.browser?.pageErrors?.length || browser.browser?.consoleErrors?.length) fail(failures, 'browser_console_errors');
  if (browser.machineEvidenceFile !== path.basename(machineFile) || browser.machineEvidenceSha256 !== shaFile(machineFile)) fail(failures, 'machine_browser_file_binding');
  const machineScenes = new Map((machine.scenes || []).map((scene) => [scene.sceneId, scene])); const browserScenes = new Map((browser.scenes || []).map((scene) => [scene.sceneId, scene]));
  if (machineScenes.size !== browserScenes.size) fail(failures, 'scene_count_mismatch');
  const imageHashes = new Set(); let frameCount = 0;
  for (const [sceneId, machineScene] of machineScenes) {
    const browserScene = browserScenes.get(sceneId); if (!browserScene) { fail(failures, 'browser_scene_missing', { sceneId }); continue; }
    const rebuilt = rebuildScene(machineScene); const browserFrames = new Map((browserScene.frames || []).map((frame) => [frame.semanticFrameId, frame]));
    for (const machineFrame of machineScene.frames || []) {
      frameCount += 1; const browserFrame = browserFrames.get(machineFrame.semanticFrameId); if (!browserFrame) { fail(failures, 'browser_frame_missing', { sceneId, file: machineFrame.file }); continue; }
      const expectedSceneHash = buildEvidenceSceneHash(rebuilt.plan); const expectedState = rebuilt.presentation.renderState.atTime(machineFrame.timeMs / 1000); const expectedPayload = buildEvidenceStatePayload({ sceneId, seed: machineScene.seed, state: expectedState, timeMs: machineFrame.timeMs }); const expectedSignature = buildEvidenceStateSignature({ sceneId, seed: machineScene.seed, state: expectedState, timeMs: machineFrame.timeMs }); const described = describeEvidenceFrameAt(rebuilt.plan, rebuilt.schedule, machineFrame.timeMs / 1000, machineFrame.file); const expectedPredicates = semanticPredicateForName(machineFrame.file, described); const required = requiredPredicateForName(machineFrame.file);
      if (machineFrame.semanticFrameId !== `${sceneId}::${machineFrame.file}`) fail(failures, 'machine_semantic_id', { sceneId, file: machineFrame.file });
      if (machineFrame.sceneHash !== expectedSceneHash) fail(failures, 'machine_scene_hash', { sceneId, file: machineFrame.file });
      if (machineFrame.stateSignature !== expectedSignature || !equal(machineFrame.statePayload, expectedPayload)) fail(failures, 'machine_state_signature', { sceneId, file: machineFrame.file });
      if (machineFrame.requiredPredicate !== required || machineFrame.semanticPredicates?.[required] !== true || expectedPredicates[required] !== true) fail(failures, 'machine_semantic_predicate', { sceneId, file: machineFrame.file, required });
      if (browserFrame.sceneId !== sceneId || Number(browserFrame.seed) !== Number(machineScene.seed) || browserFrame.semanticFrameId !== machineFrame.semanticFrameId) fail(failures, 'browser_identity_binding', { sceneId, file: machineFrame.file });
      if (browserFrame.sceneHash !== expectedSceneHash || browserFrame.sceneHash !== machineFrame.sceneHash) fail(failures, 'browser_scene_hash', { sceneId, file: machineFrame.file });
      if (Math.abs(Number(browserFrame.captureTimeMs) - Number(machineFrame.timeMs)) > 16.7 || Math.abs(Number(browserFrame.resolverTimeMs) - Number(machineFrame.timeMs)) > 16.7) fail(failures, 'timestamp_binding', { sceneId, file: machineFrame.file });
      if (!equal(browserFrame.browserStateSnapshot, expectedPayload) || browserFrame.stateSignature !== expectedSignature || sha256Hex(browserFrame.browserStateSnapshot) !== expectedSignature) fail(failures, 'browser_state_signature', { sceneId, file: machineFrame.file });
      const browserComputedPredicates = browserPredicates(machineFrame, browserFrame.browserStateSnapshot); if (browserFrame.semanticPredicates?.[required] !== expectedPredicates[required] || browserComputedPredicates[required] !== true) fail(failures, 'browser_semantic_predicate', { sceneId, file: machineFrame.file, required });
      const png = path.join(root, browserFrame.screenshot?.path || ''); if (!fs.existsSync(png)) { fail(failures, 'png_missing', { sceneId, file: machineFrame.file }); continue; }
      const actualPngHash = shaFile(png); const size = pngSize(png); if (!size || size.width <= 0 || size.height <= 0) fail(failures, 'png_invalid', { sceneId, file: machineFrame.file }); if (actualPngHash !== browserFrame.imageSha256 || actualPngHash !== browserFrame.screenshot?.sha256) fail(failures, 'png_hash', { sceneId, file: machineFrame.file }); if (imageHashes.has(actualPngHash)) fail(failures, 'duplicate_png', { sceneId, file: machineFrame.file }); imageHashes.add(actualPngHash);
    }
  }
  if (frameCount !== 24 || imageHashes.size !== 24) fail(failures, 'final_frame_count', { frameCount, uniqueImageHashes: imageHashes.size });
  if (browser.binding?.duplicateImageHashes !== false) fail(failures, 'manifest_duplicate_flag');
  return { ok: failures.length === 0, failures, checks: { machineIndependent: true, browserIndependent: true, sceneHash: failures.every((failure) => failure.code !== 'machine_scene_hash' && failure.code !== 'browser_scene_hash'), stateSignature: failures.every((failure) => failure.code !== 'machine_state_signature' && failure.code !== 'browser_state_signature'), semanticPredicates: failures.every((failure) => !failure.code.includes('semantic_predicate')), timestamps: failures.every((failure) => failure.code !== 'timestamp_binding'), pngHashes: failures.every((failure) => failure.code !== 'png_hash'), duplicates: failures.every((failure) => failure.code !== 'duplicate_png') }, frameCount, uniqueImageHashes: imageHashes.size };
}
