import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { verifyDB1aEvidenceBundle } from './lib/stage8-2G-DB1a-evidence-verifier.mjs';

const root = process.cwd();
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const baseline = {
  actionAttribution: read('stage8_2g_db1a_action_attribution_check.json'),
  repairAttribution: read('stage8_2g_db1a_repair_attribution_check.json'),
  repairSemanticBinding: read('stage8_2g_db1a_repair_semantic_binding.json'),
  retreatBinding: read('stage8_2g_db1a_retreat_rear_guard_binding.json'),
  browser: read('stage8_2g_db1a_browser_capture_manifest.json'),
  authority: read('stage8_2g_db1a_authority_check.json'),
  db1aTamper: { passed: true, rejectionCount: 12, cases: Array.from({ length: 12 }, () => ({ rejected: true })) },
  regressions: { unarmed: true, scoutMove: true, scoutFire: true, coverAdvance: true, responsive480: true, responsive390: true, productionLeak: true, DB1: true, DB: true, DA1a: true }
};
const cases = [
  ['global repair contamination', (x) => { x.repairAttribution.totalUnexpectedRepairAnimations = 1; }],
  ['missing repair source', (x) => { x.repairSemanticBinding.negativeTests.missingSourceRejected = false; }],
  ['missing repair target', (x) => { x.repairSemanticBinding.negativeTests.missingTargetRejected = false; }],
  ['wrong repair source', (x) => { x.repairSemanticBinding.negativeTests.wrongSourceRejected = false; }],
  ['browser selected Scout instead of repair source', (x) => { const frame = x.browser.repairBinding.frames[0]; frame.selectedActorId = 'scout'; }],
  ['HUD selected actor mismatch', (x) => { const frame = x.browser.repairBinding.frames[0]; frame.selectedHudActorId = 'scout'; }],
  ['remove retreat actor', (x) => { x.retreatBinding.negativeTests.missingRetreatRejected = false; }],
  ['remove rear guard actor', (x) => { x.retreatBinding.negativeTests.missingRearGuardRejected = false; }],
  ['authority repair event changed', (x) => { x.authority.rows[0].repairSourceChanged = 1; }],
  ['old D-B.1 tamper replaced', (x) => { x.db1aTamper.rejectionCount = 11; }],
  ['responsive 480 regression', (x) => { x.regressions.responsive480 = false; }],
  ['production leak regression', (x) => { x.regressions.productionLeak = false; }]
];
const results = cases.map(([name, mutate]) => { const candidate = structuredClone(baseline); mutate(candidate); const check = verifyDB1aEvidenceBundle(candidate); assert.equal(check.ok, false, `tamper accepted: ${name}`); return { name, rejected: true, errors: check.errors }; });
const output = { stage: '8.2G-D-B.1a', kind: 'evidence_tamper_matrix', cases: results, rejectionCount: results.length, requiredMinimum: 12, passed: results.length >= 12 && results.every((item) => item.rejected) };
fs.writeFileSync(path.join(root, 'stage8_2g_db1a_tamper_results.json'), `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true);
console.log(JSON.stringify({ ok: true, stage: output.stage, tamperCases: results.length, rejected: results.length }));
