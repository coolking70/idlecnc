import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { clearUniversalPlanCache, getOrBuildUniversalPresentation, getUniversalPlanCacheDiagnostics } from '../js/battle-presentation/universal/universal-plan-cache.js';
import { createBattlePresentationRouter } from '../js/battle-presentation/presentation-router.js';
import { clearAllRuntimeFallbacks, getRuntimeFallbackDiagnostics } from '../js/battle-presentation/runtime-fallback-registry.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const victory = load('campaign-victory.json');
const withdraw = load('campaign-withdraw.json');
const wiped = load('campaign-defeat-or-wiped.json');
const operation = load('operation-result.json');
const active = (report, id = `universal-${report.id}`) => ({ id, theaterId: report.theaterId, report, elapsed: 0, duration: report.duration, presentationPhase: 'battle', returnElapsed: 0, returnDuration: 5 });
let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${name}`); }

check('universal adapter accepts a formal campaign victory', () => {
  const before = stableStringify(victory); const presentation = createUniversalBattlePresentation(active(victory));
  assert.equal(presentation.ok, true); assert.equal(presentation.mode, 'universal_battle'); assert.equal(presentation.plan.ok, true); assert.equal(stableStringify(victory), before);
});
check('universal adapter accepts withdraw and preserves the result', () => {
  const presentation = createUniversalBattlePresentation(active(withdraw));
  assert.equal(presentation.ok, true); assert.equal(presentation.plan.source.result, 'withdraw'); assert.ok(presentation.plan.layout.routes.some((route) => route.retreat));
});
check('universal adapter accepts wiped without fabricating survivors', () => {
  const presentation = createUniversalBattlePresentation(active(wiped));
  assert.equal(presentation.ok, true); assert.deepEqual(presentation.plan.outcome.finalState.friendlyAliveIds, []); assert.equal(presentation.plan.source.result, 'wiped');
});
check('universal adapter accepts operation reports outside the road contract', () => {
  const presentation = createUniversalBattlePresentation(active(operation));
  assert.equal(presentation.ok, true); assert.equal(presentation.plan.source.missionId, 'salvage_run'); assert.equal(presentation.plan.scene.terrain.id, 'open');
});
check('universal render state applies authority damage and final state exactly', () => {
  const presentation = createUniversalBattlePresentation(active(victory));
  const initial = presentation.renderState.atTime(0); const final = presentation.renderState.atTime(presentation.plan.timeline.duration);
  assert.ok(initial.actors.some((actor) => actor.hp !== final.actors.find((row) => row.id === actor.id).hp));
  for (const actor of final.actors) { const source = presentation.plan.outcome.finalState.actors[actor.id]; assert.equal(actor.hp, source.hp); assert.equal(actor.alive, source.alive); }
});
check('universal render state supports explicit return choreography', () => {
  const presentation = createUniversalBattlePresentation(active(victory));
  const battle = presentation.renderState.atTime(presentation.plan.timeline.duration); const returning = presentation.renderState.atTime(presentation.plan.timeline.duration, { presentationPhase: 'returning', returnElapsed: 2.5, returnDuration: 5 });
  const friendly = battle.actors.find((actor) => actor.side === 'friendly' && actor.alive); const returned = returning.actors.find((actor) => actor.id === friendly.id);
  assert.notDeepEqual(returned.visualCenter, friendly.visualCenter); assert.equal(returning.returnProgress, 0.5); assert.equal(returning.authority[friendly.id].hp, battle.authority[friendly.id].hp);
});
check('universal plan cache builds once and then hits', () => {
  clearUniversalPlanCache(); const battle = active(operation, 'cache-test'); getOrBuildUniversalPresentation(battle); getOrBuildUniversalPresentation(battle); const diagnostics = getUniversalPlanCacheDiagnostics();
  assert.equal(diagnostics.entries, 1); assert.equal(diagnostics.builds >= 1, true); assert.equal(diagnostics.hits >= 1, true);
});
check('router admits explicit universal preference and publishes render state', () => {
  clearAllRuntimeFallbacks(); const router = createBattlePresentationRouter({ canvas: null, legacyRenderer: { render: () => true } }); router.setPreference('universal'); router.render(active(operation, 'router-operation'), 0);
  assert.equal(router.getState().preference, 'universal'); assert.equal(router.getState().renderedMode, 'universal_battle'); assert.equal(router.getRenderState().actors.length > 0, true); assert.equal(router.getTextState().mode, 'universal'); router.destroy();
});
check('auto keeps the existing contract path for the supported road victory', () => {
  const router = createBattlePresentationRouter({ canvas: null, legacyRenderer: { render: () => true } }); router.setPreference('auto'); router.render(active(victory, 'router-contract'), 0); assert.equal(router.getState().renderedMode, 'contract_road_victory'); router.destroy();
});
check('legacy preference never invokes the universal sidecar', () => {
  const router = createBattlePresentationRouter({ canvas: null, legacyRenderer: { render: () => true } }); router.setPreference('legacy'); router.render(active(operation, 'router-legacy'), 0); assert.equal(router.getState().renderedMode, 'legacy'); assert.equal(router.getState().universalAttempts, 0); router.destroy();
});
check('router universal failure is permanently bounded and falls back', () => {
  clearAllRuntimeFallbacks(); let legacyCalls = 0; const context = { setTransform() {}, clearRect() {} }; const canvas = { getContext: () => context, getBoundingClientRect: () => ({ width: 960, height: 540 }), clientWidth: 960, clientHeight: 540, width: 960, height: 540 };
  const router = createBattlePresentationRouter({ canvas, legacyRenderer: { render: () => { legacyCalls += 1; return true; } } }); router.setPreference('universal'); router.render(active(operation, 'router-failure'), 0); router.render(active(operation, 'router-failure'), 0);
  assert.equal(router.getState().renderedMode, 'legacy'); assert.equal(router.getState().universalAttempts, 1); assert.equal(legacyCalls, 2); assert.equal(getRuntimeFallbackDiagnostics().length, 1); router.reset(); assert.equal(getRuntimeFallbackDiagnostics().length, 0);
});
check('production universal path does not import experiment resources', () => {
  const files = ['universal-battle-adapter.js', 'universal-battle-renderer.js', 'universal-render-state.js', 'universal-plan-cache.js', 'universal-hud-policy.js'].map((file) => fs.readFileSync(path.join(root, 'js/battle-presentation/universal', file), 'utf8')).join('\n');
  assert.doesNotMatch(files, /experiments\//); assert.doesNotMatch(files, /fixture/i);
});

console.log(`stage8-2F-B-1-test: ${passed} passed / ${passed} total`);
