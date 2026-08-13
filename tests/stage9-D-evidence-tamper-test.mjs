import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SALVAGE_RULES } from '../js/config.js';
import { verifyStage9DEvidence } from './stage9-D-evidence-verifier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clone = (value) => JSON.parse(JSON.stringify(value));
const bundle = JSON.parse(fs.readFileSync(path.join(root, 'stage9_d_evidence_bundle.json'), 'utf8'));
const mutations = [];
const add = (label, mutate, coupled = false) => mutations.push({ label, mutate, coupled });
const frame = (index) => (candidate) => candidate.browser.scenes[0].frames[index];
const claimedFrame = (candidate) => frame(2)(candidate);
const salvageRow = (candidate) => claimedFrame(candidate).state.equipmentInventory.find((row) => row.provenance?.kind === 'battle_salvage');
const salvageClaim = (candidate) => claimedFrame(candidate).state.salvageClaims[claimedFrame(candidate).state.salvage.salvageId];

add('save-version', (candidate) => { candidate.saveVersion = 9; });
add('salvage-rule-version', (candidate) => { candidate.salvageRules.version = 99; });
add('salvage-chance-cap', (candidate) => { candidate.salvageRules.victory.cap = 0.99; });
add('equipment-rule-slots', (candidate) => { candidate.equipmentRules.maxSlotsPerUnit = 3; });
add('catalog-remove-entry', (candidate) => { candidate.equipmentCatalog.pop(); });
add('catalog-modifier', (candidate) => { candidate.equipmentCatalog[0].modifiers.scouting = 1.99; });
add('machine-stage', (candidate) => { candidate.machine.stage = '9-X'; });
add('machine-frame-count', (candidate) => { candidate.machine.frameCount = 8; });
add('machine-semantic-rename', (candidate) => { candidate.machine.frames[0].semantic = 'renamed_semantic'; });
add('browser-dispatch-api', (candidate) => { candidate.browser.dispatchApiUsed = true; });
add('machine-equipment-api', (candidate) => { candidate.machine.equipmentApiUsed = true; });
add('browser-capture-count', (candidate) => { candidate.browser.browser.captureCount = 8; });
add('browser-duplicate-hash', (candidate) => { candidate.browser.scenes[0].frames[1].imageSha256 = candidate.browser.scenes[0].frames[0].imageSha256; });
add('browser-console-error', (candidate) => { candidate.browser.browser.consoleErrors = ['forged']; });
add('reload-reason-missing', (candidate) => { candidate.browser.realReloads[0].reason = 'wrong_reason'; });
add('reload-reason-extra', (candidate) => { candidate.browser.realReloads.push(clone(candidate.browser.realReloads[0])); });
add('reload-time-equal', (candidate) => { candidate.browser.realReloads[0].after.timeOrigin = candidate.browser.realReloads[0].before.timeOrigin; });
add('reload-time-backwards', (candidate) => { candidate.browser.realReloads[1].after.timeOrigin = candidate.browser.realReloads[1].before.timeOrigin - 1; });
add('reload-time-declaration', (candidate) => { candidate.browser.realReloads[2].timeOriginChanged = false; });
add('reload-loader-equal', (candidate) => { candidate.browser.realReloads[0].afterLoaderId = candidate.browser.realReloads[0].beforeLoaderId; });
add('reload-loader-duplicate', (candidate) => { candidate.browser.realReloads[1].afterLoaderId = candidate.browser.realReloads[0].afterLoaderId; });
add('required-action-missing', (candidate) => { candidate.browser.actionProvenance = candidate.browser.actionProvenance.filter((row) => !String(row.selector).includes('claim-battle-salvage')); });
add('ui-provenance-source', (candidate) => { candidate.browser.actionProvenance[0].source = 'test_api'; });
add('ui-provenance-synthetic', (candidate) => { candidate.browser.actionProvenance[1].syntheticApiCall = true; });
add('session-version-missing', (candidate) => { delete frame(0)(candidate).state.authoritativeSession.salvageRulesVersion; });
add('session-version-zero', (candidate) => { frame(0)(candidate).state.authoritativeSession.salvageRulesVersion = 0; });
add('session-version-unknown', (candidate) => { frame(0)(candidate).state.authoritativeSession.salvageRulesVersion = 99; });
add('claimed-salvage-production-provenance', (candidate) => { salvageRow(candidate).provenance.kind = 'production'; });
add('claimed-production-id-salvage-provenance', (candidate) => { salvageRow(candidate).id = 'equipment-production-forged'; });
add('claimed-provenance-missing', (candidate) => { delete salvageRow(candidate).provenance; });
add('claimed-provenance-salvage-id', (candidate) => { salvageRow(candidate).provenance.salvageId = 'forged-salvage'; });
add('claimed-receipt-removed-inventory-retained', (candidate) => { delete claimedFrame(candidate).state.salvageClaims[claimedFrame(candidate).state.salvage.salvageId]; });
add('claimed-inventory-removed-receipt-retained', (candidate) => { const f = claimedFrame(candidate); f.state.equipmentInventory = f.state.equipmentInventory.filter((row) => row.provenance?.kind !== 'battle_salvage'); f.state.inventoryCount = f.state.equipmentInventory.length; });
add('coupled-equipment-id-both-sides', (candidate) => { const f = claimedFrame(candidate); const row = salvageRow(candidate); const claim = salvageClaim(candidate); row.equipmentId = 'scout_optics'; claim.equipmentId = 'scout_optics'; }, true);
add('coupled-instance-id-both-sides', (candidate) => { const f = claimedFrame(candidate); const row = salvageRow(candidate); const claim = salvageClaim(candidate); row.id = `${SALVAGE_RULES.instanceNamespace}-forged`; claim.instanceId = row.id; }, true);
add('coupled-salvage-id-both-sides', (candidate) => { const row = salvageRow(candidate); const claim = salvageClaim(candidate); row.provenance.salvageId = 'forged-salvage'; claim.salvageId = 'forged-salvage'; }, true);
add('coupled-deterministic-instance-id', (candidate) => { const row = salvageRow(candidate); const claim = salvageClaim(candidate); row.id = `${SALVAGE_RULES.instanceNamespace}-00000000000000000000000000000000`; claim.instanceId = row.id; }, true);
add('coupled-offer-hash-receipt', (candidate) => { const f = claimedFrame(candidate); f.state.salvage.offerHash = 'forged-offer'; salvageClaim(candidate).offerHash = 'forged-offer'; }, true);
add('coupled-report-hash-receipt', (candidate) => { const f = claimedFrame(candidate); f.state.formalReportHash = 'forged-report'; f.state.authoritativeSession.formalReportHash = 'forged-report'; salvageClaim(candidate).formalReportHash = 'forged-report'; }, true);
add('coupled-version-and-eligibility', (candidate) => { const f = frame(0)(candidate); f.state.authoritativeSession.salvageRulesVersion = 99; f.state.salvageRulesVersion = 99; f.state.salvage.outcome = 'equipment'; }, true);
add('coupled-claim-and-inventory-session', (candidate) => { const f = claimedFrame(candidate); f.state.authoritativeSession.battleSessionId = 'forged-session'; salvageClaim(candidate).battleSessionId = 'forged-session'; salvageRow(candidate).provenance.battleSessionId = 'forged-session'; }, true);

