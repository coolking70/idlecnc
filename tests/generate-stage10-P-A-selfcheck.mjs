import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'evidence/stage10-P-A');
const read = (name) => JSON.parse(fs.readFileSync(path.join(evidenceDir, name), 'utf8'));
const machine = read('stage10-P-A-machine.json');
const browser = read('stage10-P-A-browser.json');
const verdict = read('stage10-P-A-verdict.json');
const tamper = read('stage10-P-A-tamper.json');

const output = {
  stage: '10-P-A',
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
  historicalRegressionPassed: machine.functionalRegression?.historicalCoreRegression === true && machine.functionalRegression?.stage9RelevantRegression === true,
  passed: false
};
output.passed = output.gameplayAuthorityChanged === false
  && output.saveVersionChanged === false
  && Object.entries(output).filter(([key]) => key.endsWith('Migrated') || key.endsWith('Passed')).every(([, value]) => value === true)
  && machine.passed === true && browser.passed === true && verdict.passed === true && tamper.passed === true;

const serialized = `${JSON.stringify(output, null, 2)}\n`;
fs.writeFileSync(path.join(evidenceDir, 'stage10-P-A-selfcheck.json'), serialized);
fs.writeFileSync(path.join(root, 'STAGE10-P-A-SELFCHECK.json'), serialized);
console.log(JSON.stringify(output));
if (!output.passed) process.exitCode = 1;
