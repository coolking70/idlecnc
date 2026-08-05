import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPresentationContract } from '../report-adapter/presentation-contract.js';
import { stableStringify } from '../report-adapter/report-normalizer.js';
import { formalBoundaryHash, hashFile, hashJson } from '../report-adapter/fixture-integrity.js';
import { buildPresentationPlan } from '../contract-demo/contract-plan-builder.js';
import { buildContractCaptureState, buildContractTextState } from '../contract-demo/contract-capture-tools.js';
import { positionAtSlot } from '../contract-demo/contract-movement-director.js';
import { buildAuthorityEffects } from '../contract-demo/authority-effect-director.js';
import { buildProjectileGeometry, validateProjectileGeometry, MAX_SEGMENT_LENGTH } from '../contract-demo/projectile-geometry.js';
import { getRepairChoreographyAtTime, validateRepairChoreography } from '../contract-demo/repair-choreography.js';
import { boundsIntersect, distanceBetween, getVisualBounds } from '../contract-demo/visual-bounds.js';
import { isTemporaryPresentationStatus } from '../contract-demo/presentation-status-resolver.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const demo = path.join(root, 'experiments/battle-sandbox/contract-demo');
const fixturePath = path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures/campaign-victory.json');
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const contract = buildPresentationContract(fixture.report);
const plan = buildPresentationPlan(contract);
const manifest = JSON.parse(fs.readFileSync(path.join(demo, 'screenshots/capture-manifest.json'), 'utf8'));
const fixtureBefore = stableStringify(fixture.report);
const actors = Object.fromEntries(plan.actors.map((actor) => [actor.id, actor]));
const repairAnchors = plan.anchors.filter((anchor) => anchor.type === 'repair');
const leadDestroyAnchor = plan.anchors.find((anchor) => anchor.type === 'destroy' && anchor.targetId === 'unit_fixture-u-4');
const actor = (id) => actors[id];
const stateAt = (time) => buildContractCaptureState(plan, contract, time);
const textAt = (time) => buildContractTextState(plan, contract, stateAt(time));
let total = 0;
let passed = 0;
function check(name, fn) { total += 1; try { fn(); passed += 1; } catch (error) { console.error(`FAIL ${name}: ${error.message}`); throw error; } }

