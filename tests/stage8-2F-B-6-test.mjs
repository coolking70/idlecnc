import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUniversalPlan } from '../js/battle-presentation/universal/universal-plan-builder.js';
import { buildUniversalRenderState } from '../js/battle-presentation/universal/universal-render-state.js';
import { compileUniversalPlan } from '../js/battle-presentation/universal/universal-plan-compiler.js';
import { sampleSpatialEntityPosition } from '../js/battle-presentation/universal/universal-position-sampler.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures');
const reports = ['campaign-victory.json', 'campaign-withdraw.json', 'campaign-defeat-or-wiped.json', 'operation-result.json']
  .map((file) => JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8')).report);

let passed = 0;
const check = (label, fn) => { fn(); passed += 1; console.log(`  PASS ${String(passed).padStart(2, '0')} ${label}`); };

console.log('\n════════════════════════════════════════════');
console.log('  钢铁指令 阶段8.2F-B.6 近距接敌与掩体真实性回归');
console.log('════════════════════════════════════════════');

check('首轮火力统一在接敌带之后才发生', () => {
  for (const report of reports) {
    const plan = buildUniversalPlan(report);
    const firstFire = plan.timeline.anchors.find((anchor) => anchor.type === 'fire');
    assert.ok(firstFire, report.id);
    assert.ok(firstFire.t >= plan.timeline.duration * 0.39, `${report.id}: ${firstFire.t}/${plan.timeline.duration}`);
  }
});

check('每个单位的首轮开火已离开初始部署线且距离受控', () => {
  for (const report of reports) {
    const plan = buildUniversalPlan(report); const compiled = compileUniversalPlan(plan); const seen = new Set();
    report.events.forEach((event, index) => {
      if (event.type !== 'fire' || seen.has(event.actor)) return;
      seen.add(event.actor);
      const anchor = plan.timeline.anchors.find((row) => row.sourceEventId === `event_${String(index + 1).padStart(4, '0')}`);
      const source = sampleSpatialEntityPosition(compiled, event.actor, anchor.t); const target = sampleSpatialEntityPosition(compiled, event.target, anchor.t);
      const initial = plan.layout.nodes.find((node) => node.actorId === event.actor);
      assert.ok(Math.hypot(source.x - initial.x, source.y - initial.y) > 100, `${report.id}: ${event.actor} stayed at deployment line`);
      assert.ok(Math.hypot(source.x - target.x, source.y - target.y) <= 520, `${report.id}: ${event.actor} first fire too far`);
    });
  }
});

check('掩体是正式空间对象并绑定到接敌路线', () => {
  for (const report of reports) {
    const plan = buildUniversalPlan(report);
    assert.ok(plan.scene.props.filter((prop) => prop.tacticalCover === true).length >= 6, report.id);
    const tacticalRoutes = plan.layout.routes.filter((route) => route.tactical?.stage);
    assert.ok(tacticalRoutes.length > 0, report.id);
    assert.ok(tacticalRoutes.every((route) => route.tactical.cover === true && route.tactical.coverPropId), `${report.id}: route without cover binding`);
  }
});

check('首轮接敌时渲染状态公开掩体保护语义', () => {
  for (const report of reports) {
    const plan = buildUniversalPlan(report); const firstFire = plan.timeline.anchors.find((anchor) => anchor.type === 'fire'); const state = buildUniversalRenderState(plan, firstFire.t);
    assert.ok(state.actors.some((actor) => actor.cover?.inCover === true), report.id);
    assert.ok(state.actors.every((actor) => actor.cover && Number.isFinite(actor.cover.value)), report.id);
  }
});

check('单兵力覆灭样本仍由存活敌军推进而非出生点互射', () => {
  const report = reports.find((row) => row.result === 'wiped'); const plan = buildUniversalPlan(report); const enemyRoute = plan.layout.routes.find((route) => route.side === 'enemy'); const node = plan.layout.nodes.find((item) => item.actorId === enemyRoute.actorId); const contact = enemyRoute.tactical.firing;
  assert.ok(contact.x < node.x - 180 || Math.abs(contact.y - node.y) > 80);
  assert.ok(plan.validation.ok && plan.spatialValidation.ok);
});

console.log(`stage8-2F-B-6-test: ${passed} passed / ${passed} total`);
