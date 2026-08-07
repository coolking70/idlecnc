import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPresentationContract } from '../../../js/battle-presentation/contract-battle-adapter.js';
import { buildUniversalPlan } from '../../../js/battle-presentation/universal/universal-plan-builder.js';

const fixtureDir = new URL('../report-adapter/fixtures/', import.meta.url);
const reports = ['campaign-victory.json', 'campaign-withdraw.json', 'campaign-defeat-or-wiped.json', 'operation-result.json']
  .map((file) => JSON.parse(fs.readFileSync(new URL(file, fixtureDir), 'utf8')).report);
let checks = 0;
for (const report of reports) {
  const before = JSON.stringify(report);
  const fromReport = buildUniversalPlan(report);
  const fromContract = buildUniversalPlan(buildPresentationContract(report));
  assert.equal(JSON.stringify(fromReport), JSON.stringify(fromContract), `${report.id}: report/contract equivalence`); checks += 1;
  const reversed = structuredClone(report);
  for (const side of ['friendly', 'enemy']) { reversed.initial[side].reverse(); reversed.final[side].reverse(); }
  const fromReversed = buildUniversalPlan(reversed);
  assert.equal(JSON.stringify(fromReport), JSON.stringify(fromReversed), `${report.id}: input order stability`); checks += 1;
  assert.equal(JSON.stringify(report), before, `${report.id}: source unchanged`); checks += 1;
  assert.equal(fromReport.source.reportFingerprint, fromContract.source.reportFingerprint, `${report.id}: report fingerprint stable`); checks += 1;
  assert.equal(fromReport.planFingerprint, fromContract.planFingerprint, `${report.id}: plan fingerprint stable`); checks += 1;
}
console.log(`universal-presentation-input-stability-test: ${checks} checks passed`);
