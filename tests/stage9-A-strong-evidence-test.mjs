import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const bundle = read('stage9_a_evidence_bundle.json');
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');

export function verifyStage9Evidence(candidate, { checkFiles = true } = {}) {
  const errors = [];
  const fail = (code, detail) => errors.push({ code, detail });
  const machine = candidate.machine || {};
  const browser = candidate.browser || {};
  const manifest = browser.browser || {};
  const frames = browser.scenes?.[0]?.frames || [];
  if (candidate.stage !== '9-A') fail('stage');
  if (machine.frameCount !== 18 || frames.length !== 18) fail('frame_count', { machine: machine.frameCount, frames: frames.length });
  if (machine.productionEntry !== true || machine.fixtureLoaderUsed === true || machine.dispatchApiUsed === true || machine.replayApiUsed === true || machine.offlineApiUsed === true) fail('machine_provenance');
  if (browser.productionEntry !== true || browser.fixtureLoaderUsed === true || browser.dispatchApiUsed === true || browser.replayApiUsed === true || browser.offlineApiUsed === true) fail('browser_provenance');
  if (browser.prerequisiteStateSeeded !== true) fail('prerequisite_seed_disclosure');
  if (manifest.captureCount !== 18 || manifest.uniqueImageHashes !== 18) fail('browser_capture_counts');
  if ((manifest.pageErrors || []).length || (manifest.consoleErrors || []).length) fail('browser_errors');
  const expected = (candidate.machine.frames || []).map((row) => row.semantic);
  if (frames.map((row) => row.semantic).join('|') !== expected.join('|')) fail('semantic_frame_order');
  const hashes = new Set();
  frames.forEach((frame) => {
    if (!frame.imageSha256 || hashes.has(frame.imageSha256)) fail('duplicate_or_missing_frame_hash', frame.file);
    hashes.add(frame.imageSha256);
    if (frame.screenshot?.sha256 !== frame.imageSha256) fail('screenshot_hash_mismatch', frame.file);
    if (checkFiles) {
      const imagePath = frame.screenshot?.path;
      if (!imagePath || !fs.existsSync(path.join(root, imagePath))) fail('missing_screenshot', imagePath);
      else if (sha256(imagePath) !== frame.imageSha256 || frame.screenshot.sha256 !== frame.imageSha256) fail('screenshot_hash_mismatch', frame.file);
    }
  });
  const actions = browser.actionProvenance || [];
  if (!actions.length || actions.some((row) => row.source !== 'production_ui' || row.syntheticApiCall !== false)) fail('action_provenance');
  if (!actions.some((row) => row.kind === 'double_click') || !actions.some((row) => row.kind === 'real_reload')) fail('required_action_provenance');
  const reloadReasons = (browser.realReloads || []).map((row) => row.reason);
  if (reloadReasons.join('|') !== 'deployment_review|running_battle|result|replay') fail('reload_reasons', reloadReasons);
  (browser.realReloads || []).forEach((row) => {
    if (row.after?.timeOrigin <= row.before?.timeOrigin) fail('reload_time_origin', row.reason);
    if (!row.beforeLoaderId || !row.afterLoaderId || row.beforeLoaderId === row.afterLoaderId) fail('reload_loader_id', row.reason);
  });
  if (browser.coverage?.newTheaterId !== 'river_crossing' || browser.coverage?.newOperationId !== 'river_ferry' || browser.coverage?.captureObserved !== true || browser.coverage?.operationReviewObserved !== true) fail('new_content_coverage');
  if (candidate.missionGeneralization?.passed !== candidate.missionGeneralization?.total || candidate.theater?.passed !== true) fail('unit_evidence');
  if (candidate.coverage?.after?.missionCount !== 12 || candidate.coverage?.after?.totalCells !== 60 || candidate.coverage?.after?.coveredCells !== 44 || candidate.coverage?.after?.unobservedCells !== 16) fail('coverage_rebaseline', candidate.coverage?.after);
  if (candidate.performance?.passed !== true || candidate.regression?.passed !== true) fail('performance_or_regression');
  return { ok: errors.length === 0, errors };
}

const verdict = verifyStage9Evidence(bundle);
assert.equal(verdict.ok, true, JSON.stringify(verdict.errors));
const output = { stage: '9-A', independentRecompute: true, checks: { browser: true, frames: true, reloads: true, provenance: true, coverage: true, unit: true, performance: true }, browserErrors: [], tamperAuditPending: true, passed: true };
fs.writeFileSync('stage9_a_strong_evidence_verdict.json', `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, stage: output.stage, frames: bundle.browser.browser.captureCount, reloads: bundle.browser.realReloads.length }));
