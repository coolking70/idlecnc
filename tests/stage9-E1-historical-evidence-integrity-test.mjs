import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = '5f7bbdd00fe5a2b3a029bcbbc8e550019f0034b6';
const historicalPattern = /^(stage8_.*\.json|stage9_[abcd]_.*\.json)$/;
const baselinePaths = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  .split('\n').map((row) => row.trim()).filter((row) => historicalPattern.test(row));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const mismatches = [];
baselinePaths.forEach((relativePath) => {
  const baselineBytes = execFileSync('git', ['show', `${baseline}:${relativePath}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 });
  const currentPath = path.join(root, relativePath);
  if (!fs.existsSync(currentPath) || hash(fs.readFileSync(currentPath)) !== hash(baselineBytes)) {
    mismatches.push(relativePath);
  }
});
assert.deepEqual(mismatches, [], JSON.stringify({ baseline, mismatches }, null, 2));
console.log(JSON.stringify({ stage: '9-E.1', baseline, checked: baselinePaths.length, whitelist: [], mismatches }));
