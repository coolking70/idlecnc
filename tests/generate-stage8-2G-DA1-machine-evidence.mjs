import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildEvidenceSceneHash, buildStageC1EvidenceStateSignature } from '../js/battle-presentation/universal/evidence-integrity.js';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { OFFLINE_ASSET_MANIFEST } from '../js/battle-presentation/environment/asset-provider.js';
import { buildArtShowcaseReport } from './lib/stage8-2G-DA-art-scenarios.mjs';
import { miningVictoryReport } from './lib/stage8-2G-C1-scenarios.mjs';
import { DA1_FRAME_DEFINITIONS } from './lib/stage8-2G-DA1-semantic-predicates.mjs';
import { resolveSemanticFrames } from './lib/stage8-2G-DA1-semantic-frame-resolver.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = path.join(root, 'stage8_2g_da1_machine_semantic_evidence.json');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileSha256 = async (file) => sha256(await fs.readFile(file));
const reportHash = (report) => sha256(stableStringify(report));

function compactActor(actor) {
  return {
    id: actor.id,
    side: actor.side,
    type: actor.type,
    visualClass: actor.drawSpec?.visualClass || null,
    alive: actor.alive,
    hp: actor.hp,
    maxHp: actor.maxHp,
    visualState: actor.visualState || null,
    visualCenter: actor.visualCenter,
    facing: actor.facing,
    movementFacing: actor.movementFacing,
    aimFacing: actor.aimFacing,
    bodyFacing: actor.bodyFacing,
    weaponFacing: actor.weaponFacing,
    facingPolicy: actor.facingPolicy || null,
    shotFacing: actor.shotFacing ?? null,
    turretFacing: actor.turretFacing ?? null,
    aiming: actor.aiming === true,
    firing: actor.firing === true,
    drawSpec: actor.drawSpec ? {
      assetId: actor.drawSpec.assetId,
      assetMode: actor.drawSpec.assetMode,
      animation: actor.drawSpec.animation,
      policy: actor.drawSpec.policy || null,
      movementFacing: actor.drawSpec.movementFacing ?? null,
      aimFacing: actor.drawSpec.aimFacing ?? null,
      bodyFacing: actor.drawSpec.bodyFacing ?? null,
      bodyDirectionIndex: actor.drawSpec.bodyDirectionIndex ?? null,
      weaponFacing: actor.drawSpec.weaponFacing ?? null,
      weaponDirectionIndex: actor.drawSpec.weaponDirectionIndex ?? null,
      hullDirectionIndex: actor.drawSpec.hullDirectionIndex ?? null,
      turretDirectionIndex: actor.drawSpec.turretDirectionIndex ?? null,
      muzzleFacing: actor.drawSpec.muzzleFacing ?? actor.drawSpec.muzzleAnchor?.facing ?? null,
      visualMuzzlePoint: actor.drawSpec.visualMuzzlePoint || null
    } : null
  };
}

function compactProjectile(projectile) {
  return {
    id: projectile.id,
    shotId: projectile.shotId,
    kind: projectile.kind,
    authoritativeStart: projectile.start,
    visualStart: projectile.visualStart || null,
    end: projectile.end,
    progress: Number(Number(projectile.progress || 0).toFixed(6)),
    muzzleAnchor: projectile.muzzleAnchor || null
  };
}

function compactWreck(wreck) {
  return {
    id: wreck.id,
    sourceActorId: wreck.sourceActorId,
    side: wreck.side,
    wreckType: wreck.wreckType,
    angle: wreck.angle,
    assetId: wreck.drawSpec?.assetId || null,
    lastHullFacing: wreck.drawSpec?.lastHullFacing ?? null
  };
}

