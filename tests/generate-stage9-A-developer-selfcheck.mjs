import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

import { STAGE9_SEMANTIC_SHARED_FILES, readStage9FrozenAuthorityStatus } from './lib/stage9-frozen-authority.mjs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const workflow = fs.readFileSync('.github/workflows/core-regression.yml', 'utf8');
const manifest = JSON.parse(fs.readFileSync('stage9_a_browser_capture_manifest.json', 'utf8'));
const tamper = JSON.parse(fs.readFileSync('stage9_a_tamper_results.json', 'utf8'));
// Stage 9-A is a regression on the accepted Stage 9-D.1 baseline here.
// Using the original 9-A baseline would reclassify already accepted theater
// snapshot wiring as a new authority change.
const baseline = '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6';
const committed = execFileSync('git', ['diff', '--name-only', `${baseline}..HEAD`], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const working = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const changedFiles = [...new Set([...committed, ...working])].sort();
const allowedPerformanceHelper = 'tests/lib/perf-environment.mjs';

// Anti-tamper: a verifier under tests/lib/ must not change, or evidence could be
// waved through by weakening the thing that checks it. The Stage 10-P-B Command
// UI migration made a blanket ban unsatisfiable — the E-B verifier asserted the
// '战报详情' heading, which the migration deleted along with the standalone
// report card, so that gate can never pass again unless the verifier is updated.
//
// Instead of advancing the baseline (which would wave through every verifier
// change in the Stage 10 window, and impose no constraint afterwards), each
// permitted verifier is pinned to the exact sha256 that was reviewed. The check
// stays fail-closed in both directions: an unlisted verifier change is a
// violation, and a listed file that no longer matches its recorded hash is also
// a violation. Changing one of these again requires recording the new hash here,
// which puts the change in the diff where a human has to look at it.
const REVIEWED_VERIFIER_HASHES = {
  // report_view realigned from the deleted '战报详情' heading to the seed row the
  // Command Inspector always renders for a report.
  'tests/lib/stage8-2G-EB-strong-integration-verifier.mjs': 'd1c39f0daadfa0ca0b2c3e439d6112f536c41083a774f258b1539ddb6476e4e3',
  // Stage 10-A/B/E moved theater/offline/formations/save/save-diff from byte
  // freeze to the documented additive-only export contract.
  'tests/lib/stage9-frozen-authority.mjs': '6cb07e7527ae38370f618bc08d038f02d68222528e14a923145006264c332e91',
  // Added by Stage 10-P-A; did not exist at this baseline.
  'tests/lib/stage10-P-A-verifier.mjs': 'cdde7d6bd004c7be9e519363816d148d580c9d01518646ccf9f5c9fcdd347cb9'
};
const sha256OfFile = (file) => {
  try { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch { return null; }
};
const verifierChangeAllowed = (file) => {
  const expected = REVIEWED_VERIFIER_HASHES[file];
  return Boolean(expected) && sha256OfFile(file) === expected;
};

// Stage 10-A through 10-E legitimately extend the shared integration files.
// Those are governed by the shared Stage 9 frozen-authority guard under its
// additive-only export contract, so defer to that guard rather than re-freezing
// them against this stage's older baseline. Fail-closed: nothing is excused
// unless the shared guard itself passes.
const stage9Authority = readStage9FrozenAuthorityStatus(process.cwd());
const sharedAdditiveOk = (file) => stage9Authority.passed && STAGE9_SEMANTIC_SHARED_FILES.includes(file);

const forbiddenPrefixes = ['js/battle.js', 'js/save-diff.js', 'js/battle-presentation/universal/', 'experiments/battle-sandbox/universal-planner/universal-planner.js'];
const forbiddenChangedFiles = changedFiles.filter((file) => {
  if (file.startsWith('tests/lib/')) return file !== allowedPerformanceHelper && !verifierChangeAllowed(file);
  if (sharedAdditiveOk(file)) return false;
  return forbiddenPrefixes.some((prefix) => file === prefix || file.startsWith(prefix));
});
// A pinned verifier that drifted from its recorded hash is a violation even if
// git reports no change against the baseline (e.g. an uncommitted edit).
Object.keys(REVIEWED_VERIFIER_HASHES).forEach((file) => {
  if (!verifierChangeAllowed(file) && !forbiddenChangedFiles.includes(file)) forbiddenChangedFiles.push(file);
});
const output = {
  stage: '9-A',
  changedFiles,
  forbiddenChangedFiles,
  forbiddenAuthorityPaths: forbiddenPrefixes,
  allowedPerformanceHelper,
  package: { testStage9: typeof pkg.scripts['test:stage9-A'] === 'string', browserStage9: typeof pkg.scripts['browser:stage9-A'] === 'string', posttestIncludesStage9: String(pkg.scripts.posttest).includes('test:stage9-A'), gateIncludesStage9: String(pkg.scripts['gate:stage8-2G']).includes('browser:stage9-A') },
  workflow: { testStage9: workflow.includes('npm run test:stage9-A'), browserStage9: workflow.includes('npm run browser:stage9-A') },
  browser: { productionEntry: manifest.productionEntry, fixtureLoaderUsed: manifest.fixtureLoaderUsed, dispatchApiUsed: manifest.dispatchApiUsed, replayApiUsed: manifest.replayApiUsed, offlineApiUsed: manifest.offlineApiUsed, frameCount: manifest.browser.captureCount },
  tamper: { caseCount: tamper.caseCount, rejectionCount: tamper.rejectionCount, passedFlagOnlyCases: tamper.passedFlagOnlyCases },
  passed: forbiddenChangedFiles.length === 0 && typeof pkg.scripts['test:stage9-A'] === 'string' && typeof pkg.scripts['browser:stage9-A'] === 'string' && String(pkg.scripts.posttest).includes('test:stage9-A') && String(pkg.scripts['gate:stage8-2G']).includes('browser:stage9-A') && workflow.includes('npm run test:stage9-A') && workflow.includes('npm run browser:stage9-A') && manifest.productionEntry === true && manifest.fixtureLoaderUsed === false && tamper.caseCount >= 80 && tamper.rejectionCount === tamper.caseCount && tamper.passedFlagOnlyCases === 0
};
fs.writeFileSync('stage9_a_developer_selfcheck.json', `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true, JSON.stringify(output));
console.log(JSON.stringify({ ok: true, stage: output.stage, changedFiles: changedFiles.length, tamperCases: tamper.caseCount }));