check('1. campaign-victory Fixture is selected', () => assert.equal(fixture.scenario.id, 'campaign-victory'));
check('2. source report hash remains stable', () => assert.equal(hashJson(fixture.report), '2a141200b5a4768ce601ae54dbf2c005f347887002ad4b9e7057e7648adc2a81'));
check('3. source report is not mutated', () => assert.equal(stableStringify(fixture.report), fixtureBefore));
check('4. contract validation is true', () => assert.equal(contract.validation.ok, true));
check('5. contract support diagnostics are true', () => assert.equal(contract.diagnostics.supported, true));
check('6. plan validation is true', () => assert.equal(plan.validation.ok, true));
check('7. plan serializes without throwing', () => assert.doesNotThrow(() => JSON.stringify(plan)));
check('8. plan is deterministic on a cloned report', () => assert.equal(JSON.stringify(plan), JSON.stringify(buildPresentationPlan(buildPresentationContract(structuredClone(fixture.report))))));
check('9. exactly twelve actors are present', () => assert.equal(plan.actors.length, 12));
check('10. exactly six friendly actors are present', () => assert.equal(plan.actors.filter((item) => item.side === 'friendly').length, 6));
check('11. exactly six enemy actors are present', () => assert.equal(plan.actors.filter((item) => item.side === 'enemy').length, 6));
check('12. no enemy armor actor is synthesized', () => assert.equal(plan.actors.some((item) => ['enemy_mbt', 'enemy_light_armor'].includes(item.type)), false));
check('13. no extra ordinary infantry actor is synthesized', () => assert.equal(plan.actors.filter((item) => item.side === 'friendly' && item.type === 'infantry').length, 1));
check('14. the repair vehicle is a real actor', () => assert.equal(actor('unit_fixture-u-6').sourceActorId, 'unit_fixture-u-6'));
check('15. the lead tank is a real actor', () => assert.equal(actor('unit_fixture-u-4').sourceActorId, 'unit_fixture-u-4'));
check('16. exactly five repair anchors exist', () => assert.equal(repairAnchors.length, 5));
check('17. exactly two repair groups exist', () => assert.equal(plan.repairGroups.length, 2));
check('18. all repair anchors are grouped once', () => assert.equal(plan.repairGroups.flatMap((group) => group.anchors).length, repairAnchors.length));
check('19. first group targets the lead tank', () => assert.equal(plan.repairGroups[0].targetId, 'unit_fixture-u-4'));
check('20. second group targets the support tank', () => assert.equal(plan.repairGroups[1].targetId, 'unit_fixture-u-5'));
check('21. first repair approach begins near 12.8 seconds', () => assert.ok(Math.abs(plan.repairGroups[0].approachStart - 12.797445) < 1e-6));
check('22. first repair work begins near 13.45 seconds', () => assert.ok(Math.abs(plan.repairGroups[0].workingStart - 13.447445) < 1e-6));
check('23. first repair work retracts near 20.05 seconds', () => assert.ok(Math.abs(plan.repairGroups[0].retractStart - 20.048322) < 1e-6));
check('24. second repair approach begins near 27.2 seconds', () => assert.ok(Math.abs(plan.repairGroups[1].approachStart - 27.199851) < 1e-6));
check('25. second repair work begins near 27.85 seconds', () => assert.ok(Math.abs(plan.repairGroups[1].workingStart - 27.849851) < 1e-6));
check('26. second repair work retracts near 33.65 seconds', () => assert.ok(Math.abs(plan.repairGroups[1].retractStart - 33.651304) < 1e-6));
check('27. repair choreography validator passes', () => assert.deepEqual(validateRepairChoreography({ groups: plan.repairGroups }, plan), { ok: true, errors: [] }));

for (const [index, anchor] of repairAnchors.entries()) {
  const sample = getRepairChoreographyAtTime(plan, anchor.presentationTime);
  const repair = actor(anchor.actorId);
  const target = actor(anchor.targetId);
  check(`${28 + index}. repair ${index + 1} is active at its anchor`, () => assert.equal(sample.active, true));
  check(`${33 + index}. repair ${index + 1} has a valid work distance`, () => assert.ok(sample.distance >= 55 && sample.distance <= 82));
  const targetPosition = positionAtSlot(target.templateSlot, anchor.presentationTime);
  check(`${38 + index}. repair ${index + 1} vehicle does not intersect target`, () => assert.equal(boundsIntersect(getVisualBounds(repair, sample.repairPosition), getVisualBounds(target, targetPosition)), false));
  check(`${43 + index}. repair ${index + 1} arm reaches contact`, () => assert.ok(distanceBetween(sample.armEndpoint, sample.contactPoint) <= 6));
  check(`${48 + index}. repair ${index + 1} sparks stay at contact`, () => assert.ok(distanceBetween(sample.sparkPoint, sample.contactPoint) <= 8));
}

check('53. choreography is smooth at one-frame resolution', () => {
  for (let time = 0; time < 35; time += 1 / 60) {
    const current = getRepairChoreographyAtTime(plan, time);
    const next = getRepairChoreographyAtTime(plan, time + 1 / 60);
    if (current.repairPosition && next.repairPosition) assert.ok(distanceBetween(current.repairPosition, next.repairPosition) <= 35);
  }
});
check('54. repair is deploying at the first approach window', () => assert.equal(getRepairChoreographyAtTime(plan, 12.9).state, 'deploying'));
check('55. repair is working at the first contact', () => assert.equal(getRepairChoreographyAtTime(plan, 13.867445).state, 'working'));
check('56. first repair target is the lead tank', () => assert.equal(getRepairChoreographyAtTime(plan, 13.867445).targetId, 'unit_fixture-u-4'));
check('57. repair has left the lead tank by 24.1 seconds', () => assert.equal(getRepairChoreographyAtTime(plan, 24.1).active, false));
check('58. repair is working on support at 28.2 seconds', () => assert.equal(getRepairChoreographyAtTime(plan, 28.199851).targetId, 'unit_fixture-u-5'));
check('59. repair is working on support at 32.99 seconds', () => assert.equal(getRepairChoreographyAtTime(plan, 32.991304).state, 'working'));
check('60. repair is stowed at 35 seconds', () => assert.equal(getRepairChoreographyAtTime(plan, 35).state, 'stowed'));

