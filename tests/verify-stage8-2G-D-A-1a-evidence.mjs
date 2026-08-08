import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildArtShowcaseReport } from './lib/stage8-2G-DA-art-scenarios.mjs';
import { miningVictoryReport } from './lib/stage8-2G-C1-scenarios.mjs';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildActorDrawSpec } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { OFFLINE_ASSET_MANIFEST } from '../js/battle-presentation/environment/asset-provider.js';
import { canonicalEvidenceString, buildEvidenceSceneHash, buildStageC1EvidenceStateSignature } from '../js/battle-presentation/universal/evidence-integrity.js';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { DA1_FRAME_DEFINITIONS, evaluateDA1SemanticPredicate } from './lib/stage8-2G-DA1-semantic-predicates.mjs';
import { screenMetricsForSemanticState } from './lib/stage8-2G-DA1-semantic-frame-resolver.mjs';

const root = process.env.IRON_COMMAND_EVIDENCE_ROOT || process.cwd();
const read = (file) => JSON.parse(fs.readFileSync(`${root}/${file}`, 'utf8'));
const shaFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const shaValue = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(message); };
const machine = read('stage8_2g_da1a_machine_semantic_evidence.json');
const browser = read('stage8_2g_da1a_browser_capture_manifest.json');
const definitions = new Map(DA1_FRAME_DEFINITIONS.map((definition) => [definition.id, { ...definition, file: definition.file.replace(/^d-a1/, 'd-a1a') }]));
const requiredAssets = new Set(['unit_friendly_infantry', 'unit_friendly_at_infantry', 'unit_friendly_mbt', 'unit_enemy_infantry', 'unit_enemy_at_infantry', 'unit_enemy_mbt', 'wreck_friendly_mbt', 'wreck_enemy_mbt']);
const reportForScene = (sceneId) => sceneId === 'stage8g-da1a-art-showcase' ? buildArtShowcaseReport() : sceneId === 'stage8g-da1a-formal-mining' ? miningVictoryReport() : fail(`unknown D-A.1a scene ${sceneId}`);
const scenePresentation = (scene) => { const report = reportForScene(scene.sceneId); const presentation = createUniversalBattlePresentation({ id: scene.sceneId, report, duration: report.duration, presentationPhase: 'battle' }); if (!presentation.ok) fail(`D-A.1a presentation failed ${scene.sceneId}`); if (scene.sourceReportHash !== shaValue(stableStringify(report))) fail(`D-A.1a source report hash ${scene.sceneId}`); if (scene.sourceReport && stableStringify(scene.sourceReport) !== stableStringify(report)) fail(`D-A.1a source report ${scene.sceneId}`); if (scene.sceneHash !== buildEvidenceSceneHash(presentation.plan)) fail(`D-A.1a scene hash ${scene.sceneId}`); return { report, presentation }; };
const compactProjectile = (projectile) => ({ id: projectile.id, shotId: projectile.shotId, kind: projectile.kind, authoritativeStart: projectile.start, visualStart: projectile.visualStart || null, end: projectile.end, progress: Number(Number(projectile.progress || 0).toFixed(6)), muzzleAnchor: projectile.muzzleAnchor || null });

if (machine.stage !== '8.2G-D-A.1a' || browser.stage !== '8.2G-D-A.1a') fail('D-A.1a stage mismatch');
if (machine.frameCount !== 13 || browser.browser?.captureCount !== 13) fail('D-A.1a frame count mismatch');
if (browser.browser?.currentCodeCaptured !== true || browser.browser?.legacyFallbackUsed !== false || browser.binding?.semanticPredicateRecomputedFromCurrentState !== true || browser.binding?.nonTurretFacingPredicate !== true) fail('D-A.1a browser provenance gate');
if ((browser.browser?.pageErrors || []).length || (browser.browser?.consoleErrors || []).length) fail('D-A.1a browser errors');
if (machine.manifestSha256 !== shaFile(`${root}/assets/battle/asset-manifest.json`)) fail('D-A.1a manifest hash mismatch');
if (browser.machineEvidenceSha256 !== shaFile(`${root}/stage8_2g_da1a_machine_semantic_evidence.json`)) fail('D-A.1a machine/browser binding mismatch');
for (const assetId of requiredAssets) { const asset = OFFLINE_ASSET_MANIFEST.assets.find((item) => item.id === assetId); if (!asset || !asset.source || !fs.existsSync(`${root}/${asset.source}`)) fail(`D-A.1a required asset ${assetId}`); }

