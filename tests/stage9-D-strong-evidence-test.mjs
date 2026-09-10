import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyStage9DEvidence } from './stage9-D-evidence-verifier.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundle = JSON.parse(fs.readFileSync(path.join(root, 'stage9_d_evidence_bundle.json'), 'utf8'));
const verdict = verifyStage9DEvidence(bundle, { checkFiles: true });
const output = { stage: '9-D', independentRecompute: true, verifier: 'source-derived session/ledger/report/offer/claim/hash recomputation', checks: { browser: verdict.ok, core: bundle.core?.passed === true, authority: bundle.authority?.formalSettlementEquipmentUnchanged === true && bundle.authority?.noBattleDropInSolver === true }, errors: verdict.errors, passed: verdict.ok && bundle.core?.passed === true && bundle.authority?.formalSettlementEquipmentUnchanged === true && bundle.authority?.noBattleDropInSolver === true };
fs.writeFileSync(path.join(root, 'stage9_d_strong_evidence_verdict.json'), `${JSON.stringify(output, null, 2)}\n`);
assert.equal(output.passed, true, JSON.stringify(output));
console.log(JSON.stringify({ ok: true, stage: output.stage, errors: output.errors.length, independentRecompute: output.independentRecompute }));
