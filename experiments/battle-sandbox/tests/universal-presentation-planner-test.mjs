import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPresentationContract } from '../../../js/battle-presentation/contract-battle-adapter.js';
import { buildUniversalPlan, buildUniversalPlanSafely } from '../../../js/battle-presentation/universal/universal-plan-builder.js';

const fixtureDir = new URL('../report-adapter/fixtures/', import.meta.url);
const files = ['campaign-victory.json', 'campaign-withdraw.json', 'campaign-defeat-or-wiped.json', 'operation-result.json'];
const reports = files.map((file) => JSON.parse(fs.readFileSync(new URL(file, fixtureDir), 'utf8')).report);
let checks = 0;
function check(condition, message) { checks += 1; assert.equal(Boolean(condition), true, message); }

for (const report of reports) {
  const before = JSON.stringify(report);
  const plan = buildUniversalPlan(report);
  check(plan.ok, `${report.id}: plan ok`);
  check(plan.planKind === 'universal_battle', `${report.id}: plan kind`);
  check(plan.planVersion.startsWith('8.2F-A'), `${report.id}: plan version`);
  check(plan.source.reportId === report.id, `${report.id}: report id`);
  check(plan.source.seed === report.seed, `${report.id}: seed`);
  check(plan.source.terrainId === undefined, `${report.id}: no fabricated terrain authority field`);
  check(plan.source.result === report.result, `${report.id}: result`);
  check(plan.intent.missionId === report.missionId, `${report.id}: mission intent`);
  check(plan.intent.strategy.id === report.strategyId, `${report.id}: strategy intent`);
  check(plan.forces.friendly.length === report.initial.friendly.length, `${report.id}: friendly count`);
  check(plan.forces.enemy.length === report.initial.enemy.length, `${report.id}: enemy count`);
  check(plan.assignments.length === plan.forces.profile.totalCount, `${report.id}: all actors assigned`);
  check(new Set(plan.assignments.map((row) => row.actorId)).size === plan.assignments.length, `${report.id}: assignment ids unique`);
  check(plan.layout.nodes.length === plan.assignments.length, `${report.id}: all actors laid out`);
  check(plan.layout.routes.length === plan.assignments.length, `${report.id}: all actors routed`);
  check(plan.timeline.anchors.length === report.events.length, `${report.id}: anchor count`);
  check(plan.timeline.actions.filter((row) => row.authority).length === report.events.length, `${report.id}: authority actions`);
  check(plan.timeline.duration <= report.duration, `${report.id}: presentation within source duration`);
  check(plan.timeline.anchors.at(-1).type === 'result', `${report.id}: result anchor last`);
  check(plan.timeline.anchors.at(-1).t === plan.timeline.duration, `${report.id}: result at end`);
  check(plan.timeline.anchors.every((row, index, rows) => index === 0 || row.t >= rows[index - 1].t), `${report.id}: monotonic time`);
  check(plan.validation.errors.length === 0, `${report.id}: no validation errors`);
  check(JSON.stringify(report) === before, `${report.id}: source unchanged`);
  check(buildUniversalPlan(buildPresentationContract(report)).ok, `${report.id}: contract input accepted`);
}

const reference = buildUniversalPlan(reports[0]);
const stable = buildUniversalPlan(reports[0]);
check(JSON.stringify(reference) === JSON.stringify(stable), 'deterministic plan serialization');
check(reference.quality.level === 'full', 'known axes use full quality');
check(reference.scene.grammarVersion === 'universal-scene-1', 'scene grammar version');
check(reference.layout.metrics.sameSideOverlaps === 0, 'same-side layout has no overlaps');
check(reference.authority.expectedEventCount === reports[0].events.length, 'authority expected event count');
check(reference.authority.expectedAnchorCount === reports[0].events.length, 'authority expected anchor count');
check(reference.outcome.finalState.friendlyAliveIds.length > 0, 'victory final state has friendly survivor');
check(reference.outcome.capture === true, 'campaign victory capture preserved');

for (const report of reports) {
  const safe = buildUniversalPlanSafely(report);
  check(safe.ok === true, `${report.id}: safe builder`);
  check(Array.isArray(safe.validation.warnings), `${report.id}: warnings array`);
}

console.log(`universal-presentation-planner-test: ${checks} checks passed`);

