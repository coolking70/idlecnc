import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyStage9BEvidence } from './stage9-B-strong-evidence-test.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const base = JSON.parse(fs.readFileSync('stage9_b_evidence_bundle.json', 'utf8'));
const mutations = [];
const add = (label, mutate) => mutations.push({ label, mutate });

add('equipment-stat-attack', (b) => { b.core.evidence.effectiveEvidence.actual.attack += 0.0001; });
add('equipment-stat-scouting', (b) => { b.core.evidence.effectiveEvidence.actual.scouting += 1; });
add('equipment-order-result', (b) => { b.core.evidence.effectiveEvidence.actual.defense = 999; });
add('equipment-hp', (b) => { b.core.evidence.effectiveEvidence.actual.hp = 101; });
add('snapshot-stat', (b) => { b.core.evidence.snapshotEvidence.parsedStats.attack = 999; });
add('snapshot-equipment-id', (b) => { b.core.evidence.snapshotEvidence.equipmentComposition[0].equipmentId = 'field_toolkit'; });
add('snapshot-equipment-modifier', (b) => { b.core.evidence.snapshotEvidence.equipmentComposition[0].modifiers.scouting = 9; });
add('snapshot-hash-input', (b) => { b.core.evidence.snapshotEvidence.deploymentHashInput = 'fake'; });
add('migration-fabricated-equipment', (b) => { b.core.evidence.migrationEvidence.oldSaveEquipment.inventory.push({ id: 'fabricated', equipmentId: 'scout_optics', quantity: 1 }); });
add('migration-fail-open-unit', (b) => { b.core.evidence.migrationEvidence.danglingUnitReferenceRemoved = false; });
add('migration-fail-open-equipment', (b) => { b.core.evidence.migrationEvidence.danglingEquipmentReferenceRemoved = false; });
add('save-diff-battle-pollution', (b) => { b.core.evidence.saveDiffEvidence.mountChangedPaths.push('battleSessions.fake'); });
add('save-diff-ledger-pollution', (b) => { b.core.evidence.saveDiffEvidence.mountChangedPaths.push('battleSettlementLedger.fake'); });
add('settlement-equipment-mutation', (b) => { b.core.evidence.saveDiffEvidence.settlementEquipmentUnchanged = false; });
add('running-session-swap', (b) => { b.browser.scenes[0].frames[3].state.activeBattle.battleSessionId = 'swapped'; });
add('running-deployment-hash', (b) => { b.browser.scenes[0].frames[3].state.activeBattle.deploymentHash = 'swapped'; });
add('running-report-hash', (b) => { b.browser.scenes[0].frames[3].state.activeBattle.formalReportHash = 'swapped'; });
add('result-ledger-count', (b) => { b.browser.scenes[0].frames[5].state.ledgerCount = 0; });
add('replay-deployment-hash', (b) => { b.browser.scenes[0].frames[7].state.activeBattle.deploymentHash = 'current-equipment-hash'; });
add('replay-report-hash', (b) => { b.browser.scenes[0].frames[7].state.activeBattle.formalReportHash = 'current-report-hash'; });
add('replay-equipment-current', (b) => { b.browser.scenes[0].frames[7].state.equipment['stage9-b-browser-unit'] = []; });
add('reload-time-origin-equal', (b) => { b.browser.realReloads[0].after.timeOrigin = b.browser.realReloads[0].before.timeOrigin; });
add('reload-time-origin-backwards', (b) => { b.browser.realReloads[1].after.timeOrigin = b.browser.realReloads[1].before.timeOrigin - 1; });
add('reload-loader-swap', (b) => { b.browser.realReloads[2].afterLoaderId = b.browser.realReloads[2].beforeLoaderId; });
add('reload-reason-extra', (b) => { b.browser.realReloads.push({ reason: 'extra', before: { timeOrigin: 1 }, after: { timeOrigin: 2 }, beforeLoaderId: 'x', afterLoaderId: 'y' }); });
add('reload-reason-missing', (b) => { b.browser.realReloads.pop(); });
add('reload-declared-time-origin', (b) => { b.browser.realReloads[3].timeOriginChanged = false; });
add('ui-action-mount-missing', (b) => { b.browser.actionProvenance = b.browser.actionProvenance.filter((row) => !String(row.selector).includes('equip-equipment')); });
add('ui-action-unmount-missing', (b) => { b.browser.actionProvenance = b.browser.actionProvenance.filter((row) => !String(row.selector).includes('unequip-equipment')); });
add('ui-provenance-source', (b) => { b.browser.actionProvenance[0].source = 'fixture'; });
add('ui-provenance-synthetic', (b) => { b.browser.actionProvenance[0].syntheticApiCall = true; });
add('equipment-api-used', (b) => { b.browser.equipmentApiUsed = true; });
add('dispatch-api-used', (b) => { b.browser.dispatchApiUsed = true; });
add('fixture-loader-used', (b) => { b.browser.fixtureLoaderUsed = true; });
add('missing-result-coverage', (b) => { b.browser.coverage.resultAttempt = false; });
add('missing-replay-coverage', (b) => { b.browser.coverage.replayAttempt = false; });
add('missing-mount-coverage', (b) => { b.browser.coverage.mountAction = false; });
add('machine-frame-count', (b) => { b.machine.frameCount = 7; });
add('browser-capture-count', (b) => { b.browser.browser.captureCount = 7; });
add('browser-unique-hashes', (b) => { b.browser.browser.uniqueImageHashes = 7; });
add('running-readonly-flag', (b) => { b.browser.scenes[0].frames[2].state.activeBattle.replayReadOnly = true; });
add('result-settled-flag', (b) => { b.browser.scenes[0].frames[4].state.activeBattle.settled = false; });
add('replay-readonly-flag', (b) => { b.browser.scenes[0].frames[6].state.activeBattle.replayReadOnly = false; });
add('replay-session-swap', (b) => { b.browser.scenes[0].frames[7].state.activeBattle.battleSessionId = 'other-session'; });
add('replay-report-id-swap', (b) => { b.browser.scenes[0].frames[7].state.activeBattle.reportId = 'other-report'; });
add('result-report-id-swap', (b) => { b.browser.scenes[0].frames[5].state.activeBattle.reportId = 'other-report'; });
add('running-settlement-id-swap', (b) => { b.browser.scenes[0].frames[3].state.activeBattle.settlementId = 'other-settlement'; });
add('running-unit-equipment-copy', (b) => { b.browser.scenes[0].frames[3].state.equipment['stage9-b-browser-unit'] = ['equipment-starter-1', 'equipment-starter-2']; });
add('replay-unit-equipment-copy', (b) => { b.browser.scenes[0].frames[6].state.equipment['stage9-b-browser-unit'] = ['equipment-starter-1']; });
add('frame-state-report-count', (b) => { b.browser.scenes[0].frames[5].state.reportCount = 99; });
add('frame-state-session-id', (b) => { b.browser.scenes[0].frames[2].state.sessionId = 'other'; });
add('browser-page-error', (b) => { b.browser.browser.pageErrors = ['tampered']; });
add('browser-console-error', (b) => { b.browser.browser.consoleErrors = ['tampered']; });
add('performance-effective-p95', (b) => { b.performance.scenarios.effectiveStats.p95Ms = 16.8; });
add('performance-snapshot-p95', (b) => { b.performance.scenarios.snapshot.p95Ms = 16.8; });
add('performance-environment', (b) => { delete b.performance.environment.cpuModel; });
add('core-effective-base', (b) => { b.core.evidence.effectiveEvidence.actual.base = 999; });
add('core-snapshot-unit', (b) => { b.core.evidence.snapshotEvidence.unitId = 'other-unit'; });
add('core-replay-history', (b) => { b.core.evidence.replayEvidence.replayAfterCurrentEquipmentChanged.usesHistoricalSnapshot = false; });
add('core-isolation-ledger', (b) => { b.core.evidence.isolationEvidence.resultPanel.ledgerUnchanged = false; });

