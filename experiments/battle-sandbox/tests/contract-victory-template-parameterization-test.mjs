import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPresentationContract } from '../report-adapter/presentation-contract.js';
import { formalBoundaryHash, hashFile } from '../report-adapter/fixture-integrity.js';
import { buildVictoryPresentationPlan, validateContractDrivenPlan } from '../contract-demo/contract-plan-builder.js';
import { buildContractCaptureState, buildContractTextState } from '../contract-demo/contract-capture-tools.js';
import { buildAuthorityEffects } from '../contract-demo/authority-effect-director.js';
import { buildProjectileGeometry, validateProjectileGeometry, MAX_SEGMENT_LENGTH } from '../contract-demo/projectile-geometry.js';
import { getFinalRoleStatus, isTemporaryPresentationStatus } from '../contract-demo/role-presentation-policy.js';
import { getRepairChoreographyAtTime, buildRepairGroups } from '../contract-demo/repair-choreography.js';
import { validateSemanticTimeMap, mapSourceToPresentation } from '../contract-demo/semantic-time-mapper.js';
import { validateVictoryTemplateContract } from '../contract-demo/victory-template-validator.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const demo = path.join(root, 'experiments/battle-sandbox/contract-demo');
const adapter = path.join(root, 'experiments/battle-sandbox/report-adapter');
const sourceFiles = {
  fixture: path.join(adapter, 'fixtures/campaign-victory.json'),
  'scenario-b': path.join(demo, 'scenarios/scenario-b.json'),
  'scenario-c': path.join(demo, 'scenarios/scenario-c.json')
};
const sources = Object.entries(sourceFiles).map(([sourceId, file]) => ({ sourceId, file, payload: JSON.parse(fs.readFileSync(file, 'utf8')) }));
const built = sources.map(({ sourceId, payload }) => { const contract = buildPresentationContract(payload.report); const plan = buildVictoryPresentationPlan(contract, { sourceId }); return { sourceId, payload, contract, plan }; });
const fixturePlan = built[0].plan;
let total = 0; let passed = 0;
function check(name, fn) { total += 1; try { fn(); passed += 1; } catch (error) { console.error(`FAIL ${name}: ${error.message}`); throw error; } }

check('1. three source payloads exist', () => built.forEach(({ payload }) => assert.ok(payload.report)));
check('2. all three contracts validate', () => built.forEach(({ contract }) => assert.equal(contract.validation.ok, true)));
check('3. all three contracts are supported', () => built.forEach(({ contract }) => assert.equal(contract.diagnostics.supported, true)));
check('4. all three reports are victory results', () => built.forEach(({ contract }) => assert.equal(contract.normalizedBattle.battle.result, 'victory')));
check('5. all three plans validate', () => built.forEach(({ plan }) => assert.equal(plan.validation.ok, true)));
check('6. all three plans pass public validation', () => built.forEach(({ plan, contract }) => assert.equal(validateContractDrivenPlan(plan, contract).ok, true)));
check('7. source seeds are distinct', () => assert.equal(new Set(built.map(({ contract }) => contract.normalizedBattle.battle.seed)).size, 3));
check('8. report IDs are distinct', () => assert.equal(new Set(built.map(({ contract }) => contract.normalizedBattle.battle.id)).size, 3));
check('9. scenario C actor IDs differ from the official Fixture', () => { const a = new Set(built[0].plan.actors.map((actor) => actor.sourceActorId)); const c = new Set(built[2].plan.actors.map((actor) => actor.sourceActorId)); assert.equal([...c].some((id) => a.has(id)), false); });
check('10. event statistics are not fixed across reports', () => assert.ok(new Set(built.map(({ plan }) => plan.counts.anchors)).size > 1));
check('11. repair statistics vary across reports', () => assert.ok(new Set(built.map(({ plan }) => plan.counts.repair)).size > 1));
check('12. final HP statistics vary across reports', () => assert.ok(new Set(built.map(({ plan }) => JSON.stringify(Object.values(plan.finalAuthority.actors).map((actor) => actor.hp)))).size > 1));

