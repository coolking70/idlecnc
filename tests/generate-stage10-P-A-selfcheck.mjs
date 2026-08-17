import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Static implementation selfcheck for Stage 10-P-A.
//
// This file is a DEVELOPMENT-side checkpoint only. It distinguishes:
//   implementationPassed - the implementation-level evidence (machine,
//                          browser, equivalence, strong verdict, tamper) is
//                          complete and passing for this checkpoint.
//   deliveryClosed       - false here by contract. The final delivery closure
//                          is only produced by the final CI runtime closure
//                          (tests/generate-stage10-P-A-final-closure.mjs),
//                          which binds the same evidence to the workflow HEAD
//                          and run identity.
//   passed               - false here by contract (deliveryClosed is false).
// A committed selfcheck may never claim delivery closure; otherwise a
// repository could again contain "selfcheck says PASS" while the real CI gate
// is failing.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'evidence/stage10-P-A');
const read = (name) => JSON.parse(fs.readFileSync(path.join(evidenceDir, name), 'utf8'));
const machine = read('stage10-P-A-machine.json');
const browser = read('stage10-P-A-browser.json');
const verdict = read('stage10-P-A-verdict.json');
const tamper = read('stage10-P-A-tamper.json');

const output = {
  stage: '10-P-A',
  scope: 'implementation static selfcheck; delivery closure is produced only by the final CI runtime closure (evidence/stage10-P-A/stage10-P-A-final-closure.json)',
  implementationCheckpointHeadSha: machine.headSha,
  baseStage9Sha: machine.baseSha,
  gameplayAuthorityChanged: machine.authority?.gameplayAuthorityChanged !== false,
  saveVersionChanged: machine.saveVersion !== 10,
  constructionMigrated: machine.componentChecks?.presentationModels === true,
  unitProductionMigrated: machine.componentChecks?.presentationModels === true,
  equipmentProductionMigrated: machine.componentChecks?.presentationModels === true,
  queueMigrated: machine.componentChecks?.commandQueue === true,
  desktopPassed: verdict.recomputed?.desktopCoverage === true,
  mobilePassed: verdict.recomputed?.mobileCoverage === true,
  hoverPassed: verdict.recomputed?.hoverCoverage === true,
  longPressPassed: verdict.recomputed?.longPressCoverage === true,
  historicalRegressionPassed: machine.functionalRegression?.historicalCoreRegression === true,
  stage9RegressionPassed: machine.functionalRegression?.stage9RelevantRegression === true,
  focusedTestsPassed: machine.functionalRegression?.stage10CommandUiTests === true,
  stateEquivalencePassed: machine.canonicalStateEquivalence?.passed === true && machine.canonicalStateEquivalence?.caseCount >= 4,
  browserEvidencePassed: machine.functionalRegression?.stage10BrowserEvidence === true,
  strongEvidencePassed: verdict.passed === true,
  tamperPassed: tamper.passed === true && tamper.rejected === tamper.total && tamper.passedFlagOnlyCases === 0,
  implementationPassed: false,
  deliveryClosed: false,
  externalGateRuns: { finalClosureWorkflowRunId: null, finalClosureHead: null, finalClosureConclusion: null },
  passed: false
};

output.implementationPassed = output.gameplayAuthorityChanged === false
  && output.saveVersionChanged === false
  && ['constructionMigrated', 'unitProductionMigrated', 'equipmentProductionMigrated', 'queueMigrated',
    'desktopPassed', 'mobilePassed', 'hoverPassed', 'longPressPassed',
    'historicalRegressionPassed', 'stage9RegressionPassed', 'focusedTestsPassed',
    'stateEquivalencePassed', 'browserEvidencePassed', 'strongEvidencePassed', 'tamperPassed'
  ].every((key) => output[key] === true)
  && machine.passed === true && browser.passed === true;
output.passed = output.implementationPassed === true && output.deliveryClosed === true;

const serialized = `${JSON.stringify(output, null, 2)}\n`;
fs.writeFileSync(path.join(evidenceDir, 'stage10-P-A-selfcheck.json'), serialized);
fs.writeFileSync(path.join(root, 'STAGE10-P-A-SELFCHECK.json'), serialized);
console.log(JSON.stringify({ stage: output.stage, implementationPassed: output.implementationPassed, deliveryClosed: output.deliveryClosed, passed: output.passed }));
if (!output.implementationPassed) process.exitCode = 1;
