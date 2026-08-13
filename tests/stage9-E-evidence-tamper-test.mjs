import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyStage9EEvidence } from './stage9-E-evidence-verifier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const original = JSON.parse(fs.readFileSync(path.join(root, 'stage9_e_evidence.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const mutations = [];
const add = (name, fn, coupled = true) => mutations.push({ name, fn, coupled });
const mutate = (name, pathParts, value, coupled = true) => add(name, (candidate) => {
  let target = candidate;
  pathParts.slice(0, -1).forEach((key) => { target = target[key]; });
  target[pathParts.at(-1)] = value;
}, coupled);

mutate('core check count', ['coreEvidence', 'checkCount'], 1);
mutate('core recompute flag', ['coreEvidence', 'independentRecompute'], false);
mutate('core production instance', ['coreEvidence', 'equipment', 'productionInstanceId'], 'forged-production');
mutate('core salvage equipment', ['coreEvidence', 'equipment', 'salvageEquipmentId'], 'mobile_repair_rig');
mutate('core mission kind', ['coreEvidence', 'integration', 'missionKind'], 'campaign');
mutate('core mission id', ['coreEvidence', 'integration', 'missionId'], 'scrap_mine');
mutate('core seed', ['coreEvidence', 'integration', 'seed'], 2);
mutate('core salvage version', ['coreEvidence', 'integration', 'salvageRulesVersion'], 0);
mutate('core settlement mutation', ['coreEvidence', 'boundaries', 'settlementMutatesEquipment'], true);
mutate('core diff boundary', ['coreEvidence', 'boundaries', 'claimDiffEquipmentOnly'], false);
mutate('core replay boundary', ['coreEvidence', 'boundaries', 'replayReadOnly'], false);
mutate('core drop scope', ['coreEvidence', 'boundaries', 'dropsPreexistingNotImplemented'], false);

for (let index = 0; index < 14; index += 1) add(`frame ${index} semantic name`, (candidate) => { candidate.browserManifest.scenes[0].frames[index].phase = 'operation_review'; candidate.browserManifest.scenes[0].frames[6].phase = 'production_queue'; });
for (let index = 0; index < 14; index += 1) add(`frame ${index} screenshot hash`, (candidate) => { const other = index === 0 ? 1 : 0; candidate.browserManifest.scenes[0].frames[index].imageSha256 = original.browserManifest.scenes[0].frames[other].imageSha256; });
for (let index = 0; index < 5; index += 1) {
  mutate(`reload ${index} timeOrigin`, ['browserManifest', 'realReloads', index, 'after', 'timeOrigin'], 1);
  add(`reload ${index} loader`, (candidate) => { const other = index === 0 ? 1 : 0; candidate.browserManifest.realReloads[index].afterLoaderId = original.browserManifest.realReloads[other].afterLoaderId; });
}
for (let index = 0; index < 14; index += 1) mutate(`action ${index} provenance`, ['browserManifest', 'actionProvenance', index, 'source'], 'forged_api');