for (const { sourceId, contract, plan } of built) {
  check(`${sourceId} 13. dynamic all-anchor count matches contract`, () => assert.equal(plan.counts.anchors, contract.authorityAnchors.length));
  check(`${sourceId} 14. dynamic required count matches contract`, () => assert.equal(plan.counts.requiredAnchors, contract.authorityAnchors.filter((anchor) => anchor.required).length));
  check(`${sourceId} 15. dynamic count is not required to equal 120`, () => assert.equal(plan.counts.anchors === 120, sourceId === 'fixture'));
  check(`${sourceId} 16. dynamic count is not required to equal 71`, () => assert.equal(plan.counts.requiredAnchors === 71, sourceId === 'fixture'));
  check(`${sourceId} 17. all source event IDs are unique`, () => assert.equal(new Set(plan.anchors.map((anchor) => anchor.sourceEventId)).size, plan.anchors.length));
  check(`${sourceId} 18. actor IDs are preserved`, () => plan.anchors.forEach((anchor) => assert.equal(anchor.actorId, contract.authorityAnchors[anchor.sourceIndex].actorId)));
  check(`${sourceId} 19. target IDs are preserved`, () => plan.anchors.forEach((anchor) => assert.equal(anchor.targetId, contract.authorityAnchors[anchor.sourceIndex].targetId)));
  check(`${sourceId} 20. values are preserved`, () => plan.anchors.forEach((anchor) => assert.equal(anchor.value, contract.authorityAnchors[anchor.sourceIndex].value)));
  check(`${sourceId} 21. all required anchors are applied exactly once at 35`, () => { const state = buildContractCaptureState(plan, contract, 35); assert.equal(state.authority.appliedAnchorIds.filter((id) => plan.requiredAnchors.some((anchor) => anchor.id === id)).length, plan.requiredAnchors.length); });
  check(`${sourceId} 22. final authority matches the report`, () => assert.equal(buildContractCaptureState(plan, contract, 35).finalCompare.ok, true));
  check(`${sourceId} 23. result maps to 35`, () => assert.equal(plan.timeMap.knots.at(-1).presentation, 35));
  check(`${sourceId} 24. semantic time map validates`, () => assert.equal(validateSemanticTimeMap(plan.timeMap, contract).ok, true));
  check(`${sourceId} 25. semantic mapping is monotonic`, () => { let previous = -Infinity; for (const anchor of plan.anchors) { const mapped = anchor.presentationTime; assert.ok(mapped >= previous); previous = mapped; } });
  check(`${sourceId} 26. result anchor is at presentation 35`, () => assert.equal(plan.anchors.find((anchor) => anchor.type === 'result').presentationTime, 35));
  check(`${sourceId} 27. last enemy destroy is no later than 32.5`, () => assert.ok(Math.max(...plan.anchors.filter((anchor) => anchor.type === 'destroy' && plan.actorById[anchor.targetId]?.side === 'enemy').map((anchor) => anchor.presentationTime)) <= 32.5));
  check(`${sourceId} 28. destroy order is preserved`, () => { const source = contract.authorityAnchors.filter((anchor) => anchor.type === 'destroy').map((anchor) => anchor.targetId); const presentation = plan.anchors.filter((anchor) => anchor.type === 'destroy').sort((a, b) => a.presentationTime - b.presentationTime || a.sourceIndex - b.sourceIndex).map((anchor) => anchor.targetId); assert.deepEqual(presentation, source); });
  check(`${sourceId} 29. repair order is preserved`, () => { const source = contract.authorityAnchors.filter((anchor) => anchor.type === 'repair').map((anchor) => anchor.sourceEventId); const presentation = plan.anchors.filter((anchor) => anchor.type === 'repair').sort((a, b) => a.presentationTime - b.presentationTime || a.sourceIndex - b.sourceIndex).map((anchor) => anchor.sourceEventId); assert.deepEqual(presentation, source); });
  check(`${sourceId} 30. identical contract builds identical plan`, () => assert.equal(JSON.stringify(plan), JSON.stringify(buildVictoryPresentationPlan(buildPresentationContract(structuredClone(built.find((item) => item.sourceId === sourceId).payload.report)), { sourceId }))));
  check(`${sourceId} 31. final result is victory and captured`, () => { const state = buildContractCaptureState(plan, contract, 35); const text = buildContractTextState(plan, contract, state); assert.equal(text.result, 'victory'); assert.equal(text.capture, true); });

  const finalState = buildContractCaptureState(plan, contract, 35);
  for (const actor of plan.actors) {
    const authority = finalState.authority.actors[actor.id];
    check(`${sourceId} 32. final status uses role for ${actor.role}`, () => assert.equal(finalState.actors.find((item) => item.id === actor.id).visualStatus, getFinalRoleStatus(actor, authority, plan)));
  }
  check(`${sourceId} 33. no temporary status remains at 35`, () => finalState.actors.forEach((actor) => assert.equal(isTemporaryPresentationStatus(actor.visualStatus), false)));
  check(`${sourceId} 34. destroyed actors remain destroyed`, () => finalState.actors.filter((actor) => !actor.alive).forEach((actor) => assert.equal(actor.visualStatus, 'destroyed')));
  check(`${sourceId} 35. no enemy actor is alive at victory`, () => finalState.actors.filter((actor) => actor.side === 'enemy').forEach((actor) => assert.equal(actor.alive, false)));
  check(`${sourceId} 36. every real actor has one visual actor`, () => assert.equal(new Set(plan.actors.map((actor) => actor.sourceActorId)).size, contract.normalizedBattle.actors.friendly.length + contract.normalizedBattle.actors.enemy.length));
  check(`${sourceId} 37. no virtual actor is present`, () => plan.actors.forEach((actor) => assert.ok(contract.normalizedBattle.actors.friendly.concat(contract.normalizedBattle.actors.enemy).some((real) => real.id === actor.sourceActorId))));
  check(`${sourceId} 38. final HP follows the report`, () => plan.actors.forEach((actor) => assert.equal(finalState.authority.actors[actor.id].hp, contract.normalizedBattle.actors.friendly.concat(contract.normalizedBattle.actors.enemy).find((real) => real.id === actor.id).final.hp)));
  check(`${sourceId} 39. no repair vehicle means no active choreography`, () => { const noRepair = { ...plan, anchors: plan.anchors.filter((anchor) => anchor.type !== 'repair'), repairGroups: [] }; assert.equal(getRepairChoreographyAtTime(noRepair, 20).active, false); });
  check(`${sourceId} 40. repair groups contain exactly all repair anchors`, () => assert.equal(plan.repairGroups.flatMap((group) => group.anchors).length, plan.counts.repair));
  check(`${sourceId} 41. repair vehicle is not expanded without a repair window`, () => { const before = getRepairChoreographyAtTime(plan, 0); const after = getRepairChoreographyAtTime(plan, 35); assert.equal(before.active, false); assert.equal(after.active, false); });
  check(`${sourceId} 42. repair positions remain target-relative`, () => plan.repairGroups.forEach((group) => group.anchors.forEach((anchor) => { const choreography = getRepairChoreographyAtTime(plan, anchor.presentationTime); assert.ok(choreography.distance >= 55 && choreography.distance <= 82); })));

  const fire = plan.anchors.find((anchor) => anchor.type === 'fire');
  const effects = buildAuthorityEffects(plan, fire.presentationTime + (fire.duration || .18) * .5);
  const projectile = effects.find((effect) => effect.anchorId === fire.id);
  check(`${sourceId} 43. FIRE has a frozen launch position`, () => assert.ok(fire.launchPosition && Number.isFinite(fire.launchPosition.x)));
  check(`${sourceId} 44. FIRE has a frozen impact position`, () => assert.ok(fire.impactPosition && Number.isFinite(fire.impactPosition.x)));
  check(`${sourceId} 45. projectile endpoint is independent of current actor position`, () => { assert.ok(projectile); const moved = { ...plan, actorById: Object.fromEntries(plan.actors.map((actor) => [actor.id, { ...actor, visualCenter: { x: 1, y: 1 } }])) }; const movedEffect = buildAuthorityEffects(moved, fire.presentationTime + .05).find((effect) => effect.anchorId === fire.id); assert.deepEqual(movedEffect.start, projectile.start); assert.deepEqual(movedEffect.end, projectile.end); });
  check(`${sourceId} 46. seek returns identical projectile geometry`, () => { const a = buildAuthorityEffects(plan, fire.presentationTime + .05).find((effect) => effect.anchorId === fire.id); const b = buildAuthorityEffects(plan, fire.presentationTime + .05).find((effect) => effect.anchorId === fire.id); assert.deepEqual(buildProjectileGeometry(a, fire.presentationTime + .05), buildProjectileGeometry(b, fire.presentationTime + .05)); });
  check(`${sourceId} 47. active projectile is short`, () => { assert.ok(projectile); assert.equal(validateProjectileGeometry(buildProjectileGeometry(projectile, fire.presentationTime + .05)).ok, true); assert.ok(buildProjectileGeometry(projectile, fire.presentationTime + .05).length <= MAX_SEGMENT_LENGTH); });
  check(`${sourceId} 48. expired projectile is absent`, () => assert.equal(buildAuthorityEffects(plan, fire.presentationTime + (projectile?.duration || .18) + .01).some((effect) => effect.anchorId === fire.id), false));
  check(`${sourceId} 49. FIRE does not change HP`, () => { const before = buildContractCaptureState(plan, contract, Math.max(0, fire.presentationTime - .01)).authority; const after = buildContractCaptureState(plan, contract, fire.presentationTime).authority; assert.deepEqual(Object.fromEntries(Object.entries(before.actors).map(([id, actor]) => [id, actor.hp])), Object.fromEntries(Object.entries(after.actors).map(([id, actor]) => [id, actor.hp]))); });
}

