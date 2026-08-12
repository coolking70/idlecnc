import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyStage9CEvidence } from './stage9-C-strong-evidence-test.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const base = JSON.parse(fs.readFileSync('stage9_c_evidence_bundle.json', 'utf8'));
const mutations = [];
const add = (label, mutate) => mutations.push({ label, mutate });

add('effective-attack', (b) => { b.effectiveStats.actual.attack += 0.0001; });
add('effective-anti-armor', (b) => { b.effectiveStats.actual.antiArmor = 999; });
add('effective-defense', (b) => { b.effectiveStats.actual.defense = 999; });
add('effective-scouting', (b) => { b.effectiveStats.actual.scouting = 999; });
add('effective-mobility', (b) => { b.effectiveStats.actual.mobility = 999; });
add('effective-repair', (b) => { b.effectiveStats.actual.repair = 999; });
add('effective-hp', (b) => { b.effectiveStats.actual.hp = 101; });
add('snapshot-stat', (b) => { b.snapshotEvidence.parsedStats.attack = 999; });
add('snapshot-equipment-id', (b) => { b.snapshotEvidence.equipmentComposition[0].equipmentId = 'field_toolkit'; });
add('snapshot-equipment-modifier', (b) => { b.snapshotEvidence.equipmentComposition[0].modifiers.scouting = 9; });
add('production-cost', (b) => { b.core.acquisition.production.costPaid.supply += 1; });
add('production-duration', (b) => { b.core.acquisition.production.duration += 1; });
add('production-kind', (b) => { b.core.acquisition.production.kind = 'starter'; });
add('tech-gate-code', (b) => { b.core.techGate.blocked.code = 'ready'; });
add('tech-gate-missing-tech', (b) => { b.core.techGate.blocked.missingTech = 'expanded_storage'; });
add('tech-gate-reason', (b) => { b.core.techGate.blocked.reason = '伪造原因'; });

for (let index = 0; index < 9; index += 1) {
  add(`semantic-frame-${index + 1}`, (b) => { b.browser.scenes[0].frames[index].semantic = `tampered-${index}`; });
  add(`image-hash-${index + 1}`, (b) => { b.browser.scenes[0].frames[index].imageSha256 = `tampered-image-${index}`; });
  add(`screenshot-hash-${index + 1}`, (b) => { b.browser.scenes[0].frames[index].screenshot.sha256 = `tampered-screenshot-${index}`; });
}

add('queue-frame-current', (b) => { b.browser.scenes[0].frames[0].state.production.current.equipmentId = 'command_uplink'; });
add('queue-frame-inventory', (b) => { b.browser.scenes[0].frames[0].state.inventoryCount = 4; });
add('queue-reload-current', (b) => { b.browser.scenes[0].frames[1].state.production.current = null; });
add('queue-reload-inventory', (b) => { b.browser.scenes[0].frames[1].state.inventoryCount = 4; });
add('completed-frame-inventory', (b) => { b.browser.scenes[0].frames[2].state.inventoryCount = 3; });
add('completed-frame-binding', (b) => { b.browser.scenes[0].frames[2].state.equipment = { 'stage9-c-browser-unit': ['equipment-production-anti_armor_sights-1'] }; });
add('completed-reload-inventory', (b) => { b.browser.scenes[0].frames[3].state.inventoryCount = 3; });
add('mounted-frame-binding', (b) => { b.browser.scenes[0].frames[4].state.equipment = {}; });

for (const index of [5, 6]) {
  add(`running-${index}-session`, (b) => { b.browser.scenes[0].frames[index].state.activeBattle.battleSessionId = `swapped-${index}`; });
  add(`running-${index}-deployment`, (b) => { b.browser.scenes[0].frames[index].state.activeBattle.deploymentHash = `swapped-${index}`; });
  add(`running-${index}-report`, (b) => { b.browser.scenes[0].frames[index].state.activeBattle.formalReportHash = `swapped-${index}`; });
  add(`running-${index}-readonly`, (b) => { b.browser.scenes[0].frames[index].state.activeBattle.replayReadOnly = true; });
  add(`running-${index}-equipment`, (b) => { b.browser.scenes[0].frames[index].state.equipment = {}; });
}
for (const index of [7, 8]) {
  add(`replay-${index}-readonly`, (b) => { b.browser.scenes[0].frames[index].state.activeBattle.replayReadOnly = false; });
  add(`replay-${index}-historical`, (b) => { delete b.browser.scenes[0].frames[index].state.activeBattle.historicalEquipment['stage9-c-browser-unit']; });
  add(`replay-${index}-deployment`, (b) => { b.browser.scenes[0].frames[index].state.activeBattle.deploymentHash = `current-${index}`; });
  add(`replay-${index}-report`, (b) => { b.browser.scenes[0].frames[index].state.activeBattle.formalReportHash = `current-${index}`; });
  add(`replay-${index}-session`, (b) => { b.browser.scenes[0].frames[index].state.activeBattle.battleSessionId = `other-${index}`; });
  add(`replay-${index}-equipment`, (b) => { b.browser.scenes[0].frames[index].state.equipment = {}; });
  add(`replay-${index}-reports`, (b) => { b.browser.scenes[0].frames[index].state.reportCount = 0; });
  add(`replay-${index}-ledger`, (b) => { b.browser.scenes[0].frames[index].state.ledgerCount = 0; });
}

