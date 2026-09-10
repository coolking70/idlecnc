import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { verifyStage10PABrowser, verifyStage10PAMachineEvidence } from './lib/stage10-P-A-verifier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'evidence/stage10-P-A');
const original = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'stage10-P-A-browser.json'), 'utf8'));
const originalMachine = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'stage10-P-A-machine.json'), 'utf8'));
const originalEquivalence = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'stage10-P-A-state-equivalence.json'), 'utf8'));
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const requiredGates = ['historical-core-regression', 'stage9-relevant-regression', 'stage10-focused-tests', 'stage10-browser'];
const clone = (value) => JSON.parse(JSON.stringify(value));

const browserCases = [
  ['declared passed only', (candidate) => { Object.keys(candidate).forEach((key) => delete candidate[key]); candidate.stage = '10-P-A'; candidate.passed = true; }],
  ['missing screenshot', (candidate, tempRoot) => { fs.rmSync(path.join(tempRoot, candidate.screenshots[0].path)); }],
  ['duplicate screenshot bytes', (candidate, tempRoot) => { fs.copyFileSync(path.join(tempRoot, candidate.screenshots[0].path), path.join(tempRoot, candidate.screenshots[1].path)); candidate.screenshots[1].sha256 = candidate.screenshots[0].sha256; candidate.screenshots[1].bytes = candidate.screenshots[0].bytes; }],
  ['screenshot hash corruption', (candidate, tempRoot) => { const file = path.join(tempRoot, candidate.screenshots[0].path); const bytes = fs.readFileSync(file); bytes[Math.floor(bytes.length / 2)] ^= 0xff; fs.writeFileSync(file, bytes); }],
  ['missing mobile evidence', (candidate) => { candidate.screenshots = candidate.screenshots.filter((frame) => !frame.mobile); candidate.frameCount = candidate.screenshots.length; candidate.uniqueScreenshotCount = candidate.screenshots.length; candidate.mobileCoverage = { width480: true, width390: true }; }],
  ['missing hover evidence', (candidate) => { candidate.screenshots.forEach((frame) => { frame.tooltip = false; if (frame.dom) frame.dom.tooltipVisible = false; }); candidate.hoverCoverage = true; }],
  ['missing longPress evidence', (candidate) => { candidate.screenshots.forEach((frame) => { frame.longPress = false; if (frame.dom) frame.dom.inspectorVisible = false; }); candidate.longPressCoverage = true; }],
  ['hidden page error', (candidate) => { candidate.pageErrors = ['tampered page exception']; candidate.passed = true; }],
  ['hidden console error', (candidate) => { candidate.consoleErrors = ['tampered console error']; candidate.passed = true; }]
];

// Machine-evidence forgeries. Each case keeps the candidate declaring
// passed=true (or repairs the declared flag) and must still be rejected by the
// independent machine verifier: head binding, authority freeze, state
// equivalence, and runtime gate records cannot be forged by flag flipping.
const machineCases = [
  ['machine head sha mismatch', (candidate) => { candidate.headSha = 'f'.repeat(40); candidate.passed = true; }],
  ['machine gates bound to stale head', (candidate) => { candidate.runtimeGates.headSha = 'e'.repeat(40); candidate.runtimeGates.boundToHead = true; candidate.runtimeGates.gates = Object.fromEntries(requiredGates.map((label) => [label, { exitCode: 0 }])); candidate.passed = true; }],
  ['machine authority changed flag', (candidate) => { candidate.authority.gameplayAuthorityChanged = true; candidate.passed = true; }],
  ['machine frozen proof row changed', (candidate) => { candidate.authority.frozenFileProof[0].unchanged = false; candidate.authority.gameplayAuthorityChanged = false; candidate.passed = true; }],
  ['machine state equivalence false', (candidate, _tempRoot, equivalence) => { const tampered = clone(equivalence); tampered.cases[0].equivalent = false; candidate.canonicalStateEquivalence.caseCount = tampered.cases.length; candidate.passed = true; return tampered; }],
  ['machine gate record removed', (candidate) => { delete candidate.runtimeGates.gates['stage9-relevant-regression']; candidate.runtimeGates.missing = []; candidate.passed = true; }],
  ['machine gate failure hidden by regression flag', (candidate) => { candidate.runtimeGates.gates['historical-core-regression'].exitCode = 1; candidate.runtimeGates.missing = []; candidate.functionalRegression.historicalCoreRegression = true; candidate.passed = true; }]
];

function runBrowserCases() {
  return browserCases.map(([name, mutate]) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage10-pa-tamper-'));
    fs.mkdirSync(path.join(tempRoot, 'screenshots/stage10-P-A'), { recursive: true });
    fs.cpSync(path.join(root, 'screenshots/stage10-P-A'), path.join(tempRoot, 'screenshots/stage10-P-A'), { recursive: true });
    const candidate = clone(original);
    candidate.passed = true;
    mutate(candidate, tempRoot);
    const verdict = verifyStage10PABrowser(candidate, { root: tempRoot });
    fs.rmSync(tempRoot, { recursive: true, force: true });
    return { name, evidence: 'browser', candidateDeclaredPassed: candidate.passed === true, rejected: verdict.passed !== true, failureCount: verdict.failures.length };
  });
}

function runMachineCases() {
  return machineCases.map(([name, mutate]) => {
    const candidate = clone(originalMachine);
    candidate.passed = true;
    const tamperedEquivalence = mutate(candidate, null, originalEquivalence);
    const equivalence = tamperedEquivalence || originalEquivalence;
    const verdict = verifyStage10PAMachineEvidence(candidate, { currentHead: gitHead, requiredGates, stateEquivalence: equivalence });
    return { name, evidence: 'machine', candidateDeclaredPassed: candidate.passed === true, rejected: verdict.passed !== true, failureCount: verdict.failures.length };
  });
}

const results = [...runBrowserCases(), ...runMachineCases()];

const output = {
  stage: '10-P-A',
  independentRecompute: true,
  total: results.length,
  rejected: results.filter((row) => row.rejected).length,
  candidateDeclaredPassedTrueCount: results.filter((row) => row.candidateDeclaredPassed).length,
  passedFlagOnlyCases: results.filter((row) => row.candidateDeclaredPassed && !row.rejected).length,
  corpus: { browser: browserCases.length, machine: machineCases.length },
  results,
  passed: results.every((row) => row.rejected)
};
fs.writeFileSync(path.join(evidenceDir, 'stage10-P-A-tamper.json'), `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.rejected, output.total, JSON.stringify(results, null, 2));
assert.equal(output.passedFlagOnlyCases, 0);
console.log(JSON.stringify({ stage: output.stage, total: output.total, rejected: output.rejected, corpus: output.corpus, passedFlagOnlyCases: output.passedFlagOnlyCases }));
