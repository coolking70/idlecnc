import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { SAVE_VERSION } from '../js/config.js';
import { verifyStage10PABrowser, STAGE10_PA_REQUIRED_FRAMES } from './lib/stage10-P-A-verifier.mjs';

// Final runtime delivery closure for Stage 10-P-A.1.
//
// This closure is produced at RUNTIME by the final CI gate (or a full local
// gate run) after every real gate step has executed and recorded its true exit
// code. Every boolean below is computed from this run's actual inputs:
//   - the runtime gate records bound to the current git HEAD
//   - the machine / browser / equivalence / verdict / tamper evidence
//     regenerated in this run at this HEAD
//   - the fresh Stage 9-E semantic core evidence written by this run's
//     stage9 regression step
//   - git HEAD versus the workflow head (GITHUB_SHA) when running in Actions
// Nothing is hardcoded: a missing artifact, a stale head binding, a failed
// gate, or a head mismatch fails closed with process exit code 1, so a later
// CI step can never declare delivery closure on top of a failing gate.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'evidence/stage10-P-A');
const read = (name) => JSON.parse(fs.readFileSync(path.join(evidenceDir, name), 'utf8'));
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const workflowHead = process.env.GITHUB_SHA || gitHead;
const workflowRunId = process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : null;
const workflowRunAttempt = process.env.GITHUB_RUN_ATTEMPT ? Number(process.env.GITHUB_RUN_ATTEMPT) : null;

const REQUIRED_RUNTIME_GATES = [
  'historical-core-regression',
  'stage9-relevant-regression',
  'stage10-focused-tests',
  'stage10-browser',
  'stage10-strong-verifier'
];

const failures = [];
const requireCondition = (condition, field, expected, actual) => {
  if (condition !== true) failures.push({ field, expected, actual });
};

let gates = null;
try {
  gates = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'stage10-P-A-runtime-gates.json'), 'utf8'));
} catch {
  gates = null;
}
requireCondition(gates?.headSha === gitHead, 'runtimeGates.headSha', gitHead, gates?.headSha || null);
const gateResults = {};
REQUIRED_RUNTIME_GATES.forEach((label) => {
  const record = gates?.gates?.[label];
  gateResults[label] = record ? { exitCode: record.exitCode, durationMs: record.durationMs, finishedAt: record.finishedAt } : null;
  requireCondition(record?.exitCode === 0, `runtimeGates.gates.${label}.exitCode`, 0, record ? record.exitCode : 'missing record');
});

const machine = read('stage10-P-A-machine.json');
const browser = read('stage10-P-A-browser.json');
const verdict = read('stage10-P-A-verdict.json');
const tamper = read('stage10-P-A-tamper.json');
const equivalence = read('stage10-P-A-state-equivalence.json');
let stage9Core = null;
try {
  stage9Core = JSON.parse(fs.readFileSync(path.join(root, 'stage9_e_core_evidence.json'), 'utf8'));
} catch {
  stage9Core = null;
}

requireCondition(gitHead === workflowHead, 'identity.gitHeadEqualsWorkflowHead', workflowHead, gitHead);
requireCondition(machine.stage === '10-P-A', 'machine.stage', '10-P-A', machine.stage);
requireCondition(machine.baseSha === 'ca408bb7031afda79a65af7aad27b6b64b7c18c4', 'machine.baseSha', 'ca408bb7031afda79a65af7aad27b6b64b7c18c4', machine.baseSha);
requireCondition(machine.headSha === gitHead, 'machine.headSha', gitHead, machine.headSha);
requireCondition(machine.saveVersion === 10 && SAVE_VERSION === 10, 'saveVersion', 10, { machine: machine.saveVersion, config: SAVE_VERSION });
requireCondition(machine.authority?.gameplayAuthorityChanged === false, 'machine.authority.gameplayAuthorityChanged', false, machine.authority?.gameplayAuthorityChanged);
requireCondition(machine.authority?.passed === true, 'machine.authority.passed', true, machine.authority?.passed);
requireCondition(machine.passed === true, 'machine.passed', true, machine.passed);

requireCondition(stage9Core?.stage === '9-E', 'stage9CoreEvidence.stage', '9-E', stage9Core?.stage);
requireCondition(stage9Core?.passed === true, 'stage9CoreEvidence.passed', true, stage9Core?.passed);
requireCondition(stage9Core?.checkCount >= 23, 'stage9CoreEvidence.checkCount', '>= 23', stage9Core?.checkCount);
requireCondition(stage9Core?.passedCount === stage9Core?.checkCount, 'stage9CoreEvidence.passedCount', stage9Core?.checkCount, stage9Core?.passedCount);

requireCondition(equivalence.passed === true, 'stateEquivalence.passed', true, equivalence.passed);
requireCondition((equivalence.cases?.length || 0) >= 4, 'stateEquivalence.caseCount', '>= 4', equivalence.cases?.length || 0);
requireCondition(Array.isArray(equivalence.canonicalFieldsAdded) && equivalence.canonicalFieldsAdded.length === 0, 'stateEquivalence.canonicalFieldsAdded', [], equivalence.canonicalFieldsAdded);

