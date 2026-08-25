import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selfcheck = JSON.parse(fs.readFileSync(path.join(root, 'stage9_e_developer_selfcheck.json'), 'utf8'));
assert.equal(selfcheck.implementationPassed, true);
assert.equal(selfcheck.deliveryClosed, false);
assert.deepEqual(selfcheck.externalGateRuns, { fast: null, stage: null, release: null });
assert.equal(selfcheck.passed, false);
console.log(JSON.stringify({ stage: '9-E.1', implementationPassed: true, deliveryClosed: false, passed: false }));
