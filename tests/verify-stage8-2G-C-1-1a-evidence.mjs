import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildC1ScenarioReports } from './lib/stage8-2G-C1-scenarios.mjs';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildProductionDrawSpecs } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { normalizeVisualUnitClass } from '../js/battle-presentation/environment/visual-unit-class.js';
import { canonicalEvidenceString } from '../js/battle-presentation/universal/evidence-integrity.js';

const root = process.env.IRON_COMMAND_EVIDENCE_ROOT || process.cwd();
const read = (file) => JSON.parse(fs.readFileSync(`${root}/${file}`, 'utf8'));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fail = (message) => { throw new Error(message); };
const reports = await buildC1ScenarioReports();
const machine = read('stage8_2g_c11a_machine_semantic_evidence.json');
const browser = read('stage8_2g_c11a_browser_capture_manifest.json');
if (machine.stage !== '8.2G-C.1.1a' || browser.stage !== '8.2G-C.1.1a') fail('C.1.1a stage mismatch');
if (browser.browser?.currentCodeCaptured !== true || browser.browser?.legacyFallbackUsed !== false) fail('C.1.1a browser capture gate');
if ((browser.browser?.pageErrors || []).length || (browser.browser?.consoleErrors || []).length) fail('C.1.1a browser errors');
if (browser.machineEvidenceSha256 !== sha(`${root}/stage8_2g_c11a_machine_semantic_evidence.json`)) fail('C.1.1a machine hash mismatch');
const machineFrames = machine.scenes.flatMap((scene) => scene.frames); const browserFrames = browser.scenes.flatMap((scene) => scene.frames);
if (machine.frameCount !== 6 || browser.browser?.captureCount !== 6 || browserFrames.length !== 6) fail('C.1.1a frame count mismatch');
const seen = new Set();
const geometryComparable = (row) => { const copy = JSON.parse(JSON.stringify(row)); for (const key of ['logicalRect', 'cssRect', 'drawRect', 'rawCssWidth', 'rawCssHeight', 'finalCssWidth', 'finalCssHeight', 'rawScreenFootprint', 'screenFootprint', 'cameraZoom', 'viewportScale', 'visualScaleBoost']) delete copy[key]; return copy; };
const legacyBrowserRow = (row, expected) => Object.fromEntries(Object.keys(expected).map((key) => [key, row[key]]));
for (const frame of machineFrames) {
  const report = reports[frame.result === 'withdraw' ? 'defeat' : 'victory']; const presentation = createUniversalBattlePresentation({ id: frame.sceneId, report, duration: report.duration, presentationPhase: 'battle' }); if (!presentation.ok) fail(`presentation ${frame.sceneId}`);
  const state = presentation.renderState.atTime(frame.visualTimeSeconds); if (frame.sceneHash !== state.sceneHash || frame.environmentSignature !== state.environment.signature) fail(`machine state binding ${frame.file}`);
  if ((frame.routeClearance?.violations || []).length || Object.values(frame.routeClearance?.violationsByClass || {}).some((rows) => rows.length)) fail(`route clearance ${frame.file}`);
  const expectedRoutes = state.engagementSchedule.coverMoves.map((move) => ({ id: move.id, purpose: move.purpose, start: move.start, end: move.end, routes: move.presentationRoutes || {} })); if (canonicalEvidenceString(frame.coverPresentationRoutes) !== canonicalEvidenceString(expectedRoutes)) fail(`cover presentation route binding ${frame.file}`);
  const browserFrame = browserFrames.find((candidate) => candidate.semanticFrameId === frame.semanticFrameId); if (!browserFrame) fail(`missing browser frame ${frame.file}`); if (seen.has(browserFrame.imageSha256)) fail(`duplicate PNG ${frame.file}`); seen.add(browserFrame.imageSha256);
  const imagePath = browserFrame.screenshot?.path || ''; if (!imagePath || imagePath.includes('..') || sha(`${root}/${imagePath}`) !== browserFrame.imageSha256) fail(`PNG hash mismatch ${frame.file}`); if (browserFrame.stateSignature !== frame.stateSignature || browserFrame.environmentSignature !== state.environment.signature) fail(`browser state binding ${frame.file}`);
  const expectedSpecs = buildProductionDrawSpecs({ actors: state.actors, wrecks: state.wrecks, environment: state.environment, camera: state.camera, options: { battlefieldBounds: presentation.plan.layout.bounds, viewport: frame.screenMetrics.viewport, presentationSeconds: frame.visualTimeSeconds, seed: report.seed } });
  const expectedRows = expectedSpecs.actorSpecs.map((spec) => ({ ...spec.finalDrawGeometry, actorId: spec.actorId, side: spec.faction, type: spec.type, assetId: spec.assetId, assetMode: spec.assetMode, assetStatus: spec.assetStatus, factionVisualMode: spec.factionVisualMode, factionPalette: spec.factionPalette, factionMark: spec.factionMark, animation: spec.animation, direction: spec.animationState?.direction || null, directionIndex: spec.animationState?.directionIndex ?? null, frameIndex: spec.animationState?.frameIndex ?? null, sourceRect: spec.sourceRect || null, turretSourceRect: spec.turretSourceRect || null, muzzleAnchor: spec.muzzleAnchor || null, actualDrawPath: spec.assetMode === 'procedural' ? 'procedural-fallback' : spec.assetMode === 'hybrid' ? 'drawImage:components' : 'drawImage', rendererGeometrySource: 'production-final-draw-geometry' }));
  if (canonicalEvidenceString(frame.screenMetrics.actors) !== canonicalEvidenceString(expectedRows)) fail(`machine final geometry ${frame.file}`);
  const actualRows = browserFrame.screenMetrics?.actors || []; if (actualRows.length !== expectedRows.length) fail(`browser geometry actor count ${frame.file}`); for (const expected of expectedRows) { const actual = actualRows.find((row) => row.actorId === expected.actorId); const expectedComparable = geometryComparable(expected); const actualComparable = geometryComparable(legacyBrowserRow(actual || {}, expectedComparable)); if (!actual || canonicalEvidenceString(actualComparable) !== canonicalEvidenceString(expectedComparable)) fail(`browser final geometry ${frame.file}`); }
  if (actualRows.some((row) => row.rendererGeometrySource !== 'production-final-draw-geometry' || row.finalCssWidth == null || row.finalCssHeight == null)) fail(`missing final geometry fields ${frame.file}`); if (frame.viewportKind === 'narrow' && actualRows.some((row) => row.screenFootprint < row.minimumScreenFootprint)) fail(`narrow footprint ${frame.file}`);
  const expectedClasses = new Map(state.actors.map((actor) => [actor.id, normalizeVisualUnitClass(actor)])); for (const row of frame.visualClassRows) if (row.visualClass !== expectedClasses.get(row.actorId)) fail(`visual class binding ${frame.file}`); if (frame.semantic === 'enemy-at-alias' && !actualRows.some((row) => row.type === 'enemy_at' && row.visualClass === 'anti_armor_infantry' && row.rendererFamily === 'infantry')) fail('enemy_at alias proof'); if (frame.semantic === 'faction-same-frame') { const classes = new Set(actualRows.filter((row) => ['friendly', 'enemy'].includes(row.side)).map((row) => row.visualClass)); if (!classes.has('infantry') || !classes.has('anti_armor_infantry')) fail('faction proof'); }
  if (browserFrame.assetRuntime?.allReady !== true) fail(`asset runtime not ready ${frame.file}`); if (Math.abs(Number(browserFrame.timestampDeltaMs)) > 16.7) fail(`timestamp ${frame.file}`);
}
console.log(JSON.stringify({ ok: true, stage: '8.2G-C.1.1a', machineFrames: machineFrames.length, browserFrames: browserFrames.length, uniquePngHashes: seen.size, finalGeometry: true, visualAliases: true, coverPresentationRoutes: true, assetRuntime: true }));