for (let index = 0; index < 9; index += 1) {
  add(`frame-${index + 1}-screenshot-hash`, (candidate) => { frame(index)(candidate).imageSha256 = 'forged-hash'; });
  add(`frame-${index + 1}-screenshot-declaration`, (candidate) => { frame(index)(candidate).screenshot.sha256 = 'forged-hash'; });
  add(`frame-${index + 1}-salvage-roll`, (candidate) => { frame(index)(candidate).state.salvage.roll = 0.9999; });
  add(`frame-${index + 1}-salvage-offer-hash`, (candidate) => { frame(index)(candidate).state.salvage.offerHash = 'forged-offer'; });
  add(`frame-${index + 1}-salvage-id`, (candidate) => { frame(index)(candidate).state.salvage.salvageId = 'forged-salvage'; });
  add(`frame-${index + 1}-settlement-ledger-hash`, (candidate) => { frame(index)(candidate).state.settlementLedger.ledgerHash = 'forged-ledger'; });
  add(`frame-${index + 1}-deployment-hash`, (candidate) => {
    const current = frame(index)(candidate).state.authoritativeSession.deploymentHash;
    frame(index)(candidate).state.authoritativeSession.deploymentHash = current === 'forged-deployment' ? 'forged-deployment-2' : 'forged-deployment';
  });
  add(`frame-${index + 1}-session-id`, (candidate) => {
    frame(index)(candidate).state.sessionId = 'forged-session';
  });
  add(`frame-${index + 1}-settlement-id`, (candidate) => {
    frame(index)(candidate).state.settlementId = 'forged-settlement';
  });
  add(`frame-${index + 1}-report-hash`, (candidate) => {
    frame(index)(candidate).state.formalReportHash = 'forged-report';
  });
}

