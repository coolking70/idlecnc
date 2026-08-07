import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measurePresentationViewport } from '../js/battle-presentation/presentation-viewport.js';
import { clampUniversalCamera, resolveUniversalCamera } from '../js/battle-presentation/universal/universal-render-camera.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { UniversalBattleRenderer } from '../js/battle-presentation/universal/universal-battle-renderer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const active = (report, id) => ({ id, theaterId: report.theaterId, report, elapsed: 8, duration: report.duration, presentationPhase: 'battle', returnElapsed: 0, returnDuration: 5 });
const operation = load('operation-result.json');
const withdraw = load('campaign-withdraw.json');
const wiped = load('campaign-defeat-or-wiped.json');
const victory = load('campaign-victory.json');
let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${name}`); }

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.2F-B.4 响应式战场与自由视野测试');
console.log('════════════════════════════════════════════');

check('viewport preserves aspect ratio on narrow battle panels', () => {
  const viewport = measurePresentationViewport({ clientWidth: 720, clientHeight: 420, getBoundingClientRect: () => ({ width: 720, height: 420 }) });
  assert.equal(viewport.width, 720); assert.equal(viewport.height, 420); assert.equal(viewport.scale, .5625); assert.equal(viewport.offsetX, 0); assert.equal(viewport.offsetY, 7.5);
});

check('manual universal camera override clamps and disables auto tracking', () => {
  const report = operation; const presentation = createUniversalBattlePresentation(active(report, 'b4-camera')); const state = presentation.renderState.atTime(8, { cameraMode: 'overview', autoCamera: false, cameraOverride: { x: 900, y: 500, zoom: 1.2 } });
  assert.equal(state.camera.manual, true); assert.equal(state.camera.auto, false); assert.equal(state.camera.label, '手动观察'); assert.equal(state.camera.x, 746.6666666666666); assert.equal(state.camera.y, 420); assert.equal(state.camera.zoom, 1.2);
});

check('manual camera remains bounded for every formal outcome', () => {
  for (const [report, id] of [[operation, 'operation'], [withdraw, 'withdraw'], [wiped, 'wiped'], [victory, 'victory']]) {
    const presentation = createUniversalBattlePresentation(active(report, `b4-${id}`)); const state = presentation.renderState.atTime(8, { cameraOverride: { x: 100000, y: -100000, zoom: 100 } });
    assert.ok(state.actors.length > 0); assert.equal(state.camera.manual, true); assert.equal(state.camera.x, 1280 - 640 / 1.45); assert.equal(state.camera.y, 360 / 1.45); assert.equal(state.camera.zoom, 1.45);
  }
});

check('renderer exposes reset and interaction state without a DOM canvas', () => {
  const renderer = new UniversalBattleRenderer(null); renderer.setPresentation(createUniversalBattlePresentation(active(operation, 'b4-headless'))); renderer.render(active(operation, 'b4-headless'));
  assert.equal(renderer.getInteractionState().manual, false); assert.equal(renderer.resetCamera(), true); assert.equal(renderer.getInteractionState().autoCamera, true); renderer.destroy();
});

check('formal renderers include responsive viewport and pointer camera hooks', () => {
  const universal = fs.readFileSync(path.join(root, 'js/battle-presentation/universal/universal-battle-renderer.js'), 'utf8');
  const contract = fs.readFileSync(path.join(root, 'js/battle-presentation/contract-battle-renderer.js'), 'utf8');
  assert.match(universal, /pointerdown/); assert.match(universal, /wheel/); assert.match(universal, /applyPresentationWorldTransform/); assert.match(universal, /cameraOverride/);
  assert.match(contract, /pointerdown/); assert.match(contract, /wheel/); assert.match(contract, /applyPresentationWorldTransform/); assert.match(contract, /cameraOverride/);
  assert.deepEqual(clampUniversalCamera({ x: 640, y: 360, zoom: 1 }), { x: 640, y: 360, zoom: 1 });
});

console.log(`stage8-2F-B-4-test: ${passed} passed / ${passed} total`);