requireCondition(browser.passed === true, 'browser.passed', true, browser.passed);
requireCondition(browser.frameCount === STAGE10_PA_REQUIRED_FRAMES.length, 'browser.frameCount', STAGE10_PA_REQUIRED_FRAMES.length, browser.frameCount);
requireCondition(browser.uniqueScreenshotCount >= STAGE10_PA_REQUIRED_FRAMES.length, 'browser.uniqueScreenshotCount', `>= ${STAGE10_PA_REQUIRED_FRAMES.length}`, browser.uniqueScreenshotCount);
requireCondition(Array.isArray(browser.pageErrors) && browser.pageErrors.length === 0, 'browser.pageErrors', 0, browser.pageErrors?.length);
requireCondition(Array.isArray(browser.consoleErrors) && browser.consoleErrors.length === 0, 'browser.consoleErrors', 0, browser.consoleErrors?.length);

const verifiedBrowser = verifyStage10PABrowser(browser, { root });
requireCondition(verifiedBrowser.passed === true, 'independentBrowserVerifier.passed', true, verifiedBrowser.failures);
requireCondition(verifiedBrowser.recomputed?.desktopCoverage === true, 'coverage.desktop', true, verifiedBrowser.recomputed?.desktopCoverage);
requireCondition(verifiedBrowser.recomputed?.mobileCoverage === true, 'coverage.mobile', true, verifiedBrowser.recomputed?.mobileCoverage);
requireCondition(verifiedBrowser.recomputed?.hoverCoverage === true, 'coverage.hover', true, verifiedBrowser.recomputed?.hoverCoverage);
requireCondition(verifiedBrowser.recomputed?.longPressCoverage === true, 'coverage.longPress', true, verifiedBrowser.recomputed?.longPressCoverage);
requireCondition(verifiedBrowser.recomputed?.uniqueScreenshotCount >= STAGE10_PA_REQUIRED_FRAMES.length, 'coverage.uniqueScreenshotHashes', `>= ${STAGE10_PA_REQUIRED_FRAMES.length}`, verifiedBrowser.recomputed?.uniqueScreenshotCount);

requireCondition(verdict.passed === true && verdict.failureCount === 0, 'strongVerifier.passed', true, { passed: verdict.passed, failureCount: verdict.failureCount });
requireCondition(tamper.passed === true, 'tamper.passed', true, tamper.passed);
requireCondition(tamper.rejected === tamper.total, 'tamper.rejected', tamper.total, tamper.rejected);
requireCondition(tamper.passedFlagOnlyCases === 0, 'tamper.passedFlagOnlyCases', 0, tamper.passedFlagOnlyCases);

const selfcheck = JSON.parse(fs.readFileSync(path.join(root, 'STAGE10-P-A-SELFCHECK.json'), 'utf8'));
requireCondition(selfcheck.implementationPassed === true, 'selfcheck.implementationPassed', true, selfcheck.implementationPassed);
requireCondition(selfcheck.deliveryClosed === false, 'selfcheck.deliveryClosed', false, selfcheck.deliveryClosed);
requireCondition(selfcheck.passed === false, 'selfcheck.passed', false, selfcheck.passed);

const passed = failures.length === 0;
const closure = {
  stage: '10-P-A.1',
  scope: 'downstream regression guard fix + final-head delivery closure',
  baseStage9Sha: 'ca408bb7031afda79a65af7aad27b6b64b7c18c4',
  implementationBaseSha: '136b8573eefb85911f35b23c3043f5f5f6c87832',
  finalHead: gitHead,
  workflowHead,
  workflowRunId,
  workflowRunAttempt,
  identity: { gitHeadEqualsWorkflowHead: gitHead === workflowHead, runtimeEnvironment: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local' },
  runtimeGates: {
    headSha: gates?.headSha || null,
    boundToHead: gates?.headSha === gitHead,
    required: REQUIRED_RUNTIME_GATES,
    gates: gateResults
  },
  historicalRegressionPassed: gateResults['historical-core-regression']?.exitCode === 0,
  stage9RegressionPassed: gateResults['stage9-relevant-regression']?.exitCode === 0,
  stage9SemanticChecks: stage9Core ? { checkCount: stage9Core.checkCount, passedCount: stage9Core.passedCount, passed: stage9Core.passed } : null,
  stage10FocusedPassed: gateResults['stage10-focused-tests']?.exitCode === 0,
  stateEquivalencePassed: equivalence.passed === true && (equivalence.cases?.length || 0) >= 4,
  stateEquivalenceCaseCount: equivalence.cases?.length || 0,
  browserPassed: browser.passed === true && verifiedBrowser.passed === true,
  browserFrameCount: browser.frameCount,
  uniqueScreenshotCount: verifiedBrowser.recomputed?.uniqueScreenshotCount ?? browser.uniqueScreenshotCount,
  pageErrors: browser.pageErrors?.length ?? null,
  consoleErrors: browser.consoleErrors?.length ?? null,
  strongEvidencePassed: verdict.passed === true,
  tamperPassed: tamper.passed === true && tamper.rejected === tamper.total,
  tamperCorpus: { total: tamper.total, rejected: tamper.rejected, passedFlagOnlyCases: tamper.passedFlagOnlyCases },
  gameplayAuthorityChanged: machine.authority?.gameplayAuthorityChanged === true,
  saveVersion: SAVE_VERSION,
  deliveryClosed: passed,
  passed
};
if (Array.isArray(failures) && failures.length > 0) closure.failures = failures;

fs.writeFileSync(path.join(evidenceDir, 'stage10-P-A-final-closure.json'), `${JSON.stringify(closure, null, 2)}\n`);
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
console.log(JSON.stringify({ ...closure, closureSha256: sha256(fs.readFileSync(path.join(evidenceDir, 'stage10-P-A-final-closure.json'))) }));
if (!passed) process.exitCode = 1;