add('claimed-receipt-hash', (candidate) => { candidate.browser.scenes[0].frames[2].state.salvageClaims[Object.keys(candidate.browser.scenes[0].frames[2].state.salvageClaims)[0]].offerHash = 'forged'; });
add('claimed-receipt-equipment', (candidate) => { candidate.browser.scenes[0].frames[2].state.salvageClaims[Object.keys(candidate.browser.scenes[0].frames[2].state.salvageClaims)[0]].equipmentId = 'scout_optics'; });
add('claimed-receipt-instance', (candidate) => { candidate.browser.scenes[0].frames[2].state.salvageClaims[Object.keys(candidate.browser.scenes[0].frames[2].state.salvageClaims)[0]].instanceId = 'forged-instance'; });
add('claimed-inventory-instance', (candidate) => { candidate.browser.scenes[0].frames[2].state.equipmentInventory.find((row) => row.provenance?.kind === 'battle_salvage').provenance.salvageId = 'forged'; });
add('claimed-inventory-equipment', (candidate) => { candidate.browser.scenes[0].frames[2].state.equipmentInventory.find((row) => row.provenance?.kind === 'battle_salvage').equipmentId = 'scout_optics'; candidate.browser.scenes[0].frames[2].state.authoritativeSession = clone(candidate.browser.scenes[0].frames[2].state.authoritativeSession); });
add('claimed-inventory-count', (candidate) => { candidate.browser.scenes[0].frames[2].state.inventoryCount += 1; candidate.browser.scenes[0].frames[2].state.authoritativeSession = clone(candidate.browser.scenes[0].frames[2].state.authoritativeSession); });
add('claimed-state-pending', (candidate) => { candidate.browser.scenes[0].frames[2].state.salvage.state = 'pending'; });
add('replay-read-only-false', (candidate) => { candidate.browser.scenes[0].frames[5].state.activeBattle.replayReadOnly = false; });
add('replay-claim-control-visible', (candidate) => { candidate.browser.scenes[0].frames[5].claimControlPresent = true; });
add('replay-historical-equipment', (candidate) => { candidate.browser.scenes[0].frames[5].state.salvage.equipmentId = 'scout_optics'; });
add('no-drop-equipment', (candidate) => { candidate.browser.scenes[0].frames[7].state.salvage.outcome = 'equipment'; });
add('no-drop-inventory-growth', (candidate) => { candidate.browser.scenes[0].frames[8].state.inventoryCount += 1; });

const results = mutations.map(({ label, mutate, coupled }) => {
  const candidate = clone(bundle);
  mutate(candidate);
  candidate.passed = true;
  const verdict = verifyStage9DEvidence(candidate, { checkFiles: false });
  return { label, coupled, rejected: verdict.ok === false, failureCodes: verdict.errors.map((row) => row.code) };
});
const output = {
  stage: '9-D', rule: 'true-value mutation while passed=true', caseCount: results.length,
  rejectionCount: results.filter((row) => row.rejected).length,
  coupledTamperCaseCount: results.filter((row) => row.coupled).length,
  coupledTamperRejected: results.filter((row) => row.coupled && row.rejected).length,
  passedFlagOnlyCases: results.filter((row) => row.failureCodes.length === 0).length,
  cases: results,
  passed: results.length >= 80 && results.filter((row) => row.coupled).length >= 8 && results.every((row) => row.rejected && row.failureCodes.length > 0) && results.filter((row) => row.coupled).every((row) => row.rejected)
};
fs.writeFileSync(path.join(root, 'stage9_d_tamper_results.json'), `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true, JSON.stringify(output));
console.log(JSON.stringify({ ok: true, stage: output.stage, cases: output.caseCount, rejected: output.rejectionCount, passedFlagOnlyCases: output.passedFlagOnlyCases }));
