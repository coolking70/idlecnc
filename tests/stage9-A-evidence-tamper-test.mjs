import assert from 'node:assert/strict';
import fs from 'node:fs';
import { verifyStage9Evidence } from './stage9-A-strong-evidence-test.mjs';

const clone = (value) => JSON.parse(JSON.stringify(value));
const base = JSON.parse(fs.readFileSync('stage9_a_evidence_bundle.json', 'utf8'));
const mutations = [];
const add = (label, mutate) => mutations.push({ label, mutate });

add('machine-frame-count', (b) => { b.machine.frameCount = 17; });
add('machine-fixture-loader', (b) => { b.machine.fixtureLoaderUsed = true; });
add('machine-dispatch-api', (b) => { b.machine.dispatchApiUsed = true; });
add('browser-replay-api', (b) => { b.browser.replayApiUsed = true; });
add('browser-offline-api', (b) => { b.browser.offlineApiUsed = true; });
add('browser-capture-count', (b) => { b.browser.browser.captureCount = 17; });
add('browser-unique-hashes', (b) => { b.browser.browser.uniqueImageHashes = 17; });
add('browser-page-error', (b) => { b.browser.browser.pageErrors = ['tampered']; });
add('missing-prerequisite-disclosure', (b) => { b.browser.prerequisiteStateSeeded = false; });
add('capture-observed', (b) => { b.browser.coverage.captureObserved = false; });
add('operation-review-observed', (b) => { b.browser.coverage.operationReviewObserved = false; });
add('coverage-mission-count', (b) => { b.coverage.after.missionCount = 11; });
add('coverage-covered-count', (b) => { b.coverage.after.coveredCells = 41; });
add('coverage-unobserved-count', (b) => { b.coverage.after.unobservedCells = 19; });
add('generalization-pass-flag', (b) => { b.missionGeneralization.passed = false; });
add('theater-chain-pass-flag', (b) => { b.theater.passed = false; });
add('performance-pass-flag', (b) => { b.performance.passed = false; });
add('regression-pass-flag', (b) => { b.regression.passed = false; });
add('reload-count', (b) => { b.browser.realReloads.pop(); });
add('reload-reason', (b) => { b.browser.realReloads[0].reason = 'fake_reason'; });
add('reload-time-origin', (b) => { b.browser.realReloads[0].after.timeOrigin = b.browser.realReloads[0].before.timeOrigin; });
add('reload-loader-id', (b) => { b.browser.realReloads[0].afterLoaderId = b.browser.realReloads[0].beforeLoaderId; });
add('action-source', (b) => { b.browser.actionProvenance[0].source = 'fixture'; });
add('action-synthetic', (b) => { b.browser.actionProvenance[0].syntheticApiCall = true; });
add('remove-double-click-proof', (b) => { b.browser.actionProvenance = b.browser.actionProvenance.filter((row) => row.kind !== 'double_click'); });
add('remove-reload-proof', (b) => { b.browser.actionProvenance = b.browser.actionProvenance.filter((row) => row.kind !== 'real_reload'); });

for (let index = 0; index < 18; index += 1) {
  add(`frame-semantic-${index + 1}`, (b) => { b.browser.scenes[0].frames[index].semantic = 'tampered-semantic'; });
  add(`frame-image-hash-${index + 1}`, (b) => { b.browser.scenes[0].frames[index].imageSha256 = 'tampered-image-hash'; });
  add(`frame-screenshot-hash-${index + 1}`, (b) => { b.browser.scenes[0].frames[index].screenshot.sha256 = 'tampered-screenshot-hash'; });
}

const results = mutations.slice(0, 80).map(({ label, mutate }) => {
  const candidate = clone(base); mutate(candidate); candidate.passed = true;
  const verdict = verifyStage9Evidence(candidate, { checkFiles: false });
  return { label, rejected: verdict.ok === false, failureCodes: verdict.errors.map((row) => row.code) };
});
const rejected = results.filter((row) => row.rejected).length;
const output = {
  stage: '9-A',
  caseCount: results.length,
  rejectionCount: rejected,
  passedFlagOnlyCases: results.filter((row) => row.failureCodes.length === 0).length,
  cases: results,
  passed: results.length >= 80 && rejected === results.length && results.every((row) => row.failureCodes.length > 0)
};
fs.writeFileSync('stage9_a_tamper_results.json', `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true, JSON.stringify(output));
const strong = JSON.parse(fs.readFileSync('stage9_a_strong_evidence_verdict.json', 'utf8'));
fs.writeFileSync('stage9_a_strong_evidence_verdict.json', `${JSON.stringify({ ...strong, tamperAudit: { caseCount: output.caseCount, rejectionCount: output.rejectionCount, passedFlagOnlyCases: output.passedFlagOnlyCases, independentlyRejected: output.passed }, tamperAuditPending: false, passed: strong.passed && output.passed }, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, cases: output.caseCount, rejected: output.rejectionCount }));
