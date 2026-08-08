import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { verifyDB1EvidenceBundle } from './lib/stage8-2G-DB1-evidence-verifier.mjs';

const root = process.cwd();
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const baseline = {
  unarmed: read('stage8_2g_db1_unarmed_state_check.json'),
  semantic: read('stage8_2g_db1_semantic_resolution.json'),
  machine: read('stage8_2g_db1_machine_evidence.json'),
  browser: read('stage8_2g_db1_browser_capture_manifest.json'),
  responsive: read('stage8_2g_db1_responsive_geometry.json'),
  leak: read('stage8_2g_db1_production_leak_check.json')
};
const cases = [
  ['unarmed fire state', (x) => { x.unarmed.violations = [{ actorId: 'tampered-unarmed', visualState: 'fire' }]; }],
  ['unarmed authority mutation', (x) => { x.unarmed.authority.plannerModified = true; }],
  ['unresolved semantic frame', (x) => { x.semantic.unresolved = ['formal-victory/scout-fire']; }],
  ['semantic predicate relabel', (x) => { x.browser.scenes[0].frames.find((frame) => frame.semanticCheck).productionSemanticPredicate.id = 'cover-advance'; }],
  ['semantic state signature', (x) => { const frame = x.browser.scenes[0].frames.find((item) => item.semanticCheck); frame.stateSignature = 'tampered'; }],
  ['fake repair anchor', (x) => { const frame = x.semantic.resolutions.find((item) => item.semanticName === 'repair-action'); frame.predicate.details.formalRepairEvent = false; frame.recomputedPredicate.passed = false; }],
  ['missing browser frame', (x) => { x.browser.browser.captureCount = 9; }],
  ['duplicate browser PNG', (x) => { x.browser.browser.uniqueImageHashes = 9; }],
  ['narrow sidebar restored', (x) => { x.responsive.viewport[0].panelHidden = false; }],
  ['narrow battlefield shrunk', (x) => { x.responsive.viewport[1].battlefieldWidthRatio = .35; }],
  ['production stage leak', (x) => { x.leak.productionDomForbidden = ['Stage 8.2G']; x.leak.passed = false; }],
  ['debug diagnostics removed', (x) => { x.leak.debugOverlayPreserved = false; }]
];
const results = cases.map(([name, mutate]) => { const candidate = structuredClone(baseline); mutate(candidate); const check = verifyDB1EvidenceBundle(candidate); assert.equal(check.ok, false, `tamper accepted: ${name}`); return { name, rejected: true, errors: check.errors }; });
const output = { stage: '8.2G-D-B.1', kind: 'evidence_tamper_matrix', cases: results, rejectionCount: results.length, requiredMinimum: 12, passed: results.length >= 12 && results.every((item) => item.rejected) };
fs.writeFileSync(path.join(root, 'stage8_2g_db1_tamper_results.json'), `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true); console.log(JSON.stringify({ ok: true, stage: output.stage, tamperCases: results.length, rejected: results.length }));

