import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyStage10PABrowser } from './lib/stage10-P-A-verifier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'evidence/stage10-P-A');
const original = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'stage10-P-A-browser.json'), 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));

const cases = [
  ['declared passed only', (candidate) => { Object.keys(candidate).forEach((key) => delete candidate[key]); candidate.stage = '10-P-A'; candidate.passed = true; }],
  ['missing screenshot', (candidate, tempRoot) => { fs.rmSync(path.join(tempRoot, candidate.screenshots[0].path)); }],
  ['duplicate screenshot bytes', (candidate, tempRoot) => { fs.copyFileSync(path.join(tempRoot, candidate.screenshots[0].path), path.join(tempRoot, candidate.screenshots[1].path)); candidate.screenshots[1].sha256 = candidate.screenshots[0].sha256; candidate.screenshots[1].bytes = candidate.screenshots[0].bytes; }],
  ['missing mobile evidence', (candidate) => { candidate.screenshots = candidate.screenshots.filter((frame) => !frame.mobile); candidate.frameCount = candidate.screenshots.length; candidate.uniqueScreenshotCount = candidate.screenshots.length; candidate.mobileCoverage = { width480: true, width390: true }; }],
  ['missing hover evidence', (candidate) => { candidate.screenshots.forEach((frame) => { frame.tooltip = false; if (frame.dom) frame.dom.tooltipVisible = false; }); candidate.hoverCoverage = true; }],
  ['missing longPress evidence', (candidate) => { candidate.screenshots.forEach((frame) => { frame.longPress = false; if (frame.dom) frame.dom.inspectorVisible = false; }); candidate.longPressCoverage = true; }],
  ['hidden page error', (candidate) => { candidate.pageErrors = ['tampered page exception']; candidate.passed = true; }],
  ['hidden console error', (candidate) => { candidate.consoleErrors = ['tampered console error']; candidate.passed = true; }]
];

const results = cases.map(([name, mutate]) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage10-pa-tamper-'));
  fs.mkdirSync(path.join(tempRoot, 'screenshots/stage10-P-A'), { recursive: true });
  fs.cpSync(path.join(root, 'screenshots/stage10-P-A'), path.join(tempRoot, 'screenshots/stage10-P-A'), { recursive: true });
  const candidate = clone(original);
  candidate.passed = true;
  mutate(candidate, tempRoot);
  const verdict = verifyStage10PABrowser(candidate, { root: tempRoot });
  fs.rmSync(tempRoot, { recursive: true, force: true });
  return { name, candidateDeclaredPassed: candidate.passed === true, rejected: verdict.passed !== true, failureCount: verdict.failures.length };
});

const output = {
  stage: '10-P-A',
  independentRecompute: true,
  total: results.length,
  rejected: results.filter((row) => row.rejected).length,
  candidateDeclaredPassedTrueCount: results.filter((row) => row.candidateDeclaredPassed).length,
  passedFlagOnlyCases: results.filter((row) => row.candidateDeclaredPassed && !row.rejected).length,
  results,
  passed: results.every((row) => row.rejected)
};
fs.writeFileSync(path.join(evidenceDir, 'stage10-P-A-tamper.json'), `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.rejected, output.total, JSON.stringify(results, null, 2));
assert.equal(output.passedFlagOnlyCases, 0);
console.log(JSON.stringify({ stage: output.stage, total: output.total, rejected: output.rejected, passedFlagOnlyCases: output.passedFlagOnlyCases }));