const statusChecks = [
  ['unit_fixture-u-1', 'holding_objective'], ['unit_fixture-u-2', 'holding_objective'], ['unit_fixture-u-3', 'scanning'],
  ['unit_fixture-u-4', 'destroyed'], ['unit_fixture-u-5', 'overwatch'], ['unit_fixture-u-6', 'damaged_support_holding']
];
const finalState = stateAt(35);
for (const [index, [id, expected]] of statusChecks.entries()) {
  check(`${61 + index}. final status ${id} is ${expected}`, () => assert.equal(finalState.actors.find((item) => item.id === id).visualStatus, expected));
}
check('67. no temporary presentation status remains at 35 seconds', () => finalState.actors.forEach((item) => assert.equal(isTemporaryPresentationStatus(item.visualStatus), false)));
check('68. lead tank is destroyed at 24.1 seconds', () => assert.equal(stateAt(24.1).authority.actors['unit_fixture-u-4'].alive, false));
check('69. lead tank is alive before its destroy anchor', () => assert.equal(stateAt(leadDestroyAnchor.presentationTime - 0.01).authority.actors['unit_fixture-u-4'].alive, true));
for (const [index, anchor] of repairAnchors.entries()) {
  check(`${70 + index}. repair anchor ${index + 1} adds exactly six HP`, () => {
    const before = stateAt(anchor.presentationTime - 1e-5).authority.actors[anchor.targetId].hp;
    const after = stateAt(anchor.presentationTime).authority.actors[anchor.targetId].hp;
    assert.equal(after, Math.min(stateAt(anchor.presentationTime).authority.actors[anchor.targetId].maxHp, before + 6));
  });
}
check('73. final authority result is victory', () => assert.equal(finalState.authority.result, 'victory'));
check('74. final objective is captured', () => assert.equal(buildContractTextState(plan, contract, finalState).objective.status, 'captured'));
check('75. exactly one friendly tank wreck remains', () => assert.deepEqual(finalState.wrecks.map((wreck) => wreck.sourceActorId), ['unit_fixture-u-4']));

const fireAnchors = plan.anchors.filter((anchor) => anchor.type === 'fire');
for (const [index, anchor] of fireAnchors.entries()) {
  const time = anchor.presentationTime + (anchor.weaponKind === 'rocket' ? .3 : .1);
  const effects = buildAuthorityEffects(plan, time);
  const projectile = effects.find((effect) => effect.anchorId === anchor.id && effect.start && effect.end);
  check(`${76 + index}. projectile ${anchor.id} has short geometry`, () => {
    assert.ok(projectile);
    const geometry = buildProjectileGeometry(projectile, time);
    assert.equal(validateProjectileGeometry(geometry).ok, true);
    assert.ok(geometry.length <= MAX_SEGMENT_LENGTH + 1e-6);
  });
}
check(`${76 + fireAnchors.length}. projectile segment table is capped at forty pixels`, () => fireAnchors.forEach((anchor) => assert.ok((anchor.weaponKind === 'rifle' ? 22 : anchor.weaponKind === 'light_tracer' ? 28 : anchor.weaponKind === 'coax' ? 34 : anchor.weaponKind === 'cannon' ? 28 : 22) <= 40)));
check(`${77 + fireAnchors.length}. renderer contains no full source-target stroke`, () => {
  const renderer = fs.readFileSync(path.join(demo, 'contract-renderer.js'), 'utf8');
  assert.equal(renderer.includes('lineTo(effect.end.x, effect.end.y)'), false);
  assert.equal(renderer.includes('source → target'), false);
});
check(`${78 + fireAnchors.length}. renderer contains no time-hardcoded repair arm window`, () => assert.equal(fs.readFileSync(path.join(demo, 'contract-renderer.js'), 'utf8').includes('time >= 12 && time < 34'), false));
check(`${79 + fireAnchors.length}. authority state has no visual status mutation`, () => assert.equal(fs.readFileSync(path.join(demo, 'authority-state.js'), 'utf8').includes('visualStatus'), false));
check(`${80 + fireAnchors.length}. projectile geometry has no random clock dependency`, () => { const source = fs.readFileSync(path.join(demo, 'projectile-geometry.js'), 'utf8'); assert.equal(/Math\.random|Date\.now/.test(source), false); });

