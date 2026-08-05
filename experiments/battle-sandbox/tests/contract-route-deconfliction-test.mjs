import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPresentationContract } from '../report-adapter/presentation-contract.js';
import { buildVictoryPresentationPlan } from '../contract-demo/contract-plan-builder.js';
import { buildContractCaptureState } from '../contract-demo/contract-capture-tools.js';
import { findVisualIntersectionsAtTime, getVisibleLogicalActorsAtTime } from '../contract-demo/continuous-layout-validator.js';
import { boundsIntersect, distanceBetween, getVisualBounds } from '../contract-demo/visual-bounds.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const demo = path.resolve(here, '..', 'contract-demo');
const ids = ['scenario-d', 'scenario-e', 'scenario-f'];
const keyTimes = [0, 7, 13, 21, 26, 32, 35];
const built = Object.fromEntries(ids.map((id) => {
  const payload = JSON.parse(fs.readFileSync(path.join(demo, 'scenarios', `${id}.json`), 'utf8'));
  const contract = buildPresentationContract(payload.report);
  return [id, { payload, contract, plan: buildVictoryPresentationPlan(contract, { sourceId: id, sourceKind: payload.sourceKind, rebuildHash: payload.rebuildHash }) }];
}));

let total = 0; let passed = 0;
function check(name, fn) { total += 1; try { fn(); passed += 1; } catch (error) { console.error(`FAIL ${name}: ${error.message}`); throw error; } }
function visiblePair(plan, contract, time, slotA, slotB) {
  const actors = getVisibleLogicalActorsAtTime(plan, contract, time);
  const first = actors.find((actor) => actor.templateSlot === slotA); const second = actors.find((actor) => actor.templateSlot === slotB);
  if (!first || !second) return { visible: false, intersect: false, distance: null };
  return { visible: true, intersect: boundsIntersect(first.bounds, second.bounds), distance: distanceBetween(first.position, second.position) };
}
function noIntersect(plan, contract, time, slotA, slotB) { const result = visiblePair(plan, contract, time, slotA, slotB); assert.equal(result.intersect, false, `${slotA}/${slotB}@${time}`); return result; }

