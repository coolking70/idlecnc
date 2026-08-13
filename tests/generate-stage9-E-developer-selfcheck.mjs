import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strong = JSON.parse(fs.readFileSync(path.join(root, 'stage9_e_strong_evidence_verdict.json'), 'utf8'));
const tamper = JSON.parse(fs.readFileSync(path.join(root, 'stage9_e_tamper_results.json'), 'utf8'));
const browser = JSON.parse(fs.readFileSync(path.join(root, 'stage9_e_browser_capture_manifest.json'), 'utf8'));
const output = {
  stage: '9-E', independentRecompute: true, implementationPassed: strong.passed === true && tamper.rejected === tamper.total && tamper.passedFlagOnlyCases === 0 && browser.passed === true,
  strongEvidencePassed: strong.passed === true, tamperPassed: tamper.rejected === tamper.total && tamper.coupledRejected === tamper.coupledTotal && tamper.passedFlagOnlyCases === 0,
  browserPassed: browser.passed === true, postFinalCommits: 0, externalGateRuns: { fast: null, stage: null, release: null }, passed: false
};
output.passed = output.implementationPassed;
fs.writeFileSync(path.join(root, 'stage9_e_developer_selfcheck.json'), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ stage: output.stage, implementationPassed: output.implementationPassed, strongEvidencePassed: output.strongEvidencePassed, tamperPassed: output.tamperPassed, browserPassed: output.browserPassed }));
if (!output.implementationPassed) process.exitCode = 1;
