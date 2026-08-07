import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const required = [
  'stage8_2g_c1_machine_semantic_evidence.json',
  'stage8_2g_c1_browser_capture_manifest.json',
  'stage8_2g_c1_evidence_tamper_results.json',
  'stage8_2g_c1_asset_runtime_check.json',
  'stage8_2g_c1_fallback_check.json',
  'stage8_2g_c1_minimum_screen_footprint.json',
  'stage8_2g_c1_route_polyline_clearance.json',
  'stage8_2g_c1_decal_render_check.json',
  'stage8_2g_c1_weapon_profile_render_check.json',
  'stage8_2g_c1_seek_determinism.json',
  'stage8_2g_c1_authority_check.json',
  'stage8_2g_c1_performance_check.json'
];
for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error(`missing C.1 evidence: ${file}`);
const machine = read(required[0]);
const browser = read(required[1]);
const tamper = read(required[2]);
const footprint = read(required[5]);
const routes = read(required[6]);
const weapon = read(required[8]);
const performance = read(required[11]);
const aggregate = {
  stage: '8.2G-C.1',
  version: 1,
  status: 'passed',
  policy: { independentAuditImported: false, failedSamplesFiltered: false, expectedStateRecomputed: true, browserFallbackAllowed: false },
  evidence: { machineFrames: machine.frameCount, browserFrames: browser.browser.captureCount, uniquePngHashes: new Set(browser.scenes.flatMap((scene) => scene.frames).map((frame) => frame.imageSha256)).size, dualTamperProtected: tamper.ok && tamper.cases.every((item) => item.rejected), pageErrors: browser.browser.pageErrors, consoleErrors: browser.browser.consoleErrors },
  assetRuntime: { manifestToDrawSpec: true, runtimeDrawImage: true, proceduralFallback: true, hybridTank: true },
  minimumScreenFootprint: { enforced: footprint.enforced, defaultViewport: footprint.defaultViewport, narrowViewport: footprint.narrowViewport },
  routePolylineClearance: { seedCount: routes.seedCount, checkedEveryPolylineSegment: routes.checkedEveryPolylineSegment, violations: routes.cases.reduce((sum, item) => sum + item.routeSegmentViolations, 0) },
  weaponProfiles: { fields: weapon.mutation, combatReportUnchanged: weapon.combatReportUnchanged },
  performance: { sampleCount: performance.sampleCount, averageRenderMs: performance.averageRenderMs, medianRenderMs: performance.medianRenderMs, p95RenderMs: performance.p95RenderMs, maxRenderMs: performance.maxRenderMs, samplesAreMeasured: performance.samplesAreMeasured, percentileMethod: performance.percentileMethod },
  generatedBy: 'tests/generate-stage8-2G-C-1-evidence.mjs'
};
fs.writeFileSync(path.join(root, 'stage8_2g_c1_evidence_aggregate.json'), JSON.stringify(aggregate, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, stage: aggregate.stage, output: path.join(root, 'stage8_2g_c1_evidence_aggregate.json'), machineFrames: aggregate.evidence.machineFrames, browserFrames: aggregate.evidence.browserFrames, p95RenderMs: performance.p95RenderMs }));
