import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildC1ScenarioReports } from './lib/stage8-2G-C1-scenarios.mjs';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildProductionDrawSpecs } from '../js/battle-presentation/environment/production-visual-draw-spec.js';
import { canonicalEvidenceString } from '../js/battle-presentation/universal/evidence-integrity.js';

const root = process.env.IRON_COMMAND_EVIDENCE_ROOT || process.cwd();
const read = (file) => JSON.parse(fs.readFileSync(`${root}/${file}`, 'utf8'));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fail = (message) => { throw new Error(message); };
const reports = await buildC1ScenarioReports();
const machine = read('stage8_2g_c11_machine_semantic_evidence.json'); const browser = read('stage8_2g_c11_browser_capture_manifest.json');
if (machine.stage !== '8.2G-C.1.1' || browser.stage !== '8.2G-C.1.1') fail('C.1.1 stage mismatch');
if (browser.browser?.currentCodeCaptured !== true || browser.browser?.legacyFallbackUsed !== false) fail('C.1.1 browser capture gate');
if ((browser.browser?.pageErrors || []).length || (browser.browser?.consoleErrors || []).length) fail('C.1.1 browser errors');
if (browser.machineEvidenceSha256 !== sha(`${root}/stage8_2g_c11_machine_semantic_evidence.json`)) fail('C.1.1 machine hash mismatch');
const machineFrames = machine.scenes.flatMap((scene) => scene.frames); const browserFrames = browser.scenes.flatMap((scene) => scene.frames);
if (machine.frameCount !== 7 || browser.browser?.captureCount !== 7 || browserFrames.length !== 7) fail('C.1.1 frame count mismatch');
const seen = new Set();
for (const frame of machineFrames) {
  const report = reports[frame.result === 'withdraw' ? 'defeat' : 'victory']; const presentation = createUniversalBattlePresentation({ id: frame.sceneId, report, duration: report.duration, presentationPhase: 'battle' }); if (!presentation.ok) fail(`presentation ${frame.sceneId}`);
  const state = presentation.renderState.atTime(frame.visualTimeSeconds); const metrics = state.environment.metrics;
  if (frame.sceneHash !== state.sceneHash || frame.environmentSignature !== state.environment.signature) fail(`machine state binding ${frame.file}`);
  if ((metrics.routeSegmentViolations || []).length) fail(`route violation ${frame.file}`);
  if ((frame.routeClearance?.violations || []).length || (frame.routeClearance?.violationsByClass && Object.values(frame.routeClearance.violationsByClass).some((rows) => rows.length))) fail(`machine route clearance binding ${frame.file}`);
  const browserFrame = browserFrames.find((candidate) => candidate.semanticFrameId === frame.semanticFrameId); if (!browserFrame) fail(`missing browser frame ${frame.file}`);
  if (seen.has(browserFrame.imageSha256)) fail(`duplicate PNG ${frame.file}`); seen.add(browserFrame.imageSha256);
  const imagePath = browserFrame.screenshot?.path || ''; if (!imagePath || imagePath.includes('..') || sha(`${root}/${imagePath}`) !== browserFrame.imageSha256) fail(`PNG hash mismatch ${frame.file}`);
  if (browserFrame.environmentSignature !== state.environment.signature || browserFrame.stateSignature !== frame.stateSignature) fail(`browser state binding ${frame.file}`);
  if ((browserFrame.routeClearance?.violations || []).length || (browserFrame.routeClearance?.violationsByClass && Object.values(browserFrame.routeClearance.violationsByClass).some((rows) => rows.length))) fail(`browser route clearance binding ${frame.file}`);
  const expectedSpecs = buildProductionDrawSpecs({ actors: state.actors, wrecks: state.wrecks, environment: state.environment, camera: state.camera, options: { battlefieldBounds: presentation.plan.layout.bounds, viewport: frame.screenMetrics.viewport } }); const expectedMetrics = { metricSpace: 'final_css_pixels', viewport: frame.screenMetrics.viewport, camera: state.camera, actors: expectedSpecs.actorSpecs.map((spec) => ({ actorId: spec.actorId, side: spec.faction, type: spec.type, minimumScreenFootprint: spec.minimumScreenFootprint, rawScreenFootprint: spec.rawScreenFootprint, visualScaleBoost: spec.visualScaleBoost, screenFootprint: spec.screenFootprint, metricSpace: spec.metricSpace })) }; const actualMetrics = { metricSpace: browserFrame.screenMetrics.metricSpace, viewport: browserFrame.screenMetrics.viewport, camera: browserFrame.screenMetrics.camera, actors: browserFrame.screenMetrics.actors.map(({ actorId, side, type, minimumScreenFootprint, rawScreenFootprint, visualScaleBoost, screenFootprint, metricSpace }) => ({ actorId, side, type, minimumScreenFootprint, rawScreenFootprint, visualScaleBoost, screenFootprint, metricSpace })) }; if (canonicalEvidenceString(actualMetrics) !== canonicalEvidenceString(expectedMetrics)) fail(`browser CSS metric binding ${frame.file}`);
  if (frame.viewportKind === 'narrow') { const rows = browserFrame.screenMetrics?.actors || []; if (!rows.length || rows.some((row) => row.screenFootprint + 1e-9 < row.minimumScreenFootprint)) fail(`narrow CSS footprint ${frame.file}`); }
  if (Math.abs(Number(browserFrame.timestampDeltaMs)) > 16.7) fail(`timestamp ${frame.file}`);
}
console.log(JSON.stringify({ ok: true, stage: '8.2G-C.1.1', machineFrames: machineFrames.length, browserFrames: browserFrames.length, uniquePngHashes: seen.size, expectedStateRecomputed: true, routeClearance: true, factionResolution: true }));