function frameFromResolved(scene, report, resolved) {
  if (!resolved.resolved) throw new Error(`D-A.1 semantic frame unresolved: ${scene.sceneId}/${resolved.semanticFrameId}: ${resolved.reason}`);
  const state = resolved.state;
  return {
    semanticFrameId: `${scene.sceneId}::${resolved.semanticFrameId}::${resolved.viewportKind}`,
    semantic: resolved.semantic,
    file: resolved.file,
    sceneId: scene.sceneId,
    fixtureType: scene.fixtureType,
    seed: report.seed,
    timeMs: resolved.timeMs,
    visualTimeSeconds: resolved.visualTimeSeconds,
    viewportKind: resolved.viewportKind,
    fallbackExpected: resolved.fallbackExpected,
    sceneHash: buildEvidenceSceneHash(scene.presentation.plan),
    stateSignature: buildStageC1EvidenceStateSignature({ sceneId: scene.sceneId, seed: report.seed, state, timeMs: resolved.timeMs, semanticName: resolved.semantic }),
    environmentSignature: state.environment?.signature || null,
    destructionSignature: state.destruction?.signature || null,
    predicate: resolved.predicate,
    matchedActorIds: resolved.matchedActorIds,
    matchedShotIds: resolved.matchedShotIds,
    screenMetrics: resolved.screenMetrics,
    actors: state.actors.map(compactActor),
    wrecks: state.wrecks.map(compactWreck),
    projectiles: state.projectiles.map(compactProjectile),
    effects: state.effects.filter((effect) => ['muzzle_flash', 'hit_spark', 'heavy_impact', 'explosion', 'destruction'].includes(effect.kind)).map((effect) => ({ id: effect.id, kind: effect.kind, actorId: effect.actorId || null, target: effect.target || null, x: effect.x, y: effect.y, visualMuzzlePoint: effect.visualMuzzlePoint || null })),
    routeClearance: { violations: state.environment?.metrics?.routeSegmentViolations || [], byClass: state.environment?.metrics?.routeSegmentViolationsByClass || {} }
  };
}

function makeScene(sceneId, fixtureType, report, definitions) {
  const presentation = createUniversalBattlePresentation({ id: sceneId, report, duration: report.duration, presentationPhase: 'battle' });
  if (!presentation.ok) throw new Error(`${sceneId} presentation failed: ${presentation.reason || 'unknown'}`);
  const resolved = resolveSemanticFrames(presentation, definitions);
  const frames = resolved.map((item) => frameFromResolved({ sceneId, fixtureType, presentation }, report, item));
  return { sceneId, fixtureType, result: report.result, seed: report.seed, sceneHash: buildEvidenceSceneHash(presentation.plan), sourceReportHash: reportHash(report), sourceReport: report, frames, presentation, resolved };
}

const artReport = buildArtShowcaseReport();
const formalReport = miningVictoryReport();
const artDefinitions = DA1_FRAME_DEFINITIONS.filter((definition) => definition.id !== 'formal-unmodified-production');
const formalDefinitions = DA1_FRAME_DEFINITIONS.filter((definition) => definition.id === 'formal-unmodified-production');
const scenes = [
  makeScene('stage8g-da1-art-showcase', 'synthetic-art-coverage', artReport, artDefinitions),
  makeScene('stage8g-da1-formal-mining', 'formal-unmodified', formalReport, formalDefinitions)
];

const freshFormalReport = miningVictoryReport();
const formalReportCheck = {
  stage: '8.2G-D-A.1',
  sceneId: 'stage8g-da1-formal-mining',
  fixtureType: 'formal-unmodified',
  sourceReportHash: reportHash(formalReport),
  regeneratedSourceReportHash: reportHash(freshFormalReport),
  syntheticActorIds: scenes[1].sourceReport.initial.friendly.concat(scenes[1].sourceReport.initial.enemy).map((actor) => actor.id).filter((id) => String(id).startsWith('art-')),
  requiredFriendlyClasses: ['infantry', 'anti_armor_infantry', 'mbt'],
  formalReportUnmodified: reportHash(formalReport) === reportHash(freshFormalReport),
  passed: reportHash(formalReport) === reportHash(freshFormalReport)
};
if (!formalReportCheck.passed || formalReportCheck.syntheticActorIds.length) throw new Error('formal unmodified report check failed');

const manifestSha256 = await fileSha256(path.join(root, 'assets/battle/asset-manifest.json'));
const output = {
  stage: '8.2G-D-A.1',
  version: 1,
  generatedBy: 'tests/generate-stage8-2G-DA1-machine-evidence.mjs',
  independentAudit: false,
  manifestSha256,
  sceneCount: scenes.length,
  frameCount: scenes.reduce((sum, scene) => sum + scene.frames.length, 0),
  scenes: scenes.map(({ presentation, resolved, ...scene }) => scene),
  semanticDefinitions: DA1_FRAME_DEFINITIONS,
  formalReportCheck
};
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
await fs.writeFile(path.join(root, 'stage8_2g_da1_formal_report_check.json'), `${JSON.stringify(formalReportCheck, null, 2)}\n`);
await fs.writeFile(path.join(root, 'stage8_2g_da1_semantic_resolution.json'), `${JSON.stringify({ stage: output.stage, frameCount: output.frameCount, scenes: scenes.map((scene) => ({ sceneId: scene.sceneId, frames: scene.frames.map((frame) => ({ semanticFrameId: frame.semanticFrameId, semantic: frame.semantic, timeMs: frame.timeMs, predicate: frame.predicate })) })), passed: true }, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, scenes: output.sceneCount, frames: output.frameCount, formalUnmodified: formalReportCheck.passed, output: outputPath }));