const expectedScreenshots = ['01-contract-roster-0s.png', '02-real-ambush-5s.png', '03-repair-vehicle-under-fire-9s.png', '04-first-enemy-destroyed-12s.png', '05-lead-tank-repair-15s.png', '06-lead-tank-destroyed-24s.png', '07-at-retaliation-25-5s.png', '08-support-tank-repair-29s.png', '09-last-enemy-destroyed-32s.png', '10-authoritative-victory-35s.png', '11-short-projectile-8s.png', '12-lead-tank-repair-contact-13-9s.png', '13-lead-tank-second-repair-19-4s.png', '14-support-tank-repair-contact-28-2s.png', '15-final-status-clean-35s.png'];
check('81. screenshot manifest has fifteen captures', () => assert.equal(manifest.captures.length, 15));
check('82. screenshot manifest names are complete', () => assert.deepEqual(manifest.captures.map((capture) => capture.file), expectedScreenshots));
check('83. all screenshot files exist', () => expectedScreenshots.forEach((file) => assert.equal(fs.existsSync(path.join(demo, 'screenshots', file)), true)));
check('84. all fifteen main screenshot SHA values are unique', () => assert.equal(new Set(manifest.captures.map((capture) => capture.pngSha256)).size, 15));
check('85. overview and final-focus 35-second captures differ', () => { assert.equal(manifest.captures[9].actualTime, 35); assert.equal(manifest.captures[14].actualTime, 35); assert.notEqual(manifest.captures[9].viewMode, manifest.captures[14].viewMode); assert.notEqual(manifest.captures[9].pngSha256, manifest.captures[14].pngSha256); });
check('86. screenshot SHA values match files', () => manifest.captures.forEach((capture) => assert.equal(hashFile(path.join(demo, 'screenshots', capture.file)), capture.pngSha256)));
check('87. new exact-time captures have zero time error', () => manifest.captures.slice(10).forEach((capture) => assert.equal(capture.actualTime, capture.requestedTime)));
check('88. contract demo entry point exists', () => assert.equal(fs.existsSync(path.join(demo, 'index.html')), true));
check('89. parameterized report load chain remains in entry script', () => { const source = fs.readFileSync(path.join(demo, 'contract-demo.js'), 'utf8'); assert.ok(source.includes('sourceIdFromSearch')); assert.ok(source.includes('buildVictoryPresentationPlan')); assert.ok(source.includes('const contract = buildPresentationContract(fixture.report);')); });
check('90. formal boundary hash remains at A.3 baseline', () => assert.equal(formalBoundaryHash(root), '2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab'));
check('91. final capture text is self-consistent', () => { const text = textAt(35); assert.equal(text.result, 'victory'); assert.equal(text.requiredAnchors.applied, 71); assert.equal(text.errors.length, 0); });
check('92. no browser-error marker is recorded', () => assert.deepEqual(manifest.browserErrors, []));

console.log(`contract-demo-visual-integrity-test: ${passed} passed / ${total} total`);
