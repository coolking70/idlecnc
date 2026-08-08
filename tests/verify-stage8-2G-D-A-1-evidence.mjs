import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildArtShowcaseReport } from './lib/stage8-2G-DA-art-scenarios.mjs';
import { miningVictoryReport } from './lib/stage8-2G-C1-scenarios.mjs';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildActorDrawSpec } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { OFFLINE_ASSET_MANIFEST } from '../js/battle-presentation/environment/asset-provider.js';
import { canonicalEvidenceString, buildEvidenceSceneHash, buildStageC1EvidenceStateSignature } from '../js/battle-presentation/universal/evidence-integrity.js';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { DA1_FRAME_DEFINITIONS } from './lib/stage8-2G-DA1-semantic-predicates.mjs';
import { evaluateDA1SemanticPredicate } from './lib/stage8-2G-DA1-semantic-predicates.mjs';
import { screenMetricsForSemanticState } from './lib/stage8-2G-DA1-semantic-frame-resolver.mjs';

const root = process.env.IRON_COMMAND_EVIDENCE_ROOT || process.cwd();
const read = (file) => JSON.parse(fs.readFileSync(`${root}/${file}`, 'utf8'));
const shaFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const shaValue = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(message); };
const machine = read('stage8_2g_da1_machine_semantic_evidence.json');
const browser = read('stage8_2g_da1_browser_capture_manifest.json');
const definitions = new Map(DA1_FRAME_DEFINITIONS.map((definition) => [definition.id, definition]));
const manifestAssets = new Map(OFFLINE_ASSET_MANIFEST.assets.map((asset) => [asset.id, asset]));
const requiredAssets = new Set(['unit_friendly_infantry', 'unit_friendly_at_infantry', 'unit_friendly_mbt', 'unit_enemy_infantry', 'unit_enemy_at_infantry', 'unit_enemy_mbt', 'wreck_friendly_mbt', 'wreck_enemy_mbt']);

function reportForScene(sceneId) {
  if (sceneId === 'stage8g-da1-art-showcase') return buildArtShowcaseReport();
  if (sceneId === 'stage8g-da1-formal-mining') return miningVictoryReport();
  fail(`unknown D-A.1 scene ${sceneId}`);
}

function scenePresentation(scene) {
  const report = reportForScene(scene.sceneId);
  const presentation = createUniversalBattlePresentation({ id: scene.sceneId, report, duration: report.duration, presentationPhase: 'battle' });
  if (!presentation.ok) fail(`D-A.1 presentation failed ${scene.sceneId}`);
  if (scene.sourceReportHash !== shaValue(stableStringify(report))) fail(`D-A.1 source report hash ${scene.sceneId}`);
  if (scene.sourceReport && stableStringify(scene.sourceReport) !== stableStringify(report)) fail(`D-A.1 embedded source report ${scene.sceneId}`);
  if (scene.sceneHash !== buildEvidenceSceneHash(presentation.plan)) fail(`D-A.1 scene hash ${scene.sceneId}`);
  return { report, presentation };
}

function compactProjectile(projectile) {
  return { id: projectile.id, shotId: projectile.shotId, kind: projectile.kind, authoritativeStart: projectile.start, visualStart: projectile.visualStart || null, end: projectile.end, progress: Number(Number(projectile.progress || 0).toFixed(6)), muzzleAnchor: projectile.muzzleAnchor || null };
}

function rowComparable(row) {
  const copy = JSON.parse(JSON.stringify(row));
  return copy;
}

if (machine.stage !== '8.2G-D-A.1' || browser.stage !== '8.2G-D-A.1') fail('D-A.1 stage mismatch');
if (machine.frameCount !== 13 || browser.browser?.captureCount !== 13) fail('D-A.1 frame count mismatch');
if (browser.browser?.currentCodeCaptured !== true || browser.browser?.legacyFallbackUsed !== false || browser.binding?.semanticPredicateRecomputedFromCurrentState !== true) fail('D-A.1 browser provenance gate');
if ((browser.browser?.pageErrors || []).length || (browser.browser?.consoleErrors || []).length) fail('D-A.1 browser errors');
if (machine.manifestSha256 !== shaFile(`${root}/assets/battle/asset-manifest.json`)) fail('D-A.1 manifest hash mismatch');
if (browser.machineEvidenceSha256 !== shaFile(`${root}/stage8_2g_da1_machine_semantic_evidence.json`)) fail('D-A.1 machine/browser binding mismatch');
for (const assetId of requiredAssets) {
  const asset = manifestAssets.get(assetId);
  if (!asset || asset.format !== 'spritesheet' || asset.directions !== 8 || asset.runtimeGeneration || !asset.source || asset.source.includes('..') || !fs.existsSync(`${root}/${asset.source}`)) fail(`D-A.1 required asset ${assetId}`);
}