add('capture-count', (b) => { b.browser.browser.captureCount = 8; });
add('unique-image-count', (b) => { b.browser.browser.uniqueImageHashes = 8; });
add('browser-page-error', (b) => { b.browser.browser.pageErrors = ['tampered']; });
add('browser-console-error', (b) => { b.browser.browser.consoleErrors = ['tampered']; });
for (const key of ['dispatchApiUsed', 'replayApiUsed', 'offlineApiUsed', 'equipmentApiUsed']) add(`api-${key}`, (b) => { b.browser[key] = true; });
for (const key of ['productionEntry', 'enqueueAction', 'cancelAction', 'completionObserved', 'completedUnmounted', 'mountAction', 'runningAttempt', 'replayAttempt']) add(`coverage-${key}`, (b) => { b.browser.coverage[key] = false; });
add('ui-source-provenance', (b) => { b.browser.actionProvenance[0].source = 'fixture'; });
add('ui-synthetic-provenance', (b) => { b.browser.actionProvenance[0].syntheticApiCall = true; });
for (const action of ['produce-equipment', 'cancel-production-current', 'cancel-production-queue', 'equip-equipment', 'unequip-equipment', 'confirm-dispatch', 'replay-report']) add(`missing-action-${action}`, (b) => { b.browser.actionProvenance = b.browser.actionProvenance.filter((row) => !String(row.selector).includes(`data-action="${action}"`)); });
add('reload-reason-missing', (b) => { b.browser.realReloads.pop(); });
add('reload-reason-extra', (b) => { b.browser.realReloads.push({ reason: 'extra', before: { timeOrigin: 1 }, after: { timeOrigin: 2 }, beforeLoaderId: 'x', afterLoaderId: 'y', timeOriginChanged: true }); });
add('reload-time-origin-equal', (b) => { b.browser.realReloads[0].after.timeOrigin = b.browser.realReloads[0].before.timeOrigin; });
add('reload-time-origin-backwards', (b) => { b.browser.realReloads[1].after.timeOrigin = b.browser.realReloads[1].before.timeOrigin - 1; });
add('reload-loader-same', (b) => { b.browser.realReloads[2].afterLoaderId = b.browser.realReloads[2].beforeLoaderId; });
add('reload-declared-value', (b) => { b.browser.realReloads[3].timeOriginChanged = false; });
add('reload-loader-duplicate', (b) => { b.browser.realReloads[3].afterLoaderId = b.browser.realReloads[0].afterLoaderId; });

add('performance-measurement-invalid', (b) => { b.performance.measurementValid = false; });
add('performance-budget', (b) => { b.performance.budgetMs = 16.8; });
add('performance-warmup', (b) => { b.performance.warmup = 19; });
add('performance-sample-count', (b) => { b.performance.samples = 119; });
add('performance-effective-p95', (b) => { b.performance.scenarios.effectiveStats.p95Ms = 16.8; });
add('performance-snapshot-p95', (b) => { b.performance.scenarios.snapshot.p95Ms = 16.8; });
add('performance-load-before', (b) => { delete b.performance.environmentGuard.loadBefore; });
add('performance-environment', (b) => { delete b.performance.environment.cpuModel; });
add('isolation-offline-progress', (b) => { b.core.isolation.productionOfflineProgressed = false; });
add('isolation-exactly-once', (b) => { b.core.isolation.productionOfflineCompletedExactlyOnce = false; });
add('isolation-settlement-equipment', (b) => { b.core.isolation.settlementEquipmentUnchanged = false; });
add('replay-historical-evidence', (b) => { delete b.browser.scenes[0].frames[7].state.activeBattle.historicalEquipment['stage9-c-browser-unit']; });

const results = mutations.map(({ label, mutate }) => {
  const candidate = clone(base); mutate(candidate); candidate.passed = true;
  const verdict = verifyStage9CEvidence(candidate, { checkFiles: false });
  return { label, rejected: verdict.ok === false, failureCodes: verdict.errors.map((row) => row.code) };
});
const output = {
  stage: '9-C', rule: 'true-value mutation while passed=true', caseCount: results.length,
  rejectionCount: results.filter((row) => row.rejected).length,
  passedFlagOnlyCases: results.filter((row) => row.failureCodes.length === 0).length,
  cases: results, passed: results.length >= 84 && results.every((row) => row.rejected && row.failureCodes.length > 0)
};
fs.writeFileSync('stage9_c_tamper_results.json', `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true, JSON.stringify(output));
const strong = JSON.parse(fs.readFileSync('stage9_c_strong_evidence_verdict.json', 'utf8'));
fs.writeFileSync('stage9_c_strong_evidence_verdict.json', `${JSON.stringify({ ...strong, tamperAudit: { caseCount: output.caseCount, rejectionCount: output.rejectionCount, passedFlagOnlyCases: output.passedFlagOnlyCases, independentlyRejected: output.passed }, tamperAuditPending: false, passed: strong.passed && output.passed }, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, cases: output.caseCount, rejected: output.rejectionCount, passedFlagOnlyCases: output.passedFlagOnlyCases }));