[
  ['browser frame count', ['machineEvidence', 'frameCount'], 1],
  ['browser unique hash count', ['browserManifest', 'browser', 'uniqueImageHashes'], 1],
  ['browser page error', ['browserManifest', 'browser', 'pageErrors'], ['tampered']],
  ['browser console error', ['browserManifest', 'browser', 'consoleErrors'], ['tampered']],
  ['dispatch api flag', ['browserManifest', 'dispatchApiUsed'], true],
  ['replay api flag', ['browserManifest', 'replayApiUsed'], true],
  ['offline api flag', ['browserManifest', 'offlineApiUsed'], true],
  ['equipment api flag', ['browserManifest', 'equipmentApiUsed'], true],
  ['salvage api flag', ['browserManifest', 'salvageClaimApiUsed'], true],
  ['reload count', ['browserManifest', 'realReloads'], []],
  ['operation review kind', ['browserManifest', 'scenes', 0, 'frames', 6, 'missionKind'], 'campaign'],
  ['operation review id', ['browserManifest', 'scenes', 0, 'frames', 6, 'missionId'], 'scrap_mine'],
  ['queue state', ['browserManifest', 'scenes', 0, 'frames', 1, 'state', 'production', 'current'], null],
  ['production mount binding', ['browserManifest', 'scenes', 0, 'frames', 5, 'state', 'equipment', 'bindings', 'stage9-e-unit-0'], []],
  ['running mission kind', ['browserManifest', 'scenes', 0, 'frames', 7, 'state', 'activeBattle', 'missionKind'], 'campaign'],
  ['running mission id', ['browserManifest', 'scenes', 0, 'frames', 7, 'state', 'activeBattle', 'missionId'], 'scrap_mine'],
  ['running salvage version', ['browserManifest', 'scenes', 0, 'frames', 7, 'state', 'salvageRulesVersion'], 0],
  ['pending result flag', ['browserManifest', 'scenes', 0, 'frames', 9, 'state', 'activeBattle', 'settled'], false],
  ['pending salvage outcome', ['browserManifest', 'scenes', 0, 'frames', 9, 'state', 'salvage', 'outcome'], 'none'],
  ['pending salvage definition', ['browserManifest', 'scenes', 0, 'frames', 9, 'state', 'salvage', 'equipmentId'], 'precision_fire_control'],
  ['claim count', ['browserManifest', 'scenes', 0, 'frames', 11, 'state', 'equipment', 'salvageClaims'], {}],
  ['claim inventory', ['browserManifest', 'scenes', 0, 'frames', 11, 'state', 'salvageInstanceIds'], []],
  ['salvage mount id', ['browserManifest', 'scenes', 0, 'frames', 12, 'salvageId'], 'forged-salvage'],
  ['salvage mount binding', ['browserManifest', 'scenes', 0, 'frames', 12, 'state', 'equipment', 'bindings', 'stage9-e-unit-5'], []],
  ['replay mode', ['browserManifest', 'scenes', 0, 'frames', 13, 'state', 'activeBattle', 'replayReadOnly'], false],
  ['replay production snapshot', ['browserManifest', 'scenes', 0, 'frames', 13, 'state', 'activeBattle', 'historicalEquipment', 'stage9-e-unit-0'], []],
  ['replay salvage leakage', ['browserManifest', 'scenes', 0, 'frames', 13, 'state', 'activeBattle', 'historicalEquipment', 'stage9-e-unit-5'], ['forged-salvage']],
  ['replay current inventory', ['browserManifest', 'scenes', 0, 'frames', 13, 'state', 'salvageInstanceIds'], []]
].forEach(([name, pathParts, value]) => mutate(name, pathParts, value));

const results = mutations.map(({ name, fn, coupled }) => {
  const candidate = clone(original);
  fn(candidate);
  const result = verifyStage9EEvidence(candidate);
  return { name, coupled, rejected: result.passed !== true, failureCount: result.failures.length };
});
const rejected = results.filter((row) => row.rejected).length;
const coupled = results.filter((row) => row.coupled);
const coupledRejected = coupled.filter((row) => row.rejected).length;
const passedFlagOnlyCases = results.filter((row) => !row.rejected && row.name.includes('passed')).length;
const output = { stage: '9-E', independentRecompute: true, total: results.length, rejected, coupledTotal: coupled.length, coupledRejected, passedFlagOnlyCases, results };
fs.writeFileSync(path.join(root, 'stage9_e_tamper_results.json'), `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.total >= 80, true, `tamper cases ${output.total}`);
assert.equal(output.rejected, output.total, JSON.stringify(results.filter((row) => !row.rejected), null, 2));
assert.equal(output.coupledRejected, output.coupledTotal);
assert.equal(output.passedFlagOnlyCases, 0);
console.log(JSON.stringify({ stage: output.stage, total: output.total, rejected: output.rejected, coupledTotal: output.coupledTotal, coupledRejected: output.coupledRejected, passedFlagOnlyCases: output.passedFlagOnlyCases }));
