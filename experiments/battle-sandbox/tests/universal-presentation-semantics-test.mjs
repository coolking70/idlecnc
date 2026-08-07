import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-builder.js';
import { analyzeUniversalContact } from '../../../js/battle-presentation/universal/universal-contact-analyzer.js';
import { inputFor } from '../universal-planner/scenario-corpus-generator.mjs';
import { simulateBattle } from '../../../js/battle.js';

const root = new URL('../universal-planner/scenarios/', import.meta.url);
const canonical = JSON.parse(fs.readFileSync(new URL('canonical.json', root), 'utf8'));
const fuzzSpecs = JSON.parse(fs.readFileSync(new URL('fuzz-specs.json', root), 'utf8')); const rows = [...canonical, ...fuzzSpecs.map((spec) => ({ ...spec, report: simulateBattle(inputFor(spec.index, spec.missionId, spec.strategyId, spec.unitTypes, { kind: 'fuzz', seed: spec.seed, initialRatios: spec.initialRatios, experiences: spec.experiences })) }))];
const samples = [canonical[0], canonical.find((row) => row.missionId === 'convoy_escort'), canonical.find((row) => row.missionId === 'salvage_run'), canonical.find((row) => row.missionId === 'outpost_sweep'), canonical.find((row) => row.result === 'wiped'), canonical.find((row) => row.eventTypes.includes('repair'))].filter(Boolean);
let checks = 0;
const plans = samples.map((row) => buildUniversalPlan(row.report));
for (const plan of plans) {
  assert.equal(plan.ok, true, `${plan.source.reportId}: valid`); assert.ok(Array.isArray(plan.forces.friendly[0]?.tags), 'force tags are arrays');
  for (const key of ['occurred', 'ambushed', 'enemyRevealed', 'revealHighThreat', 'firstStrike', 'firstContactTime', 'firstFireTime', 'firstDamageTime', 'friendlyOpenedFire', 'enemyOpenedFire']) assert.ok(Object.hasOwn(plan.intent.contact, key), `contact key: ${key}`);
  assert.deepEqual(plan.contact, analyzeUniversalContact(plan), 'contact analyzer integrated');
  assert.equal(plan.authority.finalState.actors && Object.keys(plan.authority.finalState.actors).length, plan.forces.profile.totalCount, 'authority final actors');
  assert.equal(plan.outcome.finalState.friendlyAliveIds.length + plan.outcome.finalState.friendlyDestroyedIds.length, plan.forces.profile.friendlyCount, 'friendly final ids');
  assert.equal(plan.outcome.finalState.enemyAliveIds.length + plan.outcome.finalState.enemyDestroyedIds.length, plan.forces.profile.enemyCount, 'enemy final ids');
  assert.equal(plan.authority.expectedRequiredCount, plan.timeline.anchors.filter((anchor) => anchor.required).length, 'required authority count');
  for (const action of plan.timeline.actions.filter((item) => item.type === 'escort_convoy')) assert.equal(action.authority, false, 'convoy action non-authority');
  for (const repair of plan.timeline.repairs) { assert.ok(repair.anchorIds.length); assert.ok(Number.isFinite(repair.workPosition.x)); assert.ok(Number.isFinite(repair.workPosition.y)); }
  checks += 10;
}
const terrainHashes = new Set(canonical.filter((row, index, all) => all.findIndex((candidate) => candidate.terrain === row.terrain) === index).map((row) => buildUniversalPlan(row.report).layout.geometryHash));
assert.equal(terrainHashes.size, 3, 'all terrain geometries differ'); checks += 1;
assert.ok(rows.some((row) => row.result === 'withdraw' && buildUniversalPlan(row.report).layout.routes.some((route) => route.retreat && route.finalTarget.x < 100)), 'withdraw routes use safe edge'); checks += 1;
assert.ok(rows.some((row) => row.result === 'wiped' && buildUniversalPlan(row.report).outcome.finalState.friendlyAliveIds.length === 0), 'wiped final state is empty'); checks += 1;
console.log(`universal-presentation-semantics-test: ${checks} checks passed`);