check('50. unsupported result is explicitly rejected', () => { const report = structuredClone(built[0].payload.report); report.result = 'withdraw'; const contract = buildPresentationContract(report); const result = buildVictoryPresentationPlan(contract, { sourceId: 'unsupported' }); assert.equal(result.ok, false); assert.equal(result.code, 'unsupported_result'); });
check('51. no forbidden actor IDs are in contract-demo JavaScript', () => fs.readdirSync(demo).filter((file) => file.endsWith('.js')).forEach((file) => { const source = fs.readFileSync(path.join(demo, file), 'utf8'); assert.doesNotMatch(source, /unit_fixture-u-|enemy_infantry_[1-4]|enemy_at_[12]/); }));
check('52. status policy source is role-driven', () => { const source = fs.readFileSync(path.join(demo, 'role-presentation-policy.js'), 'utf8'); assert.match(source, /actor\.role/); assert.doesNotMatch(source, /actor\.id\s*===/); });
check('53. semantic mapper does not hardcode actor IDs into milestones', () => {
  const source = fs.readFileSync(path.join(demo, 'semantic-time-mapper.js'), 'utf8');
  assert.doesNotMatch(source, /unit_fixture-u-|enemy_infantry_[1-4]|enemy_at_[12]/);
  assert.doesNotMatch(source, /actor\.id\s*===\s*['"]|actorId\s*===\s*['"]/);
});
check('54. repair grouping source does not name Fixture actors', () => assert.doesNotMatch(fs.readFileSync(path.join(demo, 'repair-choreography.js'), 'utf8'), /unit_fixture|enemy_infantry|enemy_at/));
check('55. text state has no fixed Fixture identity', () => { const source = fs.readFileSync(path.join(demo, 'contract-capture-tools.js'), 'utf8'); assert.doesNotMatch(source, /fixtureId:\s*['"]campaign-victory/); });
check('56. plan retains source metadata', () => built.forEach(({ sourceId, plan, contract }) => { assert.equal(plan.sourceId, sourceId); assert.equal(plan.reportId, contract.normalizedBattle.battle.id); assert.equal(plan.seed, contract.normalizedBattle.battle.seed); assert.ok(plan.missionKind && plan.missionId && plan.theaterId && plan.strategyId); }));
check('57. generator source exists', () => assert.equal(fs.existsSync(path.join(demo, 'demo-scenario-generator.mjs')), true));
check('58. loader exposes three sources', () => { const source = fs.readFileSync(path.join(demo, 'report-demo-loader.js'), 'utf8'); assert.match(source, /scenario-b/); assert.match(source, /scenario-c/); });
check('59. query source files are served locally', () => ['scenario-b.json', 'scenario-c.json'].forEach((file) => assert.equal(fs.existsSync(path.join(demo, 'scenarios', file)), true)));

const manifest = JSON.parse(fs.readFileSync(path.join(demo, 'screenshots/capture-manifest.json'), 'utf8'));
check('60. main manifest has fifteen screenshots', () => assert.equal(manifest.captures.length, 15));
check('61. main screenshot SHA values are all unique', () => assert.equal(new Set(manifest.captures.map((capture) => capture.pngSha256)).size, 15));
check('62. main screenshot SHA values match files', () => manifest.captures.forEach((capture) => assert.equal(hashFile(path.join(demo, 'screenshots', capture.file)), capture.pngSha256)));
check('63. short-projectile screenshot has an active projectile', () => assert.ok(manifest.captures.find((capture) => capture.file === '11-short-projectile-8s.png').activeProjectileCount >= 1));
check('64. short-projectile screenshot uses a derived time', () => assert.notEqual(manifest.captures.find((capture) => capture.file === '11-short-projectile-8s.png').actualTime, 8));
check('65. overview victory frame is exactly 35 seconds', () => assert.equal(manifest.captures.find((capture) => capture.file === '10-authoritative-victory-35s.png').actualTime, 35));
check('66. final-focus frame is exactly 35 seconds', () => assert.equal(manifest.captures.find((capture) => capture.file === '15-final-status-clean-35s.png').actualTime, 35));
check('67. overview and final-focus modes differ', () => assert.notEqual(manifest.captures[9].viewMode, manifest.captures[14].viewMode));
check('68. final-focus capture is not debug mode', () => assert.equal(manifest.captures[14].viewMode, 'final_status_focus'));
check('69. scenario B has three evidence screenshots', () => assert.equal(manifest.scenarioCaptures['scenario-b'].length, 3));
check('70. scenario C has three evidence screenshots', () => assert.equal(manifest.scenarioCaptures['scenario-c'].length, 3));
check('71. scenario B evidence files exist and hashes match', () => manifest.scenarioCaptures['scenario-b'].forEach((capture) => assert.equal(hashFile(path.join(demo, 'screenshots/scenario-b', capture.file)), capture.pngSha256)));
check('72. scenario C evidence files exist and hashes match', () => manifest.scenarioCaptures['scenario-c'].forEach((capture) => assert.equal(hashFile(path.join(demo, 'screenshots/scenario-c', capture.file)), capture.pngSha256)));
check('73. all scenario evidence is browser-clean', () => assert.deepEqual(manifest.browserErrors, []));
check('74. formal boundary hash is unchanged', () => assert.equal(formalBoundaryHash(root), '2e419233547bd0bae2515ef0c4a2f15ca5acd1e0c40b42f4edf5a90de60ce8ab'));
check('75. all new JS files pass syntax', () => fs.readdirSync(demo).filter((file) => file.endsWith('.js')).forEach((file) => assert.equal(spawnSync(process.execPath, ['--check', path.join(demo, file)]).status, 0, file)));
check('76. page entry includes source query support', () => { const source = fs.readFileSync(path.join(demo, 'contract-demo.js'), 'utf8'); assert.match(source, /sourceIdFromSearch/); assert.match(source, /setContractDemoViewMode/); });
check('77. no localStorage is used', () => fs.readdirSync(demo).filter((file) => file.endsWith('.js')).forEach((file) => assert.doesNotMatch(fs.readFileSync(path.join(demo, file), 'utf8'), /localStorage/)));
check('78. no wall-clock or RNG APIs are used', () => fs.readdirSync(demo).filter((file) => file.endsWith('.js')).forEach((file) => assert.doesNotMatch(fs.readFileSync(path.join(demo, file), 'utf8'), /Math\.random|Date\.now|performance\.now/)));
check('79. all three source plans have deterministic JSON', () => built.forEach(({ sourceId, payload, plan }) => assert.equal(JSON.stringify(plan), JSON.stringify(buildVictoryPresentationPlan(buildPresentationContract(structuredClone(payload.report)), { sourceId })))));

console.log(`contract-victory-template-parameterization-test: ${passed} passed / ${total} total`);
