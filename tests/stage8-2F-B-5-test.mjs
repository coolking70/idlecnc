import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';
import { buildUniversalBattleHud } from '../js/battle-presentation/universal/universal-hud-policy.js';
import { buildUniversalPlanSafely } from '../js/battle-presentation/universal/universal-plan-builder.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const reports = {
  open: fixture('operation-result.json'),
  roadVictory: fixture('campaign-victory.json'),
  roadWithdraw: fixture('campaign-withdraw.json'),
  fortifiedWiped: fixture('campaign-defeat-or-wiped.json')
};
const active = (report, id) => ({ id, theaterId: report.theaterId, report });
let passed = 0; const check = (label, fn) => { fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${label}`); };

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.2F-B.5 战术空间与战场UI测试');
console.log('════════════════════════════════════════════');

check('废弃矿区使用三条带掩体的战术布局', () => {
  const plan = buildUniversalPlanSafely(reports.open);
  assert.equal(plan.ok, true); assert.equal(plan.layout.tacticalRouting, true); assert.equal(plan.layout.tacticalLayout.version, 'scrap-mine-tactical-v2');
  assert.deepEqual(plan.layout.tacticalLayout.laneIds, ['north', 'center', 'south']); assert.ok(plan.scene.props.length >= 7); assert.ok(new Set(plan.scene.props.map((prop) => prop.position.y)).size >= 5);
});

check('友军路线包含集结、掩体和火力线阶段', () => {
  const plan = buildUniversalPlanSafely(reports.open); const friendly = plan.layout.routes.filter((route) => route.side === 'friendly' && route.outcomeMode === 'victory');
  assert.ok(friendly.length >= 3); friendly.forEach((route) => { assert.ok(route.tactical.staging); assert.ok(route.tactical.covered); assert.ok(route.tactical.firing); assert.ok(route.points.length >= 8); assert.ok(route.tactical.firing.x - route.points[0].x > 250); });
});

check('首轮火力前单位已离开初始部署线', () => {
  const plan = buildUniversalPlanSafely(reports.open); const route = plan.layout.routes.find((item) => item.side === 'friendly' && item.tactical?.firing); const initial = plan.layout.nodes.find((item) => item.actorId === route.actorId); const firePoint = route.tactical.firing;
  assert.ok(Math.hypot(firePoint.x - initial.x, firePoint.y - initial.y) > 250); assert.ok(firePoint.x >= plan.layout.tacticalLayout.friendlyFireX - 1);
});

check('不同地形保留各自的通道语义', () => {
  for (const report of Object.values(reports)) { const plan = buildUniversalPlanSafely(report); assert.equal(plan.ok, true); assert.ok(plan.layout.tacticalLayout.version.includes(plan.scene.terrain.id === 'open' ? 'scrap-mine' : plan.scene.terrain.id === 'road' ? 'road' : 'fortified')); }
});

check('所有正式结果的战术空间无动态碰撞', () => {
  for (const report of Object.values(reports)) { const plan = buildUniversalPlanSafely(report); assert.equal(plan.spatialValidation.ok, true); assert.equal(plan.spatialValidation.collisions, 0); }
});

check('Universal 文本状态公开地形、路线阶段和火力线', () => {
  const presentation = createUniversalBattlePresentation(active(reports.open, 'b5-open')); assert.equal(presentation.ok, true); const text = presentation.renderState.textAt(8);
  assert.equal(text.terrain.name, '废弃矿区'); assert.equal(text.tacticalSpace.layoutVersion, 'scrap-mine-tactical-v2'); assert.equal(text.tacticalSpace.firingLines.length, 2); assert.equal(text.tacticalSpace.routedActors, 7);
});

check('战场 HUD 使用边缘窄条而不是大面积中心面板', () => {
  const presentation = createUniversalBattlePresentation(active(reports.open, 'b5-hud')); const state = presentation.renderState.atTime(8); const hud = buildUniversalBattleHud(active(reports.open, 'b5-hud'), presentation, state);
  assert.equal(hud.title, '废弃矿区'); assert.match(hud.viewLabel, /UNIVERSAL RTS/);
  const source = fs.readFileSync(path.join(root, 'js/battle-presentation/universal/universal-hud-policy.js'), 'utf8'); assert.match(source, /roundRect\(12, 8, leftWidth, 42/); assert.doesNotMatch(source, /roundRect\(12, 12, 236, 72/);
});

check('正式战斗壳层隐藏基地叠加 UI 并收窄结果栏', () => {
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8'); const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');
  assert.match(ui, /classList\.toggle\('is-battle-active', battle\)/); assert.match(css, /#stage\.is-battle-active \.view-chip/); assert.match(css, /#stage\.is-battle-active \.zone-legend/); assert.match(css, /width: min\(390px, calc\(100% - 36px\)\)/);
});

console.log(`stage8-2F-B-5-test: ${passed} passed / ${passed} total`);