for (let index = 0; index < 8; index += 1) {
  add(`semantic-frame-${index + 1}`, (b) => { b.browser.scenes[0].frames[index].semantic = 'tampered-semantic'; });
  add(`image-hash-${index + 1}`, (b) => { b.browser.scenes[0].frames[index].imageSha256 = `tampered-image-${index}`; });
  add(`screenshot-hash-${index + 1}`, (b) => { b.browser.scenes[0].frames[index].screenshot.sha256 = `tampered-screenshot-${index}`; });
}

const results = mutations.map(({ label, mutate }) => {
  const candidate = clone(base); mutate(candidate); candidate.passed = true;
  const verdict = verifyStage9BEvidence(candidate, { checkFiles: false });
  return { label, rejected: verdict.ok === false, failureCodes: verdict.errors.map((row) => row.code) };
});
const output = {
  stage: '9-B', caseCount: results.length, rejectionCount: results.filter((row) => row.rejected).length,
  passedFlagOnlyCases: results.filter((row) => row.failureCodes.length === 0).length,
  cases: results, passed: results.length >= 80 && results.every((row) => row.rejected && row.failureCodes.length > 0)
};
fs.writeFileSync('stage9_b_tamper_results.json', `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true, JSON.stringify(output));
const strong = JSON.parse(fs.readFileSync('stage9_b_strong_evidence_verdict.json', 'utf8'));
fs.writeFileSync('stage9_b_strong_evidence_verdict.json', `${JSON.stringify({ ...strong, tamperAudit: { caseCount: output.caseCount, rejectionCount: output.rejectionCount, passedFlagOnlyCases: output.passedFlagOnlyCases, independentlyRejected: output.passed }, tamperAuditPending: false, passed: strong.passed && output.passed }, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, cases: output.caseCount, rejected: output.rejectionCount, passedFlagOnlyCases: output.passedFlagOnlyCases }));
