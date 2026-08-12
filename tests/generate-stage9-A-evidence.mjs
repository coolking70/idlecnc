import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => JSON.parse(fs.readFileSync(name, 'utf8'));
const unit = read('stage9_a_mission_generalization_check.json');
const coverage = read('stage9_a_coverage_rebaseline.json');
const browser = read('stage9_a_browser_capture_manifest.json');
const machine = read('stage9_a_machine_evidence.json');
const required = [
  'stage9_a_theater_chain_check.json', 'stage9_a_eligibility_check.json', 'stage9_a_migration_check.json',
  'stage9_a_full_loop_check.json', 'stage9_a_offline_boundary_check.json', 'stage9_a_save_diff_check.json',
  'stage9_a_authority_check.json', 'stage9_a_performance_check.json', 'stage9_a_regression_check.json'
];
required.forEach((name) => assert.equal(read(name).passed, true, `${name} failed`));
assert.equal(unit.passed, unit.total);
assert.equal(coverage.passed, true);
assert.equal(browser.passed, true);
assert.equal(machine.frameCount, 18);

const output = {
  stage: '9-A',
  generatedBy: 'tests/generate-stage9-A-evidence.mjs',
  machine: { ...machine },
  theater: read('stage9_a_theater_chain_check.json'),
  missionGeneralization: unit,
  eligibility: read('stage9_a_eligibility_check.json'),
  migration: read('stage9_a_migration_check.json'),
  fullLoop: read('stage9_a_full_loop_check.json'),
  offline: read('stage9_a_offline_boundary_check.json'),
  saveDiff: read('stage9_a_save_diff_check.json'),
  authority: read('stage9_a_authority_check.json'),
  coverage,
  performance: read('stage9_a_performance_check.json'),
  regression: read('stage9_a_regression_check.json'),
  browser,
  passed: true
};
fs.writeFileSync('stage9_a_evidence_bundle.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frames: browser.browser.captureCount, missionCells: coverage.after }));
