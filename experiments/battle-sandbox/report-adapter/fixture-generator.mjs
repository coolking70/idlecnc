import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENARIOS, rebuildScenarioInput } from './fixture-scenarios.js';
import { simulateBattle } from '../../../js/battle.js';
import { compareBattleReports } from '../../../js/integrity.js';
import { buildPresentationContract } from './presentation-contract.js';
import { buildFixtureManifest, firstDifference, hashFile, hashJson, sha256, validateFixtureShape } from './fixture-integrity.js';
import { FIXTURE_VERSION, countReportEvents, scenarioMatchesReport } from './schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../../..');
const fixtureDir = path.join(here, 'fixtures');
const manifestPath = path.join(here, 'fixture-manifest.json');

function solve(scenario) {
  for (let seed = scenario.seed; seed <= 50000; seed += 1) {
    const input = rebuildScenarioInput({ ...scenario, seed });
    const report = simulateBattle(input);
    if (report.result !== scenario.expectedResult) continue;
    const contract = buildPresentationContract(report);
    if (scenario.requireValidation && !contract.validation.ok) continue;
    if (scenario.requireSupportedContract && !contract.diagnostics.supported) continue;
    return { seed, input, report, contract };
  }
  throw new Error(`No ${scenario.expectedResult} result found for ${scenario.id} within seed search range`);
}

function buildExpectedArtifacts() {
  return SCENARIOS.map((scenario) => {
    const solved = solve(scenario);
    const reportAgain = simulateBattle({ ...solved.input, seed: solved.seed });
    const comparison = compareBattleReports(reportAgain, solved.report);
    if (!comparison.ok) throw new Error(`Deterministic comparison failed for ${scenario.id}`);
    const fixture = JSON.parse(JSON.stringify({ fixtureVersion: FIXTURE_VERSION, scenario: { ...scenario, seed: solved.seed }, report: solved.report }));
    return { id: scenario.id, file: `${scenario.id}.json`, fixture, contract: solved.contract, serialized: `${JSON.stringify(fixture, null, 2)}\n` };
  });
}

function expectedIndex(artifacts) {
  return artifacts.map(({ id, file, fixture }) => ({
    id, file, expectedResult: fixture.scenario.expectedResult, seed: fixture.scenario.seed,
    reportHash: hashJson(fixture.report),
    counts: countReportEvents(fixture.report)
  }));
}

function expectedManifest(artifacts) {
  return buildFixtureManifest(artifacts.map(({ id, file, fixture, contract, serialized }) => ({
    id, file, fixture, contract, fileHash: hashBuffer(serialized)
  })), projectRoot);
}

function hashBuffer(value) {
  return sha256(Buffer.from(value));
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }

function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`); }

function compareDirectory(directory, artifacts, manifest, index) {
  const problems = [];
  const diskIndexPath = path.join(directory, 'index.json');
  const diskManifestPath = directory === fixtureDir ? manifestPath : path.join(directory, 'fixture-manifest.json');
  if (!fs.existsSync(diskIndexPath)) problems.push({ path: 'index.json', summary: 'missing index.json' });
  if (!fs.existsSync(diskManifestPath)) problems.push({ path: 'fixture-manifest.json', summary: 'missing fixture-manifest.json' });
  for (const artifact of artifacts) {
    const filePath = path.join(directory, artifact.file);
    if (!fs.existsSync(filePath)) { problems.push({ path: artifact.file, summary: 'missing fixture' }); continue; }
    let disk;
    try { disk = readJson(filePath); } catch (error) { problems.push({ path: artifact.file, summary: error.message }); continue; }
    const shape = validateFixtureShape(disk);
    if (!shape.ok) problems.push({ path: artifact.file, summary: shape.errors.join('; ') });
    const difference = firstDifference(artifact.fixture, disk);
    if (difference) problems.push({ path: `${artifact.file}:${difference.path}`, summary: 'fixture content differs', expected: difference.expected, actual: difference.actual });
    if (hashFile(filePath) !== hashBuffer(artifact.serialized)) problems.push({ path: `${artifact.file}:fileHash`, summary: 'serialized fixture hash differs' });
    if (!scenarioMatchesReport(disk)) problems.push({ path: `${artifact.file}:scenario`, summary: 'scenario/report metadata differs' });
  }
  if (fs.existsSync(diskIndexPath)) {
    const difference = firstDifference(index, readJson(diskIndexPath));
    if (difference) problems.push({ path: `index.json:${difference.path}`, summary: 'index differs', expected: difference.expected, actual: difference.actual });
  }
  if (fs.existsSync(diskManifestPath)) {
    const difference = firstDifference(manifest, readJson(diskManifestPath));
    if (difference) problems.push({ path: `fixture-manifest.json:${difference.path}`, summary: 'manifest differs', expected: difference.expected, actual: difference.actual });
  }
  return problems;
}

function writeDirectory(directory, artifacts, manifest, index) {
  fs.mkdirSync(directory, { recursive: true });
  artifacts.forEach(({ file, serialized }) => fs.writeFileSync(path.join(directory, file), serialized));
  writeJson(path.join(directory, 'index.json'), index);
  writeJson(path.join(directory, 'fixture-manifest.json'), manifest);
}

function printSummary(artifacts, manifest) {
  for (const { id, fixture } of artifacts) console.log(JSON.stringify({
    id, reportId: fixture.report.id, seed: fixture.report.seed, result: fixture.report.result, counts: countReportEvents(fixture.report)
  }));
  console.log(`formalBoundaryHash: ${manifest.formalBoundaryHash}`);
}

function checkMode(artifacts, manifest, index, directory = fixtureDir) {
  const problems = compareDirectory(directory, artifacts, manifest, index);
  if (problems.length) {
    const problem = problems[0];
    console.error(`Fixture mismatch: ${problem.path}`);
    console.error(problem.summary);
    if (problem.expected !== undefined || problem.actual !== undefined) console.error(JSON.stringify({ expected: problem.expected, actual: problem.actual }, null, 2));
    return false;
  }
  printSummary(artifacts, manifest);
  console.log('fixture-generator --check: ok');
  return true;
}

function writeMode(artifacts, manifest, index) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'iron-command-fixtures-'));
  const tempManifest = path.join(tempDirectory, 'fixture-manifest.json');
  const tempIndex = index;
  try {
    writeDirectory(tempDirectory, artifacts, manifest, tempIndex);
    const tempProblems = compareDirectory(tempDirectory, artifacts, manifest, tempIndex);
    if (tempProblems.length) throw new Error(`temporary fixture validation failed: ${tempProblems[0].path} ${tempProblems[0].summary}`);
    const backupDirectory = `${fixtureDir}.backup`;
    const backupManifest = `${manifestPath}.backup`;
    if (fs.existsSync(backupDirectory)) fs.rmSync(backupDirectory, { recursive: true, force: true });
    if (fs.existsSync(backupManifest)) fs.rmSync(backupManifest, { force: true });
    if (fs.existsSync(fixtureDir)) fs.renameSync(fixtureDir, backupDirectory);
    if (fs.existsSync(manifestPath)) fs.renameSync(manifestPath, backupManifest);
    try {
      fs.renameSync(tempDirectory, fixtureDir);
      fs.renameSync(path.join(fixtureDir, 'fixture-manifest.json'), manifestPath);
      const finalProblems = compareDirectory(fixtureDir, artifacts, manifest, tempIndex);
      if (finalProblems.length) throw new Error(`written fixture validation failed: ${finalProblems[0].path} ${finalProblems[0].summary}`);
      if (fs.existsSync(backupDirectory)) fs.rmSync(backupDirectory, { recursive: true, force: true });
      if (fs.existsSync(backupManifest)) fs.rmSync(backupManifest, { force: true });
    } catch (error) {
      if (fs.existsSync(fixtureDir)) fs.rmSync(fixtureDir, { recursive: true, force: true });
      if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath, { force: true });
      if (fs.existsSync(backupDirectory)) fs.renameSync(backupDirectory, fixtureDir);
      if (fs.existsSync(backupManifest)) fs.renameSync(backupManifest, manifestPath);
      throw error;
    }
    printSummary(artifacts, manifest);
    console.log('fixture-generator --write: ok');
    return true;
  } finally {
    if (fs.existsSync(tempDirectory)) fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--check') || process.argv.length === 2 ? 'check' : null;
if (!mode) { console.error('Usage: node fixture-generator.mjs --check|--write'); process.exitCode = 2; }
else {
  try {
    const artifacts = buildExpectedArtifacts();
    const manifest = expectedManifest(artifacts);
    const index = expectedIndex(artifacts);
    const ok = mode === 'write' ? writeMode(artifacts, manifest, index) : checkMode(artifacts, manifest, index);
    if (!ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack || error.message); process.exitCode = 1;
  }
}
