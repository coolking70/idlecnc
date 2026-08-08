import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildArtShowcaseReport } from './lib/stage8-2G-DA-art-scenarios.mjs';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildProductionDrawSpecs } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { OFFLINE_ASSET_MANIFEST } from '../js/battle-presentation/environment/asset-provider.js';
import { canonicalEvidenceString, buildEvidenceSceneHash, buildStageC1EvidenceStateSignature } from '../js/battle-presentation/universal/evidence-integrity.js';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';

const root = process.env.IRON_COMMAND_EVIDENCE_ROOT || process.cwd();
const read = (file) => JSON.parse(fs.readFileSync(`${root}/${file}`, 'utf8'));
const shaFile = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const shaValue = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(message); };
const machine = read('stage8_2g_da_machine_semantic_evidence.json');
const browser = read('stage8_2g_da_browser_capture_manifest.json');
const report = buildArtShowcaseReport();
const presentation = createUniversalBattlePresentation({ id: machine.scene?.sceneId, report, duration: report.duration, presentationPhase: 'battle' });
if (!presentation.ok) fail('D-A showcase presentation failed');

if (machine.stage !== '8.2G-D-A' || browser.stage !== '8.2G-D-A') fail('D-A stage mismatch');
if (machine.frameCount !== 12 || browser.browser?.captureCount !== 12) fail('D-A frame count mismatch');
if (browser.browser?.currentCodeCaptured !== true || browser.browser?.legacyFallbackUsed !== false) fail('D-A current renderer capture gate');
if ((browser.browser?.pageErrors || []).length || (browser.browser?.consoleErrors || []).length) fail('D-A browser errors');
if (browser.machineEvidenceSha256 !== shaFile(`${root}/stage8_2g_da_machine_semantic_evidence.json`)) fail('D-A machine evidence hash mismatch');
if (machine.manifestSha256 !== shaFile(`${root}/assets/battle/asset-manifest.json`)) fail('D-A manifest hash mismatch');
if (machine.sourceReportHash !== shaValue(stableStringify(report))) fail('D-A source report hash mismatch');
if (machine.scene?.sourceReport && machine.sourceReportHash !== shaValue(stableStringify(machine.scene.sourceReport))) fail('D-A embedded source report tamper');
if (machine.scene?.sourceReportHash && machine.scene.sourceReportHash !== machine.sourceReportHash) fail('D-A scene source report binding mismatch');
if (machine.scene?.sceneHash !== buildEvidenceSceneHash(presentation.plan)) fail('D-A scene hash mismatch');

const requiredUnitIds = new Set(['unit_friendly_infantry', 'unit_friendly_at_infantry', 'unit_friendly_mbt', 'unit_enemy_infantry', 'unit_enemy_at_infantry', 'unit_enemy_mbt']);
const requiredWreckIds = new Set(['wreck_friendly_mbt', 'wreck_enemy_mbt']);
const manifestAssets = new Map(OFFLINE_ASSET_MANIFEST.assets.map((asset) => [asset.id, asset]));
for (const id of [...requiredUnitIds, ...requiredWreckIds]) {
  const asset = manifestAssets.get(id); if (!asset || asset.format !== 'spritesheet' || asset.directions !== 8 || asset.runtimeGeneration) fail(`D-A required local asset missing ${id}`);
  if (!asset.source || asset.source.includes('..') || !fs.existsSync(`${root}/${asset.source}`)) fail(`D-A asset source missing ${id}`);
}
if (OFFLINE_ASSET_MANIFEST.version !== 2 || OFFLINE_ASSET_MANIFEST.runtimeGeneration !== false) fail('D-A manifest runtime generation gate');

