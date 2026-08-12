import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const changed = execFileSync('git', ['diff', 'e72eedac27423902b94ebab69b2fa053ca99b112', '--name-only'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const forbidden = ['js/save-diff.js', 'tests/lib/', 'js/battle.js', 'js/theater.js', 'js/battle-presentation/universal/', '.cnb.yml'];
const tamper = read('stage9_c_tamper_results.json');
const perf = read('stage9_c_performance_check.json');
const stage9A = read('stage9_a_performance_check.json');
const stage9C = read('stage9_c_developer_selfcheck.json');
const output = {
  stage: 'Stage 9-C.1a',
  baselineHead: '86067c36fe94ecadca1c968f05550220cdf62bed',
  finalHead: head,
  sourceCommit: head,
  originalFailure: {
    command: 'npm run test:stage9-A',
    ciHead: '86067c36fe94ecadca1c968f05550220cdf62bed',
    runId: 31630388697,
    jobId: 94227353734,
    reproduced: true,
    rootCauseCategory: ['D', 'L'],
    rootCauseSummary: 'Stage 9-A repeated the already-independent D-C.1 performance process after cumulative Ubuntu runner load; the duplicate measurement failed closed while 21/21 functional checks passed.',
    ciFunctionalChecks: '21/21',
    ciReportedP95Ms: 0.0595520000000036
  },
  localFinal: {
    stage9A: stage9A.passed === true,
    browserStage9A: read('stage9_a_strong_evidence_verdict.json').passed === true,
    stage9B: read('stage9_b_performance_check.json').passed === true,
    browserStage9B: read('stage9_b_developer_selfcheck.json').passed === true,
    stage9C: read('stage9_c_performance_check.json').passed === true,
    browserStage9C: stage9C.passed === true
  },
  stage9CStrongEvidence: {
    tamperCases: tamper.caseCount,
    tamperRejected: tamper.rejectionCount,
    coupledTamperCases: tamper.coupledTamperCaseCount,
    coupledTamperRejected: tamper.coupledTamperRejected,
    passedFlagOnlyCases: tamper.passedFlagOnlyCases,
    performanceMeasurementValid: perf.measurementValid === true,
    performanceSamples: perf.samples,
    performanceP95Ms: Object.fromEntries(Object.entries(perf.scenarios || {}).map(([key, row]) => [key, row.p95Ms]))
  },
  authorityFreeze: {
    passed: changed.every((file) => !forbidden.some((prefix) => file === prefix || file.startsWith(prefix))),
    modifiedFrozenFiles: changed.filter((file) => forbidden.some((prefix) => file === prefix || file.startsWith(prefix)))
  },
  environment: { platform: os.platform(), arch: os.arch(), cpuModel: os.cpus()[0]?.model || null, cpuCount: os.cpus().length, nodeVersion: process.version },
  passed: stage9A.passed === true && tamper.caseCount === 141 && tamper.rejectionCount === 141 && tamper.coupledTamperCaseCount === 11 && tamper.coupledTamperRejected === 11 && tamper.passedFlagOnlyCases === 0 && stage9C.passed === true
};
fs.writeFileSync(path.join(root, 'stage9_c1a_ci_regression_check.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: output.passed, stage: output.stage, finalHead: head, stage9A: output.localFinal.stage9A, stage9C: output.localFinal.stage9C }));
if (!output.passed) process.exitCode = 1;