check('1. all B.2.2 plans validate', () => ids.forEach((id) => assert.equal(built[id].plan.ok, true)));
check('2. deconfliction reduces fixed-route key collisions', () => ids.forEach((id) => assert.ok(built[id].plan.routeDeconfliction.before.sameSideIntersections >= built[id].plan.routeDeconfliction.after.sameSideIntersections)));
check('3. plan owns a deconflicted route registry', () => ids.forEach((id) => assert.ok(built[id].plan.routeRegistry && built[id].plan.routeDeconfliction.validation.ok)));
check('4. D south infantry/AT bounds are separate at 7s', () => noIntersect(built['scenario-d'].plan, built['scenario-d'].contract, 7, 'friendly_south_infantry_assault', 'friendly_south_at_assault'));
check('5. D south infantry/AT bounds are separate at 13s', () => noIntersect(built['scenario-d'].plan, built['scenario-d'].contract, 13, 'friendly_south_infantry_assault', 'friendly_south_at_assault'));
check('6. D south infantry/AT bounds are separate at 21s', () => noIntersect(built['scenario-d'].plan, built['scenario-d'].contract, 21, 'friendly_south_infantry_assault', 'friendly_south_at_assault'));
check('7. D south infantry/AT bounds are separate at 26s', () => noIntersect(built['scenario-d'].plan, built['scenario-d'].contract, 26, 'friendly_south_infantry_assault', 'friendly_south_at_assault'));
check('8. D south infantry/AT bounds are separate at 32s', () => noIntersect(built['scenario-d'].plan, built['scenario-d'].contract, 32, 'friendly_south_infantry_assault', 'friendly_south_at_assault'));
check('9. D south infantry/AT bounds are separate at 35s', () => noIntersect(built['scenario-d'].plan, built['scenario-d'].contract, 35, 'friendly_south_infantry_assault', 'friendly_south_at_assault'));
check('10. D south infantry/AT centers remain at least 40px apart', () => keyTimes.forEach((time) => assert.ok(visiblePair(built['scenario-d'].plan, built['scenario-d'].contract, time, 'friendly_south_infantry_assault', 'friendly_south_at_assault').distance >= 40)));
check('11. E reserve/repair bounds are separate at all key times', () => keyTimes.forEach((time) => noIntersect(built['scenario-e'].plan, built['scenario-e'].contract, time, 'friendly_reserve_1', 'friendly_repair_rear')));
check('12. E reserve/north infantry bounds are separate', () => keyTimes.forEach((time) => noIntersect(built['scenario-e'].plan, built['scenario-e'].contract, time, 'friendly_reserve_1', 'friendly_north_assault')));
check('13. E reserve/south infantry bounds are separate', () => keyTimes.forEach((time) => noIntersect(built['scenario-e'].plan, built['scenario-e'].contract, time, 'friendly_reserve_1', 'friendly_south_infantry_assault')));
check('14. E reserve/AT bounds are separate', () => keyTimes.forEach((time) => noIntersect(built['scenario-e'].plan, built['scenario-e'].contract, time, 'friendly_reserve_1', 'friendly_south_at_assault')));
check('15. E reserve/vehicles bounds are separate', () => keyTimes.forEach((time) => { noIntersect(built['scenario-e'].plan, built['scenario-e'].contract, time, 'friendly_reserve_1', 'friendly_lead_tank'); noIntersect(built['scenario-e'].plan, built['scenario-e'].contract, time, 'friendly_reserve_1', 'friendly_support_tank'); }));
check('16. enemy north infantry/AT bounds are separate', () => keyTimes.forEach((time) => noIntersect(built['scenario-d'].plan, built['scenario-d'].contract, time, 'enemy_north_cover', 'enemy_north_at_nest')));
check('17. enemy south infantry/AT bounds are separate', () => keyTimes.forEach((time) => noIntersect(built['scenario-d'].plan, built['scenario-d'].contract, time, 'enemy_south_cover', 'enemy_south_at_nest')));
check('18. enemy reserve/fixed defense bounds are separate', () => keyTimes.forEach((time) => { noIntersect(built['scenario-d'].plan, built['scenario-d'].contract, time, 'enemy_rear_reserve', 'enemy_north_cover'); noIntersect(built['scenario-d'].plan, built['scenario-d'].contract, time, 'enemy_rear_reserve', 'enemy_center_checkpoint'); }));
check('19. D continuous layout samples 701 times', () => assert.equal(built['scenario-d'].plan.continuousLayout.sampleCount, 701));
check('20. D continuous same-side layout is clean', () => assert.equal(built['scenario-d'].plan.continuousLayout.ok, true));
check('21. E continuous same-side layout is clean', () => assert.equal(built['scenario-e'].plan.continuousLayout.ok, true));
check('22. F continuous same-side layout is clean', () => assert.equal(built['scenario-f'].plan.continuousLayout.ok, true));
check('23. cross-side intersections stay below the 0.20s allowance', () => ids.forEach((id) => built[id].plan.continuousLayout.acceptedCrossSideIntersections.forEach((item) => assert.ok(item.durationEstimate <= 0.20 + 1e-9))));
check('24. no sampled actor/building intersection exists', () => ids.forEach((id) => assert.equal(built[id].plan.continuousLayout.intersections.some((item) => item.kind === 'actor_building'), false)));
check('25. no sampled actor/flag intersection exists', () => ids.forEach((id) => assert.equal(built[id].plan.continuousLayout.intersections.some((item) => item.kind === 'actor_objective_flag'), false)));
check('26. no sampled actor/wreck intersection exists', () => ids.forEach((id) => assert.equal(built[id].plan.continuousLayout.intersections.some((item) => item.kind === 'actor_wreck'), false)));
check('27. route adjustment does not rewrite anchor identities', () => ids.forEach((id) => built[id].plan.anchors.forEach((anchor) => { const source = built[id].contract.authorityAnchors[anchor.sourceIndex]; assert.deepEqual({ actorId: anchor.actorId, targetId: anchor.targetId, value: anchor.value }, { actorId: source.actorId, targetId: source.targetId, value: source.value }); })));
check('28. route adjustment does not change HP', () => ids.forEach((id) => { const state = buildContractCaptureState(built[id].plan, built[id].contract, 35); for (const actor of Object.values(state.authority.actors)) assert.equal(actor.hp, built[id].contract.normalizedBattle.actors[actor.side].find((row) => row.id === actor.sourceActorId).final.hp); }));
check('29. route adjustment does not change final alive state', () => ids.forEach((id) => assert.equal(buildContractCaptureState(built[id].plan, built[id].contract, 35).finalCompare.ok, true)));
check('30. route adjustment preserves victory result', () => ids.forEach((id) => { const state = buildContractCaptureState(built[id].plan, built[id].contract, 35); assert.equal(state.authority.result, 'victory'); assert.equal(state.authority.capture, true); }));
check('31. required anchors are applied exactly once', () => ids.forEach((id) => { const { plan, contract } = built[id]; const state = buildContractCaptureState(plan, contract, 35); assert.equal(state.authority.appliedAnchorIds.filter((anchorId) => plan.requiredAnchors.some((anchor) => anchor.id === anchorId)).length, plan.requiredAnchors.length); }));
check('32. every final actor bounds pair is clean on its own side', () => ids.forEach((id) => { const state = buildContractCaptureState(built[id].plan, built[id].contract, 35); const actors = state.actors.filter((actor) => actor.alive); for (let i = 0; i < actors.length; i += 1) for (let j = i + 1; j < actors.length; j += 1) if (actors[i].side === actors[j].side) assert.equal(boundsIntersect(getVisualBounds(actors[i], actors[i].visualCenter), getVisualBounds(actors[j], actors[j].visualCenter)), false); }));

console.log(`contract-route-deconfliction-test: ${passed} passed / ${total} total`);
