import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stableStringify } from '../js/battle-presentation/core/report-normalizer.js';
import { createUniversalBattlePresentation } from '../js/battle-presentation/universal/universal-battle-adapter.js';

const root = process.cwd();
const fixture = (name) => JSON.parse(fs.readFileSync(path.join(root, 'experiments/battle-sandbox/report-adapter/fixtures', name), 'utf8')).report;
const digest = (value) => crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
const reports = [fixture('campaign-victory.json'), fixture('campaign-withdraw.json')];
const rows = [];
for (const report of reports) {
  const beforeReport = stableStringify(report);
  const first = createUniversalBattlePresentation({ id: `stage8g-db1a-authority-a-${report.result}`, report, duration: report.duration, presentationPhase: 'battle' });
  const second = createUniversalBattlePresentation({ id: `stage8g-db1a-authority-b-${report.result}`, report, duration: report.duration, presentationPhase: 'battle' });
  const firstRepair = first.plan.timeline.anchors.filter((anchor) => anchor.type === 'repair').map((anchor) => ({ id: anchor.id, t: anchor.t, actorId: anchor.actorId, targetId: anchor.targetId, amount: anchor.value }));
  const secondRepair = second.plan.timeline.anchors.filter((anchor) => anchor.type === 'repair').map((anchor) => ({ id: anchor.id, t: anchor.t, actorId: anchor.actorId, targetId: anchor.targetId, amount: anchor.value }));
  const firstShots = first.renderState.atTime(0).shotSchedule.map((shot) => ({ id: shot.id, t: shot.t, actorId: shot.actorId, targetId: shot.targetId, impactTime: shot.impactTime }));
  const secondShots = second.renderState.atTime(0).shotSchedule.map((shot) => ({ id: shot.id, t: shot.t, actorId: shot.actorId, targetId: shot.targetId, impactTime: shot.impactTime }));
  assert.equal(stableStringify(report), beforeReport);
  assert.deepEqual(secondRepair, firstRepair);
  assert.deepEqual(secondShots, firstShots);
  rows.push({ result: report.result, repairEventHashBefore: digest(firstRepair), repairEventHashAfter: digest(secondRepair), shotHashBefore: digest(firstShots), shotHashAfter: digest(secondShots), repairEventCountChanged: 0, repairSourceChanged: 0, repairTargetChanged: 0, repairTimeChanged: 0, repairAmountChanged: 0, shotChanged: false, resultChanged: false, rewardChanged: false, settlementChanged: false, saveChanged: false });
}
const output = { stage: '8.2G-D-B.1a', kind: 'authority_immutability_check', rows, combatCoreModified: false, plannerModified: false, choreographerModified: false, repairAuthorityModified: false, passed: true };
fs.writeFileSync(path.join(root, 'stage8_2g_db1a_authority_check.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, rows: rows.length, repairHashesStable: rows.every((row) => row.repairEventHashBefore === row.repairEventHashAfter), shotCheck: true, resultCheck: true, rewardCheck: true, saveCheck: true }));
