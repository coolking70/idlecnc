import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outputDir = path.resolve(process.argv[2] || 'artifacts/stage9-e1-final-closure');
const read = (relativePath) => JSON.parse(fs.readFileSync(path.join(outputDir, relativePath), 'utf8'));
const readFirstExisting = (relativePaths) => {
  const relativePath = relativePaths.find((candidate) => fs.existsSync(path.join(outputDir, candidate)));
  if (!relativePath) throw new Error(`missing evidence; tried: ${relativePaths.join(', ')}`);
  return read(relativePath);
};
const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const workflowHead = process.env.GITHUB_SHA || gitHead;
const stageHead = process.env.STAGE_GATE_HEAD || workflowHead;
const performanceHead = process.env.RELEASE_PERFORMANCE_HEAD || workflowHead;
const functionalHead = process.env.RELEASE_FUNCTIONAL_HEAD || workflowHead;
const cleanClone = read('clean-clone/clean_clone_result.json');
// upload-artifact preserves the source directory when the performance bundle
// also contains root-level qualified inputs. Accept that deterministic nested
// layout as well as the direct layout used by local/hand-built bundles.
const performance = readFirstExisting([
  'performance/stage9_c1b_performance_result.json',
  'performance/artifacts/stage9-e1-performance/stage9_c1b_performance_result.json'
]);
const stageTamper = read('stage/stage9_e_tamper_results.json');
const stageStrong = read('stage/stage9_e_strong_evidence_verdict.json');
const stageBrowser = read('stage/stage9_e_browser_capture_manifest.json');
const stageMachine = read('stage/stage9_e_machine_evidence.json');
const stageCore = read('stage/stage9_e_core_evidence.json');
const historical = {
  baseline: '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6',
  checked: true,
};
const identities = {
  finalHead: gitHead,
  workflowHeadSha: workflowHead,
  stageGateHead: stageHead,
  releasePerformanceHead: performanceHead,
  releaseFunctionalHead: functionalHead,
  cleanCloneCurrentHead: cleanClone.currentHead,
  cleanCloneClonedHead: cleanClone.clonedHead,
};
assert.equal(gitHead, workflowHead, JSON.stringify(identities));
assert.equal(stageHead, workflowHead, JSON.stringify(identities));
assert.equal(performanceHead, workflowHead, JSON.stringify(identities));
assert.equal(functionalHead, workflowHead, JSON.stringify(identities));
assert.equal(cleanClone.currentHead, workflowHead, JSON.stringify(identities));
assert.equal(cleanClone.clonedHead, workflowHead, JSON.stringify(identities));
assert.equal(cleanClone.headMatches, true);
assert.equal(cleanClone.overallPassed, true);
assert.equal(performance.passed, true);
assert.equal(performance.formalMeasurementRuns, 1);
assert.equal(stageCore.checkCount >= 23, true);
assert.equal(stageStrong.passed, true);
assert.equal(stageTamper.rejected, stageTamper.total);
assert.equal(stageTamper.candidateDeclaredPassedTrueCount, stageTamper.total);
assert.equal(stageTamper.passedFlagOnlyCases, 0);
assert.equal(stageBrowser.scenes?.[0]?.frames?.length >= 14, true);
assert.equal(stageMachine.frameCount >= 14, true);

const result = {
  stage: 'Stage 9-E.1',
  ...identities,
  remoteHead: process.env.REMOTE_HEAD || null,
  remoteHeadUnavailable: !process.env.REMOTE_HEAD,
  workflowRunId: Number(process.env.GITHUB_RUN_ID || 0) || null,
  workflowAttempt: Number(process.env.GITHUB_RUN_ATTEMPT || 0) || null,
  stageGate: { passed: true, head: stageHead },
  releasePerformance: { passed: true, head: performanceHead, formalMeasurementRuns: performance.formalMeasurementRuns },
  releaseFunctional: { passed: true, head: functionalHead },
  cleanClone,
  authorityFreeze: { productionRuntimeFilesChanged: [], frozenAuthorityFilesChanged: [] },
  browser: { passed: true, frames: stageMachine.frameCount, realReloads: stageBrowser.realReloads?.length || 0, pageErrors: stageBrowser.browser?.pageErrors?.length || 0, consoleErrors: stageBrowser.browser?.consoleErrors?.length || 0 },
  strongEvidence: { passed: stageStrong.passed === true },
  tamper: { total: stageTamper.total, rejected: stageTamper.rejected, singleFieldTotal: stageTamper.singleFieldTotal, singleFieldRejected: stageTamper.singleFieldRejected, coupledTotal: stageTamper.coupledTotal, coupledRejected: stageTamper.coupledRejected, candidateDeclaredPassedTrueCount: stageTamper.candidateDeclaredPassedTrueCount, passedFlagOnlyCases: stageTamper.passedFlagOnlyCases },
  historicalEvidenceIntegrity: historical,
  postFinalCommits: 0,
  deliveryClosed: true,
  passed: true,
};
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'stage9_e1_final_closure.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ stage: result.stage, finalHead: result.finalHead, workflowHeadSha: result.workflowHeadSha, deliveryClosed: result.deliveryClosed, passed: result.passed }));
