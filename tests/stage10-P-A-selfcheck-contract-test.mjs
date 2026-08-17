import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Contract: the committed Stage 10-P-A selfcheck is an implementation-side
// checkpoint. It may claim implementationPassed, but it must never claim
// delivery closure: deliveryClosed and passed stay false until the final CI
// runtime closure (tests/generate-stage10-P-A-final-closure.mjs) binds the
// evidence to the workflow HEAD and run identity. This prevents a committed
// static JSON from contradicting the real GitHub Actions gate result, which is
// exactly the Stage 10-P-A.1 failure mode this closure fixes.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selfcheck = JSON.parse(fs.readFileSync(path.join(root, 'STAGE10-P-A-SELFCHECK.json'), 'utf8'));
assert.equal(selfcheck.stage, '10-P-A');
assert.equal(selfcheck.implementationPassed, true);
assert.equal(selfcheck.deliveryClosed, false);
assert.equal(selfcheck.passed, false);
assert.deepEqual(selfcheck.externalGateRuns, { finalClosureWorkflowRunId: null, finalClosureHead: null, finalClosureConclusion: null });
const evidenceCopy = JSON.parse(fs.readFileSync(path.join(root, 'evidence/stage10-P-A/stage10-P-A-selfcheck.json'), 'utf8'));
assert.deepEqual(evidenceCopy, selfcheck);
console.log(JSON.stringify({ stage: '10-P-A', implementationPassed: true, deliveryClosed: false, passed: false }));