const browserFrames = new Map(browser.scenes?.flatMap((scene) => scene.frames || []).map((frame) => [frame.semanticFrameId, frame]) || []);
const seenImages = new Set(); const seenAssets = new Set(); const seenClasses = new Set();
const machineSceneIds = new Set();
for (const scene of machine.scenes || []) {
  machineSceneIds.add(scene.sceneId);
  const { report, presentation } = scenePresentation(scene);
  const browserScene = browser.scenes?.find((candidate) => candidate.sceneId === scene.sceneId);
  if (!browserScene || browserScene.fixtureType !== scene.fixtureType) fail(`D-A.1 browser scene binding ${scene.sceneId}`);
  for (const frame of scene.frames || []) {
    const definition = definitions.get(frame.semanticFrameId.split('::')[1]);
    if (!definition) fail(`D-A.1 unknown semanticFrameId ${frame.semanticFrameId}`);
    if (frame.semantic !== definition.semantic || frame.file !== definition.file || frame.viewportKind !== definition.viewportKind || frame.fallbackExpected !== definition.fallbackExpected) fail(`D-A.1 semantic label binding ${frame.file}`);
    if (frame.sceneId !== scene.sceneId || frame.fixtureType !== scene.fixtureType) fail(`D-A.1 frame scene binding ${frame.file}`);
    if (frame.sceneHash !== buildEvidenceSceneHash(presentation.plan)) fail(`D-A.1 frame scene hash ${frame.file}`);
    const state = presentation.renderState.atTime(frame.visualTimeSeconds);
    const expectedMetrics = screenMetricsForSemanticState(presentation, state, definition);
    if (canonicalEvidenceString(frame.screenMetrics) !== canonicalEvidenceString(expectedMetrics)) fail(`D-A.1 machine geometry ${frame.file}`);
    const expectedPredicate = evaluateDA1SemanticPredicate(definition.id, { state, screenMetrics: expectedMetrics, timeSeconds: frame.visualTimeSeconds, viewportKind: definition.viewportKind, fallbackExpected: definition.fallbackExpected === true });
    if (!expectedPredicate.passed || canonicalEvidenceString(frame.predicate) !== canonicalEvidenceString(expectedPredicate)) fail(`D-A.1 machine semantic predicate ${frame.file}`);
    if (canonicalEvidenceString(frame.matchedActorIds) !== canonicalEvidenceString(expectedPredicate.matchedActorIds) || canonicalEvidenceString(frame.matchedShotIds) !== canonicalEvidenceString(expectedPredicate.matchedShotIds)) fail(`D-A.1 predicate bindings ${frame.file}`);
    const expectedSignature = buildStageC1EvidenceStateSignature({ sceneId: scene.sceneId, seed: scene.seed, state, timeMs: frame.timeMs, semanticName: frame.semantic });
    if (frame.stateSignature !== expectedSignature || frame.environmentSignature !== state.environment?.signature || frame.destructionSignature !== state.destruction?.signature) fail(`D-A.1 machine state signature ${frame.file}`);
    if ((frame.routeClearance?.violations || []).length || Object.values(frame.routeClearance?.byClass || {}).some((rows) => rows.length)) fail(`D-A.1 route clearance ${frame.file}`);
    const expectedProjectiles = state.projectiles.map(compactProjectile);
    if (canonicalEvidenceString(frame.projectiles) !== canonicalEvidenceString(expectedProjectiles)) fail(`D-A.1 muzzle/projectile evidence ${frame.file}`);
    for (const projectile of state.projectiles) {
      const shot = state.shotSchedule.find((candidate) => candidate.id === projectile.shotId); if (!shot) fail(`D-A.1 projectile shot binding ${frame.file}`);
      if (canonicalEvidenceString(projectile.start) !== canonicalEvidenceString(shot.sourcePositionAtFire)) fail(`D-A.1 authoritative projectile start ${frame.file}`);
      if (projectile.visualStart && projectile.muzzleAnchor?.ok !== false) {
        const actor = state.actors.find((candidate) => candidate.id === shot.actorId); if (!actor) fail(`D-A.1 projectile actor ${frame.file}`);
        const visualClass = actor.drawSpec?.visualClass;
        const spec = buildActorDrawSpec({ ...actor, visualCenter: { ...shot.sourcePositionAtFire }, turretFacing: visualClass === 'mbt' ? shot.sourceFacingAtFire : actor.turretFacing, shotFacing: shot.sourceFacingAtFire, visualState: 'fire', firing: true }, state.camera, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source)), battlefieldBounds: presentation.plan.layout.bounds, presentationSeconds: state.time, seed: scene.seed });
        if (!spec.visualMuzzlePoint || canonicalEvidenceString(spec.visualMuzzlePoint) !== canonicalEvidenceString(projectile.visualStart)) fail(`D-A.1 final muzzle geometry ${frame.file}`);
      }
    }
    for (const row of frame.screenMetrics.actors || []) {
      if (row.assetId) seenAssets.add(row.assetId); if (row.visualClass) seenClasses.add(row.visualClass);
      if (row.visualClass === 'mbt' && (row.hullDirectionIndex == null || row.turretDirectionIndex == null || row.hullSourceRect == null || row.turretSourceRect == null)) fail(`D-A.1 tank component metadata ${frame.file}`);
      if (row.visualClass === 'mbt' && row.actualDrawPath !== 'drawImage:components' && !frame.fallbackExpected) fail(`D-A.1 tank production path ${frame.file}`);
      if (row.muzzleAnchor?.ok && !row.visualMuzzlePoint) fail(`D-A.1 muzzle metadata ${frame.file}`);
    }
    if (definition.id === 'formal-unmodified-production') {
      if (state.actors.some((actor) => String(actor.id).startsWith('art-'))) fail('D-A.1 formal scene synthetic actor contamination');
      if (frame.predicate.fixtureType !== 'formal-unmodified') fail('D-A.1 formal predicate fixture type');
    }
    const browserFrame = browserFrames.get(frame.semanticFrameId); if (!browserFrame) fail(`D-A.1 missing browser frame ${frame.file}`);
    if (browserFrame.semantic !== frame.semantic || browserFrame.file !== frame.file || browserFrame.sceneId !== scene.sceneId || browserFrame.fixtureType !== scene.fixtureType) fail(`D-A.1 browser semantic binding ${frame.file}`);
    if (Math.abs(Number(browserFrame.timestampDeltaMs)) > 16.7) fail(`D-A.1 browser timestamp ${frame.file}`);
    const browserState = browserFrame.browserStateSnapshot; if (!browserState || Number(browserState.time) < 0) fail(`D-A.1 browser state snapshot ${frame.file}`);
    const browserPredicate = evaluateDA1SemanticPredicate(definition.id, { state: browserState, screenMetrics: browserFrame.screenMetrics, timeSeconds: Number(browserState.time), viewportKind: definition.viewportKind, fallbackExpected: definition.fallbackExpected === true });
    if (!browserPredicate.passed || canonicalEvidenceString(browserFrame.predicate) !== canonicalEvidenceString(browserPredicate)) fail(`D-A.1 browser semantic recheck ${frame.file}`);
    const browserSignature = buildStageC1EvidenceStateSignature({ sceneId: scene.sceneId, seed: scene.seed, state: browserState, timeMs: Number(browserState.time) * 1000, semanticName: frame.semantic });
    if (browserFrame.stateSignature !== browserSignature) fail(`D-A.1 browser state signature ${frame.file}`);
    const rows = browserFrame.screenMetrics?.actors || [];
    if (rows.length !== (state.actors || []).length || rows.some((row) => row.rendererGeometrySource !== 'production-final-draw-geometry')) fail(`D-A.1 browser geometry provenance ${frame.file}`);
    if (frame.fallbackExpected) { const fallback = rows.find((row) => row.actorId === 'unit_stage8g-c1-mining-0'); if (!fallback || fallback.actualDrawPath !== 'procedural-fallback') fail(`D-A.1 browser fallback ${frame.file}`); } else if (browserFrame.assetRuntime?.allReady !== true) fail(`D-A.1 browser asset readiness ${frame.file}`);
    const screenshot = browserFrame.screenshot?.path; if (!screenshot || screenshot.includes('..')) fail(`D-A.1 screenshot path ${frame.file}`);
    const screenshotFile = `${root}/${screenshot}`; if (!fs.existsSync(screenshotFile) || shaFile(screenshotFile) !== browserFrame.imageSha256 || browserFrame.screenshot.sha256 !== browserFrame.imageSha256) fail(`D-A.1 screenshot hash ${frame.file}`);
    if (seenImages.has(browserFrame.imageSha256)) fail(`D-A.1 duplicate screenshot ${frame.file}`); seenImages.add(browserFrame.imageSha256);
  }
}
if (machineSceneIds.size !== 2 || browserFrames.size !== 13) fail('D-A.1 scene/frame collection mismatch');
if (![...requiredAssets].every((assetId) => seenAssets.has(assetId) || assetId.startsWith('wreck_'))) fail(`D-A.1 unit asset coverage ${JSON.stringify([...seenAssets])}`);
if (!['infantry', 'anti_armor_infantry', 'mbt'].every((visualClass) => seenClasses.has(visualClass))) fail(`D-A.1 visual class coverage ${JSON.stringify([...seenClasses])}`);
if (machine.formalReportCheck?.passed !== true || machine.formalReportCheck.formalReportUnmodified !== true) fail('D-A.1 formal report check');
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-A.1', machineFrames: machine.frameCount, browserFrames: browserFrames.size, uniquePngHashes: seenImages.size, visualClasses: [...seenClasses], currentRenderer: true, semanticPredicatesRecomputed: true, tamperResistantBindings: true }));