const browserFrames = new Map(browser.scenes?.flatMap((scene) => scene.frames || []).map((frame) => [frame.semanticFrameId, frame]) || []);
const seenImages = new Set(); const seenClasses = new Set(); const seenAssets = new Set(); const sceneIds = new Set();
for (const scene of machine.scenes || []) {
  sceneIds.add(scene.sceneId); const { presentation } = scenePresentation(scene); const browserScene = browser.scenes?.find((candidate) => candidate.sceneId === scene.sceneId); if (!browserScene || browserScene.fixtureType !== scene.fixtureType) fail(`D-A.1a browser scene binding ${scene.sceneId}`);
  for (const frame of scene.frames || []) {
    const definition = definitions.get(frame.semanticFrameId.split('::')[1]); if (!definition) fail(`D-A.1a unknown semantic frame ${frame.file}`);
    if (frame.semantic !== definition.semantic || frame.file !== definition.file || frame.viewportKind !== definition.viewportKind || frame.fallbackExpected !== definition.fallbackExpected) fail(`D-A.1a semantic label binding ${frame.file}`);
    if (frame.sceneId !== scene.sceneId || frame.fixtureType !== scene.fixtureType || frame.sceneHash !== buildEvidenceSceneHash(presentation.plan)) fail(`D-A.1a frame binding ${frame.file}`);
    const state = presentation.renderState.atTime(frame.visualTimeSeconds); const expectedMetrics = screenMetricsForSemanticState(presentation, state, definition); if (canonicalEvidenceString(frame.screenMetrics) !== canonicalEvidenceString(expectedMetrics)) fail(`D-A.1a machine geometry ${frame.file}`);
    const expectedPredicate = evaluateDA1SemanticPredicate(definition.id, { state, screenMetrics: expectedMetrics, timeSeconds: frame.visualTimeSeconds, viewportKind: definition.viewportKind, fallbackExpected: definition.fallbackExpected === true }); if (!expectedPredicate.passed || canonicalEvidenceString(frame.predicate) !== canonicalEvidenceString(expectedPredicate)) fail(`D-A.1a machine predicate ${frame.file}`);
    if (canonicalEvidenceString(frame.matchedActorIds) !== canonicalEvidenceString(expectedPredicate.matchedActorIds) || canonicalEvidenceString(frame.matchedShotIds) !== canonicalEvidenceString(expectedPredicate.matchedShotIds)) fail(`D-A.1a predicate binding ${frame.file}`);
    if (frame.stateSignature !== buildStageC1EvidenceStateSignature({ sceneId: scene.sceneId, seed: scene.seed, state, timeMs: frame.timeMs, semanticName: frame.semantic }) || frame.environmentSignature !== state.environment?.signature || frame.destructionSignature !== state.destruction?.signature) fail(`D-A.1a state signature ${frame.file}`);
    if ((frame.routeClearance?.violations || []).length || Object.values(frame.routeClearance?.byClass || {}).some((rows) => rows.length)) fail(`D-A.1a route clearance ${frame.file}`);
    if (['infantry-fire', 'friendly-at-fire', 'enemy-at-fire'].includes(frame.semantic)) { if (!frame.predicate.bodyFacesShot || !frame.predicate.spriteDirectionMatchesShot || !frame.predicate.muzzleFacingMatchesShot || !frame.predicate.facingEvidence?.every((proof) => proof.passed)) fail(`D-A.1a non-turret facing predicate ${frame.file}`); }
    const expectedProjectiles = state.projectiles.map(compactProjectile); if (canonicalEvidenceString(frame.projectiles) !== canonicalEvidenceString(expectedProjectiles)) fail(`D-A.1a projectile evidence ${frame.file}`);
    for (const projectile of state.projectiles) { const shot = state.shotSchedule.find((candidate) => candidate.id === projectile.shotId); if (!shot) fail(`D-A.1a projectile binding ${frame.file}`); if (canonicalEvidenceString(projectile.start) !== canonicalEvidenceString(shot.sourcePositionAtFire)) fail(`D-A.1a authority source ${frame.file}`); if (projectile.visualStart && projectile.muzzleAnchor?.ok !== false) { const actor = state.actors.find((candidate) => candidate.id === shot.actorId); const visualClass = actor?.drawSpec?.visualClass; const spec = buildActorDrawSpec({ ...actor, visualCenter: { ...shot.sourcePositionAtFire }, bodyFacing: actor.bodyFacing, facing: actor.bodyFacing, weaponFacing: visualClass === 'mbt' ? shot.sourceFacingAtFire : actor.weaponFacing, turretFacing: visualClass === 'mbt' ? shot.sourceFacingAtFire : actor.turretFacing, shotFacing: shot.sourceFacingAtFire, visualState: 'fire', firing: true }, state.camera, { manifest: OFFLINE_ASSET_MANIFEST, availableSources: new Set(OFFLINE_ASSET_MANIFEST.assets.map((asset) => asset.source)), battlefieldBounds: presentation.plan.layout.bounds, presentationSeconds: state.time, seed: scene.seed }); if (!spec.visualMuzzlePoint || canonicalEvidenceString(spec.visualMuzzlePoint) !== canonicalEvidenceString(projectile.visualStart)) fail(`D-A.1a final muzzle geometry ${frame.file}`); } }
    for (const row of frame.screenMetrics.actors || []) { if (row.assetId) seenAssets.add(row.assetId); if (row.visualClass) seenClasses.add(row.visualClass); if (row.visualClass === 'mbt' && (row.hullDirectionIndex == null || row.turretDirectionIndex == null)) fail(`D-A.1a MBT component metadata ${frame.file}`); if (row.muzzleAnchor?.ok && row.muzzleFacing == null) fail(`D-A.1a muzzle facing metadata ${frame.file}`); }
    if (frame.semantic === 'formal-unmodified-production' && state.actors.some((actor) => String(actor.id).startsWith('art-'))) fail('D-A.1a formal synthetic actor contamination');
    const browserFrame = browserFrames.get(frame.semanticFrameId); if (!browserFrame || browserFrame.semantic !== frame.semantic || browserFrame.file !== frame.file || browserFrame.sceneId !== scene.sceneId || browserFrame.fixtureType !== scene.fixtureType) fail(`D-A.1a browser frame binding ${frame.file}`);
    if (Math.abs(Number(browserFrame.timestampDeltaMs)) > 16.7) fail(`D-A.1a browser timestamp ${frame.file}`); const browserState = browserFrame.browserStateSnapshot; if (!browserState || Number(browserState.time) < 0) fail(`D-A.1a browser state ${frame.file}`);
    const browserPredicate = evaluateDA1SemanticPredicate(definition.id, { state: browserState, screenMetrics: browserFrame.screenMetrics, timeSeconds: Number(browserState.time), viewportKind: definition.viewportKind, fallbackExpected: definition.fallbackExpected === true }); if (!browserPredicate.passed || canonicalEvidenceString(browserFrame.predicate) !== canonicalEvidenceString(browserPredicate)) fail(`D-A.1a browser predicate ${frame.file}`);
    if (['infantry-fire', 'friendly-at-fire', 'enemy-at-fire'].includes(frame.semantic) && (!browserPredicate.bodyFacesShot || !browserPredicate.spriteDirectionMatchesShot || !browserPredicate.muzzleFacingMatchesShot)) fail(`D-A.1a browser facing predicate ${frame.file}`);
    if (browserFrame.stateSignature !== buildStageC1EvidenceStateSignature({ sceneId: scene.sceneId, seed: scene.seed, state: browserState, timeMs: Number(browserState.time) * 1000, semanticName: frame.semantic })) fail(`D-A.1a browser state signature ${frame.file}`);
    if ((browserFrame.screenMetrics?.actors || []).some((row) => row.rendererGeometrySource !== 'production-final-draw-geometry')) fail(`D-A.1a browser geometry provenance ${frame.file}`);
    const screenshot = browserFrame.screenshot?.path; if (!screenshot || screenshot.includes('..')) fail(`D-A.1a screenshot path ${frame.file}`); const screenshotFile = `${root}/${screenshot}`; if (!fs.existsSync(screenshotFile) || shaFile(screenshotFile) !== browserFrame.imageSha256 || browserFrame.screenshot.sha256 !== browserFrame.imageSha256) fail(`D-A.1a screenshot hash ${frame.file}`); if (seenImages.has(browserFrame.imageSha256)) fail(`D-A.1a duplicate screenshot ${frame.file}`); seenImages.add(browserFrame.imageSha256);
  }
}
if (sceneIds.size !== 2 || browserFrames.size !== 13 || seenClasses.size < 3) fail('D-A.1a scene/frame/class collection mismatch');
if (machine.formalReportCheck?.passed !== true || machine.formalReportCheck.formalReportUnmodified !== true) fail('D-A.1a formal report check');
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-A.1a', machineFrames: machine.frameCount, browserFrames: browserFrames.size, uniquePngHashes: seenImages.size, visualClasses: [...seenClasses], nonTurretFacingRecomputed: true, tamperResistantBindings: true }));
