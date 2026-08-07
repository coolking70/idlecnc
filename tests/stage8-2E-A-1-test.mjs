import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFormalBattleHud, validateFormalHud } from '../js/battle-presentation/formal-hud-policy.js';
import { createContractBattlePresentation } from '../js/battle-presentation/contract-battle-adapter.js';
import { clearContractPlanCache, getContractPlanCacheDiagnostics, getOrBuildContractPresentation, presentationCacheKey } from '../js/battle-presentation/contract-plan-cache.js';
import { buildPresentationCacheKey, buildReportFingerprint, validateReportFingerprint } from '../js/battle-presentation/report-fingerprint.js';
import { createBattlePresentationRouter } from '../js/battle-presentation/presentation-router.js';
import { clearAllRuntimeFallbacks, getRuntimeFallbackDiagnostics } from '../js/battle-presentation/runtime-fallback-registry.js';
import { applyReturnChoreography, validateReturnChoreography } from '../js/battle-presentation/return-choreography.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures/campaign-victory.json'), 'utf8')).report;
const active = { id: 'formal-runtime-a', theaterId: 'border_road', report: fixture, elapsed: 0, duration: fixture.duration, presentationPhase: 'battle', returnElapsed: 0, returnDuration: 5 };
let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${name}`); }

check('formal HUD policy exists and validates safe game text', () => {
  const hud = buildFormalBattleHud(active, { battleId: active.id }, { time: 0 });
  assert.equal(validateFormalHud(hud).ok, true);
  assert.equal(JSON.stringify(hud).includes('真实战报驱动演示'), false);
  assert.equal(JSON.stringify(hud).includes(fixture.id), false);
  assert.equal(JSON.stringify(hud).includes(String(fixture.seed)), false);
});
check('formal HUD rejects diagnostic strings', () => assert.equal(validateFormalHud({ title: 'authority 2/4' }).ok, false));
check('fingerprint is deterministic and validates without mutation', () => {
  const before = JSON.stringify(fixture);
  const fingerprint = buildReportFingerprint(fixture);
  assert.equal(fingerprint, buildReportFingerprint(JSON.parse(before)));
  assert.equal(validateReportFingerprint(fixture, fingerprint), true);
  assert.equal(JSON.stringify(fixture), before);
});
check('event value changes fingerprint', () => {
  const copy = structuredClone(fixture); copy.events[0].value += 1;
  assert.notEqual(buildReportFingerprint(copy), buildReportFingerprint(fixture));
});
check('event target changes fingerprint', () => {
  const copy = structuredClone(fixture); copy.events[0].target = 'changed-target';
  assert.notEqual(buildReportFingerprint(copy), buildReportFingerprint(fixture));
});
check('final HP changes fingerprint', () => {
  const copy = structuredClone(fixture); copy.final.friendly[0].hp -= 1;
  assert.notEqual(buildReportFingerprint(copy), buildReportFingerprint(fixture));
});
check('cache key contains report fingerprint', () => assert.match(buildPresentationCacheKey(active), /fp1-[0-9a-f]{16}/));
check('same identity with changed event rebuilds cache', () => {
  clearContractPlanCache();
  const first = getOrBuildContractPresentation(active);
  const changed = { ...active, report: structuredClone(fixture) }; changed.report.events[0].value += 1;
  getOrBuildContractPresentation(changed);
  assert.equal(getContractPlanCacheDiagnostics().entries, 2);
  assert.notEqual(presentationCacheKey(active), presentationCacheKey(changed));
  assert.ok(first);
});
check('render state takes return runtime explicitly and moves infantry members', () => {
  const presentation = createContractBattlePresentation(active);
  assert.equal(presentation.ok, true);
  const before = presentation.renderState.atTime(35, { presentationPhase: 'battle' });
  const after = presentation.renderState.atTime(35, { presentationPhase: 'returning', returnElapsed: 2.5, returnDuration: 5 });
  const result = validateReturnChoreography(before, after, 0.5);
  assert.equal(result.ok, true, result.errors.join(', '));
  const infantry = before.actors.find((actor) => actor.side === 'friendly' && actor.members.length);
  const returned = after.actors.find((actor) => actor.id === infantry.id);
  assert.notEqual(returned.visualCenter.x, infantry.visualCenter.x);
  assert.equal(returned.memberPositions.length, infantry.memberPositions.length);
});
check('return choreography leaves enemies and wrecks fixed', () => {
  const presentation = createContractBattlePresentation(active);
  const before = presentation.renderState.atTime(35, { presentationPhase: 'battle' });
  const after = presentation.renderState.atTime(35, { presentationPhase: 'returning', returnElapsed: 5, returnDuration: 5 });
  const enemyBefore = before.actors.find((actor) => actor.side === 'enemy');
  const enemyAfter = after.actors.find((actor) => actor.id === enemyBefore.id);
  assert.deepEqual(enemyAfter.visualCenter, enemyBefore.visualCenter);
  assert.deepEqual(after.wrecks, before.wrecks);
});
check('router publishes rendered mode only after successful headless render', () => {
  clearAllRuntimeFallbacks();
  const router = createBattlePresentationRouter({ canvas: null, legacyRenderer: { render: () => true } });
  router.setPreference('auto'); router.render(active, 0);
  assert.equal(router.getState().renderedMode, 'contract_road_victory');
  assert.equal(router.getState().mode, 'contract_road_victory');
  router.reset(); router.destroy();
});
check('render_error permanently disables one battle for the session', () => {
  clearAllRuntimeFallbacks();
  const context = { setTransform() {} };
  const canvas = { getContext: () => context, getBoundingClientRect: () => ({ width: 960, height: 540 }), clientWidth: 960, clientHeight: 540, width: 960, height: 540 };
  let legacyCalls = 0;
  const router = createBattlePresentationRouter({ canvas, legacyRenderer: { render: () => { legacyCalls += 1; return true; } } });
  router.setPreference('contract');
  for (let index = 0; index < 100; index += 1) router.render(active, 0);
  const state = router.getState();
  assert.equal(state.renderedMode, 'legacy');
  assert.equal(state.contractAttempts, 1);
  assert.equal(getRuntimeFallbackDiagnostics().length, 1);
  assert.equal(legacyCalls, 100);
  router.reset();
  assert.equal(getRuntimeFallbackDiagnostics().length, 0);
});
check('main explicitly resets sidecar on load and new game', () => {
  const source = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  assert.match(source, /loadGame\(\)[\s\S]{0,500}battlePresentationRouter\?\.reset\(\)/);
  assert.match(source, /newGame\(\);\s*\n\s*battlePresentationRouter\?\.reset\(\)/);
});
check('browser evidence script and manifest use CDP path', () => {
  const script = fs.readFileSync(path.join(root, 'tests/browser/formal-battle-evidence.mjs'), 'utf8');
  assert.match(script, /dispatch/); assert.match(fs.readFileSync(path.join(root, 'tests/browser/cdp-client.mjs'), 'utf8'), /Page\.captureScreenshot/); assert.doesNotMatch(script, /playwright|puppeteer/i);
  const manifestPath = path.join(root, 'tests/fixtures/formal-browser-manifest-a1.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.screenshots.length, 11);
  assert.ok(manifest.screenshots.every((entry) => entry.reportFingerprint && entry.renderedMode && entry.canvasSignature && entry.pngSha256));
  assert.equal(new Set(manifest.screenshots.map((entry) => entry.pngSha256)).size, 11);
});

console.log(`stage8-2E-A-1-test: ${passed} passed / ${passed} total`);
