import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyStage10PABrowser, verifyStage10PAMachineEvidence } from './lib/stage10-P-A-verifier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'evidence/stage10-P-A');
const read = (name) => JSON.parse(fs.readFileSync(path.join(evidenceDir, name), 'utf8'));
const browser = read('stage10-P-A-browser.json');
const machine = read('stage10-P-A-machine.json');
const stateEquivalence = read('stage10-P-A-state-equivalence.json');
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const verified = verifyStage10PABrowser(browser, { root });
const machineVerified = verifyStage10PAMachineEvidence(machine, {
  currentHead: gitHead,
  requiredGates: ['historical-core-regression', 'stage9-relevant-regression', 'stage10-focused-tests', 'stage10-browser'],
  stateEquivalence
});

const failures = [...verified.failures, ...machineVerified.failures];
if (machine.stage !== '10-P-A') failures.push({ field: 'machine.stage', expected: '10-P-A', actual: machine.stage });
if (machine.baseSha !== 'ca408bb7031afda79a65af7aad27b6b64b7c18c4') failures.push({ field: 'machine.baseSha', expected: 'ca408bb7031afda79a65af7aad27b6b64b7c18c4', actual: machine.baseSha });
if (machine.saveVersion !== 10) failures.push({ field: 'machine.saveVersion', expected: 10, actual: machine.saveVersion });
if (machine.currentStage !== '10-P-A') failures.push({ field: 'machine.currentStage', expected: '10-P-A', actual: machine.currentStage });
if (machine.authority?.gameplayAuthorityChanged !== false || machine.authority?.passed !== true) failures.push({ field: 'machine.authority', expected: 'frozen and passed', actual: machine.authority });
if (!Object.values(machine.componentChecks || {}).every(Boolean)) failures.push({ field: 'machine.componentChecks', expected: 'all true', actual: machine.componentChecks });
if (!Object.values(machine.functionalRegression || {}).every(Boolean)) failures.push({ field: 'machine.functionalRegression', expected: 'all true', actual: machine.functionalRegression });
if (stateEquivalence.stage !== '10-P-A' || stateEquivalence.saveVersion !== 10 || stateEquivalence.passed !== true || stateEquivalence.canonicalFieldsAdded?.length !== 0 || !stateEquivalence.cases?.every((row) => row.equivalent === true)) {
  failures.push({ field: 'canonicalStateEquivalence', expected: 'read-only presentation with four equivalent cases', actual: stateEquivalence });
}
if (machine.canonicalStateEquivalence?.passed !== true || machine.canonicalStateEquivalence?.caseCount !== stateEquivalence.cases.length) failures.push({ field: 'machine.canonicalStateEquivalence', expected: { passed: true, caseCount: stateEquivalence.cases.length }, actual: machine.canonicalStateEquivalence });

const output = {
  stage: '10-P-A',
  verifier: 'tests/lib/stage10-P-A-verifier.mjs',
  independentRecompute: true,
  passed: failures.length === 0,
  failureCount: failures.length,
  failures,
  recomputed: verified.recomputed,
  machineRecomputed: { machineHeadSha: machine.headSha, currentHead: gitHead, headBound: machine.headSha === gitHead, runtimeGatesBound: machine.runtimeGates?.boundToHead === true }
};
fs.writeFileSync(path.join(evidenceDir, 'stage10-P-A-verdict.json'), `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true, JSON.stringify(failures, null, 2));
console.log(JSON.stringify({ stage: output.stage, passed: output.passed, failureCount: output.failureCount, recomputed: output.recomputed }));
