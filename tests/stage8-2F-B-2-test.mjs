import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { UniversalBattleRenderer } from '../js/battle-presentation/universal/universal-battle-renderer.js';
import { UNIVERSAL_CAMERA_MODES } from '../js/battle-presentation/universal/universal-render-camera.js';
import { buildUniversalBattleHud, validateUniversalHud } from '../js/battle-presentation/universal/universal-hud-policy.js';
import { createBattlePresentationRouter } from '../js/battle-presentation/presentation-router.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const active = (report, id = `universal-b2-${report.id}`) => ({ id, theaterId: report.theaterId, report, elapsed: 0, duration: report.duration, presentationPhase: 'battle', returnElapsed: 0, returnDuration: 5 });
const victory = load('campaign-victory.json');
const withdraw = load('campaign-withdraw.json');
const wiped = load('campaign-defeat-or-wiped.json');
const operation = load('operation-result.json');
let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${name}`); }

check('formal renderer exposes deterministic camera modes', () => {
  const presentation = createUniversalBattlePresentation(active(victory)); const renderer = new UniversalBattleRenderer(null); renderer.setPresentation(presentation);
  assert.deepEqual(UNIVERSAL_CAMERA_MODES, ['overview', 'focus', 'impact', 'result']);
  for (const mode of UNIVERSAL_CAMERA_MODES) { assert.equal(renderer.setCameraMode(mode), true); renderer.render(active(victory)); assert.equal(renderer.lastState.camera.mode, mode); assert.ok(Number.isFinite(renderer.lastState.camera.x)); }
  assert.equal(renderer.setCameraMode('diagnostic'), false); renderer.destroy();
});

check('render state includes unit silhouettes and stable member formations', () => {
  const presentation = createUniversalBattlePresentation(active(operation)); const first = presentation.renderState.atTime(presentation.plan.timeline.duration * .18); const second = presentation.renderState.atTime(presentation.plan.timeline.duration * .18);
  const infantry = first.actors.find((actor) => actor.type === 'infantry'); const at = first.actors.find((actor) => actor.type === 'at_infantry'); const vehicle = first.actors.find((actor) => actor.category !== 'infantry');
  assert.equal(infantry.memberPositions.length, 4); assert.equal(at.memberPositions.length, 3); assert.equal(vehicle.memberPositions.length, 0); assert.deepEqual(first.actors.map((actor) => actor.memberPositions), second.actors.map((actor) => actor.memberPositions));
});

check('render state exposes authority effects without mutating the report', () => {
  const before = stableStringify(victory); const presentation = createUniversalBattlePresentation(active(victory)); const hitTime = presentation.plan.timeline.anchors.find((anchor) => ['damage', 'destroy', 'repair'].includes(anchor.type))?.t || 10; const state = presentation.renderState.atTime(hitTime + .12); assert.ok(state.effects.some((effect) => effect.source === 'authority_anchor')); assert.ok(state.activeActions.length > 0); assert.equal(stableStringify(victory), before);
});

check('renderer distinguishes salvage, objective and wreck scene semantics', () => {
  const salvage = createUniversalBattlePresentation(active(operation)).renderState.atTime(30); const objective = createUniversalBattlePresentation(active(victory)).renderState.atTime(30); const destroyed = createUniversalBattlePresentation(active(wiped)).renderState.atTime(30);
  assert.ok(salvage.sceneObjects.some((object) => object.visualKind === 'salvage_site' && object.state === 'recovered')); assert.ok(objective.sceneObjects.some((object) => object.visualKind === 'control_node')); assert.ok(destroyed.wrecks.length > 0); assert.equal(destroyed.objectiveState, 'enemy_controlled');
});

check('each formal outcome has a result-specific ending state', () => {
  for (const report of [victory, withdraw, wiped]) { const presentation = createUniversalBattlePresentation(active(report)); const state = presentation.renderState.atTime(presentation.plan.timeline.duration * .96); assert.equal(state.choreography.outcome, report.result); assert.ok(state.choreography.activeOutcome); assert.equal(state.camera.mode, 'overview'); }
});

check('universal HUD stays generic while carrying camera state', () => {
  const presentation = createUniversalBattlePresentation(active(operation)); const state = presentation.renderState.atTime(18, { cameraMode: 'focus', autoCamera: false }); const hud = buildUniversalBattleHud(active(operation), presentation, state); const validation = validateUniversalHud(hud); assert.equal(validation.ok, true); assert.match(hud.viewLabel, /UNIVERSAL RTS/); assert.match(hud.cameraLabel, /接敌焦点/); assert.doesNotMatch(JSON.stringify(hud), /report|seed|authority/i);
});

check('router forwards camera controls to the explicit universal renderer', () => {
  const router = createBattlePresentationRouter({ canvas: null, legacyRenderer: { render: () => true } }); router.setPreference('universal'); const battle = active(operation, 'router-b2'); router.render(battle, 0); router.setCameraMode('impact'); router.setAutoCamera(false); router.render(battle, 0); assert.equal(router.getRenderState().camera.mode, 'impact'); assert.equal(router.getRenderState().camera.auto, false); assert.equal(router.getTextState().camera.mode, 'impact'); router.destroy();
});

check('production B.2 renderer has no sandbox or diagnostic-resource imports', () => {
  const files = ['universal-battle-renderer.js', 'universal-render-state.js', 'universal-render-camera.js', 'universal-hud-policy.js'].map((file) => fs.readFileSync(path.join(root, 'js/battle-presentation/universal', file), 'utf8')).join('\n'); assert.doesNotMatch(files, /experiments\//); assert.doesNotMatch(files, /fixture/i);
});

console.log(`stage8-2F-B-2-test: ${passed} passed / ${passed} total`);