const machineFrames = machine.scene.frames || [];
const browserFrames = browser.scenes?.flatMap((scene) => scene.frames || []) || [];
if (machineFrames.length !== 12 || browserFrames.length !== 12) fail('D-A frame collection mismatch');
const geometryComparable = (row) => { const copy = JSON.parse(JSON.stringify(row)); for (const key of ['logicalRect', 'cssRect', 'drawRect', 'rawCssWidth', 'rawCssHeight', 'finalCssWidth', 'finalCssHeight', 'rawScreenFootprint', 'screenFootprint', 'cameraZoom', 'viewportScale', 'visualScaleBoost']) delete copy[key]; return copy; };
const expectedRow = (spec) => ({ ...spec.finalDrawGeometry, actorId: spec.actorId, side: spec.faction, type: spec.type, assetId: spec.assetId, assetMode: spec.assetMode, assetStatus: spec.assetStatus, factionVisualMode: spec.factionVisualMode, factionPalette: spec.factionPalette, factionMark: spec.factionMark, animation: spec.animation, direction: spec.animationState?.direction || null, directionIndex: spec.animationState?.directionIndex ?? null, frameIndex: spec.animationState?.frameIndex ?? null, sourceRect: spec.sourceRect || null, turretSourceRect: spec.turretSourceRect || null, muzzleAnchor: spec.muzzleAnchor || null, actualDrawPath: spec.assetMode === 'procedural' ? 'procedural-fallback' : spec.assetMode === 'hybrid' ? 'drawImage:components' : 'drawImage', rendererGeometrySource: 'production-final-draw-geometry' });
const seenPng = new Set();
const seenUnitAssets = new Set(); const seenFactions = new Set(); const seenVisualClasses = new Set();
for (const frame of machineFrames) {
  const state = presentation.renderState.atTime(frame.visualTimeSeconds);
  if (frame.sceneHash !== buildEvidenceSceneHash(presentation.plan) || frame.environmentSignature !== state.environment.signature || frame.destructionSignature !== state.destruction.signature) fail(`D-A machine state binding ${frame.file}`);
  const expectedSpecs = buildProductionDrawSpecs({ actors: state.actors, wrecks: state.wrecks, environment: state.environment, camera: state.camera, options: { battlefieldBounds: presentation.plan.layout.bounds, viewport: frame.screenMetrics.viewport, presentationSeconds: frame.visualTimeSeconds, seed: report.seed } });
  const expectedRows = expectedSpecs.actorSpecs.map(expectedRow);
  if (canonicalEvidenceString(frame.screenMetrics.actors) !== canonicalEvidenceString(expectedRows)) fail(`D-A machine renderer rows ${frame.file}`);
  if ((frame.routeClearance?.violations || []).length || Object.values(frame.routeClearance?.violationsByClass || {}).some((rows) => rows.length)) fail(`D-A route clearance ${frame.file}`);
  for (const row of frame.screenMetrics.actors) {
    if (row.assetId) seenUnitAssets.add(row.assetId); if (row.factionPalette) seenFactions.add(row.factionPalette); if (row.visualClass) seenVisualClasses.add(row.visualClass);
    if (!row.animation) fail(`D-A animation metadata ${frame.file}`);
    if (row.assetId && (!row.sourceRect || row.directionIndex == null || row.frameIndex == null || row.muzzleAnchor == null)) fail(`D-A sprite animation or anchor metadata ${frame.file}`);
    if (row.visualClass === 'anti_armor_infantry' && !String(row.assetId || '').includes('at_infantry')) fail(`D-A AT silhouette asset ${frame.file}`);
    if (row.visualClass === 'mbt' && (!row.turretSourceRect || row.actualDrawPath !== 'drawImage:components')) fail(`D-A MBT component draw ${frame.file}`);
  }
  const browserFrame = browserFrames.find((candidate) => candidate.semanticFrameId === frame.semanticFrameId); if (!browserFrame) fail(`D-A missing browser frame ${frame.file}`);
  if (browserFrame.stateSignature !== frame.stateSignature || browserFrame.environmentSignature !== frame.environmentSignature || browserFrame.destructionSignature !== frame.destructionSignature) fail(`D-A browser state binding ${frame.file}`);
  if (Math.abs(Number(browserFrame.timestampDeltaMs)) > 16.7) fail(`D-A timestamp ${frame.file}`);
  const imagePath = browserFrame.screenshot?.path || ''; if (!imagePath || imagePath.includes('..')) fail(`D-A screenshot path ${frame.file}`); const imageFile = `${root}/${imagePath}`; if (!fs.existsSync(imageFile) || shaFile(imageFile) !== browserFrame.imageSha256 || browserFrame.screenshot.sha256 !== browserFrame.imageSha256) fail(`D-A screenshot hash ${frame.file}`); if (seenPng.has(browserFrame.imageSha256)) fail(`D-A duplicate screenshot ${frame.file}`); seenPng.add(browserFrame.imageSha256);
  const actualRows = browserFrame.screenMetrics?.actors || []; if (actualRows.length !== expectedRows.length) fail(`D-A browser actor count ${frame.file}`);
  for (const expected of expectedRows) { const actual = actualRows.find((row) => row.actorId === expected.actorId); if (!actual) fail(`D-A missing browser actor ${frame.file}`); const expectedComparable = geometryComparable(expected); const actualComparable = geometryComparable(actual); if (frame.fallbackExpected && expected.actorId === 'unit_stage8g-c1-mining-0') { expectedComparable.actualDrawPath = 'procedural-fallback'; } if (canonicalEvidenceString(actualComparable) !== canonicalEvidenceString(expectedComparable)) fail(`D-A browser renderer rows ${frame.file}`); }
  if (frame.viewportKind === 'narrow' && actualRows.some((row) => row.screenFootprint < row.minimumScreenFootprint)) fail(`D-A narrow footprint ${frame.file}`);
  const runtime = browserFrame.assetRuntime; if (!runtime || !Array.isArray(runtime.assets)) fail(`D-A runtime state ${frame.file}`); if (frame.fallbackExpected) { if (runtime.allReady === true) fail(`D-A fallback unexpectedly ready ${frame.file}`); const disabled = runtime.assets.filter((asset) => (asset.assetId || asset.id) === 'unit_friendly_infantry' && (asset.disabled || asset.status === 'failed' || asset.status === 'error' || asset.error)); if (disabled.length !== 1) fail(`D-A fallback asset proof ${frame.file}`); } else if (runtime.allReady !== true) fail(`D-A assets not ready ${frame.file}`);
  if (frame.file === 'd-a-10-friendly-enemy-wrecks.png') { const wreckAssets = new Set((frame.wrecks || []).map((wreck) => wreck.assetId).filter(Boolean)); if (![...requiredWreckIds].every((id) => wreckAssets.has(id))) fail('D-A friendly/enemy wreck proof'); }
}
if (![...requiredUnitIds].every((id) => seenUnitAssets.has(id))) fail(`D-A required unit coverage ${JSON.stringify([...seenUnitAssets])}`);
if (seenFactions.size < 2 || !seenFactions.has('military-green-sand') || !seenFactions.has('rust-red-iron')) fail('D-A faction readability coverage');
if (!seenVisualClasses.has('anti_armor_infantry') || !seenVisualClasses.has('mbt') || !seenVisualClasses.has('infantry')) fail('D-A visual class coverage');
if (browser.binding?.machineEvidenceToBrowserCapture !== true || browser.binding?.finalDrawGeometryFromRenderer !== true || browser.binding?.animationResolverFromProductionRenderer !== true || browser.binding?.assetRuntimeStateFromRenderer !== true) fail('D-A browser provenance binding');
console.log(JSON.stringify({ ok: true, stage: '8.2G-D-A', machineFrames: machineFrames.length, browserFrames: browserFrames.length, uniquePngHashes: seenPng.size, requiredUnitAssets: seenUnitAssets.size, factionPalettes: [...seenFactions], wreckCoverage: [...requiredWreckIds], currentRenderer: true, tamperResistantBindings: true }));
